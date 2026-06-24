import { useMemo, useCallback, useState, useEffect } from 'react';
import { ReactFlow, MiniMap, Controls, Background, useNodesState, useEdgesState, useReactFlow, ReactFlowProvider } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import TableNode from './TableNode';
import { Icon } from '../ui';

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

function ERDiagramInner({ schema, selectedTables, selectedColumns, onToggleTable, onToggleColumn, onSelectAllColumns, onReset }) {
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

  const onNodeDoubleClick = useCallback((_, node) => {
    const t = allTables.find(t => t.name === node.id);
    if (!t) return;
    if (!isSelected(t.name)) onToggleTable(t);
    onSelectAllColumns(t);
    expandFromNode(t.name);
  }, [allTables, isSelected, onToggleTable, onSelectAllColumns, expandFromNode]);

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

      {/* Canvas */}
      <div style={{ flex: 1, height: '100%' }}>
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
