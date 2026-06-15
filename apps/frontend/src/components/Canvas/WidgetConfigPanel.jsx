import { useEffect, useState } from 'react';
import api from '../../lib/api';
import { useReportStore } from '../../store/reportStore';
import { Button, Field, Icon } from '../ui';

const CHART_TYPES = ['bar', 'line', 'area', 'pie', 'scatter'];
const AGG_TYPES = ['sum', 'avg', 'count', 'max', 'min'];

export default function WidgetConfigPanel({ widget, onClose }) {
  const { updateWidget, removeWidget } = useReportStore();
  const [datasets, setDatasets] = useState([]);
  const [columnsByDs, setColumnsByDs] = useState({});
  const [cfg, setCfg] = useState(widget.config || {});
  const [datasetId, setDatasetId] = useState(widget.datasetId || '');

  useEffect(() => {
    api.get('/datasets').then(({ data }) => setDatasets(data));
  }, []);

  useEffect(() => {
    if (!datasetId) return;
    api.get(`/datasets/${datasetId}/columns`).then(({ data }) =>
      setColumnsByDs((prev) => ({ ...prev, [datasetId]: data }))
    );
  }, [datasetId]);

  const columns = datasetId ? columnsByDs[datasetId] || [] : [];

  const set = (key, val) => setCfg((c) => ({ ...c, [key]: val }));

  const save = () => {
    updateWidget(widget.id, { config: cfg, datasetId: datasetId || null });
    onClose();
  };

  const typeLabel = { chart: 'Gráfico', kpi: 'KPI', table: 'Tabla', map: 'Mapa', pivot: 'Tabla Pivot' };

  return (
    <div className="fixed md:static inset-y-0 right-0 z-50 w-full max-w-xs md:max-w-none md:w-72 bg-surface border-l border-line h-full overflow-y-auto flex flex-col shadow-lift md:shadow-none">
      <div className="flex items-center justify-between px-4 py-3 border-b border-line-soft">
        <span className="font-display text-sm text-ink">{typeLabel[widget.widgetType] || widget.widgetType}</span>
        <button onClick={onClose} className="text-ink-faint hover:text-ink transition cursor-pointer" aria-label="Cerrar">
          <Icon name="x" size={16} />
        </button>
      </div>

      <div className="p-4 space-y-4 flex-1">
        <Field label="Título">
          <input value={cfg.title || ''} onChange={(e) => set('title', e.target.value)}
            className="field field-sm" placeholder="Título del widget" />
        </Field>

        <Field label="Dataset">
          <select value={datasetId} onChange={(e) => setDatasetId(e.target.value)} className="field field-sm">
            <option value="">— Sin dataset —</option>
            {datasets.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </Field>

        {widget.widgetType === 'chart' && (
          <>
            <Field label="Tipo de gráfico">
              <select value={cfg.chartType || 'bar'} onChange={(e) => set('chartType', e.target.value)} className="field field-sm">
                {CHART_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
            {cfg.chartType === 'scatter' ? (
              <>
                <Field label="Eje X (numérico)"><ColSelect value={cfg.xField} onChange={(v) => set('xField', v)} columns={columns} /></Field>
                <Field label="Eje Y (numérico)"><ColSelect value={cfg.yField} onChange={(v) => set('yField', v)} columns={columns} /></Field>
                <Field label="Tamaño (opcional)"><ColSelect value={cfg.sizeField} onChange={(v) => set('sizeField', v)} columns={columns} placeholder="— Sin tamaño —" /></Field>
                <Field label="Etiqueta (opcional)"><ColSelect value={cfg.labelField} onChange={(v) => set('labelField', v)} columns={columns} placeholder="— Sin etiqueta —" /></Field>
              </>
            ) : (
              <>
                <Field label="Eje X (categoría)"><ColSelect value={cfg.xField} onChange={(v) => set('xField', v)} columns={columns} /></Field>
                <Field label="Eje Y (valor)"><ColSelect value={cfg.yField} onChange={(v) => set('yField', v)} columns={columns} /></Field>
              </>
            )}
          </>
        )}

        {widget.widgetType === 'kpi' && (
          <>
            <Field label="Campo de valor"><ColSelect value={cfg.valueField} onChange={(v) => set('valueField', v)} columns={columns} /></Field>
            <Field label="Agregación">
              <select value={cfg.aggregation || 'sum'} onChange={(e) => set('aggregation', e.target.value)} className="field field-sm">
                {AGG_TYPES.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </Field>
            <Field label="Prefijo">
              <input value={cfg.prefix || ''} onChange={(e) => set('prefix', e.target.value)} className="field field-sm" placeholder="ej. $" />
            </Field>
            <Field label="Sufijo">
              <input value={cfg.suffix || ''} onChange={(e) => set('suffix', e.target.value)} className="field field-sm" placeholder="ej. USD" />
            </Field>
            <Field label="Color">
              <input type="color" value={cfg.color || '#b8730f'} onChange={(e) => set('color', e.target.value)}
                className="h-8 w-full rounded-lg cursor-pointer border border-line bg-surface" />
            </Field>
          </>
        )}

        {widget.widgetType === 'table' && (
          <>
            <Field label="Columnas (vacío = todas)">
              <input value={(cfg.columns || []).join(', ')} onChange={(e) => set('columns', e.target.value.split(',').map((s) => s.trim()).filter(Boolean))}
                className="field field-sm field-mono" placeholder="col1, col2, col3" />
            </Field>
            <Field label="Cross-filter al hacer clic (campo)">
              <ColSelect value={cfg.crossFilterField} onChange={(v) => set('crossFilterField', v)} columns={columns} placeholder="— Sin cross-filter —" />
            </Field>
          </>
        )}

        {widget.widgetType === 'map' && (
          <>
            <Field label="Campo Latitud"><ColSelect value={cfg.latField} onChange={(v) => set('latField', v)} columns={columns} /></Field>
            <Field label="Campo Longitud"><ColSelect value={cfg.lonField} onChange={(v) => set('lonField', v)} columns={columns} /></Field>
            <Field label="Etiqueta"><ColSelect value={cfg.labelField} onChange={(v) => set('labelField', v)} columns={columns} placeholder="— Ninguna —" /></Field>
          </>
        )}

        {widget.widgetType === 'pivot' && (
          <>
            <Field label="Filas (agrupar por)"><ColSelect value={cfg.rowField} onChange={(v) => set('rowField', v)} columns={columns} /></Field>
            <Field label="Columnas (agrupar por, opcional)">
              <ColSelect value={cfg.colField} onChange={(v) => set('colField', v)} columns={columns} placeholder="— Sin columnas —" />
            </Field>
            <Field label="Valores"><ColSelect value={cfg.valueField} onChange={(v) => set('valueField', v)} columns={columns} /></Field>
            <Field label="Agregación">
              <select value={cfg.aggregation || 'sum'} onChange={(e) => set('aggregation', e.target.value)} className="field field-sm">
                {AGG_TYPES.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </Field>
          </>
        )}
      </div>

      <div className="p-4 border-t border-line-soft flex gap-2">
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
