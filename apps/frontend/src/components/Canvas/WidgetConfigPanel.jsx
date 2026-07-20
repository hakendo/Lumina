import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import api from '../../lib/api';
import { CACHE, invalidateDatasetCache } from '../../lib/datasetCache';
import { useReportStore } from '../../store/reportStore';
import { Button, Field, Icon, Modal } from '../ui';
import SchemaExplorer from '../QueryBuilder/SchemaExplorer';
import JoinBuilder from '../QueryBuilder/JoinBuilder';
import QueryPreview from '../QueryBuilder/QueryPreview';

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

// ── Client-side expression evaluator (mirrors exprEval.js — no eval/Function) ─

function _tokenize(expr) {
  const tokens = [];
  let i = 0;
  while (i < expr.length) {
    if (/\s/.test(expr[i])) { i++; continue; }
    if (/[+\-*/()]/.test(expr[i])) { tokens.push(expr[i++]); continue; }
    if (/[\d.]/.test(expr[i])) {
      let num = '';
      while (i < expr.length && /[\d.]/.test(expr[i])) num += expr[i++];
      tokens.push(num);
      continue;
    }
    return null;
  }
  return tokens;
}
function _atom(t, p) {
  if (t[p.i] === '(') { p.i++; const v = _expr(t, p); if (t[p.i] !== ')') return null; p.i++; return v; }
  const tok = t[p.i++];
  return (tok !== undefined && /^-?\d*\.?\d+$/.test(tok)) ? Number(tok) : null;
}
function _unary(t, p) {
  if (t[p.i] === '-') { p.i++; const v = _atom(t, p); return v === null ? null : -v; }
  return _atom(t, p);
}
function _term(t, p) {
  let l = _unary(t, p); if (l === null) return null;
  while (p.i < t.length && (t[p.i] === '*' || t[p.i] === '/')) {
    const op = t[p.i++]; const r = _unary(t, p); if (r === null) return null;
    l = op === '*' ? l * r : r === 0 ? null : l / r;
  }
  return l;
}
function _expr(t, p) {
  let l = _term(t, p); if (l === null) return null;
  while (p.i < t.length && (t[p.i] === '+' || t[p.i] === '-')) {
    const op = t[p.i++]; const r = _term(t, p); if (r === null) return null;
    l = op === '+' ? l + r : l - r;
  }
  return l;
}
const _FIELD_RE = /\b([a-zA-Z_][a-zA-Z0-9_]*)\b/g;
function clientEval(expression, row) {
  if (typeof expression !== 'string' || !expression.trim()) return null;
  const sub = expression.replace(_FIELD_RE, (_, f) => {
    const v = row[f]; if (v == null || v === '') return '0';
    const n = Number(v); return isNaN(n) ? '0' : String(n);
  });
  if (/[a-zA-Z_]/.test(sub)) return null;
  const tokens = _tokenize(sub); if (!tokens) return null;
  const pos = { i: 0 }; const result = _expr(tokens, pos);
  return pos.i === tokens.length ? result : null;
}

// ── Main component ────────────────────────────────────────────────────────────

export default function WidgetConfigPanel({ widget, onClose }) {
  const { updateWidget, removeWidget, pages } = useReportStore();
  const [datasets,   setDatasets]   = useState([]);
  const [columns,    setColumns]    = useState([]);
  const [cfg,        setCfg]        = useState(widget.config || {});
  const [datasetId,  setDatasetId]  = useState(widget.datasetId || '');
  const [activeWell,   setActiveWell]   = useState(null);
  const [search,       setSearch]       = useState('');
  const [optOpen,      setOptOpen]      = useState(false);
  const [formulaOpen,  setFormulaOpen]  = useState(false);
  const [queryEditorOpen, setQueryEditorOpen] = useState(false);

  useEffect(() => { api.get('/datasets').then(({ data }) => setDatasets(Array.isArray(data) ? data : [])); }, []);

  useEffect(() => {
    if (!datasetId) { setColumns([]); return; }
    api.get(`/datasets/${datasetId}/columns`).then(({ data }) => setColumns(Array.isArray(data) ? data : []));
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
        {datasetId && (
          <div className="mt-1.5 flex items-center gap-3">
            <button
              onClick={() => setFormulaOpen(true)}
              className="flex items-center gap-1 text-[11px] text-lumen-deep hover:text-lumen font-medium cursor-pointer transition"
            >
              <span className="font-mono text-[12px]">fx</span> Columnas calculadas
            </button>
            {datasets.find(d => d.id === datasetId)?.sourceType === 'db' && (
              <button
                onClick={() => setQueryEditorOpen(true)}
                className="flex items-center gap-1 text-[11px] text-sea hover:text-sea/80 font-medium cursor-pointer transition"
              >
                <Icon name="database" size={12} /> Editar query
              </button>
            )}
          </div>
        )}
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
          <div className="mt-2">
            <Field label="Formato de fecha/hora del eje X (opcional)" hint="Tokens: YYYY MM DD HH mm ss. Ej: DD/MM/YYYY. Solo cambia cómo se ve, no modifica el dataset.">
              <input
                value={cfg.dateFormat || ''}
                onChange={(e) => set('dateFormat', e.target.value)}
                placeholder="DD/MM/YYYY"
                className="field field-sm field-mono"
              />
            </Field>
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
      {widget.widgetType === 'table' && datasetId && columnsWithTypes.length === 0 && (
        <div className="px-3 py-2.5 border-b border-line-soft shrink-0">
          <p className="text-[11px] text-ink-faint/60 italic py-1">Cargando columnas…</p>
        </div>
      )}
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
          <div className="mt-2 space-y-2">
            <Field label="Cross-filter al hacer clic">
              <ColSelect value={cfg.crossFilterField} onChange={(v) => set('crossFilterField', v)} columns={columns} placeholder="— Sin cross-filter —" />
            </Field>
            <Field label="Formato de fecha/hora (opcional)" hint="Tokens: YYYY MM DD HH mm ss. Ej: DD/MM/YYYY HH:mm. Solo cambia cómo se ve, no modifica el dataset.">
              <input
                value={cfg.dateFormat || ''}
                onChange={(e) => set('dateFormat', e.target.value)}
                placeholder="DD/MM/YYYY HH:mm"
                className="field field-sm field-mono"
              />
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
            {widget.widgetType === 'pivot' && (
              <Field label="Formato de fecha/hora (opcional)" hint="Tokens: YYYY MM DD HH mm ss. Ej: DD/MM/YYYY. Solo cambia cómo se ve, no modifica el dataset.">
                <input
                  value={cfg.dateFormat || ''}
                  onChange={(e) => set('dateFormat', e.target.value)}
                  placeholder="DD/MM/YYYY"
                  className="field field-sm field-mono"
                />
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
                  <input type="color" value={cfg.color || '#133896'} onChange={(e) => set('color', e.target.value)}
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

      {queryEditorOpen && datasetId && (
        <QueryEditorModal
          datasetId={datasetId}
          dataset={datasets.find(d => d.id === datasetId)}
          onClose={() => setQueryEditorOpen(false)}
          onSaved={() => {
            setQueryEditorOpen(false);
            invalidateDatasetCache(datasetId);
            api.get(`/datasets/${datasetId}/columns`).then(({ data }) => setColumns(Array.isArray(data) ? data : []));
            api.get('/datasets').then(({ data }) => setDatasets(Array.isArray(data) ? data : []));
          }}
        />
      )}

      {formulaOpen && datasetId && (
        <FormulaEditor
          datasetId={datasetId}
          datasetName={datasets.find((d) => d.id === datasetId)?.name || 'Dataset'}
          cachedRows={cachedRows}
          sourceColumns={columns}
          onClose={() => setFormulaOpen(false)}
          onSaved={(newDatasetId) => {
            const refresh = newDatasetId !== datasetId;
            const targetId = newDatasetId;
            setDatasetId(targetId);
            setFormulaOpen(false);
            invalidateDatasetCache(targetId);
            if (refresh) {
              api.get('/datasets').then(({ data }) => setDatasets(Array.isArray(data) ? data : []));
            }
            api.get(`/datasets/${targetId}/columns`).then(({ data }) => setColumns(Array.isArray(data) ? data : []));
            updateWidget(widget.id, { datasetId: targetId });
          }}
        />
      )}
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

// ── Query Editor Modal (visual builder from report) ──────────────────────────

function QueryEditorModal({ datasetId, dataset, onClose, onSaved }) {
  const [schema, setSchema] = useState(null);
  const [schemaLoading, setSchemaLoading] = useState(false);
  const [schemaViewMode, setSchemaViewMode] = useState('list');
  const [selectedTables, setSelectedTables] = useState(dataset?.config?.visualDefinition?.tables || []);
  const [selectedColumns, setSelectedColumns] = useState(() => {
    const vd = dataset?.config?.visualDefinition;
    if (!vd?.columns) return {};
    const map = {};
    for (const c of vd.columns) { (map[c.table] ||= []).push(c.column); }
    return map;
  });
  const [joins, setJoins] = useState(dataset?.config?.visualDefinition?.joins || []);
  const [queryLimit, setQueryLimit] = useState(dataset?.config?.visualDefinition?.limit || null);
  const [query, setQuery] = useState(dataset?.config?.query || '');
  const [queryMode, setQueryMode] = useState(dataset?.config?.visualDefinition ? 'visual' : 'direct');
  const originalStateRef = useRef(null);
  const [buildingQuery, setBuildingQuery] = useState(false);
  const [estimating, setEstimating] = useState(false);
  const [costWarnings, setCostWarnings] = useState([]);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const debounceRef = useRef(null);
  const nextAliasIndexRef = useRef(selectedTables.length);

  useEffect(() => {
    if (!schema) {
      setSchemaLoading(true);
      api.post('/datasets/db-connector/introspect', { datasetId })
        .then(({ data }) => {
          setSchema(data);
          if (!selectedTables.length && query) {
            const tablePattern = /(?:FROM|JOIN)\s+(?:\[?\w+\]?\.)?(?:\[?)(\w+)(?:\]?)\s+(?:\[?)(\w+)(?:\]?)/gi;
            const found = [];
            let m;
            while ((m = tablePattern.exec(query))) {
              const tableName = m[1];
              const alias = m[2];
              if (!found.some(f => f.name.toLowerCase() === tableName.toLowerCase())) {
                const t = data.tables.find(st => st.name.toLowerCase() === tableName.toLowerCase());
                if (t) found.push({ name: t.name, schema: t.schema, type: t.type, alias });
              }
            }
            if (found.length) {
              setSelectedTables(found);
              const aliasMap = new Map();
              found.forEach(f => aliasMap.set(f.alias, f.name));

              const joinPattern = /JOIN\s+(?:\[?\w+\]?\.)?(?:\[?\w+\]?)\s+(?:\[?)(\w+)(?:\]?)\s+ON\s+(?:\[?)(\w+)(?:\]?)\.(?:\[?)(\w+)(?:\]?)\s*=\s*(?:\[?)(\w+)(?:\]?)\.(?:\[?)(\w+)(?:\]?)/gi;
              const parsedJoins = [];
              let jm;
              while ((jm = joinPattern.exec(query))) {
                parsedJoins.push({ type: 'INNER', leftTable: jm[2], leftColumn: jm[3], rightTable: jm[4], rightColumn: jm[5] });
              }
              if (parsedJoins.length) setJoins(parsedJoins);

              let colMap = {};
              const selectMatch = query.match(/^SELECT\s+(?:TOP\s+\d+\s+)?(.+?)\s+FROM\s/is);
              if (selectMatch) {
                for (const part of selectMatch[1].split(',').map(s => s.trim())) {
                  const cm = part.match(/(?:\[?)(\w+)(?:\]?)\.(?:\[?)(\w+)(?:\]?)$/);
                  if (cm) {
                    const tableName = aliasMap.get(cm[1]);
                    if (tableName) { (colMap[tableName] ||= []).push(cm[2]); }
                  }
                }
                if (Object.keys(colMap).length) setSelectedColumns(colMap);
              }
              originalStateRef.current = { tables: found, columns: colMap, joins: parsedJoins, query };
            }
          }
        })
        .catch(err => setMsg(`Error esquema: ${err.response?.data?.error || err.message}`))
        .finally(() => setSchemaLoading(false));
    }
  }, [datasetId]);

  const suggestedJoins = schema?.foreignKeys?.filter(fk =>
    selectedTables.some(t => t.name === fk.fromTable) && selectedTables.some(t => t.name === fk.toTable)
  ) || [];

  const buildQueryFromVisual = useCallback(async () => {
    if (!selectedTables.length) return null;
    const completeJoins = joins.filter(j => j.leftTable && j.leftColumn && j.rightTable && j.rightColumn);
    setBuildingQuery(true);
    try {
      const tables = selectedTables.map((t, i) => ({ name: t.name, schema: t.schema, alias: t.alias || `t${i}` }));
      const columns = [];
      for (const t of tables) {
        const cols = selectedColumns[t.name];
        if (cols?.length) {
          for (const c of cols) columns.push({ table: t.alias, column: c });
        }
      }
      const definition = { tables, columns, joins: completeJoins, limit: queryLimit };
      const { data } = await api.post('/datasets/db-connector/build-query', { datasetId, definition });
      setQuery(data.query);
      setCostWarnings([]);
      return data.query;
    } catch (err) { setMsg(`Error SQL: ${err.response?.data?.error || err.message}`); return null; }
    finally { setBuildingQuery(false); }
  }, [selectedTables, selectedColumns, joins, queryLimit, datasetId]);

  useEffect(() => {
    if (queryMode !== 'visual' || !selectedTables.length) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(buildQueryFromVisual, 500);
    return () => clearTimeout(debounceRef.current);
  }, [selectedTables, selectedColumns, joins, queryLimit, queryMode, buildQueryFromVisual]);

  const toggleTable = (t) => {
    setSelectedTables(prev => {
      const exists = prev.some(s => s.name === t.name);
      if (exists) {
        const removed = prev.find(s => s.name === t.name);
        setSelectedColumns(cols => { const next = { ...cols }; delete next[t.name]; return next; });
        if (removed?.alias) {
          setJoins(js => js.filter(j => j.leftTable !== removed.alias && j.rightTable !== removed.alias));
        }
        return prev.filter(s => s.name !== t.name);
      }
      const alias = `t${nextAliasIndexRef.current++}`;
      return [...prev, { name: t.name, schema: t.schema, type: t.type, alias }];
    });
  };

  const toggleColumn = (tableName, colName) => {
    setSelectedColumns(prev => {
      const cols = prev[tableName] || [];
      return { ...prev, [tableName]: cols.includes(colName) ? cols.filter(c => c !== colName) : [...cols, colName] };
    });
  };

  const resetToOriginal = () => {
    const orig = originalStateRef.current;
    if (orig) {
      setSelectedTables(orig.tables);
      setSelectedColumns(orig.columns);
      setJoins(orig.joins);
      setQuery(orig.query);
    }
  };

  const selectAllColumns = (t) => {
    setSelectedColumns(prev => ({ ...prev, [t.name]: t.columns.map(c => c.name) }));
  };

  const estimateCost = async () => {
    if (!query.trim()) return;
    setEstimating(true); setCostWarnings([]);
    try {
      const { data } = await api.post('/datasets/db-connector/estimate', { datasetId, query });
      setCostWarnings(data.warnings || []);
    } catch { /* silent */ }
    finally { setEstimating(false); }
  };

  const saveQuery = async () => {
    setSaving(true); setMsg('');
    try {
      let finalQuery = query;
      if (queryMode === 'visual' && selectedTables.length) {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        const fresh = await buildQueryFromVisual();
        if (fresh) finalQuery = fresh;
      }
      if (!finalQuery.trim()) { setMsg('Genera o escribe una query primero'); setSaving(false); return; }
      const visualDefinition = queryMode === 'visual' ? {
        tables: selectedTables,
        columns: Object.entries(selectedColumns).flatMap(([table, cols]) => {
          const t = selectedTables.find(s => s.name === table);
          return cols.map(c => ({ table: t?.alias || table, column: c }));
        }),
        joins,
        limit: queryLimit,
      } : undefined;
      await api.put(`/datasets/${datasetId}/db-connector`, { query: finalQuery, visualDefinition });
      await api.post(`/datasets/${datasetId}/fetch`, {});
      onSaved();
    } catch (err) { setMsg(`Error: ${err.response?.data?.error || err.message}`); }
    finally { setSaving(false); }
  };

  return (
    <Modal title="Editar consulta" onClose={onClose} maxWidth="max-w-7xl">
      <div className="space-y-3">
        {dataset?.config?.dbType !== 'redis' && (
          <div className="flex gap-1 bg-paper-deep rounded-lg p-1">
            <button type="button" onClick={() => setQueryMode('direct')}
              className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition ${queryMode === 'direct' ? 'bg-surface text-ink shadow-sm' : 'text-ink-faint hover:text-ink'}`}>
              Query directa
            </button>
            <button type="button" onClick={() => setQueryMode('visual')}
              className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition ${queryMode === 'visual' ? 'bg-surface text-ink shadow-sm' : 'text-ink-faint hover:text-ink'}`}>
              Constructor visual
            </button>
          </div>
        )}

        {queryMode === 'direct' ? (
          <Field label="Query SQL">
            <textarea value={query} onChange={(e) => setQuery(e.target.value)} rows={6}
              className="field field-mono resize-y" />
          </Field>
        ) : (
          <div className="space-y-3">
            {schemaLoading ? (
              <div className="flex items-center gap-2 text-xs text-ink-faint py-4">
                <Icon name="refresh" size={14} className="animate-spin" /> Cargando esquema…
              </div>
            ) : schema ? (
              <div className={schemaViewMode === 'diagram' ? 'space-y-3' : 'grid grid-cols-1 md:grid-cols-[2fr_3fr] gap-3 min-h-[400px]'}>
                <div className={`border border-line-soft rounded-xl bg-paper-deep/50 p-2 flex flex-col ${schemaViewMode === 'diagram' ? '' : 'max-h-[60vh]'}`} style={schemaViewMode === 'diagram' ? { height: '60vh', minHeight: 500 } : undefined}>
                  <SchemaExplorer
                    schema={schema}
                    selectedTables={selectedTables}
                    selectedColumns={selectedColumns}
                    onToggleTable={toggleTable}
                    onToggleColumn={toggleColumn}
                    onSelectAllColumns={selectAllColumns}
                    onReset={resetToOriginal}
                    viewMode={schemaViewMode}
                    onViewModeChange={setSchemaViewMode}
                    query={query}
                    joins={joins}
                    onJoinsChange={setJoins}
                    suggestedJoins={suggestedJoins}
                    onSave={saveQuery}
                    saving={saving}
                    saveLabel="Guardar y sincronizar"
                    datasetId={dataset?.id || datasetId}
                  />
                </div>
                <div className="space-y-3">
                  <JoinBuilder
                    selectedTables={selectedTables}
                    schema={schema}
                    joins={joins}
                    onJoinsChange={setJoins}
                    suggestedJoins={suggestedJoins}
                  />
                  <QueryPreview
                    query={query}
                    onQueryChange={setQuery}
                    warnings={costWarnings}
                    estimating={estimating}
                    onEstimate={estimateCost}
                    onApplyLimit={(n) => setQueryLimit(n)}
                    datasetId={dataset?.id || datasetId}
                  />
                </div>
              </div>
            ) : (
              <p className="text-xs text-ink-faint">No se pudo cargar el esquema</p>
            )}
          </div>
        )}

        <div className="flex items-center gap-2">
          <Button onClick={saveQuery} disabled={saving}>
            {saving ? 'Guardando y sincronizando…' : 'Guardar y sincronizar'}
          </Button>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          {msg && <span className="text-xs text-ink-faint font-mono">{msg}</span>}
        </div>
      </div>
    </Modal>
  );
}

// ── Formula Editor modal ──────────────────────────────────────────────────────

function FormulaEditor({ datasetId, datasetName, cachedRows, sourceColumns, onClose, onSaved }) {
  const [formulas, setFormulas]     = useState([]);
  const [saving,   setSaving]       = useState(false);
  const [error,    setError]        = useState(null);
  const [dsInfo,   setDsInfo]       = useState(null); // { sourceType, config, name }

  // Load existing columns if this is already a derived dataset
  useEffect(() => {
    api.get(`/datasets/${datasetId}`).then(({ data }) => {
      setDsInfo(data);
      if (data.sourceType === 'derived' && data.config?.columns?.length) {
        setFormulas(data.config.columns.map((c, i) => ({ _id: i, name: c.name, expression: c.expression })));
      }
    }).catch(() => {});
  }, [datasetId]);

  const addFormula = () =>
    setFormulas((f) => [...f, { _id: Date.now(), name: '', expression: '' }]);

  const removeFormula = (id) =>
    setFormulas((f) => f.filter((x) => x._id !== id));

  const updateFormula = (id, field, val) =>
    setFormulas((f) => f.map((x) => x._id === id ? { ...x, [field]: val } : x));

  // Preview: evaluate each formula against first 3 cached rows
  const previewRows = useMemo(() => {
    if (!cachedRows?.length || !formulas.length) return [];
    return cachedRows.slice(0, 3).map((row) => {
      const out = { ...row };
      for (const f of formulas) {
        if (f.name && f.expression) {
          out[f.name] = clientEval(f.expression, row);
        }
      }
      return out;
    });
  }, [formulas, cachedRows]);

  const save = async () => {
    const cols = formulas.filter((f) => f.name.trim() && f.expression.trim())
      .map((f) => ({ name: f.name.trim(), expression: f.expression.trim() }));
    if (!cols.length) { setError('Agrega al menos una fórmula con nombre y expresión.'); return; }

    setSaving(true); setError(null);
    try {
      if (dsInfo?.sourceType === 'derived') {
        await api.put(`/datasets/${datasetId}/derived`, { columns: cols });
        onSaved(datasetId);
      } else {
        const { data } = await api.post('/datasets/derived', {
          name: `${datasetName} (calculado)`,
          areaId: dsInfo?.areaId || null,
          sources: [{ datasetId, alias: 'src' }],
          columns: cols,
        });
        onSaved(data.id);
      }
    } catch (e) {
      setError(e.response?.data?.error || 'Error al guardar.');
    } finally {
      setSaving(false);
    }
  };

  const previewCols = [
    ...sourceColumns.slice(0, 6),
    ...formulas.filter((f) => f.name).map((f) => f.name),
  ];

  return (
    <Modal title="Columnas calculadas" onClose={onClose} maxWidth="max-w-2xl">
      <div className="flex gap-4">
        {/* Left: formula list */}
        <div className="flex-1 min-w-0 space-y-3">
          <p className="text-[11px] text-ink-faint">
            Usa nombres de columna del dataset como variables. Soporta <span className="font-mono">+ − × ÷</span> y paréntesis.
          </p>

          {formulas.length === 0 && (
            <p className="text-sm text-ink-faint/60 italic py-2">Sin fórmulas todavía.</p>
          )}

          {formulas.map((f) => {
            const previewVal = previewRows[0]?.[f.name];
            const evalOk = !f.expression || previewVal !== null || !f.name || !previewRows.length;
            return (
              <div key={f._id} className="bg-paper-deep rounded-xl p-3 space-y-2 border border-line">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-lumen-deep text-[12px] shrink-0">fx</span>
                  <input
                    value={f.name}
                    onChange={(e) => updateFormula(f._id, 'name', e.target.value)}
                    placeholder="nombre_columna"
                    className="field field-sm field-mono flex-1 min-w-0"
                  />
                  <button onClick={() => removeFormula(f._id)} className="text-ink-faint hover:text-rust transition cursor-pointer shrink-0">
                    <Icon name="x" size={13} />
                  </button>
                </div>
                <div className="relative">
                  <input
                    value={f.expression}
                    onChange={(e) => updateFormula(f._id, 'expression', e.target.value)}
                    placeholder="precio * cantidad"
                    className={`field field-sm field-mono w-full pr-20 ${f.expression && !evalOk ? 'border-rust/60 bg-rust/5' : ''}`}
                  />
                  {f.expression && previewVal !== undefined && previewVal !== null && (
                    <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px] font-mono text-sea">
                      = {typeof previewVal === 'number' ? previewVal.toLocaleString('es', { maximumFractionDigits: 4 }) : previewVal}
                    </span>
                  )}
                  {f.expression && !evalOk && (
                    <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-rust">error</span>
                  )}
                </div>
              </div>
            );
          })}

          <button
            onClick={addFormula}
            className="flex items-center gap-1.5 text-sm text-lumen-deep hover:text-lumen transition cursor-pointer font-medium"
          >
            <Icon name="plus" size={14} /> Nueva fórmula
          </button>

          {error && <p className="text-sm text-rust">{error}</p>}

          {dsInfo && dsInfo.sourceType !== 'derived' && (
            <p className="text-[11px] text-ink-faint bg-paper rounded-lg px-3 py-2 border border-line-soft">
              Se creará un nuevo dataset derivado basado en <span className="font-medium text-ink-soft">{datasetName}</span>.
              El widget usará ese dataset a partir de ahora.
            </p>
          )}
        </div>

        {/* Right: column reference */}
        <div className="w-36 shrink-0">
          <p className="text-[10px] font-semibold text-ink-faint uppercase tracking-widest mb-2">Columnas</p>
          <div className="space-y-0.5 max-h-72 overflow-y-auto">
            {sourceColumns.map((col) => (
              <button
                key={col}
                onClick={() => {
                  const active = [...formulas].reverse().find((f) => f._id);
                  if (!active) return;
                  updateFormula(active._id, 'expression', (active.expression ? active.expression + ' + ' : '') + col);
                }}
                title="Insertar en última fórmula"
                className="w-full text-left px-2 py-0.5 rounded text-[11px] font-mono text-ink-soft hover:bg-lumen-soft hover:text-lumen-deep cursor-pointer transition truncate"
              >
                {col}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Preview table */}
      {previewRows.length > 0 && previewCols.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <p className="text-[10px] font-semibold text-ink-faint uppercase tracking-widest mb-1.5">Vista previa (3 filas)</p>
          <table className="w-full text-[11px] font-mono border-collapse">
            <thead>
              <tr className="border-b border-line">
                {previewCols.map((c) => (
                  <th key={c} className={`text-left px-2 py-1 text-ink-faint font-medium truncate max-w-[100px] ${formulas.some((f) => f.name === c) ? 'text-lumen-deep' : ''}`}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {previewRows.map((row, i) => (
                <tr key={i} className="border-b border-line-soft">
                  {previewCols.map((c) => (
                    <td key={c} className={`px-2 py-1 truncate max-w-[100px] ${formulas.some((f) => f.name === c) ? 'text-lumen-deep font-semibold' : 'text-ink-soft'}`}>
                      {row[c] == null ? <span className="text-ink-faint/40">—</span> : String(row[c])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex justify-end gap-2 mt-5">
        <Button variant="ghost" size="sm" onClick={onClose}>Cancelar</Button>
        <Button size="sm" onClick={save} disabled={saving}>
          {saving ? 'Guardando…' : 'Guardar fórmulas'}
        </Button>
      </div>
    </Modal>
  );
}

function KpiThresholds({ thresholds, onChange }) {
  const add    = () => onChange([...thresholds, { op: 'gt', value: '', color: '#157a52' }]);
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
          <input type="color" value={t.color || '#157a52'} onChange={(e) => update(i, 'color', e.target.value)}
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
