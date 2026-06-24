import { useMemo } from 'react';
import { useDatasetMeta, WidgetFooter } from './useDatasetMeta';

function evalThreshold(numericValue, thresholds = [], defaultColor) {
  for (const t of thresholds) {
    const tv = Number(t.value);
    if (isNaN(tv) || !t.color) continue;
    if (t.op === 'gt' && numericValue > tv) return t.color;
    if (t.op === 'gte' && numericValue >= tv) return t.color;
    if (t.op === 'lt' && numericValue < tv) return t.color;
    if (t.op === 'lte' && numericValue <= tv) return t.color;
    if (t.op === 'eq' && numericValue === tv) return t.color;
  }
  return defaultColor;
}

function formatValue(v) {
  if (v === null || v === undefined) return '—';
  return v % 1 === 0 ? v.toLocaleString() : v.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export default function KPIWidget({ config, data, aggResult, datasetId }) {
  const { title = 'KPI', valueField, aggregation = 'sum', prefix = '', suffix = '', color = '#b8730f', thresholds = [] } = config;
  const meta = useDatasetMeta(datasetId);

  const { display, numericValue } = useMemo(() => {
    if (aggResult?.value !== undefined && aggResult.value !== null) {
      return { display: formatValue(aggResult.value), numericValue: aggResult.value };
    }

    if (!data?.length || !valueField) return { display: '—', numericValue: null };
    const nums = data.map((r) => Number(r[valueField])).filter((n) => !isNaN(n));
    if (!nums.length) return { display: '—', numericValue: null };
    let v;
    if (aggregation === 'sum') v = nums.reduce((a, b) => a + b, 0);
    else if (aggregation === 'avg') v = nums.reduce((a, b) => a + b, 0) / nums.length;
    else if (aggregation === 'max') v = Math.max(...nums);
    else if (aggregation === 'min') v = Math.min(...nums);
    else if (aggregation === 'count') v = nums.length;
    else v = nums[0];
    return { display: formatValue(v), numericValue: v };
  }, [data, aggResult, config]);

  const activeColor = numericValue !== null
    ? evalThreshold(numericValue, thresholds, color)
    : color;

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 flex flex-col items-center justify-center text-center px-4">
        <p className="text-[11px] font-semibold text-ink-faint mb-2 uppercase tracking-widest">{title}</p>
        <p className="font-mono font-semibold text-4xl tracking-tight" style={{ color: activeColor }}>
          {prefix}{display}{suffix}
        </p>
        {aggregation !== 'sum' && (
          <p className="font-mono text-[11px] text-ink-faint mt-1.5">{aggregation}</p>
        )}
      </div>
      <WidgetFooter dataCount={aggResult?.count ?? data?.length} dataLabel="registros" meta={meta} />
    </div>
  );
}
