import { useState, lazy, Suspense } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../ui';

const ERDiagram = lazy(() => import('./ERDiagram'));

export default function SchemaExplorer({ schema, selectedTables, selectedColumns, onToggleTable, onToggleColumn, onSelectAllColumns, viewMode: viewModeProp, onViewModeChange, onReset, query, joins, onJoinsChange, suggestedJoins, onSave, saving, saveLabel = 'Guardar', datasetId, dbType, connectionString }) {
  const [internalViewMode, setInternalViewMode] = useState('list');
  const viewMode = viewModeProp ?? internalViewMode;
  const changeView = (mode) => { setInternalViewMode(mode); onViewModeChange?.(mode); };
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState(new Set());

  const toggle = (name) => {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });
  };

  const filtered = (schema?.tables || []).filter(
    t => !search || t.name.toLowerCase().includes(search.toLowerCase()) ||
      t.columns.some(c => c.name.toLowerCase().includes(search.toLowerCase()))
  );

  const isTableSelected = (t) => selectedTables.some(s => s.name === t.name);
  const isColSelected = (tableName, colName) => (selectedColumns[tableName] || []).includes(colName);

  if (viewMode === 'diagram') {
    return (
      <>
        <div className="flex flex-col h-full">
          <div className="flex gap-1 bg-paper-deep rounded-md p-0.5 mb-2 shrink-0">
            <button type="button" onClick={() => changeView('list')}
              className="flex-1 px-2 py-1 text-[10px] font-medium rounded transition text-ink-faint hover:text-ink">
              <Icon name="grid" size={11} className="inline mr-1" />Lista
            </button>
            <button type="button" onClick={() => changeView('diagram')}
              className="flex-1 px-2 py-1 text-[10px] font-medium rounded transition bg-surface text-ink shadow-sm">
              <Icon name="layers" size={11} className="inline mr-1" />Diagrama
            </button>
          </div>
          <p className="text-[11px] text-ink-faint text-center py-8">
            Diagrama abierto en pantalla completa
          </p>
        </div>
        {createPortal(
          <div className="fixed inset-0 z-[100] bg-surface flex flex-col">
            <div className="flex items-center justify-between px-4 py-2 border-b border-line-soft bg-paper shrink-0">
              <h3 className="text-sm font-semibold text-ink flex items-center gap-2">
                <Icon name="layers" size={16} /> Diagrama ER
                <span className="text-ink-faint font-normal">— {schema?.tables?.length || 0} tablas</span>
              </h3>
              <div className="flex items-center gap-2">
                {onSave && (
                  <button type="button" onClick={onSave} disabled={saving}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-ink text-paper rounded-lg hover:bg-ink/90 transition disabled:opacity-50">
                    <Icon name="check" size={14} /> {saving ? 'Guardando…' : saveLabel}
                  </button>
                )}
                <button onClick={() => changeView('list')}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-paper-deep rounded-lg hover:bg-line-soft transition">
                  <Icon name="x" size={14} /> Cerrar diagrama
                </button>
              </div>
            </div>
            <div style={{ flex: 1, overflow: 'hidden' }}>
              <Suspense fallback={<div className="flex items-center justify-center h-full text-sm text-ink-faint">Cargando diagrama…</div>}>
                <ERDiagram
                  schema={schema}
                  selectedTables={selectedTables}
                  selectedColumns={selectedColumns}
                  onToggleTable={onToggleTable}
                  onToggleColumn={onToggleColumn}
                  onSelectAllColumns={onSelectAllColumns}
                  onReset={onReset}
                  query={query}
                  joins={joins}
                  onJoinsChange={onJoinsChange}
                  suggestedJoins={suggestedJoins}
                  datasetId={datasetId}
                  dbType={dbType}
                  connectionString={connectionString}
                />
              </Suspense>
            </div>
          </div>,
          document.body
        )}
      </>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex gap-1 bg-paper-deep rounded-md p-0.5 mb-2 shrink-0">
        <button type="button" onClick={() => changeView('list')}
          className="flex-1 px-2 py-1 text-[10px] font-medium rounded transition bg-surface text-ink shadow-sm">
          <Icon name="grid" size={11} className="inline mr-1" />Lista
        </button>
        <button type="button" onClick={() => changeView('diagram')}
          className="flex-1 px-2 py-1 text-[10px] font-medium rounded transition text-ink-faint hover:text-ink">
          <Icon name="layers" size={11} className="inline mr-1" />Diagrama
        </button>
      </div>
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Buscar tabla o columna…"
        className="field field-sm mb-2"
      />
      <div className="flex-1 overflow-y-auto space-y-0.5">
        {filtered.length === 0 && (
          <p className="text-xs text-ink-faint text-center py-4">No se encontraron tablas</p>
        )}
        {filtered.map(t => {
          const open = expanded.has(t.name);
          const selected = isTableSelected(t);
          return (
            <div key={t.name} className="rounded-lg overflow-hidden">
              <div className={`flex items-center gap-1.5 px-2 py-1.5 cursor-pointer text-sm hover:bg-paper-deep/60 rounded-lg ${selected ? 'bg-lumen-soft/40' : ''}`}>
                <button type="button" onClick={() => toggle(t.name)} className="text-ink-faint hover:text-ink">
                  <Icon name={open ? 'chevronDown' : 'chevronRight'} size={14} />
                </button>
                <label className="flex items-center gap-1.5 flex-1 cursor-pointer select-none">
                  <input type="checkbox" checked={selected}
                    onChange={() => onToggleTable(t)}
                    className="accent-lumen rounded" />
                  <Icon name={t.type === 'view' ? 'eye' : 'table'} size={14} className="text-ink-faint" />
                  <span className="font-medium truncate">{t.name}</span>
                </label>
                <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono uppercase ${t.type === 'view' ? 'bg-sea/10 text-sea' : 'bg-paper-deep text-ink-faint'}`}>
                  {t.type === 'view' ? 'vista' : 'tabla'}
                </span>
              </div>
              {open && (
                <div className="ml-6 border-l border-line-soft pl-2 py-1 space-y-0.5">
                  {selected && (
                    <button type="button" onClick={() => onSelectAllColumns(t)}
                      className="text-[11px] text-lumen-deep hover:underline mb-1">
                      Seleccionar todas
                    </button>
                  )}
                  {t.columns.map(col => (
                    <label key={col.name}
                      className="flex items-center gap-1.5 px-1.5 py-0.5 text-xs hover:bg-paper-deep/60 rounded cursor-pointer select-none">
                      {selected && (
                        <input type="checkbox" checked={isColSelected(t.name, col.name)}
                          onChange={() => onToggleColumn(t.name, col.name)}
                          className="accent-lumen rounded" />
                      )}
                      {col.isPrimaryKey && <Icon name="lock" size={12} className="text-lumen" />}
                      {col.isForeignKey && !col.isPrimaryKey && <Icon name="link" size={12} className="text-sea" />}
                      <span className="truncate">{col.name}</span>
                      <span className="ml-auto text-[10px] font-mono text-ink-faint">{col.dataType}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
