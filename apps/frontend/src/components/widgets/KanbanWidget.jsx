import { useMemo, useState } from 'react';
import { useDatasetMeta, WidgetFooter } from './useDatasetMeta';
import { formatDateValue } from '../../lib/dateFormat';
import { Modal } from '../ui';

const COLORS = ['#133896', '#08cdff', '#031560', '#157a52', '#b3222f', '#5c6b84', '#7a9cc6', '#0a5c8a'];

export default function KanbanWidget({ config, data, onCrossFilter, datasetId }) {
  const {
    title, groupField, titleField, cardFields = [], colorField, columnOrder, crossFilterField,
    columnColors = {}, cardFieldSuffixes = {}, dateFormat,
  } = config;
  const meta = useDatasetMeta(datasetId);
  const [selected, setSelected] = useState(null);
  const [detailRow, setDetailRow] = useState(null);

  const displayValue = (field, value) => {
    if (value === null || value === undefined || value === '') return '';
    const formatted = dateFormat ? formatDateValue(value, dateFormat) : value;
    const suffix = cardFieldSuffixes[field];
    return suffix ? `${formatted} ${suffix}` : String(formatted);
  };

  const { columns, colorMap } = useMemo(() => {
    if (!data?.length || !groupField) return { columns: [], colorMap: {} };

    const groups = {};
    const seenOrder = [];
    for (const row of data) {
      const key = String(row[groupField] ?? '(vacío)');
      if (!groups[key]) { groups[key] = []; seenOrder.push(key); }
      groups[key].push(row);
    }

    const order = columnOrder?.length
      ? [...columnOrder.filter((k) => groups[k]), ...seenOrder.filter((k) => !columnOrder.includes(k))]
      : seenOrder;

    const colorMap = {};
    if (colorField) {
      let i = 0;
      for (const row of data) {
        const v = String(row[colorField] ?? '');
        if (v && !(v in colorMap)) colorMap[v] = COLORS[i++ % COLORS.length];
      }
    }

    return { columns: order.map((key) => ({ key, rows: groups[key] })), colorMap };
  }, [data, groupField, colorField, columnOrder]);

  const handleCardClick = (row) => {
    const field = crossFilterField || groupField;
    if (onCrossFilter && field) {
      const value = row[field];
      const key = `${field}:${value}`;
      const isSame = selected === key;
      setSelected(isSame ? null : key);
      onCrossFilter(field, value);
    }
    setDetailRow(row);
  };

  if (!groupField || !titleField) {
    return <div className="h-full flex items-center justify-center text-ink-faint text-sm">Configura las columnas del tablero</div>;
  }
  if (!columns.length) {
    return <div className="h-full flex items-center justify-center text-ink-faint text-sm">Sin datos</div>;
  }

  return (
    <div className="h-full flex flex-col overflow-hidden drag-cancel">
      {title && (
        <div className="flex items-center gap-2 px-2 py-1 shrink-0 border-b border-line-soft">
          <p className="text-xs font-semibold text-ink-soft truncate">{title}</p>
        </div>
      )}
      <div className="flex-1 flex gap-3 overflow-x-auto overflow-y-hidden p-2 min-h-0">
        {columns.map(({ key, rows }) => {
          const colColor = columnColors[key];
          return (
          <div key={key} className="flex flex-col shrink-0 w-56 bg-paper-deep rounded-lg overflow-hidden">
            <div
              className="flex items-center justify-between gap-2 px-2.5 py-1.5 shrink-0"
              style={colColor ? { borderTop: `3px solid ${colColor}`, backgroundColor: `${colColor}1a` } : undefined}
            >
              <p className="text-[11px] font-semibold text-ink-soft truncate">{key}</p>
              <span className="text-[10px] font-mono text-ink-faint shrink-0">{rows.length}</span>
            </div>
            <div className="flex-1 overflow-y-auto px-1.5 pb-1.5 space-y-1.5 min-h-0">
              {rows.map((row, i) => {
                const accent = colorField ? colorMap[String(row[colorField] ?? '')] : null;
                const field = crossFilterField || groupField;
                const isSelected = onCrossFilter && field && selected === `${field}:${row[field]}`;
                return (
                  <div
                    key={i}
                    onClick={() => handleCardClick(row)}
                    className={`bg-surface border rounded-lg px-2.5 py-2 shadow-card transition cursor-pointer hover:border-lumen-line hover:-translate-y-0.5 ${
                      isSelected ? 'border-lumen ring-1 ring-lumen' : 'border-line-soft'
                    }`}
                    style={accent ? { borderLeft: `3px solid ${accent}`, paddingLeft: '9px' } : undefined}
                  >
                    <p className="text-xs font-medium text-ink truncate">{String(row[titleField] ?? '')}</p>
                    {cardFields.map((f) => (
                      <p key={f} className="text-[11px] text-ink-faint truncate mt-0.5">{displayValue(f, row[f])}</p>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
          );
        })}
      </div>
      {detailRow && (
        <Modal title={String(detailRow[titleField] ?? 'Ticket')} onClose={() => setDetailRow(null)}>
          <div className="space-y-2.5">
            <div>
              <p className="text-[10px] font-semibold text-ink-faint uppercase tracking-widest">{groupField}</p>
              <p className="text-sm text-ink">{String(detailRow[groupField] ?? '')}</p>
            </div>
            {cardFields.map((f) => (
              <div key={f}>
                <p className="text-[10px] font-semibold text-ink-faint uppercase tracking-widest">{f}</p>
                <p className="text-sm text-ink whitespace-pre-wrap">{displayValue(f, detailRow[f]) || '—'}</p>
              </div>
            ))}
          </div>
        </Modal>
      )}
      <WidgetFooter dataCount={data?.length} dataLabel="tarjetas" meta={meta} />
    </div>
  );
}
