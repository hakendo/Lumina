import { useMemo, useCallback, useState, useEffect } from 'react';
import { ReactFlow, MiniMap, Controls, Background, useNodesState, useEdgesState, useReactFlow, ReactFlowProvider } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import TableNode from './TableNode';
import { Icon, Button } from '../ui';
import api from '../../lib/api';

const nodeTypes = { table: TableNode };

function getRelatedTables(tableName, fks) {
  const related = new Set();
  for (const fk of fks) {
    if (fk.fromTable === tableName) related.add(fk.toTable);
    if (fk.toTable === tableName) related.add(fk.fromTable);
  }
  return related;
}

function autoLayout(tables, foreignKeys) {
  if (!tables.length) return [];
  const fkCount = new Map();
  for (const fk of foreignKeys) {
    fkCount.set(fk.fromTable, (fkCount.get(fk.fromTable) || 0) + 1);
    fkCount.set(fk.toTable, (fkCount.get(fk.toTable) || 0) + 1);
  }
  const sorted = [...tables].sort((a, b) => (fkCount.get(b.name) || 0) - (fkCount.get(a.name) || 0));
  const cols = Math.max(2, Math.ceil(Math.sqrt(sorted.length)));
  const spacingX = 320;
  const spacingY = 380;
  return sorted.map((t, i) => ({
    x: (i % cols) * spacingX,
    y: Math.floor(i / cols) * spacingY,
  }));
}

const MODES = [
  { key: 'query', icon: 'filter', label: 'Query', hint: 'Tablas de la query actual' },
  { key: 'focus', icon: 'search', label: 'Foco', hint: 'Click = ver tabla + relacionadas' },
  { key: 'add', icon: 'layers', label: 'Esquema', hint: 'Click = explorar esquema completo' },
];

function ERDiagramInner({ schema, selectedTables, selectedColumns, onToggleTable, onToggleColumn, onSelectAllColumns, onReset, query, joins: externalJoins, onJoinsChange, suggestedJoins: externalSuggested, datasetId, dbType, connectionString }) {
  const [bottomOpen, setBottomOpen] = useState(true);
  const [topN, setTopN] = useState(50);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [previewResult, setPreviewResult] = useState(null);

  useEffect(() => {
    setPreviewResult(null);
    setPreviewError('');
  }, [query]);

  const runPreview = async () => {
    if (!query?.trim()) return;
    setPreviewing(true); setPreviewError(''); setPreviewResult(null);
    try {
      const reqBody = connectionString
        ? { dbType, connectionString, query, limit: topN }
        : { datasetId, query, limit: topN };
      const { data } = await api.post('/datasets/db-connector/preview-query', reqBody);
      setPreviewResult(data);
    } catch (err) {
      setPreviewError(err.response?.data?.error || err.message);
    } finally {
      setPreviewing(false);
    }
  };
  const allTables = schema?.tables || [];
  const fks = schema?.foreignKeys || [];
  const [search, setSearch] = useState('');
  const [mode, setMode] = useState(selectedTables.length > 0 ? 'query' : 'focus');
  const [diagramTables, setDiagramTables] = useState(new Set());
  const [focusTable, setFocusTable] = useState(null);
  const { fitView } = useReactFlow();

  const isSelected = useCallback((name) => selectedTables.some(t => t.name === name), [selectedTables]);
  const getCols = useCallback((name) => selectedColumns[name] || [], [selectedColumns]);

  const visibleTableNames = useMemo(() => {
    if (mode === 'query') {
      return new Set(selectedTables.map(t => t.name));
    }
    if (mode === 'add') {
      const names = new Set(diagramTables);
      for (const t of selectedTables) names.add(t.name);
      return names;
    }
    // mode === 'focus'
    if (focusTable) {
      const names = new Set([focusTable]);
      for (const r of getRelatedTables(focusTable, fks)) names.add(r);
      return names;
    }
    return new Set(selectedTables.map(t => t.name));
  }, [focusTable, selectedTables, fks, allTables, mode, diagramTables]);

  const visibleTables = useMemo(() =>
    allTables.filter(t => visibleTableNames.has(t.name)),
    [allTables, visibleTableNames]
  );

  const visibleFks = useMemo(() =>
    fks.filter(fk => visibleTableNames.has(fk.fromTable) && visibleTableNames.has(fk.toTable)),
    [fks, visibleTableNames]
  );

  const positions = useMemo(() => autoLayout(visibleTables, visibleFks), [visibleTables, visibleFks]);

  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

  useEffect(() => {
    const newNodes = visibleTables.map((t, i) => ({
      id: t.name,
      type: 'table',
      position: positions[i] || { x: 0, y: 0 },
      data: {
        table: t,
        selected: isSelected(t.name),
        selectedCols: getCols(t.name),
        onToggleTable,
        onToggleColumn,
        onSelectAll: onSelectAllColumns,
      },
    }));
    setNodes(newNodes);
    setTimeout(() => fitView({ padding: 0.1, duration: 300 }), 150);
  }, [visibleTables, positions]);

  useEffect(() => {
    setNodes(prev => prev.map(n => ({
      ...n,
      data: {
        ...n.data,
        selected: isSelected(n.id),
        selectedCols: getCols(n.id),
        onToggleTable,
        onToggleColumn,
        onSelectAll: onSelectAllColumns,
      },
    })));
  }, [selectedTables, selectedColumns, onToggleTable, onToggleColumn, onSelectAllColumns]);

  useEffect(() => {
    setEdges(visibleFks.map(fk => {
      const bothSelected = isSelected(fk.fromTable) && isSelected(fk.toTable);
      return {
        id: `${fk.constraintName || ''}-${fk.fromTable}.${fk.fromColumn}-${fk.toTable}.${fk.toColumn}`,
        source: fk.fromTable,
        sourceHandle: `${fk.fromTable}.${fk.fromColumn}`,
        target: fk.toTable,
        targetHandle: `${fk.toTable}.${fk.toColumn}`,
        type: 'smoothstep',
        animated: bothSelected,
        style: {
          stroke: bothSelected ? 'var(--color-lumen)' : 'var(--color-line)',
          strokeDasharray: bothSelected ? undefined : '5 5',
          strokeWidth: bothSelected ? 2 : 1,
        },
        label: `${fk.fromColumn} → ${fk.toColumn}`,
        labelStyle: { fontSize: 9, fill: 'var(--color-ink-faint)' },
      };
    }));
  }, [visibleFks, selectedTables]);

  const handleSidebarClick = (t) => {
    if (mode === 'query') {
      onToggleTable(t);
    } else if (mode === 'focus') {
      setFocusTable(prev => prev === t.name ? null : t.name);
    } else if (mode === 'add') {
      setDiagramTables(prev => {
        const next = new Set(prev);
        if (next.has(t.name)) {
          next.delete(t.name);
        } else {
          next.add(t.name);
          for (const r of getRelatedTables(t.name, fks)) next.add(r);
        }
        return next;
      });
    }
  };

  const expandFromNode = useCallback((tableName) => {
    const related = getRelatedTables(tableName, fks);
    setDiagramTables(prev => {
      const next = new Set(prev);
      next.add(tableName);
      for (const r of related) next.add(r);
      return next;
    });
    setMode('add');
  }, [fks]);

  const selectAll = () => {
    if (!confirm('¿Seleccionar todas las tablas? Esto puede generar una query muy grande.')) return;
    for (const t of allTables) {
      if (!isSelected(t.name)) onToggleTable(t);
    }
  };

  const deselectAll = () => {
    if (selectedTables.length === 0) return;
    if (!confirm('¿Deseleccionar todas las tablas? Se perderá la selección actual de columnas y joins.')) return;
    for (const t of [...selectedTables]) {
      onToggleTable(t);
    }
    setDiagramTables(new Set());
    setFocusTable(null);
  };

  const clearDiagram = () => {
    if (mode === 'query' && onReset) {
      onReset();
    } else if (mode === 'add') {
      setDiagramTables(new Set());
    }
    setFocusTable(null);
  };

  const filteredList = search
    ? allTables.filter(t => t.name.toLowerCase().includes(search.toLowerCase()))
    : allTables;

  const relatedCount = useMemo(() => {
    const counts = new Map();
    for (const t of allTables) {
      counts.set(t.name, getRelatedTables(t.name, fks).size);
    }
    return counts;
  }, [allTables, fks]);

  const onNodeDoubleClick = useCallback((e, node) => {
    e.stopPropagation();
    const t = allTables.find(t => t.name === node.id);
    if (!t) return;
    if (!isSelected(t.name)) onToggleTable(t);
    onSelectAllColumns(t);
  }, [allTables, isSelected, onToggleTable, onSelectAllColumns]);

  const tableAliases = useMemo(() =>
    selectedTables.map((t, i) => ({ ...t, alias: t.alias || `t${i}` })),
    [selectedTables]
  );

  const joinExists = useCallback((fromTable, fromCol, toTable, toCol) =>
    (externalJoins || []).some(j =>
      (j.leftTable === fromTable && j.leftColumn === fromCol && j.rightTable === toTable && j.rightColumn === toCol) ||
      (j.leftTable === toTable && j.leftColumn === toCol && j.rightTable === fromTable && j.rightColumn === fromCol)
    ), [externalJoins]);

  const applySuggestion = useCallback((s) => {
    if (!onJoinsChange) return;
    const leftAlias = tableAliases.find(t => t.name === s.fromTable)?.alias;
    const rightAlias = tableAliases.find(t => t.name === s.toTable)?.alias;
    if (!leftAlias || !rightAlias) return;
    if (joinExists(leftAlias, s.fromColumn, rightAlias, s.toColumn)) return;
    onJoinsChange([...(externalJoins || []), { type: 'INNER', leftTable: leftAlias, leftColumn: s.fromColumn, rightTable: rightAlias, rightColumn: s.toColumn }]);
  }, [onJoinsChange, externalJoins, tableAliases, joinExists]);

  const pendingSuggested = useMemo(() => (externalSuggested || []).filter(s => {
    const leftAlias = tableAliases.find(t => t.name === s.fromTable)?.alias;
    const rightAlias = tableAliases.find(t => t.name === s.toTable)?.alias;
    if (!leftAlias || !rightAlias) return false;
    return !joinExists(leftAlias, s.fromColumn, rightAlias, s.toColumn);
  }), [externalSuggested, tableAliases, joinExists]);

  const applyAllSuggestions = useCallback(() => {
    if (!onJoinsChange) return;
    const added = pendingSuggested.map(s => ({
      type: 'INNER',
      leftTable: tableAliases.find(t => t.name === s.fromTable)?.alias,
      leftColumn: s.fromColumn,
      rightTable: tableAliases.find(t => t.name === s.toTable)?.alias,
      rightColumn: s.toColumn,
    })).filter(j => j.leftTable && j.rightTable);
    onJoinsChange([...(externalJoins || []), ...added]);
  }, [onJoinsChange, externalJoins, tableAliases, pendingSuggested]);

  const addEmptyJoin = useCallback(() => {
    if (!onJoinsChange) return;
    const usedAliases = new Set((externalJoins || []).flatMap(j => [j.leftTable, j.rightTable]));
    const unused = tableAliases.filter(t => !usedAliases.has(t.alias));
    const left = tableAliases[0]?.alias || '';
    const right = unused[0]?.alias || tableAliases[1]?.alias || '';
    onJoinsChange([...(externalJoins || []), { type: 'INNER', leftTable: left, leftColumn: '', rightTable: right, rightColumn: '' }]);
  }, [onJoinsChange, externalJoins, tableAliases]);

  return (
    <div className="flex h-full">
      <div className="w-64 shrink-0 border-r border-line-soft flex flex-col bg-paper">
        {/* Mode toggle */}
        <div className="flex gap-0.5 p-1.5 border-b border-line-soft shrink-0">
          {MODES.map(m => (
            <button key={m.key} type="button" onClick={() => { setMode(m.key); setFocusTable(null); if (m.key !== 'add') setDiagramTables(new Set()); }}
              title={m.hint}
              className={`flex-1 flex items-center justify-center gap-1 px-2 py-1 text-[10px] font-medium rounded transition ${
                mode === m.key ? 'bg-surface text-ink shadow-sm' : 'text-ink-faint hover:text-ink'
              }`}>
              <Icon name={m.icon} size={11} />{m.label}
            </button>
          ))}
        </div>

        {/* Actions */}
        <div className="flex gap-1 px-2 py-1.5 border-b border-line-soft shrink-0">
          <button type="button" onClick={selectAll}
            className="text-[10px] text-lumen-deep hover:underline">Seleccionar todo</button>
          <span className="text-ink-faint text-[10px]">·</span>
          <button type="button" onClick={deselectAll}
            className="text-[10px] text-rust hover:underline">Ninguna</button>
          <span className="text-ink-faint text-[10px]">·</span>
          <button type="button" onClick={clearDiagram}
            className="text-[10px] text-ink-faint hover:underline">Limpiar</button>
        </div>

        {/* Search */}
        <div className="p-2 border-b border-line-soft shrink-0">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar tabla…"
            className="field field-sm w-full"
          />
        </div>

        {/* Table list */}
        <div className="flex-1 overflow-y-auto">
          {filteredList.map(t => {
            const isFocused = focusTable === t.name;
            const inDiagram = visibleTableNames.has(t.name);
            const sel = isSelected(t.name);
            const rels = relatedCount.get(t.name) || 0;
            return (
              <div key={t.name}
                className={`flex items-center gap-1.5 px-2 py-1 text-[11px] cursor-pointer border-l-2 transition ${
                  isFocused ? 'border-lumen bg-lumen-soft/30 font-semibold' :
                  sel ? 'border-lumen/50 bg-lumen-soft/10' :
                  inDiagram ? 'border-sea/40 bg-sea/5' :
                  'border-transparent hover:bg-paper-deep/60'
                }`}
                onClick={() => handleSidebarClick(t)}>
                <input type="checkbox" checked={sel}
                  onChange={(e) => { e.stopPropagation(); onToggleTable(t); }}
                  className="accent-lumen shrink-0" />
                <Icon name={t.type === 'view' ? 'eye' : 'table'} size={11} className="text-ink-faint shrink-0" />
                <span className="truncate flex-1">{t.name}</span>
                {inDiagram && !sel && (
                  <span className="w-1.5 h-1.5 rounded-full bg-sea shrink-0" title="En diagrama" />
                )}
                {rels > 0 && (
                  <span className="text-[9px] text-ink-faint bg-paper-deep px-1 rounded shrink-0">{rels}</span>
                )}
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="p-2 border-t border-line-soft text-[10px] text-ink-faint shrink-0 space-y-0.5">
          <div>{selectedTables.length} seleccionadas · {visibleTables.length} en diagrama</div>
          <div className="text-[9px] italic">
            {mode === 'query' ? 'Click = agregar/quitar de query' : mode === 'focus' ? 'Click = ver relaciones' : 'Click = explorar esquema'}
            {' · '}Doble-click nodo = seleccionar todo
          </div>
        </div>
      </div>

      {/* Right panel: canvas + bottom SQL */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%' }}>
        <div style={{ flex: 1 }}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeDoubleClick={onNodeDoubleClick}
            nodeTypes={nodeTypes}
            fitView
            minZoom={0.05}
            maxZoom={2}
            defaultEdgeOptions={{ type: 'smoothstep' }}
            proOptions={{ hideAttribution: true }}
          >
            <Background color="var(--color-line-soft)" gap={20} size={1} />
            <Controls className="!bg-surface !border-line !shadow-sm" />
            <MiniMap
              nodeStrokeColor={(n) => isSelected(n.id) ? 'var(--color-lumen)' : 'var(--color-line)'}
              nodeColor={(n) => isSelected(n.id) ? 'var(--color-lumen-soft)' : 'var(--color-paper-deep)'}
              className="!bg-paper !border-line"
            />
          </ReactFlow>
        </div>

        {/* Bottom panel: SQL + Joins */}
        <div className="border-t border-line-soft bg-paper shrink-0">
          <button type="button" onClick={() => setBottomOpen(p => !p)}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] font-semibold text-ink-faint hover:text-ink transition">
            <Icon name={bottomOpen ? 'chevronDown' : 'chevronRight'} size={12} />
            SQL Generado
            {externalJoins?.length > 0 && (
              <span className="bg-lumen-soft text-lumen-deep px-1.5 py-0.5 rounded text-[9px] font-mono">{externalJoins.length} join{externalJoins.length > 1 ? 's' : ''}</span>
            )}
            {selectedTables.length > 1 && (!externalJoins?.length) && (
              <span className="bg-rust/10 text-rust px-1.5 py-0.5 rounded text-[9px]">Sin joins</span>
            )}
            {pendingSuggested.length > 0 && (
              <span className="bg-sea/10 text-sea px-1.5 py-0.5 rounded text-[9px]">{pendingSuggested.length} sugerido{pendingSuggested.length > 1 ? 's' : ''}</span>
            )}
          </button>
          {bottomOpen && (
            <div className="px-3 pb-3 space-y-3 max-h-[45vh] overflow-y-auto">
              {onJoinsChange && selectedTables.length > 1 && (
                <button type="button" onClick={addEmptyJoin}
                  className="flex items-center gap-1 text-[10px] font-medium text-lumen-deep hover:underline">
                  <Icon name="plus" size={11} /> Agregar join
                </button>
              )}
              {externalJoins?.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-[10px] font-semibold text-ink-soft">Joins configurados ({externalJoins.length})</p>
                  <div className="space-y-2 max-h-40 overflow-y-auto pr-0.5">
                    {externalJoins.map((j, i) => {
                      const incomplete = !j.leftTable || !j.leftColumn || !j.rightTable || !j.rightColumn;
                      return (
                        <div key={i} className={`relative flex items-center gap-1.5 text-[10px] font-mono rounded-lg pl-3 pr-2 py-2 flex-wrap border-l-4 border border-y-line-soft border-r-line-soft shadow-sm ${
                          incomplete ? 'bg-rust/5 border-l-rust' : 'bg-surface border-l-lumen'
                        }`}>
                          <span className={`absolute -left-1.5 -top-1.5 w-4 h-4 rounded-full grid place-items-center text-[8px] font-sans font-bold text-paper ${incomplete ? 'bg-rust' : 'bg-lumen-deep'}`}>
                            {i + 1}
                          </span>
                          {incomplete && (
                            <span className="w-full text-[9px] font-sans font-semibold text-rust -mb-0.5">
                              ⚠ Configura tabla y columna de esta relación
                            </span>
                          )}
                          <select value={j.type || 'INNER'} onChange={(e) => onJoinsChange(externalJoins.map((jj, idx) => idx === i ? { ...jj, type: e.target.value } : jj))}
                            className="field field-sm field-mono !text-[10px] !py-0.5">
                            {['INNER', 'LEFT', 'RIGHT'].map(jt => <option key={jt} value={jt}>{jt}</option>)}
                          </select>
                          <select value={j.leftTable} onChange={(e) => onJoinsChange(externalJoins.map((jj, idx) => idx === i ? { ...jj, leftTable: e.target.value } : jj))}
                            className="field field-sm field-mono !text-[10px] !py-0.5 min-w-[70px]">
                            <option value="">Tabla</option>
                            {tableAliases.map(t => <option key={t.alias} value={t.alias}>{t.name} ({t.alias})</option>)}
                          </select>
                          <select value={j.leftColumn} onChange={(e) => onJoinsChange(externalJoins.map((jj, idx) => idx === i ? { ...jj, leftColumn: e.target.value } : jj))}
                            className="field field-sm field-mono !text-[10px] !py-0.5 min-w-[70px]">
                            <option value="">Columna</option>
                            {(allTables.find(t => t.name === tableAliases.find(ta => ta.alias === j.leftTable)?.name)?.columns || []).map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
                          </select>
                          <span className="text-ink-faint">=</span>
                          <select value={j.rightTable} onChange={(e) => onJoinsChange(externalJoins.map((jj, idx) => idx === i ? { ...jj, rightTable: e.target.value } : jj))}
                            className="field field-sm field-mono !text-[10px] !py-0.5 min-w-[70px]">
                            <option value="">Tabla</option>
                            {tableAliases.map(t => <option key={t.alias} value={t.alias}>{t.name} ({t.alias})</option>)}
                          </select>
                          <select value={j.rightColumn} onChange={(e) => onJoinsChange(externalJoins.map((jj, idx) => idx === i ? { ...jj, rightColumn: e.target.value } : jj))}
                            className="field field-sm field-mono !text-[10px] !py-0.5 min-w-[70px]">
                            <option value="">Columna</option>
                            {(allTables.find(t => t.name === tableAliases.find(ta => ta.alias === j.rightTable)?.name)?.columns || []).map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
                          </select>
                          {onJoinsChange && (
                            <button type="button" onClick={() => onJoinsChange(externalJoins.filter((_, idx) => idx !== i))}
                              className="ml-auto text-rust hover:text-rust/80">
                              <Icon name="x" size={11} />
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              {pendingSuggested.length > 0 && (
                <div className="text-[10px] text-sea space-y-0.5">
                  <div className="flex items-center justify-between">
                    <p className="font-semibold">Relaciones detectadas (click para agregar):</p>
                    {onJoinsChange && (
                      <button type="button" onClick={applyAllSuggestions}
                        className="font-medium hover:underline shrink-0">
                        Agregar todas
                      </button>
                    )}
                  </div>
                  {pendingSuggested.map((s, i) => (
                    <button key={i} type="button" onClick={() => applySuggestion(s)}
                      className="flex items-center gap-1 hover:underline">
                      <Icon name="plus" size={10} />
                      {s.fromTable}.{s.fromColumn} → {s.toTable}.{s.toColumn}
                    </button>
                  ))}
                </div>
              )}
              <div>
                <p className="text-[10px] font-semibold text-ink-soft mb-1">SQL generado</p>
                {query ? (
                  <pre className="text-[10px] font-mono bg-paper-deep rounded-lg p-2 whitespace-pre-wrap overflow-x-auto">{query}</pre>
                ) : (
                  <p className="text-[10px] text-ink-faint italic">Selecciona tablas y columnas para generar SQL</p>
                )}
              </div>

              {query && (datasetId || connectionString) && (
                <div className="border-t border-line-soft pt-3 space-y-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <label className="text-[10px] text-ink-faint whitespace-nowrap shrink-0">Top N</label>
                    <input type="number" min={1} max={1000} value={topN}
                      onChange={(e) => setTopN(Math.min(1000, Math.max(1, Number(e.target.value) || 1)))}
                      className="field field-sm field-mono !text-[10px] !py-0.5 w-16 shrink-0" />
                    <Button type="button" variant="soft" size="sm" onClick={runPreview} disabled={previewing || !query.trim()} className="shrink-0 !text-[10px] !py-1">
                      {previewing ? (
                        <><Icon name="refresh" size={11} className="animate-spin inline mr-1" />Ejecutando…</>
                      ) : (
                        <>Ejecutar preview</>
                      )}
                    </Button>
                    {previewResult && (
                      <span className="text-[9px] text-ink-faint shrink-0">{previewResult.count} fila{previewResult.count !== 1 ? 's' : ''}</span>
                    )}
                  </div>
                  {previewError && (
                    <div className="flex items-start gap-1.5 text-[10px] px-2 py-1.5 rounded-lg bg-rust/10 border border-rust/20 text-rust">
                      <Icon name="alertTriangle" size={12} className="mt-0.5 shrink-0" />
                      <span>{previewError}</span>
                    </div>
                  )}
                  {previewResult && (
                    <div className="border border-line-soft rounded-lg overflow-auto max-h-48">
                      <table className="text-[9px] font-mono w-full border-collapse">
                        <thead className="sticky top-0 bg-paper-deep">
                          <tr>
                            {previewResult.columns.map(c => (
                              <th key={c} className="text-left px-1.5 py-1 border-b border-line-soft font-semibold whitespace-nowrap">{c}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {previewResult.rows.map((row, i) => (
                            <tr key={i} className="odd:bg-paper-deep/30">
                              {previewResult.columns.map(c => (
                                <td key={c} className="px-1.5 py-1 border-b border-line-soft/50 whitespace-nowrap">{String(row[c] ?? '')}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ERDiagram(props) {
  return (
    <ReactFlowProvider>
      <ERDiagramInner {...props} />
    </ReactFlowProvider>
  );
}
