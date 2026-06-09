import { useMemo } from 'react';

const AGG = {
  sum: (arr) => arr.reduce((a, b) => a + b, 0),
  count: (arr) => arr.length,
  avg: (arr) => arr.reduce((a, b) => a + b, 0) / arr.length,
  max: (arr) => Math.max(...arr),
  min: (arr) => Math.min(...arr),
};

function fmt(v) {
  if (v === null || v === undefined || isNaN(v)) return '—';
  return typeof v === 'number'
    ? v % 1 === 0 ? v.toLocaleString() : v.toLocaleString(undefined, { maximumFractionDigits: 2 })
    : v;
}

export default function PivotWidget({ config, data }) {
  const { rowField, colField, valueField, aggregation = 'sum', title } = config;

  const { rowKeys, colKeys, cells, rowTotals, colTotals, grandTotal } = useMemo(() => {
    if (!data?.length || !rowField || !valueField) {
      return { rowKeys: [], colKeys: [], cells: {}, rowTotals: {}, colTotals: {}, grandTotal: null };
    }

    const groups = {};
    for (const row of data) {
      const rk = String(row[rowField] ?? '(vacío)');
      const ck = colField ? String(row[colField] ?? '(vacío)') : '__all__';
      const val = Number(row[valueField]);
      if (!groups[rk]) groups[rk] = {};
      if (!groups[rk][ck]) groups[rk][ck] = [];
      if (!isNaN(val)) groups[rk][ck].push(val);
    }

    const agg = AGG[aggregation] || AGG.sum;
    const rowKeys = Object.keys(groups).sort();
    const colKeys = colField
      ? [...new Set(data.map((r) => String(r[colField] ?? '(vacío)')))].sort()
      : ['__all__'];

    const cells = {};
    const rowTotals = {};
    const colTotals = {};
    let allVals = [];

    for (const rk of rowKeys) {
      let rowVals = [];
      for (const ck of colKeys) {
        const vals = groups[rk]?.[ck] || [];
        cells[`${rk}__${ck}`] = vals.length ? agg(vals) : null;
        rowVals = rowVals.concat(vals);
      }
      rowTotals[rk] = rowVals.length ? agg(rowVals) : null;
      allVals = allVals.concat(rowVals);
    }
    for (const ck of colKeys) {
      const vals = rowKeys.flatMap((rk) => groups[rk]?.[ck] || []);
      colTotals[ck] = vals.length ? agg(vals) : null;
    }
    const grandTotal = allVals.length ? agg(allVals) : null;

    return { rowKeys, colKeys, cells, rowTotals, colTotals, grandTotal };
  }, [data, config]);

  if (!rowField || !valueField) {
    return <div className="h-full flex items-center justify-center text-slate-400 text-sm">Configura los campos de la tabla pivot</div>;
  }
  if (!rowKeys.length) {
    return <div className="h-full flex items-center justify-center text-slate-400 text-sm">Sin datos</div>;
  }

  const showCols = colField;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {title && <p className="text-xs font-semibold text-slate-600 mb-1 px-1 flex-shrink-0">{title}</p>}
      <div className="flex-1 overflow-auto min-h-0">
        <table className="text-xs border-collapse w-full">
          <thead className="sticky top-0 bg-slate-50 z-10">
            <tr>
              <th className="text-left px-3 py-2 font-semibold text-slate-600 border-b border-r border-slate-200 bg-slate-100 whitespace-nowrap">
                {rowField}
              </th>
              {showCols && colKeys.map((ck) => (
                <th key={ck} className="px-3 py-2 font-semibold text-slate-600 border-b border-slate-200 text-right whitespace-nowrap">
                  {ck}
                </th>
              ))}
              <th className="px-3 py-2 font-semibold text-slate-700 border-b border-l border-slate-200 text-right whitespace-nowrap bg-slate-50">
                {showCols ? 'Total' : aggregation}
              </th>
            </tr>
          </thead>
          <tbody>
            {rowKeys.map((rk, i) => (
              <tr key={rk} className={i % 2 === 0 ? '' : 'bg-slate-50'}>
                <td className="px-3 py-1.5 text-slate-700 border-b border-r border-slate-100 font-medium whitespace-nowrap">
                  {rk}
                </td>
                {showCols && colKeys.map((ck) => {
                  const v = cells[`${rk}__${ck}`];
                  return (
                    <td key={ck} className="px-3 py-1.5 text-slate-600 border-b border-slate-100 text-right tabular-nums">
                      {fmt(v)}
                    </td>
                  );
                })}
                <td className="px-3 py-1.5 text-slate-800 border-b border-l border-slate-100 text-right font-semibold tabular-nums bg-slate-50">
                  {fmt(rowTotals[rk])}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-slate-100">
              <td className="px-3 py-2 font-bold text-slate-700 border-t border-r border-slate-200">Total</td>
              {showCols && colKeys.map((ck) => (
                <td key={ck} className="px-3 py-2 text-slate-700 border-t border-slate-200 text-right font-semibold tabular-nums">
                  {fmt(colTotals[ck])}
                </td>
              ))}
              <td className="px-3 py-2 font-bold text-slate-800 border-t border-l border-slate-200 text-right tabular-nums">
                {fmt(grandTotal)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
