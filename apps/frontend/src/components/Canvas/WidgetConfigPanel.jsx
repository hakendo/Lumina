import { useEffect, useState } from 'react';
import api from '../../lib/api';
import { useReportStore } from '../../store/reportStore';

const CHART_TYPES = ['bar', 'line', 'area', 'pie'];
const AGG_TYPES = ['sum', 'avg', 'count', 'max', 'min'];

export default function WidgetConfigPanel({ widget, onClose }) {
  const { updateWidget, removeWidget } = useReportStore();
  const [datasets, setDatasets] = useState([]);
  const [columns, setColumns] = useState([]);
  const [cfg, setCfg] = useState(widget.config || {});
  const [datasetId, setDatasetId] = useState(widget.datasetId || '');

  useEffect(() => {
    api.get('/datasets').then(({ data }) => setDatasets(data));
  }, []);

  useEffect(() => {
    if (!datasetId) return;
    api.get(`/datasets/${datasetId}/columns`).then(({ data }) => setColumns(data));
  }, [datasetId]);

  const set = (key, val) => setCfg((c) => ({ ...c, [key]: val }));

  const save = () => {
    updateWidget(widget.id, { config: cfg, datasetId: datasetId || null });
    onClose();
  };

  return (
    <div className="w-72 bg-white border-l border-slate-200 h-full overflow-y-auto flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
        <span className="font-semibold text-sm text-slate-700 capitalize">{widget.widgetType} widget</span>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-lg leading-none">✕</button>
      </div>

      <div className="p-4 space-y-4 flex-1">
        <Field label="Título">
          <input value={cfg.title || ''} onChange={(e) => set('title', e.target.value)}
            className="input-sm" placeholder="Título del widget" />
        </Field>

        <Field label="Dataset">
          <select value={datasetId} onChange={(e) => setDatasetId(e.target.value)} className="input-sm">
            <option value="">— Sin dataset —</option>
            {datasets.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </Field>

        {widget.widgetType === 'chart' && (
          <>
            <Field label="Tipo de gráfico">
              <select value={cfg.chartType || 'bar'} onChange={(e) => set('chartType', e.target.value)} className="input-sm">
                {CHART_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="Eje X (categoría)">
              <ColSelect value={cfg.xField} onChange={(v) => set('xField', v)} columns={columns} />
            </Field>
            <Field label="Eje Y (valor)">
              <ColSelect value={cfg.yField} onChange={(v) => set('yField', v)} columns={columns} />
            </Field>
          </>
        )}

        {widget.widgetType === 'kpi' && (
          <>
            <Field label="Campo de valor">
              <ColSelect value={cfg.valueField} onChange={(v) => set('valueField', v)} columns={columns} />
            </Field>
            <Field label="Agregación">
              <select value={cfg.aggregation || 'sum'} onChange={(e) => set('aggregation', e.target.value)} className="input-sm">
                {AGG_TYPES.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </Field>
            <Field label="Prefijo">
              <input value={cfg.prefix || ''} onChange={(e) => set('prefix', e.target.value)} className="input-sm" placeholder="ej. $" />
            </Field>
            <Field label="Sufijo">
              <input value={cfg.suffix || ''} onChange={(e) => set('suffix', e.target.value)} className="input-sm" placeholder="ej. USD" />
            </Field>
            <Field label="Color">
              <input type="color" value={cfg.color || '#6366f1'} onChange={(e) => set('color', e.target.value)} className="h-8 w-full rounded cursor-pointer" />
            </Field>
          </>
        )}

        {widget.widgetType === 'table' && (
          <Field label="Columnas (vacío = todas)">
            <input value={(cfg.columns || []).join(', ')} onChange={(e) => set('columns', e.target.value.split(',').map((s) => s.trim()).filter(Boolean))}
              className="input-sm" placeholder="col1, col2, col3" />
          </Field>
        )}

        {widget.widgetType === 'map' && (
          <>
            <Field label="Campo Latitud">
              <ColSelect value={cfg.latField} onChange={(v) => set('latField', v)} columns={columns} />
            </Field>
            <Field label="Campo Longitud">
              <ColSelect value={cfg.lonField} onChange={(v) => set('lonField', v)} columns={columns} />
            </Field>
            <Field label="Etiqueta">
              <ColSelect value={cfg.labelField} onChange={(v) => set('labelField', v)} columns={columns} placeholder="— Ninguna —" />
            </Field>
          </>
        )}
      </div>

      <div className="p-4 border-t border-slate-100 flex gap-2">
        <button onClick={save} className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg py-2 text-sm font-medium transition">
          Aplicar
        </button>
        <button onClick={() => { removeWidget(widget.id); onClose(); }}
          className="text-red-500 hover:bg-red-50 rounded-lg px-3 py-2 text-sm transition">
          Eliminar
        </button>
      </div>

      <style>{`.input-sm { width:100%; border:1px solid #e2e8f0; border-radius:0.5rem; padding:0.375rem 0.625rem; font-size:0.8rem; outline:none; } .input-sm:focus { outline:2px solid #6366f1; }`}</style>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-600 mb-1">{label}</label>
      {children}
    </div>
  );
}

function ColSelect({ value, onChange, columns, placeholder = '— Columna —' }) {
  return (
    <select value={value || ''} onChange={(e) => onChange(e.target.value)} className="input-sm">
      <option value="">{placeholder}</option>
      {columns.map((c) => <option key={c} value={c}>{c}</option>)}
    </select>
  );
}
