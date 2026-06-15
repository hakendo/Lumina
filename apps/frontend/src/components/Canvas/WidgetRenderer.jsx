import { useEffect, useState } from 'react';
import api from '../../lib/api';
import { CACHE } from '../../lib/datasetCache';
import { useReportStore, applyFilters } from '../../store/reportStore';
import ChartWidget from '../widgets/ChartWidget';
import KPIWidget from '../widgets/KPIWidget';
import TableWidget from '../widgets/TableWidget';
import MapWidget from '../widgets/MapWidget';
import PivotWidget from '../widgets/PivotWidget';

// publicSlug: en la vista pública anónima no hay sesión, así que las filas
// se piden por el endpoint público del reporte en vez de /datasets/:id/rows.
export default function WidgetRenderer({ widget, publicSlug }) {
  const [fetched, setFetched] = useState(null);
  const filters = useReportStore((s) => s.filters);
  const filterValues = useReportStore((s) => s.filterValues);

  // El caché se lee en render; el efecto solo trae lo que falta.
  const rawData = widget.datasetId ? CACHE[widget.datasetId] ?? fetched : null;

  useEffect(() => {
    if (!widget.datasetId || CACHE[widget.datasetId]) return;
    let alive = true;
    const path = publicSlug
      ? `/reports/public/${publicSlug}/datasets/${widget.datasetId}/rows`
      : `/datasets/${widget.datasetId}/rows`;
    api.get(path).then(({ data: rows }) => {
      CACHE[widget.datasetId] = rows;
      if (alive) setFetched(rows);
    });
    return () => { alive = false; };
  }, [widget.datasetId, publicSlug]);

  const data = rawData
    ? applyFilters(rawData, widget.datasetId, filters, filterValues)
    : [];

  const props = { config: widget.config || {}, data };

  if (widget.widgetType === 'chart') return <ChartWidget {...props} />;
  if (widget.widgetType === 'kpi') return <KPIWidget {...props} />;
  if (widget.widgetType === 'table') return <TableWidget {...props} />;
  if (widget.widgetType === 'map') return <MapWidget {...props} />;
  if (widget.widgetType === 'pivot') return <PivotWidget {...props} />;
  return <div className="flex items-center justify-center h-full text-ink-faint text-sm">Widget desconocido</div>;
}
