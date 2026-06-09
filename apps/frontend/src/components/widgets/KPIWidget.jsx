import { useMemo } from 'react';

export default function KPIWidget({ config, data }) {
  const { title = 'KPI', valueField, aggregation = 'sum', prefix = '', suffix = '', color = '#6366f1' } = config;

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
      <p className="text-xs font-medium text-slate-500 mb-2 uppercase tracking-wide">{title}</p>
      <p className="text-4xl font-bold" style={{ color }}>
        {prefix}{value}{suffix}
      </p>
      {aggregation !== 'sum' && (
        <p className="text-xs text-slate-400 mt-1">{aggregation}</p>
      )}
    </div>
  );
}
