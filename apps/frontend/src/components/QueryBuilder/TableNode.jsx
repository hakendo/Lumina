import { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import { Icon } from '../ui';

const MAX_VISIBLE_COLS = 15;

function TableNode({ data }) {
  const { table, selected, selectedCols = [], onToggleTable, onToggleColumn, onSelectAll } = data;
  const cols = table.columns || [];
  const visible = cols.slice(0, MAX_VISIBLE_COLS);
  const overflow = cols.length - MAX_VISIBLE_COLS;

  return (
    <div className={`rounded-lg border shadow-sm min-w-[220px] max-w-[280px] text-[11px] bg-surface transition-colors ${
      selected ? 'border-lumen shadow-md' : 'border-line'
    }`}>
      <div className={`flex items-center gap-1.5 px-2 py-1.5 rounded-t-lg cursor-pointer select-none ${
        table.type === 'view' ? 'bg-sea/10' : 'bg-lumen-soft/60'
      }`}
        onClick={() => onToggleTable(table)}>
        <input type="checkbox" checked={selected} readOnly className="accent-lumen pointer-events-none" />
        <Icon name={table.type === 'view' ? 'eye' : 'table'} size={12} className="text-ink-faint shrink-0" />
        <span className="font-semibold text-ink truncate flex-1">{table.name}</span>
        <span className={`text-[9px] px-1 py-0.5 rounded uppercase font-mono ${
          table.type === 'view' ? 'text-sea bg-sea/10' : 'text-ink-faint bg-paper-deep'
        }`}>
          {table.type === 'view' ? 'vista' : 'tabla'}
        </span>
      </div>

      <div className="divide-y divide-line-soft/50">
        {selected && (
          <button type="button" onClick={() => onSelectAll(table)}
            className="w-full text-[10px] text-lumen-deep hover:bg-lumen-soft/20 px-2 py-0.5 text-left">
            Seleccionar todas
          </button>
        )}
        {visible.map((col, i) => {
          const colSelected = selectedCols.includes(col.name);
          return (
            <div key={col.name}
              className={`flex items-center gap-1 px-2 py-0.5 relative ${
                colSelected ? 'bg-lumen-soft/20' : 'hover:bg-paper-deep/40'
              } ${selected ? 'cursor-pointer' : ''}`}
              onClick={selected ? () => onToggleColumn(table.name, col.name) : undefined}>
              {selected && (
                <input type="checkbox" checked={colSelected} readOnly className="accent-lumen pointer-events-none" />
              )}
              {col.isPrimaryKey && <Icon name="lock" size={10} className="text-lumen shrink-0" />}
              {col.isForeignKey && !col.isPrimaryKey && <Icon name="link" size={10} className="text-sea shrink-0" />}
              <span className={`truncate flex-1 ${col.isPrimaryKey ? 'font-bold' : ''}`}>{col.name}</span>
              <span className="text-ink-faint font-mono text-[9px] shrink-0">{col.dataType}</span>

              {col.isForeignKey && (
                <Handle
                  type="source"
                  position={Position.Right}
                  id={`${table.name}.${col.name}`}
                  className="!w-2 !h-2 !bg-sea !border-sea/50"
                />
              )}
              {col.isPrimaryKey && (
                <Handle
                  type="target"
                  position={Position.Left}
                  id={`${table.name}.${col.name}`}
                  className="!w-2 !h-2 !bg-lumen !border-lumen/50"
                />
              )}
            </div>
          );
        })}
        {overflow > 0 && (
          <div className="px-2 py-0.5 text-ink-faint text-[10px] italic">
            +{overflow} columnas más
          </div>
        )}
      </div>
    </div>
  );
}

export default memo(TableNode);
