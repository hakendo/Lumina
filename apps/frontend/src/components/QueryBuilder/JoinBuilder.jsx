import { useEffect } from 'react';
import { Icon } from '../ui';

const JOIN_TYPES = ['INNER', 'LEFT', 'RIGHT'];

export default function JoinBuilder({ selectedTables, schema, joins, onJoinsChange, suggestedJoins }) {
  if (selectedTables.length < 2) return null;

  const tableAliases = selectedTables.map((t, i) => ({ ...t, alias: t.alias || `t${i}` }));
  const colsFor = (tableName) => (schema?.tables || []).find(t => t.name === tableName)?.columns || [];

  const update = (idx, field, value) => {
    const next = joins.map((j, i) => i === idx ? { ...j, [field]: value } : j);
    onJoinsChange(next);
  };

  const remove = (idx) => onJoinsChange(joins.filter((_, i) => i !== idx));

  const add = () => {
    const usedAliases = new Set(joins.flatMap(j => [j.leftTable, j.rightTable]));
    const unused = tableAliases.filter(t => !usedAliases.has(t.alias));
    const left = tableAliases[0]?.alias || '';
    const right = unused[0]?.alias || tableAliases[1]?.alias || '';
    onJoinsChange([...joins, {
      type: 'INNER',
      leftTable: left,
      leftColumn: '',
      rightTable: right,
      rightColumn: '',
    }]);
  };

  const joinExists = (fromTable, fromCol, toTable, toCol) =>
    joins.some(j =>
      (j.leftTable === fromTable && j.leftColumn === fromCol && j.rightTable === toTable && j.rightColumn === toCol) ||
      (j.leftTable === toTable && j.leftColumn === toCol && j.rightTable === fromTable && j.rightColumn === fromCol)
    );

  const applySuggestion = (sug) => {
    const leftAlias = tableAliases.find(t => t.name === sug.fromTable)?.alias;
    const rightAlias = tableAliases.find(t => t.name === sug.toTable)?.alias;
    if (!leftAlias || !rightAlias) return;
    if (joinExists(leftAlias, sug.fromColumn, rightAlias, sug.toColumn)) return;
    onJoinsChange([...joins, {
      type: 'INNER',
      leftTable: leftAlias,
      leftColumn: sug.fromColumn,
      rightTable: rightAlias,
      rightColumn: sug.toColumn,
    }]);
  };

  const nameForAlias = (alias) => tableAliases.find(t => t.alias === alias)?.name || alias;

  const pendingSuggestions = (suggestedJoins || []).filter(sug => {
    const leftAlias = tableAliases.find(t => t.name === sug.fromTable)?.alias;
    const rightAlias = tableAliases.find(t => t.name === sug.toTable)?.alias;
    if (!leftAlias || !rightAlias) return false;
    return !joinExists(leftAlias, sug.fromColumn, rightAlias, sug.toColumn);
  });

  const applyAllSuggestions = () => {
    const added = pendingSuggestions.map(sug => ({
      type: 'INNER',
      leftTable: tableAliases.find(t => t.name === sug.fromTable)?.alias,
      leftColumn: sug.fromColumn,
      rightTable: tableAliases.find(t => t.name === sug.toTable)?.alias,
      rightColumn: sug.toColumn,
    })).filter(j => j.leftTable && j.rightTable);
    onJoinsChange([...joins, ...added]);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold text-ink-soft">Joins</h4>
        <button type="button" onClick={add}
          className="flex items-center gap-1 text-xs text-lumen-deep hover:underline">
          <Icon name="plus" size={14} /> Agregar join
        </button>
      </div>

      {pendingSuggestions.length > 0 && (
        <div className="bg-lumen-soft/30 border border-lumen/20 rounded-lg p-2 space-y-1">
          <div className="flex items-center justify-between">
            <p className="text-[11px] text-ink-soft">Relaciones detectadas:</p>
            <button type="button" onClick={applyAllSuggestions}
              className="text-[11px] text-lumen-deep font-medium hover:underline">
              Agregar todas
            </button>
          </div>
          {pendingSuggestions.map((sug, i) => (
            <button key={i} type="button" onClick={() => applySuggestion(sug)}
              className="flex items-center gap-1 text-xs text-lumen-deep hover:underline">
              <Icon name="plus" size={12} />
              {sug.fromTable}.{sug.fromColumn} → {sug.toTable}.{sug.toColumn}
            </button>
          ))}
        </div>
      )}

      {joins.map((join, idx) => (
        <div key={idx} className="bg-paper-deep/50 rounded-lg p-2 space-y-1.5">
          <div className="flex items-center gap-1.5">
            <select value={join.type} onChange={(e) => update(idx, 'type', e.target.value)}
              className="field field-sm w-20">
              {JOIN_TYPES.map(jt => <option key={jt} value={jt}>{jt}</option>)}
            </select>
            <span className="flex-1" />
            <button type="button" onClick={() => remove(idx)} className="text-rust hover:text-rust/80 p-0.5">
              <Icon name="x" size={14} />
            </button>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            <select value={join.leftTable} onChange={(e) => update(idx, 'leftTable', e.target.value)}
              className="field field-sm field-mono flex-1 min-w-[80px]">
              <option value="">Tabla</option>
              {tableAliases.map(t => <option key={t.alias} value={t.alias}>{t.name} ({t.alias})</option>)}
            </select>
            <select value={join.leftColumn} onChange={(e) => update(idx, 'leftColumn', e.target.value)}
              className="field field-sm field-mono flex-1 min-w-[80px]">
              <option value="">Columna</option>
              {colsFor(nameForAlias(join.leftTable)).map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
            </select>
            <span className="text-ink-faint text-xs font-bold">=</span>
            <select value={join.rightTable} onChange={(e) => update(idx, 'rightTable', e.target.value)}
              className="field field-sm field-mono flex-1 min-w-[80px]">
              <option value="">Tabla</option>
              {tableAliases.map(t => <option key={t.alias} value={t.alias}>{t.name} ({t.alias})</option>)}
            </select>
            <select value={join.rightColumn} onChange={(e) => update(idx, 'rightColumn', e.target.value)}
              className="field field-sm field-mono flex-1 min-w-[80px]">
              <option value="">Columna</option>
              {colsFor(nameForAlias(join.rightTable)).map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
            </select>
          </div>
        </div>
      ))}
    </div>
  );
}
