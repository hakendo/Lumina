import { useMemo, useState, useRef, useCallback } from 'react';
import { useDatasetMeta, WidgetFooter } from './useDatasetMeta';

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

const MIN_COL = 80;
const DEFAULT_COL = 120;
const PAGE_SIZES = [25, 50, 100, 500];

export default function PivotWidget({ config, data, datasetId }) {
  const { rowField, colField, valueField, aggregation = 'sum', title } = config;
  const meta = useDatasetMeta(datasetId);
  const [sortCol, setSortCol] = useState(null);
  const [sortDir, setSortDir] = useState('desc');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [perPage, setPerPage] = useState(50);
  const [colWidths, setColWidths] = useState({});

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

  const filtered = useMemo(() => {
    if (!search.trim()) return rowKeys;
    const q = search.toLowerCase();
    return rowKeys.filter((rk) => rk.toLowerCase().includes(q));
  }, [rowKeys, search]);

  const sorted = useMemo(() => {
    if (!sortCol) return filtered;
    const arr = [...filtered];
    arr.sort((a, b) => {
      let va, vb;
      if (sortCol === '__total__') {
        va = rowTotals[a] ?? 0; vb = rowTotals[b] ?? 0;
      } else if (sortCol === '__row__') {
        return sortDir === 'asc' ? a.localeCompare(b) : b.localeCompare(a);
      } else {
        va = cells[`${a}__${sortCol}`] ?? 0;
        vb = cells[`${b}__${sortCol}`] ?? 0;
      }
      return sortDir === 'asc' ? va - vb : vb - va;
    });
    return arr;
  }, [filtered, sortCol, sortDir, cells, rowTotals]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / perPage));
  const pageRows = useMemo(() => sorted.slice(page * perPage, (page + 1) * perPage), [sorted, page, perPage]);

  const handleSort = useCallback((col) => {
    if (sortCol === col) setSortDir((d) => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(col); setSortDir('desc'); }
    setPage(0);
  }, [sortCol]);

  const startResize = useCallback((e, col) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = colWidths[col] || DEFAULT_COL;
    const onMove = (me) => setColWidths((prev) => ({ ...prev, [col]: Math.max(MIN_COL, startW + me.clientX - startX) }));
    const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [colWidths]);

  if (!rowField || !valueField) {
    return <div className="h-full flex items-center justify-center text-ink-faint text-sm">Configura los campos de la tabla pivot</div>;
  }
  if (!rowKeys.length) {
    return <div className="h-full flex items-center justify-center text-ink-faint text-sm">Sin datos</div>;
  }

  const showCols = colField;
  const SortIcon = ({ col }) => {
    if (sortCol === col) return <span className="text-lumen-deep text-[10px] ml-0.5">{sortDir === 'asc' ? '▲' : '▼'}</span>;
    return <span className="text-ink-faint/30 text-[10px] ml-0.5 opacity-0 group-hover:opacity-100 transition">▲</span>;
  };

  return (
    <div className="h-full flex flex-col overflow-hidden drag-cancel">
      {/* Header */}
      <div className="flex items-center gap-2 px-2 py-1 shrink-0 border-b border-line-soft">
        {title && <p className="text-xs font-semibold text-ink-soft truncate">{title}</p>}
        <div className="flex-1" />
        <input
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(0); }}
          placeholder="Buscar fila…"
          className="text-[11px] font-mono bg-paper-deep border border-line rounded px-2 py-0.5 w-28 focus:w-36 transition-all focus:outline-none focus:border-lumen placeholder:text-ink-faint/40"
        />
        <span className="text-[10px] font-mono text-ink-faint shrink-0">{filtered.length} filas</span>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto min-h-0">
        <table className="text-xs border-collapse w-full">
          <thead className="sticky top-0 bg-paper z-10">
            <tr>
              <th
                className="text-left px-3 py-2 font-mono font-medium text-ink-soft border-b border-r border-line bg-paper-deep whitespace-nowrap relative group cursor-pointer select-none"
                style={{ width: colWidths['__row__'] || DEFAULT_COL, minWidth: MIN_COL }}
                onClick={() => handleSort('__row__')}
              >
                <span className="flex items-center">{rowField}<SortIcon col="__row__" /></span>
                <div onMouseDown={(e) => startResize(e, '__row__')} className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-lumen/30" />
              </th>
              {showCols && colKeys.map((ck) => (
                <th
                  key={ck}
                  className="px-3 py-2 font-mono font-medium text-ink-soft border-b border-line text-right whitespace-nowrap relative group cursor-pointer select-none"
                  style={{ width: colWidths[ck] || DEFAULT_COL, minWidth: MIN_COL }}
                  onClick={() => handleSort(ck)}
                >
                  <span className="flex items-center justify-end">{ck}<SortIcon col={ck} /></span>
                  <div onMouseDown={(e) => startResize(e, ck)} className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-lumen/30" />
                </th>
              ))}
              <th
                className="px-3 py-2 font-mono font-medium text-ink border-b border-l border-line text-right whitespace-nowrap bg-paper cursor-pointer select-none group"
                onClick={() => handleSort('__total__')}
              >
                <span className="flex items-center justify-end">{showCols ? 'Total' : aggregation}<SortIcon col="__total__" /></span>
              </th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((rk, i) => (
              <tr key={rk} className={i % 2 === 0 ? '' : 'bg-paper/60'}>
                <td className="px-3 py-1.5 text-ink-soft border-b border-r border-line-soft font-medium whitespace-nowrap truncate" style={{ maxWidth: colWidths['__row__'] || DEFAULT_COL }}>
                  {rk}
                </td>
                {showCols && colKeys.map((ck) => (
                  <td key={ck} className="px-3 py-1.5 text-ink-soft border-b border-line-soft text-right font-mono">
                    {fmt(cells[`${rk}__${ck}`])}
                  </td>
                ))}
                <td className="px-3 py-1.5 text-ink border-b border-l border-line-soft text-right font-semibold font-mono bg-paper/60">
                  {fmt(rowTotals[rk])}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-lumen-soft/50">
              <td className="px-3 py-2 font-bold text-ink border-t border-r border-line">Total</td>
              {showCols && colKeys.map((ck) => (
                <td key={ck} className="px-3 py-2 text-ink-soft border-t border-line text-right font-semibold font-mono">
                  {fmt(colTotals[ck])}
                </td>
              ))}
              <td className="px-3 py-2 font-bold text-lumen-deep border-t border-l border-line text-right font-mono">
                {fmt(grandTotal)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Pagination + footer */}
      <div className="flex items-center gap-2 px-2 py-1 border-t border-line-soft shrink-0 bg-paper">
        <button onClick={() => setPage(0)} disabled={page === 0} className="text-[10px] text-ink-faint hover:text-ink disabled:opacity-30 cursor-pointer disabled:cursor-default px-1">««</button>
        <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} className="text-[10px] text-ink-faint hover:text-ink disabled:opacity-30 cursor-pointer disabled:cursor-default px-1">«</button>
        <span className="text-[10px] font-mono text-ink-faint">{page + 1} / {totalPages}</span>
        <button onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1} className="text-[10px] text-ink-faint hover:text-ink disabled:opacity-30 cursor-pointer disabled:cursor-default px-1">»</button>
        <button onClick={() => setPage(totalPages - 1)} disabled={page >= totalPages - 1} className="text-[10px] text-ink-faint hover:text-ink disabled:opacity-30 cursor-pointer disabled:cursor-default px-1">»»</button>
        <div className="flex-1" />
        <select value={perPage} onChange={(e) => { setPerPage(Number(e.target.value)); setPage(0); }}
          className="text-[10px] font-mono text-ink-faint bg-paper-deep border border-line rounded px-1 py-0.5 cursor-pointer">
          {PAGE_SIZES.map((s) => <option key={s} value={s}>{s} / pág</option>)}
        </select>
      </div>
      <WidgetFooter dataCount={data?.length} dataLabel="registros" meta={meta} />
    </div>
  );
}
