import { useEffect, useState } from 'react';
import api from '../../lib/api';
import { useReportStore, applyFilters } from '../../store/reportStore';
import ChartWidget from '../widgets/ChartWidget';
import KPIWidget from '../widgets/KPIWidget';
import TableWidget from '../widgets/TableWidget';
import MapWidget from '../widgets/MapWidget';
import PivotWidget from '../widgets/PivotWidget';

const CACHE = {};

export default function WidgetRenderer({ widget }) {
  const [rawData, setRawData] = useState(null);
  const filters = useReportStore((s) => s.filters);
  const filterValues = useReportStore((s) => s.filterValues);

  useEffect(() => {
    if (!widget.datasetId) return;
    if (CACHE[widget.datasetId]) { setRawData(CACHE[widget.datasetId]); return; }
    api.get(`/datasets/${widget.datasetId}/rows`).then(({ data: rows }) => {
      CACHE[widget.datasetId] = rows;
      setRawData(rows);
    });
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
  return <div className="flex items-center justify-center h-full text-slate-400 text-sm">Widget desconocido</div>;
}

// Expose cache invalidation for re-sync
export function invalidateDatasetCache(datasetId) {
  delete CACHE[datasetId];
}
