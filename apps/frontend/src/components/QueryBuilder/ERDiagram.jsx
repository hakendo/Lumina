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

function ERDiagramInner({ schema, selectedTables, selectedColumns, onToggleTable, onToggleColumn, onSelectAllColumns }) {
  const allTables = schema?.tables || [];
  const fks = schema?.foreignKeys || [];
  const [search, setSearch] = useState('');
  const [focusTable, setFocusTable] = useState(null);
  const { fitView } = useReactFlow();

  const isSelected = useCallback((name) => selectedTables.some(t => t.name === name), [selectedTables]);
  const getCols = useCallback((name) => selectedColumns[name] || [], [selectedColumns]);

  const visibleTableNames = useMemo(() => {
    if (!focusTable) {
      const names = new Set();
      for (const t of selectedTables) {
        names.add(t.name);
        for (const r of getRelatedTables(t.name, fks)) names.add(r);
      }
      return names.size > 0 ? names : new Set(allTables.slice(0, 30).map(t => t.name));
    }
    const names = new Set([focusTable]);
    for (const r of getRelatedTables(focusTable, fks)) names.add(r);
    return names;
  }, [focusTable, selectedTables, fks, allTables]);

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
    setTimeout(() => fitView({ padding: 0.1, duration: 300 }), 100);
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

  return (
    <div className="flex h-full">
      {/* Sidebar — tabla list */}
      <div className="w-64 shrink-0 border-r border-line-soft flex flex-col bg-paper">
        <div className="p-2 border-b border-line-soft shrink-0">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar tabla…"
            className="field field-sm w-full"
          />
        </div>
        <div className="flex-1 overflow-y-auto">
          {filteredList.map(t => {
            const isFocused = focusTable === t.name;
            const sel = isSelected(t.name);
            const rels = relatedCount.get(t.name) || 0;
            return (
              <div key={t.name}
                className={`flex items-center gap-1.5 px-2 py-1 text-[11px] cursor-pointer border-l-2 transition ${
                  isFocused ? 'border-lumen bg-lumen-soft/30 font-semibold' :
                  sel ? 'border-lumen/50 bg-lumen-soft/10' :
                  'border-transparent hover:bg-paper-deep/60'
                }`}
                onClick={() => setFocusTable(isFocused ? null : t.name)}>
                <input type="checkbox" checked={sel}
                  onChange={(e) => { e.stopPropagation(); onToggleTable(t); }}
                  className="accent-lumen shrink-0" />
                <Icon name={t.type === 'view' ? 'eye' : 'table'} size={11} className="text-ink-faint shrink-0" />
                <span className="truncate flex-1">{t.name}</span>
                {rels > 0 && (
                  <span className="text-[9px] text-ink-faint bg-paper-deep px-1 rounded shrink-0">{rels}</span>
                )}
              </div>
            );
          })}
        </div>
        <div className="p-2 border-t border-line-soft text-[10px] text-ink-faint shrink-0">
          {selectedTables.length} seleccionadas · {visibleTables.length} en diagrama
        </div>
      </div>

      {/* Canvas */}
      <div style={{ flex: 1, height: '100%' }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
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
