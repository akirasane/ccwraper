export interface TooltipRow {
  label: string
  value: string
  /** tailwind bg class from a chart token, e.g. "bg-chart-1" */
  swatch?: string
}

/** Positioned by percentage inside a `relative` chart wrapper. Decorative: the data is also in the bar's aria-label. */
export function ChartTooltip({
  leftPct,
  title,
  rows
}: {
  leftPct: number
  title: string
  rows: TooltipRow[]
}): React.JSX.Element {
  return (
    <div
      role="tooltip"
      data-testid="chart-tooltip"
      style={{ left: `${Math.min(88, Math.max(12, leftPct))}%` }}
      className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 rounded-md border border-border-strong bg-bg-3 px-2.5 py-1.5 text-sm text-fg shadow-md"
    >
      <div className="mb-1 font-medium">{title}</div>
      {rows.map((r) => (
        <div key={r.label} className="flex items-center gap-2 tabular-nums">
          {r.swatch ? <span aria-hidden className={`size-2 rounded-sm ${r.swatch}`} /> : null}
          <span className="text-fg-3">{r.label}</span>
          <span className="ml-auto pl-3">{r.value}</span>
        </div>
      ))}
    </div>
  )
}
