/** The accessible fallback for every chart: the same numbers as a plain table. */
export function ChartTable({
  caption,
  columns,
  rows
}: {
  caption: string
  columns: string[]
  rows: Array<{ key: string; cells: string[] }>
}): React.JSX.Element {
  return (
    <div className="max-h-64 overflow-auto" tabIndex={0} role="region" aria-label={caption}>
      <table className="w-full text-sm tabular-nums">
        <caption className="sr-only">{caption}</caption>
        <thead className="sticky top-0 bg-bg-1 text-fg-3">
          <tr>
            {columns.map((c, i) => (
              <th key={c} scope="col" className={`px-2 py-1 font-medium ${i === 0 ? 'text-left' : 'text-right'}`}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-t border-border">
              {r.cells.map((c, i) =>
                i === 0 ? (
                  <th key={i} scope="row" className="px-2 py-1 text-left font-normal">
                    {c}
                  </th>
                ) : (
                  <td key={i} className="px-2 py-1 text-right">
                    {c}
                  </td>
                )
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
