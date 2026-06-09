export default function TableWidget({ config, data }) {
  const { title, columns } = config;

  const cols = columns?.length
    ? columns
    : data?.[0] ? Object.keys(data[0]).slice(0, 8) : [];

  if (!data?.length) {
    return <div className="h-full flex items-center justify-center text-slate-400 text-sm">Sin datos</div>;
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {title && <p className="text-xs font-semibold text-slate-600 mb-1 px-1 flex-shrink-0">{title}</p>}
      <div className="flex-1 overflow-auto min-h-0">
        <table className="w-full text-xs border-collapse">
          <thead className="sticky top-0 bg-slate-50">
            <tr>
              {cols.map((c) => (
                <th key={c} className="text-left px-3 py-2 font-semibold text-slate-600 border-b border-slate-200 whitespace-nowrap">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((row, i) => (
              <tr key={i} className={i % 2 === 0 ? '' : 'bg-slate-50'}>
                {cols.map((c) => (
                  <td key={c} className="px-3 py-1.5 text-slate-700 border-b border-slate-100 whitespace-nowrap max-w-[200px] truncate">
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
