import { useMemo } from 'react';

export default function KPIWidget({ config, data }) {
  const { title = 'KPI', valueField, aggregation = 'sum', prefix = '', suffix = '', color = '#b8730f' } = config;

  const value = useMemo(() => {
    if (!data?.length || !valueField) return '—';
    const nums = data.map((r) => Number(r[valueField])).filter((n) => !isNaN(n));
    if (!nums.length) return '—';
    let v;
    if (aggregation === 'sum') v = nums.reduce((a, b) => a + b, 0);
    else if (aggregation === 'avg') v = nums.reduce((a, b) => a + b, 0) / nums.length;
    else if (aggregation === 'max') v = Math.max(...nums);
    else if (aggregation === 'min') v = Math.min(...nums);
    else if (aggregation === 'count') v = nums.length;
    else v = nums[0];
    return v % 1 === 0 ? v.toLocaleString() : v.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }, [data, config]);

  return (
    <div className="h-full flex flex-col items-center justify-center text-center px-4">
      <p className="text-[11px] font-semibold text-ink-faint mb-2 uppercase tracking-widest">{title}</p>
      <p className="font-mono font-semibold text-4xl tracking-tight" style={{ color }}>
        {prefix}{value}{suffix}
      </p>
      {aggregation !== 'sum' && (
        <p className="font-mono text-[11px] text-ink-faint mt-1.5">{aggregation}</p>
      )}
    </div>
  );
}
