import { useEffect, useState } from 'react';
import { nanoid } from 'nanoid';
import api from '../../lib/api';
import { useReportStore } from '../../store/reportStore';
import { Icon } from '../ui';

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

  const AddButton = (
    <button onClick={() => setAdding(true)}
      className="inline-flex items-center gap-1 text-xs text-lumen-deep hover:bg-lumen-soft px-2 py-1 rounded-lg transition cursor-pointer">
      <Icon name="plus" size={12} /> Agregar filtro
    </button>
  );

  if (!filters.length && !adding) {
    return (
      <div className="flex items-center gap-2 px-4 py-1.5 bg-paper border-b border-line">
        <Icon name="filter" size={12} className="text-ink-faint" />
        <span className="text-xs text-ink-faint">Sin filtros activos</span>
        {AddButton}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2 px-4 py-2 bg-paper border-b border-line min-h-[44px]">
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink-soft">
        <Icon name="filter" size={12} /> Filtros
      </span>

      {filters.map((f) => (
        <FilterChip key={f.id} filter={f} value={filterValues[f.id]}
          options={optionsByFilter[f.id]}
          onChange={(v) => setFilterValue(f.id, v)}
          onRemove={() => removeFilter(f.id)} />
      ))}

      {adding ? (
        <div className="flex items-center gap-1.5 bg-surface border border-line rounded-lg px-2 py-1 text-xs">
          <select value={draft.datasetId}
            onChange={(e) => { setDraft((d) => ({ ...d, datasetId: e.target.value, field: '' })); loadCols(e.target.value); }}
            className="border-none outline-none text-xs bg-transparent text-ink-soft">
            <option value="">Dataset…</option>
            {datasets.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <select value={draft.field} onChange={(e) => setDraft((d) => ({ ...d, field: e.target.value }))}
            className="border-none outline-none text-xs bg-transparent text-ink-soft">
            <option value="">Campo…</option>
            {(colsByDs[draft.datasetId] || []).map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select value={draft.type} onChange={(e) => setDraft((d) => ({ ...d, type: e.target.value }))}
            className="border-none outline-none text-xs bg-transparent text-ink-soft">
            {FILTER_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          <input value={draft.label} onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
            placeholder="Etiqueta (opcional)" className="border-none outline-none text-xs bg-transparent w-28 placeholder:text-ink-faint" />
          <button onClick={confirmAdd} title="Confirmar" className="text-sea hover:opacity-70 cursor-pointer"><Icon name="check" size={13} /></button>
          <button onClick={() => setAdding(false)} title="Cancelar" className="text-ink-faint hover:text-ink cursor-pointer"><Icon name="x" size={13} /></button>
        </div>
      ) : (
        AddButton
      )}
    </div>
  );
}

function ChipShell({ children, onRemove }) {
  return (
    <div className="flex items-center gap-1 bg-lumen-soft border border-lumen-line rounded-lg px-2 py-0.5 text-xs">
      {children}
      <button onClick={onRemove} className="text-lumen-deep/60 hover:text-lumen-deep ml-0.5 cursor-pointer" aria-label="Quitar filtro">
        <Icon name="x" size={11} />
      </button>
    </div>
  );
}

function FilterChip({ filter, value, options, onChange, onRemove }) {
  const label = filter.label || filter.field;

  if (filter.type === 'select') {
    return (
      <ChipShell onRemove={onRemove}>
        <span className="text-lumen-deep font-semibold">{label}:</span>
        <select value={value || ''} onChange={(e) => onChange(e.target.value || null)}
          className="border-none outline-none text-xs bg-transparent text-ink max-w-[120px]">
          <option value="">Todos</option>
          {(options || []).map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      </ChipShell>
    );
  }

  if (filter.type === 'range') {
    const [min, max] = Array.isArray(value) ? value : ['', ''];
    return (
      <ChipShell onRemove={onRemove}>
        <span className="text-lumen-deep font-semibold">{label}:</span>
        <input type="number" placeholder="mín" value={min} onChange={(e) => onChange([e.target.value, max])}
          className="w-16 border-none outline-none text-xs bg-transparent text-ink font-mono" />
        <span className="text-lumen-deep/50">—</span>
        <input type="number" placeholder="máx" value={max} onChange={(e) => onChange([min, e.target.value])}
          className="w-16 border-none outline-none text-xs bg-transparent text-ink font-mono" />
      </ChipShell>
    );
  }

  if (filter.type === 'daterange') {
    const [from, to] = Array.isArray(value) ? value : ['', ''];
    return (
      <ChipShell onRemove={onRemove}>
        <span className="text-lumen-deep font-semibold">{label}:</span>
        <input type="date" value={from} onChange={(e) => onChange([e.target.value, to])}
          className="border-none outline-none text-xs bg-transparent text-ink font-mono" />
        <span className="text-lumen-deep/50">→</span>
        <input type="date" value={to} onChange={(e) => onChange([from, e.target.value])}
          className="border-none outline-none text-xs bg-transparent text-ink font-mono" />
      </ChipShell>
    );
  }

  return null;
}
