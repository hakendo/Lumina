import { useEffect, useState } from 'react';
import { nanoid } from 'nanoid';
import api from '../../lib/api';
import { useReportStore } from '../../store/reportStore';

const FILTER_TYPES = [
  { value: 'select', label: 'Selección' },
  { value: 'range', label: 'Rango numérico' },
  { value: 'daterange', label: 'Rango de fechas' },
];

export default function FilterBar() {
  const { filters, filterValues, addFilter, removeFilter, setFilterValue } = useReportStore();
  const [datasets, setDatasets] = useState([]);
  const [colsByDs, setColsByDs] = useState({});
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ datasetId: '', field: '', type: 'select', label: '' });
  const [optionsByFilter, setOptionsByFilter] = useState({});

  useEffect(() => {
    api.get('/datasets').then(({ data }) => setDatasets(data));
  }, []);

  useEffect(() => {
    for (const f of filters) {
      if (f.type === 'select' && f.datasetId && f.field && !optionsByFilter[f.id]) {
        api.get(`/datasets/${f.datasetId}/rows`).then(({ data: rows }) => {
          const opts = [...new Set(rows.map((r) => String(r[f.field] ?? '')))].sort();
          setOptionsByFilter((prev) => ({ ...prev, [f.id]: opts }));
        });
      }
    }
  }, [filters]);

  const loadCols = async (datasetId) => {
    if (!datasetId || colsByDs[datasetId]) return;
    const { data } = await api.get(`/datasets/${datasetId}/columns`);
    setColsByDs((prev) => ({ ...prev, [datasetId]: data }));
  };

  const confirmAdd = () => {
    if (!draft.datasetId || !draft.field) return;
    addFilter({ id: nanoid(), ...draft });
    setDraft({ datasetId: '', field: '', type: 'select', label: '' });
    setAdding(false);
  };

  if (!filters.length && !adding) {
    return (
      <div className="flex items-center gap-2 px-4 py-1.5 bg-slate-50 border-b border-slate-200">
        <span className="text-xs text-slate-400">Sin filtros activos</span>
        <button onClick={() => setAdding(true)}
          className="text-xs text-indigo-600 hover:bg-indigo-50 px-2 py-0.5 rounded transition">
          + Agregar filtro
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2 px-4 py-2 bg-slate-50 border-b border-slate-200 min-h-[44px]">
      <span className="text-xs font-medium text-slate-500">Filtros:</span>

      {filters.map((f) => (
        <FilterChip key={f.id} filter={f} value={filterValues[f.id]}
          options={optionsByFilter[f.id]}
          onChange={(v) => setFilterValue(f.id, v)}
          onRemove={() => removeFilter(f.id)} />
      ))}

      {adding ? (
        <div className="flex items-center gap-1.5 bg-white border border-slate-200 rounded-lg px-2 py-1 text-xs">
          <select value={draft.datasetId}
            onChange={(e) => { setDraft((d) => ({ ...d, datasetId: e.target.value, field: '' })); loadCols(e.target.value); }}
            className="border-none outline-none text-xs bg-transparent">
            <option value="">Dataset...</option>
            {datasets.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <select value={draft.field} onChange={(e) => setDraft((d) => ({ ...d, field: e.target.value }))}
            className="border-none outline-none text-xs bg-transparent">
            <option value="">Campo...</option>
            {(colsByDs[draft.datasetId] || []).map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select value={draft.type} onChange={(e) => setDraft((d) => ({ ...d, type: e.target.value }))}
            className="border-none outline-none text-xs bg-transparent">
            {FILTER_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          <input value={draft.label} onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
            placeholder="Etiqueta (opcional)" className="border-none outline-none text-xs bg-transparent w-28" />
          <button onClick={confirmAdd} className="text-indigo-600 font-medium hover:text-indigo-800">✓</button>
          <button onClick={() => setAdding(false)} className="text-slate-400 hover:text-slate-700">✕</button>
        </div>
      ) : (
        <button onClick={() => setAdding(true)}
          className="text-xs text-indigo-600 hover:bg-indigo-50 px-2 py-0.5 rounded transition">
          + Agregar
        </button>
      )}
    </div>
  );
}

function FilterChip({ filter, value, options, onChange, onRemove }) {
  const label = filter.label || filter.field;

  if (filter.type === 'select') {
    return (
      <div className="flex items-center gap-1 bg-indigo-50 border border-indigo-200 rounded-lg px-2 py-0.5 text-xs">
        <span className="text-indigo-700 font-medium">{label}:</span>
        <select value={value || ''} onChange={(e) => onChange(e.target.value || null)}
          className="border-none outline-none text-xs bg-transparent text-indigo-800 max-w-[120px]">
          <option value="">Todos</option>
          {(options || []).map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
        <button onClick={onRemove} className="text-indigo-400 hover:text-indigo-700 ml-0.5">✕</button>
      </div>
    );
  }

  if (filter.type === 'range') {
    const [min, max] = Array.isArray(value) ? value : ['', ''];
    return (
      <div className="flex items-center gap-1 bg-indigo-50 border border-indigo-200 rounded-lg px-2 py-0.5 text-xs">
        <span className="text-indigo-700 font-medium">{label}:</span>
        <input type="number" placeholder="mín" value={min} onChange={(e) => onChange([e.target.value, max])}
          className="w-16 border-none outline-none text-xs bg-transparent text-indigo-800 tabular-nums" />
        <span className="text-indigo-400">—</span>
        <input type="number" placeholder="máx" value={max} onChange={(e) => onChange([min, e.target.value])}
          className="w-16 border-none outline-none text-xs bg-transparent text-indigo-800 tabular-nums" />
        <button onClick={onRemove} className="text-indigo-400 hover:text-indigo-700 ml-0.5">✕</button>
      </div>
    );
  }

  if (filter.type === 'daterange') {
    const [from, to] = Array.isArray(value) ? value : ['', ''];
    return (
      <div className="flex items-center gap-1 bg-indigo-50 border border-indigo-200 rounded-lg px-2 py-0.5 text-xs">
        <span className="text-indigo-700 font-medium">{label}:</span>
        <input type="date" value={from} onChange={(e) => onChange([e.target.value, to])}
          className="border-none outline-none text-xs bg-transparent text-indigo-800" />
        <span className="text-indigo-400">→</span>
        <input type="date" value={to} onChange={(e) => onChange([from, e.target.value])}
          className="border-none outline-none text-xs bg-transparent text-indigo-800" />
        <button onClick={onRemove} className="text-indigo-400 hover:text-indigo-700 ml-0.5">✕</button>
      </div>
    );
  }

  return null;
}
