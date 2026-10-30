export interface HBarItem {
  key: string
  label: string
  title?: string
  value: number
  display: string
  /** background class from a chart token */
  bar: string
}

/** Horizontal bar list; the bar grows with transform: scaleX (no transition under reduced motion). */
export function HBars({ items, ariaLabel }: { items: HBarItem[]; ariaLabel: string }): React.JSX.Element {
  const max = Math.max(0, ...items.map((i) => i.value))
  return (
    <ul aria-label={ariaLabel} className="flex flex-col gap-1.5">
      {items.map((it) => (
        <li key={it.key} className="grid grid-cols-[minmax(0,10rem)_1fr_auto] items-center gap-3 text-sm">
          <span className="truncate text-fg-2" title={it.title ?? it.label}>
            {it.label}
          </span>
          <span aria-hidden className="h-2 overflow-hidden rounded-full bg-bg-3">
            <span
              data-testid="hbar"
              data-scale-x={max > 0 ? (it.value / max).toFixed(4) : '0'}
              className={`block h-full w-full origin-left rounded-full ${it.bar} transition-transform duration-slow ease-out motion-reduce:transition-none`}
              style={{ transform: `scaleX(${max > 0 ? it.value / max : 0})` }}
            />
          </span>
          <span className="tabular-nums text-fg-3">{it.display}</span>
        </li>
      ))}
    </ul>
  )
}
