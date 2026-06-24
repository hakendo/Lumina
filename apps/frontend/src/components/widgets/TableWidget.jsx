import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useDatasetMeta, formatRelativeTime } from './useDatasetMeta';

const ROW_HEIGHT = 32;
const PAGE_SIZES = [25, 50, 100, 500];
const MIN_COL_WIDTH = 60;
const DEFAULT_COL_WIDTH = 150;

export default function TableWidget({ config, data, onCrossFilter, datasetId }) {
  const { title, columns, crossFilterField, pageSize: configPageSize } = config;
  const [selectedRow, setSelectedRow] = useState(null);
  const [sortCol, setSortCol] = useState(null);
  const [sortDir, setSortDir] = useState('asc');
  const [page, setPage] = useState(0);
  const [perPage, setPerPage] = useState(configPageSize || 100);
  const [search, setSearch] = useState('');
  const [colWidths, setColWidths] = useState({});
  const meta = useDatasetMeta(datasetId);
  const parentRef = useRef(null);
  const resizingRef = useRef(null);

  const cols = useMemo(() =>
    columns?.length ? columns : data?.[0] ? Object.keys(data[0]).slice(0, 12) : [],
    [columns, data],
  );

  const effectiveCrossFilterField = crossFilterField !== undefined && crossFilterField !== null
    ? crossFilterField
    : (data?.[0] ? cols.find((c) => isNaN(Number(data[0][c])) && data[0][c] !== null) ?? cols[0] : null);

  const filtered = useMemo(() => {
    if (!data?.length || !search.trim()) return data || [];
    const q = search.toLowerCase();
    return data.filter((row) =>
      cols.some((c) => String(row[c] ?? '').toLowerCase().includes(q))
    );
  }, [data, search, cols]);

  const sorted = useMemo(() => {
    if (!sortCol || !filtered.length) return filtered;
    const arr = [...filtered];
    arr.sort((a, b) => {
      const va = a[sortCol], vb = b[sortCol];
      const na = Number(va), nb = Number(vb);
      if (!isNaN(na) && !isNaN(nb)) return sortDir === 'asc' ? na - nb : nb - na;
      const sa = String(va ?? ''), sb = String(vb ?? '');
      return sortDir === 'asc' ? sa.localeCompare(sb) : sb.localeCompare(sa);
    });
    return arr;
  }, [filtered, sortCol, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / perPage));
  const pageData = useMemo(() => {
    const start = page * perPage;
    return sorted.slice(start, start + perPage);
  }, [sorted, page, perPage]);

  const rowVirtualizer = useVirtualizer({
    count: pageData.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 15,
  });

  useEffect(() => { setPage(0); }, [search, sortCol, sortDir, perPage]);
  useEffect(() => { parentRef.current?.scrollTo(0, 0); }, [page]);

  const handleSort = useCallback((col) => {
    if (sortCol === col) {
      setSortDir((d) => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortCol(col);
      setSortDir('asc');
    }
  }, [sortCol]);

  const handleRowClick = useCallback((row, i) => {
    if (!onCrossFilter || !effectiveCrossFilterField) return;
    const value = row[effectiveCrossFilterField];
    if (value === undefined) return;
    const globalIdx = page * perPage + i;
    const isSame = selectedRow === globalIdx;
    setSelectedRow(isSame ? null : globalIdx);
    onCrossFilter(effectiveCrossFilterField, value);
  }, [onCrossFilter, effectiveCrossFilterField, selectedRow, page, perPage]);

  const startResize = useCallback((e, col) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startWidth = colWidths[col] || DEFAULT_COL_WIDTH;
    resizingRef.current = col;

    const onMove = (me) => {
      const delta = me.clientX - startX;
      setColWidths((prev) => ({ ...prev, [col]: Math.max(MIN_COL_WIDTH, startWidth + delta) }));
    };
    const onUp = () => {
      resizingRef.current = null;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [colWidths]);

  if (!data?.length) {
    return <div className="h-full flex items-center justify-center text-ink-faint text-sm">Sin datos</div>;
  }

  const clickable = onCrossFilter && effectiveCrossFilterField;
  const relTime = meta ? formatRelativeTime(meta.lastSyncAt) : null;

  return (
    <div className="h-full flex flex-col overflow-hidden drag-cancel">
      {/* Header bar */}
      <div className="flex items-center gap-2 px-2 py-1 shrink-0 border-b border-line-soft">
        {title && <p className="text-xs font-semibold text-ink-soft truncate">{title}</p>}
        <div className="flex-1" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar…"
          className="text-[11px] font-mono bg-paper-deep border border-line rounded px-2 py-0.5 w-32 focus:w-44 transition-all focus:outline-none focus:border-lumen placeholder:text-ink-faint/40"
        />
        <span className="text-[10px] font-mono text-ink-faint shrink-0">
          {filtered.length.toLocaleString()} filas
        </span>
        {relTime && (
          <span className="text-[9px] text-ink-faint/60 shrink-0" title={meta?.lastSyncAt}>
            · {relTime}
          </span>
        )}
      </div>

      {/* Table */}
      <div ref={parentRef} className="flex-1 overflow-auto min-h-0">
        <table className="text-xs border-collapse" style={{ minWidth: cols.reduce((s, c) => s + (colWidths[c] || DEFAULT_COL_WIDTH), 0) }}>
          <thead className="sticky top-0 bg-paper z-10">
            <tr>
              {cols.map((c) => (
                <th
                  key={c}
                  className="text-left font-mono font-medium text-ink-soft border-b border-line whitespace-nowrap relative select-none group"
                  style={{ width: colWidths[c] || DEFAULT_COL_WIDTH, minWidth: MIN_COL_WIDTH }}
                >
                  <button
                    onClick={() => handleSort(c)}
                    className="w-full text-left px-3 py-2 hover:text-ink transition cursor-pointer flex items-center gap-1"
                  >
                    <span className="truncate">{c}</span>
                    {sortCol === c && (
                      <span className="text-lumen-deep text-[10px] shrink-0">
                        {sortDir === 'asc' ? '▲' : '▼'}
                      </span>
                    )}
                    {sortCol !== c && (
                      <span className="text-ink-faint/30 text-[10px] shrink-0 opacity-0 group-hover:opacity-100 transition">
                        ▲
                      </span>
                    )}
                  </button>
                  {/* Resize handle */}
                  <div
                    onMouseDown={(e) => startResize(e, c)}
                    className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-lumen/30 transition"
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody style={{ height: `${rowVirtualizer.getTotalSize()}px`, position: 'relative' }}>
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const i = virtualRow.index;
              const row = pageData[i];
              const globalIdx = page * perPage + i;
              return (
                <tr
                  key={virtualRow.key}
                  data-index={i}
                  ref={rowVirtualizer.measureElement}
                  onClick={() => handleRowClick(row, i)}
                  className={`transition-colors ${i % 2 === 0 ? '' : 'bg-paper/60'} ${
                    clickable ? 'cursor-pointer hover:bg-lumen-soft/40' : ''
                  } ${selectedRow === globalIdx ? 'bg-lumen-soft ring-1 ring-inset ring-lumen-line' : ''}`}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: `${virtualRow.size}px`,
                    transform: `translateY(${virtualRow.start}px)`,
                    display: 'table-row',
                  }}
                >
                  {cols.map((c) => (
                    <td
                      key={c}
                      className="px-3 py-1.5 text-ink-soft border-b border-line-soft whitespace-nowrap truncate font-mono"
                      style={{ width: colWidths[c] || DEFAULT_COL_WIDTH, maxWidth: colWidths[c] || DEFAULT_COL_WIDTH }}
                      title={row[c] !== null && row[c] !== undefined ? String(row[c]) : ''}
                    >
                      {row[c] !== null && row[c] !== undefined ? String(row[c]) : ''}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex items-center gap-2 px-2 py-1 border-t border-line-soft shrink-0 bg-paper">
        <button
          onClick={() => setPage(0)}
          disabled={page === 0}
          className="text-[10px] text-ink-faint hover:text-ink disabled:opacity-30 cursor-pointer disabled:cursor-default px-1"
        >
          ««
        </button>
        <button
          onClick={() => setPage((p) => Math.max(0, p - 1))}
          disabled={page === 0}
          className="text-[10px] text-ink-faint hover:text-ink disabled:opacity-30 cursor-pointer disabled:cursor-default px-1"
        >
          «
        </button>
        <span className="text-[10px] font-mono text-ink-faint">
          {page + 1} / {totalPages}
        </span>
        <button
          onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
          disabled={page >= totalPages - 1}
          className="text-[10px] text-ink-faint hover:text-ink disabled:opacity-30 cursor-pointer disabled:cursor-default px-1"
        >
          »
        </button>
        <button
          onClick={() => setPage(totalPages - 1)}
          disabled={page >= totalPages - 1}
          className="text-[10px] text-ink-faint hover:text-ink disabled:opacity-30 cursor-pointer disabled:cursor-default px-1"
        >
          »»
        </button>
        <div className="flex-1" />
        <select
          value={perPage}
          onChange={(e) => setPerPage(Number(e.target.value))}
          className="text-[10px] font-mono text-ink-faint bg-paper-deep border border-line rounded px-1 py-0.5 cursor-pointer"
        >
          {PAGE_SIZES.map((s) => (
            <option key={s} value={s}>{s} / pág</option>
          ))}
        </select>
      </div>
    </div>
  );
}
