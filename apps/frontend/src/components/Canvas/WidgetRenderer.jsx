import { useEffect, useState } from 'react';
import api from '../../lib/api';
import ChartWidget from '../widgets/ChartWidget';
import KPIWidget from '../widgets/KPIWidget';
import TableWidget from '../widgets/TableWidget';
import MapWidget from '../widgets/MapWidget';

const CACHE = {};

export default function WidgetRenderer({ widget }) {
  const [data, setData] = useState(null);

  useEffect(() => {
    if (!widget.datasetId) return;
    if (CACHE[widget.datasetId]) { setData(CACHE[widget.datasetId]); return; }
    api.get(`/datasets/${widget.datasetId}/rows`).then(({ data: rows }) => {
      CACHE[widget.datasetId] = rows;
      setData(rows);
    });
  }, [widget.datasetId]);

  const props = { config: widget.config || {}, data: data || [] };

  if (widget.widgetType === 'chart') return <ChartWidget {...props} />;
  if (widget.widgetType === 'kpi') return <KPIWidget {...props} />;
  if (widget.widgetType === 'table') return <TableWidget {...props} />;
  if (widget.widgetType === 'map') return <MapWidget {...props} />;
  return <div className="flex items-center justify-center h-full text-slate-400 text-sm">Widget desconocido</div>;
}
