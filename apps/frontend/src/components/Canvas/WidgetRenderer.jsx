import { lazy, Suspense, useEffect, useState, useMemo, memo } from 'react';
import api from '../../lib/api';
import { CACHE, PENDING } from '../../lib/datasetCache';
import { useReportStore, applyFilters } from '../../store/reportStore';
// Lightweight widgets — no heavy deps, loaded eagerly
import KPIWidget   from '../widgets/KPIWidget';
import TableWidget from '../widgets/TableWidget';
import PivotWidget from '../widgets/PivotWidget';

// Heavy widgets code-split: ECharts (~300 kB gzip) and Leaflet (~45 kB gzip)
// only download when a widget of that type actually mounts.
const ChartWidget = lazy(() => import('../widgets/ChartWidget'));
const MapWidget   = lazy(() => import('../widgets/MapWidget'));

function WidgetSkeleton() {
  return <div className="skeleton h-full rounded-lg" />;
}

// memo: skips re-render when widget identity and store slices haven't changed.
const WidgetRenderer = memo(function WidgetRenderer({ widget, publicSlug }) {
  const [fetched, setFetched] = useState(null);

  // Granular store subscriptions — each selector is stable, avoids re-renders
  // triggered by unrelated store updates (e.g. selectedWidget changing).
  const filters      = useReportStore((s) => s.filters);
  const filterValues = useReportStore((s) => s.filterValues);
  const crossFilters = useReportStore((s) => s.crossFilters);
  const drillFilters = useReportStore((s) => s.drillFilters);
  const setCrossFilter = useReportStore((s) => s.setCrossFilter);
  const drillThrough   = useReportStore((s) => s.drillThrough);

  useEffect(() => {
    const dsId = widget.datasetId;
    if (!dsId) return;

    if (CACHE[dsId]) { setFetched(CACHE[dsId]); return; }

    let alive = true;
    const path = publicSlug
      ? `/reports/public/${publicSlug}/datasets/${dsId}/rows`
      : `/datasets/${dsId}/rows`;

    // Deduplicate: widgets sharing a dataset share one in-flight promise.
    if (!PENDING[dsId]) {
      PENDING[dsId] = api.get(path)
        .then(({ data: rows }) => { CACHE[dsId] = rows; return rows; })
        .finally(() => { delete PENDING[dsId]; });
    }

    PENDING[dsId].then((rows) => { if (alive) setFetched(rows); });
    return () => { alive = false; };
  }, [widget.datasetId, publicSlug]);

  const rawData = widget.datasetId ? (CACHE[widget.datasetId] ?? fetched) : null;

  // Memoize filtered data: only recomputes when inputs actually change.
  const data = useMemo(
    () => rawData ? applyFilters(rawData, widget.datasetId, filters, filterValues, crossFilters, drillFilters) : [],
    [rawData, widget.datasetId, filters, filterValues, crossFilters, drillFilters],
  );

  const drillPageId = widget.config?.drillTargetPageId;
  const onCrossFilter = useMemo(
    () => widget.datasetId && !publicSlug
      ? (field, value) => {
          if (drillPageId) drillThrough(drillPageId, widget.datasetId, field, value);
          else setCrossFilter(widget.datasetId, field, value);
        }
      : null,
    [widget.datasetId, publicSlug, drillPageId, drillThrough, setCrossFilter],
  );

  const props = { config: widget.config || {}, data, onCrossFilter };

  if (widget.widgetType === 'chart') {
    return (
      <Suspense fallback={<WidgetSkeleton />}>
        <ChartWidget {...props} />
      </Suspense>
    );
  }
  if (widget.widgetType === 'map') {
    return (
      <Suspense fallback={<WidgetSkeleton />}>
        <MapWidget {...props} />
      </Suspense>
    );
  }
  if (widget.widgetType === 'kpi')   return <KPIWidget   {...props} />;
  if (widget.widgetType === 'table') return <TableWidget {...props} />;
  if (widget.widgetType === 'pivot') return <PivotWidget {...props} />;
  return <div className="flex items-center justify-center h-full text-ink-faint text-sm">Widget desconocido</div>;
});

export default WidgetRenderer;
