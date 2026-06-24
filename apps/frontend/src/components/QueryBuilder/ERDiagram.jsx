import { useMemo, useCallback, useState } from 'react';
import { ReactFlow, MiniMap, Controls, Background, useNodesState, useEdgesState } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import TableNode from './TableNode';

const nodeTypes = { table: TableNode };

function autoLayout(tables, foreignKeys) {
  const fkCount = new Map();
  for (const fk of foreignKeys) {
    fkCount.set(fk.fromTable, (fkCount.get(fk.fromTable) || 0) + 1);
    fkCount.set(fk.toTable, (fkCount.get(fk.toTable) || 0) + 1);
  }

  const sorted = [...tables].sort((a, b) => (fkCount.get(b.name) || 0) - (fkCount.get(a.name) || 0));
  const cols = Math.max(3, Math.ceil(Math.sqrt(sorted.length)));
  const spacingX = 320;
  const spacingY = 360;

  return sorted.map((t, i) => ({
    x: (i % cols) * spacingX,
    y: Math.floor(i / cols) * spacingY,
  }));
}

export default function ERDiagram({ schema, selectedTables, selectedColumns, onToggleTable, onToggleColumn, onSelectAllColumns }) {
  const tables = schema?.tables || [];
  const fks = schema?.foreignKeys || [];
  const [search, setSearch] = useState('');

  const isSelected = useCallback((name) => selectedTables.some(t => t.name === name), [selectedTables]);
  const getCols = useCallback((name) => selectedColumns[name] || [], [selectedColumns]);

  const initialNodes = useMemo(() => {
    const positions = autoLayout(tables, fks);
    return tables.map((t, i) => ({
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
  }, [tables, fks]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

  useMemo(() => {
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

  useMemo(() => {
    const tableNames = new Set(tables.map(t => t.name));
    const newEdges = fks
      .filter(fk => tableNames.has(fk.fromTable) && tableNames.has(fk.toTable))
      .map(fk => {
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
          label: bothSelected ? `${fk.fromColumn} → ${fk.toColumn}` : undefined,
          labelStyle: { fontSize: 9, fill: 'var(--color-ink-faint)' },
        };
      });
    setEdges(newEdges);
  }, [fks, tables, selectedTables]);

  const filtered = search
    ? tables.filter(t => t.name.toLowerCase().includes(search.toLowerCase()))
    : null;

  const onSearchFocus = useCallback(() => {
    if (!filtered?.length) return;
    const node = nodes.find(n => n.id === filtered[0].name);
    if (node) {
      // React Flow fitView doesn't have a focus API, but we can use the node position
    }
  }, [filtered, nodes]);

  return (
    <div className="flex flex-col h-full">
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Buscar tabla…"
        className="field field-sm mb-2 shrink-0"
      />
      {search && filtered && (
        <div className="flex flex-wrap gap-1 mb-1 shrink-0">
          {filtered.slice(0, 8).map(t => (
            <button key={t.name} type="button"
              onClick={() => {
                const node = nodes.find(n => n.id === t.name);
                if (node) {
                  setNodes(prev => prev.map(n => n.id === t.name
                    ? { ...n, selected: true }
                    : { ...n, selected: false }
                  ));
                }
                setSearch('');
              }}
              className={`text-[10px] px-1.5 py-0.5 rounded border transition ${
                isSelected(t.name) ? 'bg-lumen-soft border-lumen text-lumen-deep' : 'bg-paper-deep border-line text-ink-faint hover:text-ink'
              }`}>
              {t.name}
            </button>
          ))}
          {filtered.length > 8 && <span className="text-[10px] text-ink-faint">+{filtered.length - 8}</span>}
        </div>
      )}
      <div className="flex-1 rounded-lg overflow-hidden border border-line-soft" style={{ minHeight: 450 }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={nodeTypes}
          fitView
          minZoom={0.1}
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
