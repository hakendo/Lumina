import { useEffect, useState } from 'react';
import api from '../../lib/api';
import { CACHE } from '../../lib/datasetCache';
import { useReportStore, applyFilters } from '../../store/reportStore';
import ChartWidget from '../widgets/ChartWidget';
import KPIWidget from '../widgets/KPIWidget';
import TableWidget from '../widgets/TableWidget';
import MapWidget from '../widgets/MapWidget';
import PivotWidget from '../widgets/PivotWidget';

export default function WidgetRenderer({ widget }) {
  const [fetched, setFetched] = useState(null);
  const filters = useReportStore((s) => s.filters);
  const filterValues = useReportStore((s) => s.filterValues);

  // El caché se lee en render; el efecto solo trae lo que falta.
  const rawData = widget.datasetId ? CACHE[widget.datasetId] ?? fetched : null;

  useEffect(() => {
    if (!widget.datasetId || CACHE[widget.datasetId]) return;
    let alive = true;
    api.get(`/datasets/${widget.datasetId}/rows`).then(({ data: rows }) => {
      CACHE[widget.datasetId] = rows;
      if (alive) setFetched(rows);
    });
    return () => { alive = false; };
  }, [widget.datasetId]);

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
