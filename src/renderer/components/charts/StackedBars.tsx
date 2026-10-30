import { useEffect, useState } from 'react'
import { ChartTooltip, type TooltipRow } from './ChartTooltip'
import { bandScale, niceTicks, scaleY } from './scale'

export interface Series {
  id: string
  label: string
  /** fill class from a chart token, e.g. "fill-chart-1" */
  fill: string
  /** matching background class for swatches, e.g. "bg-chart-1" */
  swatch: string
}

export interface BarDatum {
  key: string
  label: string
  /** value per series id */
  values: Record<string, number>
}

const W = 720
const H = 200
const PAD = { l: 44, r: 8, t: 8, b: 22 }

/** Stacked vertical bars. Bars grow via transform: scaleY (no transition under reduced motion). */
export function StackedBars({
  data,
  series,
  ariaLabel,
  formatValue,
  formatTick
}: {
  data: BarDatum[]
  series: Series[]
  ariaLabel: string
  formatValue: (n: number) => string
  formatTick: (n: number) => string
}): React.JSX.Element {
  const [active, setActive] = useState<number | null>(null)
  const [grown, setGrown] = useState(false)
  useEffect(() => {
    const id = requestAnimationFrame(() => setGrown(true))
    return () => cancelAnimationFrame(id)
  }, [])

  const totals = data.map((d) => series.reduce((s, x) => s + (d.values[x.id] ?? 0), 0))
  const { ticks, max } = niceTicks(Math.max(0, ...totals))
  const innerW = W - PAD.l - PAD.r
  const innerH = H - PAD.t - PAD.b
  const bands = bandScale(data.length, innerW, 0.25)
  const every = Math.max(1, Math.ceil(data.length / 8))
  const activeDatum = active !== null ? data[active] : undefined

  return (
    <div className="relative" onMouseLeave={() => setActive(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} role="group" aria-label={ariaLabel} className="block w-full">
        {ticks.map((t) => {
          const y = PAD.t + innerH - scaleY(t, max, innerH)
          return (
            <g key={t}>
              <line x1={PAD.l} x2={W - PAD.r} y1={y} y2={y} className="stroke-chart-grid" strokeWidth={1} />
              <text x={PAD.l - 6} y={y + 3} textAnchor="end" className="fill-chart-axis" fontSize={10}>
                {formatTick(t)}
              </text>
            </g>
          )
        })}
        {data.map((d, i) => {
          let acc = 0
          const x = PAD.l + bands.x(i)
          return (
            <g
              key={d.key}
              data-testid="bar-group"
              tabIndex={0}
              role="img"
              aria-label={`${d.label}: ${formatValue(totals[i] ?? 0)} tokens. ${series
                .map((s) => `${s.label} ${formatValue(d.values[s.id] ?? 0)}`)
                .join(', ')}`}
              className="outline-none [&:focus-visible_.hit]:stroke-fg"
              onMouseEnter={() => setActive(i)}
              onFocus={() => setActive(i)}
              onBlur={() => setActive((a) => (a === i ? null : a))}
            >
              <rect
                className="hit fill-transparent stroke-transparent"
                strokeWidth={1.5}
                x={x - 1}
                y={PAD.t}
                width={bands.bandwidth + 2}
                height={innerH}
              />
              {series.map((s) => {
                const v = d.values[s.id] ?? 0
                const h = scaleY(v, max, innerH)
                if (h <= 0) return null
                acc += h
                return (
                  <rect
                    key={s.id}
                    data-testid="bar-segment"
                    data-series={s.id}
                    data-value={v}
                    data-scale-y={(v / max).toFixed(4)}
                    className={`${s.fill} transition-transform duration-slow ease-out motion-reduce:transition-none`}
                    style={{
                      transformBox: 'fill-box',
                      transformOrigin: 'bottom',
                      transform: `scaleY(${grown ? 1 : 0})`
                    }}
                    x={x}
                    y={PAD.t + innerH - acc}
                    width={bands.bandwidth}
                    height={h}
                  />
                )
              })}
              {i % every === 0 ? (
                <text x={PAD.l + bands.center(i)} y={H - 6} textAnchor="middle" className="fill-chart-axis" fontSize={10}>
                  {d.label}
                </text>
              ) : null}
            </g>
          )
        })}
      </svg>
      {activeDatum && active !== null ? (
        <ChartTooltip
          leftPct={((PAD.l + bands.center(active)) / W) * 100}
          title={`${activeDatum.label} - ${formatValue(totals[active] ?? 0)} tokens`}
          rows={series.map(
            (s): TooltipRow => ({ label: s.label, value: formatValue(activeDatum.values[s.id] ?? 0), swatch: s.swatch })
          )}
        />
      ) : null}
    </div>
  )
}
