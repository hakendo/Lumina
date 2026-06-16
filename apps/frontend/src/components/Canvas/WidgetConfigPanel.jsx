import { useEffect, useState, useMemo } from 'react';
import api from '../../lib/api';
import { CACHE } from '../../lib/datasetCache';
import { useReportStore } from '../../store/reportStore';
import { Button, Field, Icon } from '../ui';

// ── Type inference ────────────────────────────────────────────────────────────

function inferType(colName, rows) {
  if (!rows?.length) return 'text';
  const sample = rows.slice(0, 10).map((r) => r[colName]).filter((v) => v != null && v !== '');
  if (!sample.length) return 'text';
  if (sample.filter((v) => !isNaN(Number(v))).length / sample.length >= 0.8) return 'number';
  if (sample.filter((v) => !isNaN(Date.parse(String(v)))).length / sample.length >= 0.8) return 'date';
  return 'text';
}

function TypeBadge({ type }) {
  if (type === 'number') return <span className="font-mono text-[10px] text-lumen-deep leading-none">#</span>;
  if (type === 'date')   return <span className="text-[10px] text-sea leading-none">cal</span>;
  return <span className="text-[10px] text-ink-faint font-display italic leading-none">Aa</span>;
}

// ── Chart type mini-icons ─────────────────────────────────────────────────────

const CHART_TYPES = {
  bar: (
    <svg viewBox="0 0 20 16" width="20" height="14" fill="currentColor">
      <rect x="1" y="4" width="4" height="12" rx="1" opacity=".6" />
      <rect x="7" y="1" width="4" height="15" rx="1" />
      <rect x="13" y="6" width="4" height="10" rx="1" opacity=".6" />
    </svg>
  ),
  line: (
    <svg viewBox="0 0 20 16" width="20" height="14" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="1,14 7,6 11,10 19,2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  area: (
    <svg viewBox="0 0 20 16" width="20" height="14">
      <path d="M1,15 L7,7 L11,11 L19,3 L19,15 Z" fill="currentColor" opacity=".25" />
      <polyline points="1,15 7,7 11,11 19,3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  pie: (
    <svg viewBox="0 0 20 20" width="16" height="14">
      <path d="M10,10 L10,1 A9,9 0 0,1 19,10 Z" fill="currentColor" />
      <path d="M10,10 L19,10 A9,9 0 0,1 4,17.8 Z" fill="currentColor" opacity=".5" />
      <path d="M10,10 L4,17.8 A9,9 1,1 1 10,1 Z" fill="currentColor" opacity=".25" />
    </svg>
  ),
  scatter: (
    <svg viewBox="0 0 20 16" width="20" height="14" fill="currentColor">
      <circle cx="3"  cy="13" r="2" />
      <circle cx="8"  cy="7"  r="2.5" />
      <circle cx="13" cy="10" r="1.5" />
      <circle cx="17" cy="4"  r="2" />
    </svg>
  ),
};

// ── Well definitions ──────────────────────────────────────────────────────────

function getWells(widgetType, chartType) {
  if (widgetType === 'chart') {
    if (chartType === 'pie') return [
      { key: 'xField', label: 'Categoría', hint: 'texto', preferred: 'text' },
      { key: 'yField', label: 'Valor',     hint: 'número', preferred: 'number' },
    ];
    if (chartType === 'scatter') return [
      { key: 'xField',     label: 'Eje X',    hint: 'número', preferred: 'number' },
      { key: 'yField',     label: 'Eje Y',    hint: 'número', preferred: 'number' },
      { key: 'sizeField',  label: 'Tamaño',   hint: 'número', preferred: 'number', optional: true },
      { key: 'labelField', label: 'Etiqueta', hint: 'texto',  preferred: 'text',   optional: true },
    ];
    return [
      { key: 'xField', label: 'Eje X', hint: 'categoría', preferred: 'text' },
      { key: 'yField', label: 'Eje Y', hint: 'valor',     preferred: 'number' },
    ];
  }
  if (widgetType === 'kpi') return [
    { key: 'valueField', label: 'Valor', hint: 'número', preferred: 'number' },
  ];
  if (widgetType === 'map') return [
    { key: 'latField',   label: 'Latitud',   hint: 'número', preferred: 'number' },
    { key: 'lonField',   label: 'Longitud',  hint: 'número', preferred: 'number' },
    { key: 'labelField', label: 'Etiqueta',  hint: 'texto',  preferred: 'text',   optional: true },
  ];
  if (widgetType === 'pivot') return [
    { key: 'rowField',   label: 'Filas',    hint: 'texto',  preferred: 'text' },
    { key: 'colField',   label: 'Columnas', hint: 'texto',  preferred: 'text',   optional: true },
    { key: 'valueField', label: 'Valores',  hint: 'número', preferred: 'number' },
  ];
  return [];
}

const AGG_TYPES = ['sum', 'avg', 'count', 'max', 'min'];
const OP_LABELS  = { gt: '>', gte: '≥', lt: '<', lte: '≤', eq: '=' };

// ── Main component ────────────────────────────────────────────────────────────

export default function WidgetConfigPanel({ widget, onClose }) {
  const { updateWidget, removeWidget, pages } = useReportStore();
  const [datasets,   setDatasets]   = useState([]);
  const [columns,    setColumns]    = useState([]);
  const [cfg,        setCfg]        = useState(widget.config || {});
  const [datasetId,  setDatasetId]  = useState(widget.datasetId || '');
  const [activeWell, setActiveWell] = useState(null);
  const [search,     setSearch]     = useState('');
  const [optOpen,    setOptOpen]    = useState(false);

  useEffect(() => { api.get('/datasets').then(({ data }) => setDatasets(data)); }, []);

  useEffect(() => {
    if (!datasetId) { setColumns([]); return; }
    api.get(`/datasets/${datasetId}/columns`).then(({ data }) => setColumns(data));
  }, [datasetId]);

  const cachedRows = datasetId ? (CACHE[datasetId] ?? null) : null;

  const columnsWithTypes = useMemo(
    () => columns.map((name) => ({ name, type: inferType(name, cachedRows) })),
    [columns, cachedRows],
  );

  const set = (key, val) => setCfg((c) => ({ ...c, [key]: val }));

  const wells = getWells(widget.widgetType, cfg.chartType || 'bar');

  // Auto-activate first empty required well when dataset or chart type changes
  useEffect(() => {
    const firstEmpty = wells.find((w) => !w.optional && !cfg[w.key]);
    setActiveWell(firstEmpty?.key ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg.chartType, datasetId]);

  const assignColumn = (colName) => {
    if (!activeWell) return;
    set(activeWell, colName);
    const idx  = wells.findIndex((w) => w.key === activeWell);
    const next = wells.slice(idx + 1).find((w) => !w.optional && !cfg[w.key] && w.key !== activeWell);
    setActiveWell(next?.key ?? null);
  };

  const filteredCols = columnsWithTypes.filter(
    (c) => !search || c.name.toLowerCase().includes(search.toLowerCase()),
  );

  const save = () => {
    updateWidget(widget.id, { config: cfg, datasetId: datasetId || null });
    onClose();
  };

  const activePage = useReportStore((s) => s.activePage);
  const otherPages = pages.filter((p) => p.id !== activePage);

  return (
    <div className="fixed md:static inset-y-0 right-0 z-50 w-full max-w-xs md:max-w-none md:w-72 bg-surface border-l border-line h-full overflow-y-auto flex flex-col shadow-lift md:shadow-none">

      {/* ── Header ── */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-line-soft shrink-0">
        <input
          value={cfg.title || ''}
          onChange={(e) => set('title', e.target.value)}
          placeholder="Título del widget…"
          className="flex-1 text-sm font-medium text-ink bg-transparent outline-none border-none placeholder:text-ink-faint/40"
        />
        <button onClick={onClose} className="text-ink-faint hover:text-ink transition cursor-pointer shrink-0">
          <Icon name="x" size={16} />
        </button>
      </div>

      {/* ── Dataset ── */}
      <div className="px-3 py-2.5 border-b border-line-soft bg-paper shrink-0">
        <p className="text-[10px] font-semibold text-ink-faint uppercase tracking-widest mb-1.5">Fuente de datos</p>
        <select
          value={datasetId}
          onChange={(e) => { setDatasetId(e.target.value); setActiveWell(null); }}
          className="field field-sm"
        >
          <option value="">— Sin dataset —</option>
          {datasets.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      </div>

      {/* ── Chart type grid ── */}
      {widget.widgetType === 'chart' && (
        <div className="px-3 py-2.5 border-b border-line-soft shrink-0">
          <p className="text-[10px] font-semibold text-ink-faint uppercase tracking-widest mb-2">Tipo de gráfico</p>
          <div className="grid grid-cols-5 gap-1">
            {Object.entries(CHART_TYPES).map(([type, icon]) => (
              <button
                key={type}
                onClick={() => { set('chartType', type); setActiveWell(null); }}
                title={type}
                className={`flex flex-col items-center justify-center gap-0.5 rounded-lg py-1.5 transition cursor-pointer border ${
                  (cfg.chartType || 'bar') === type
                    ? 'bg-lumen-soft text-lumen-deep border-lumen-line'
                    : 'text-ink-faint border-transparent hover:bg-paper-deep hover:text-ink-soft'
                }`}
              >
                {icon}
                <span className="text-[9px] leading-none">{type}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Field wells ── */}
      {wells.length > 0 && (
        <div className="px-3 py-2.5 border-b border-line-soft shrink-0">
          <p className="text-[10px] font-semibold text-ink-faint uppercase tracking-widest mb-2">
            {activeWell ? `↓ Selecciona columna abajo` : 'Campos mapeados'}
          </p>
          <div className="space-y-1.5">
            {wells.map((well) => {
              const isActive = activeWell === well.key;
              const value    = cfg[well.key];
              return (
                <button
                  key={well.key}
                  onClick={() => setActiveWell(isActive ? null : well.key)}
                  className={`w-full flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-left transition cursor-pointer border ${
                    isActive
                      ? 'bg-lumen-soft border-lumen text-lumen-deep ring-2 ring-lumen/20'
                      : 'bg-paper-deep border-line hover:border-line-soft'
                  }`}
                >
                  <div className={`w-0.5 h-4 rounded-full shrink-0 ${isActive ? 'bg-lumen-deep' : 'bg-line'}`} />
                  <span className={`text-[11px] font-semibold shrink-0 w-16 truncate ${isActive ? 'text-lumen-deep' : 'text-ink-faint'}`}>
                    {well.label}
                    {well.optional && <span className="font-normal opacity-50"> opc</span>}
                  </span>
                  {value ? (
                    <span className="flex-1 text-[11px] text-ink font-mono truncate">{value}</span>
                  ) : (
                    <span className="flex-1 text-[11px] text-ink-faint/40 italic">{well.hint}</span>
                  )}
                  {value && (
                    <span
                      role="button"
                      onClick={(e) => { e.stopPropagation(); set(well.key, ''); }}
                      className="text-ink-faint hover:text-rust transition cursor-pointer shrink-0"
                    >
                      <Icon name="x" size={11} />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Table column chips ── */}
      {widget.widgetType === 'table' && datasetId && columnsWithTypes.length > 0 && (
        <div className="px-3 py-2.5 border-b border-line-soft shrink-0">
          <p className="text-[10px] font-semibold text-ink-faint uppercase tracking-widest mb-2">Columnas visibles</p>
          <div className="flex flex-wrap gap-1">
            {columnsWithTypes.map(({ name, type }) => {
              const allNames = columnsWithTypes.map((c) => c.name);
              const active   = !cfg.columns?.length || cfg.columns.includes(name);
              return (
                <button
                  key={name}
                  onClick={() => {
                    const current = cfg.columns?.length ? cfg.columns : allNames;
                    const next    = current.includes(name)
                      ? current.filter((c) => c !== name)
                      : [...current, name];
                    set('columns', next.length === allNames.length ? [] : next);
                  }}
                  className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono transition cursor-pointer border ${
                    active
                      ? 'bg-lumen-soft text-lumen-deep border-lumen-line'
                      : 'bg-paper-deep text-ink-faint border-line line-through'
                  }`}
                >
                  <TypeBadge type={type} /> {name}
                </button>
              );
            })}
          </div>
          <div className="mt-2">
            <Field label="Cross-filter al hacer clic">
              <ColSelect value={cfg.crossFilterField} onChange={(v) => set('crossFilterField', v)} columns={columns} placeholder="— Sin cross-filter —" />
            </Field>
          </div>
        </div>
      )}

      {/* ── Column browser (all types except table) ── */}
      {datasetId && widget.widgetType !== 'table' && (
        <div className="px-3 py-2.5 border-b border-line-soft flex flex-col min-h-0">
          <div className="flex items-center gap-1.5 mb-2 shrink-0">
            <p className="text-[10px] font-semibold text-ink-faint uppercase tracking-widest flex-1">
              {activeWell
                ? `→ ${wells.find((w) => w.key === activeWell)?.label}`
                : 'Columnas del dataset'}
            </p>
            <div className="relative">
              <Icon name="search" size={10} className="absolute left-1.5 top-1/2 -translate-y-1/2 text-ink-faint pointer-events-none" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="buscar…"
                className="field field-sm pl-5 text-[10px] w-24 py-0.5"
              />
            </div>
          </div>
          {columnsWithTypes.length === 0 ? (
            <p className="text-[11px] text-ink-faint/60 italic py-2">Cargando columnas…</p>
          ) : (
            <div className="overflow-y-auto space-y-0.5 max-h-44">
              {filteredCols.map(({ name, type }) => {
                const usedWell = wells.find((w) => cfg[w.key] === name);
                return (
                  <button
                    key={name}
                    onClick={() => activeWell ? assignColumn(name) : undefined}
                    disabled={!activeWell}
                    className={`w-full flex items-center gap-2 px-2 py-1 rounded-md text-left transition ${
                      activeWell
                        ? 'hover:bg-lumen-soft hover:text-lumen-deep cursor-pointer'
                        : 'cursor-default opacity-50'
                    }`}
                  >
                    <TypeBadge type={type} />
                    <span className="text-[11px] font-mono text-ink flex-1 truncate">{name}</span>
                    {usedWell && (
                      <span className="text-[9px] text-ink-faint bg-paper-deep border border-line px-1 py-0.5 rounded shrink-0">
                        {usedWell.label}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Opciones (collapsible) ── */}
      <div className="border-b border-line-soft shrink-0">
        <button
          onClick={() => setOptOpen((o) => !o)}
          className="w-full flex items-center gap-2 px-3 py-2 text-[10px] font-semibold text-ink-faint uppercase tracking-widest hover:text-ink-soft transition cursor-pointer"
        >
          <Icon name={optOpen ? 'chevronDown' : 'chevronRight'} size={11} />
          Opciones
        </button>
        {optOpen && (
          <div className="px-3 pb-3 space-y-3">
            {(widget.widgetType === 'kpi' || widget.widgetType === 'pivot') && (
              <Field label="Agregación">
                <select value={cfg.aggregation || 'sum'} onChange={(e) => set('aggregation', e.target.value)} className="field field-sm">
                  {AGG_TYPES.map((a) => <option key={a} value={a}>{a}</option>)}
                </select>
              </Field>
            )}
            {widget.widgetType === 'kpi' && (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Prefijo">
                    <input value={cfg.prefix || ''} onChange={(e) => set('prefix', e.target.value)} className="field field-sm" placeholder="$" />
                  </Field>
                  <Field label="Sufijo">
                    <input value={cfg.suffix || ''} onChange={(e) => set('suffix', e.target.value)} className="field field-sm" placeholder="USD" />
                  </Field>
                </div>
                <Field label="Color base">
                  <input type="color" value={cfg.color || '#b8730f'} onChange={(e) => set('color', e.target.value)}
                    className="h-8 w-full rounded-lg cursor-pointer border border-line bg-surface" />
                </Field>
                <KpiThresholds thresholds={cfg.thresholds || []} onChange={(t) => set('thresholds', t)} />
              </>
            )}
            {(widget.widgetType === 'chart' || widget.widgetType === 'table') && otherPages.length > 0 && (
              <Field label="Drill-through a página">
                <select value={cfg.drillTargetPageId || ''} onChange={(e) => set('drillTargetPageId', e.target.value || null)} className="field field-sm">
                  <option value="">— Cross-filter (misma página) —</option>
                  {otherPages.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
                </select>
              </Field>
            )}
          </div>
        )}
      </div>

      {/* ── Footer ── */}
      <div className="p-3 flex gap-2 mt-auto shrink-0">
        <Button onClick={save} className="flex-1" size="sm">Aplicar</Button>
        <Button variant="danger" size="sm" title="Eliminar widget"
          onClick={() => { removeWidget(widget.id); onClose(); }}>
          <Icon name="trash" size={13} />
        </Button>
      </div>
    </div>
  );
}

function ColSelect({ value, onChange, columns, placeholder = '— Columna —' }) {
  return (
    <select value={value || ''} onChange={(e) => onChange(e.target.value)} className="field field-sm">
      <option value="">{placeholder}</option>
      {columns.map((c) => <option key={c} value={c}>{c}</option>)}
    </select>
  );
}

function KpiThresholds({ thresholds, onChange }) {
  const add    = () => onChange([...thresholds, { op: 'gt', value: '', color: '#16695f' }]);
  const remove = (i) => onChange(thresholds.filter((_, j) => j !== i));
  const update = (i, field, val) => onChange(thresholds.map((t, j) => j === i ? { ...t, [field]: val } : t));

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-ink-soft">Umbrales de color</span>
        <button type="button" onClick={add} className="text-xs text-lumen-deep hover:underline cursor-pointer">+ Agregar</button>
      </div>
      {!thresholds.length && <p className="text-[11px] text-ink-faint">Sin umbrales — usa el color base siempre.</p>}
      {thresholds.map((t, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <select value={t.op} onChange={(e) => update(i, 'op', e.target.value)}
            className="field field-sm w-14 shrink-0 text-center font-mono">
            {Object.entries(OP_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <input type="number" value={t.value} onChange={(e) => update(i, 'value', e.target.value)}
            className="field field-sm field-mono flex-1 min-w-0" placeholder="valor" />
          <input type="color" value={t.color || '#16695f'} onChange={(e) => update(i, 'color', e.target.value)}
            className="h-8 w-10 rounded-md cursor-pointer border border-line bg-surface shrink-0" />
          <button type="button" onClick={() => remove(i)} className="text-ink-faint hover:text-rust transition cursor-pointer shrink-0">
            <Icon name="x" size={13} />
          </button>
        </div>
      ))}
      {thresholds.length > 0 && <p className="text-[11px] text-ink-faint">Primera regla que coincide gana.</p>}
    </div>
  );
}
