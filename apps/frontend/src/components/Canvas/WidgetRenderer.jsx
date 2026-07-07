import { lazy, Suspense, useEffect, useState, useMemo, memo } from 'react';
import api from '../../lib/api';
import { CACHE, PENDING } from '../../lib/datasetCache';
import { useReportStore, applyFilters } from '../../store/reportStore';
import KPIWidget   from '../widgets/KPIWidget';
import TableWidget from '../widgets/TableWidget';
import PivotWidget from '../widgets/PivotWidget';

const ChartWidget = lazy(() => import('../widgets/ChartWidget'));
const MapWidget   = lazy(() => import('../widgets/MapWidget'));

function WidgetSkeleton() {
  return <div className="skeleton h-full rounded-lg" />;
}

const AGGREGATE_TYPES = new Set(['kpi']);

const WidgetRenderer = memo(function WidgetRenderer({ widget, publicSlug }) {
  const [fetched, setFetched] = useState(null);
  const [aggResult, setAggResult] = useState(null);

  const filters      = useReportStore((s) => s.filters);
  const filterValues = useReportStore((s) => s.filterValues);
  const crossFilters = useReportStore((s) => s.crossFilters);
  const drillFilters = useReportStore((s) => s.drillFilters);
  const setCrossFilter = useReportStore((s) => s.setCrossFilter);
  const drillThrough   = useReportStore((s) => s.drillThrough);

  const useAggregate = AGGREGATE_TYPES.has(widget.widgetType) && widget.datasetId && !publicSlug;
  const aggField = widget.config?.valueField;
  const aggOp = widget.config?.aggregation || 'sum';

  useEffect(() => {
    if (!useAggregate || !aggField) return;
    let alive = true;

    const params = new URLSearchParams({ field: aggField, op: aggOp });

    const activeFilters = [];
    for (const df of drillFilters ?? []) {
      if (df.datasetId === widget.datasetId) activeFilters.push({ field: df.field, value: df.value });
    }
    const cf = crossFilters?.[widget.datasetId];
    if (cf) activeFilters.push({ field: cf.field, value: cf.value });
    if (activeFilters.length) params.set('filters', JSON.stringify(activeFilters));

    api.get(`/datasets/${widget.datasetId}/aggregate?${params}`)
      .then(({ data }) => { if (alive) setAggResult(data); });

    return () => { alive = false; };
  }, [useAggregate, widget.datasetId, aggField, aggOp, crossFilters, drillFilters]);

  useEffect(() => {
    const dsId = widget.datasetId;
    if (!dsId || useAggregate) return;

    if (CACHE[dsId]) { setFetched(CACHE[dsId]); return; }

    let alive = true;
    const path = publicSlug
      ? `/reports/public/${publicSlug}/datasets/${dsId}/rows`
      : `/datasets/${dsId}/rows`;

    if (!PENDING[dsId]) {
      PENDING[dsId] = api.get(path)
        .then(({ data: rows }) => { CACHE[dsId] = rows; return rows; })
        .finally(() => { delete PENDING[dsId]; });
    }

    PENDING[dsId].then((rows) => { if (alive) setFetched(rows); });
    return () => { alive = false; };
  }, [widget.datasetId, publicSlug, useAggregate]);

  const rawData = widget.datasetId ? (CACHE[widget.datasetId] ?? fetched) : null;

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

  const dsId = widget.datasetId;

  const loadingRows = !!dsId && !useAggregate && rawData === null;
  const loadingAgg = useAggregate && !!aggField && aggResult === null;
  if (loadingRows || loadingAgg) {
    return <WidgetSkeleton />;
  }

  if (widget.widgetType === 'kpi') {
    return <KPIWidget config={widget.config || {}} data={data} aggResult={aggResult} datasetId={dsId} />;
  }

  const props = { config: widget.config || {}, data, onCrossFilter, datasetId: dsId };

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
  if (widget.widgetType === 'table') return <TableWidget {...props} />;
  if (widget.widgetType === 'pivot') return <PivotWidget {...props} />;
  return <div className="flex items-center justify-center h-full text-ink-faint text-sm">Widget desconocido</div>;
});

export default WidgetRenderer;
