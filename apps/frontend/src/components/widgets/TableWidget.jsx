import { useState } from 'react';

export default function TableWidget({ config, data, onCrossFilter }) {
  const { title, columns, crossFilterField } = config;
  const [selectedRow, setSelectedRow] = useState(null);

  const cols = columns?.length
    ? columns
    : data?.[0] ? Object.keys(data[0]).slice(0, 8) : [];

  // Auto-default: first non-numeric column so tables cross-filter without manual config
  const effectiveCrossFilterField = crossFilterField ||
    (data?.[0] ? cols.find((c) => isNaN(Number(data[0][c])) && data[0][c] !== null) ?? cols[0] : null);

  if (!data?.length) {
    return <div className="h-full flex items-center justify-center text-ink-faint text-sm">Sin datos</div>;
  }

  const handleRowClick = (row, i) => {
    if (!onCrossFilter || !effectiveCrossFilterField) return;
    const value = row[effectiveCrossFilterField];
    if (value === undefined) return;
    const isSame = selectedRow === i;
    setSelectedRow(isSame ? null : i);
    onCrossFilter(effectiveCrossFilterField, value);
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {title && <p className="text-xs font-semibold text-ink-soft mb-1 px-1 shrink-0">{title}</p>}
      <div className="flex-1 overflow-auto min-h-0">
        <table className="w-full text-xs border-collapse">
          <thead className="sticky top-0 bg-paper">
            <tr>
              {cols.map((c) => (
                <th key={c} className="text-left px-3 py-2 font-mono font-medium text-ink-soft border-b border-line whitespace-nowrap">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((row, i) => (
              <tr key={i}
                onClick={() => handleRowClick(row, i)}
                className={`transition ${i % 2 === 0 ? '' : 'bg-paper/60'} ${
                  onCrossFilter && effectiveCrossFilterField ? 'cursor-pointer hover:bg-lumen-soft/40' : ''
                } ${selectedRow === i ? 'bg-lumen-soft ring-1 ring-inset ring-lumen-line' : ''}`}
              >
                {cols.map((c) => (
                  <td key={c} className="px-3 py-1.5 text-ink-soft border-b border-line-soft whitespace-nowrap max-w-[200px] truncate font-mono">
                    {row[c] !== null && row[c] !== undefined ? String(row[c]) : ''}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
