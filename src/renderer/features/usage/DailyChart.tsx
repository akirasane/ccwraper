import { useMemo, useState } from 'react'
import { ChartTable, formatInt, StackedBars, type BarDatum, type Series } from '@/components/charts'
import { formatTokens } from '@/features/chat/activity/format'
import type { UsageSummary } from '@shared/usage'
import { totalTokens } from './queries'

const CHART_CLASSES = [
  { fill: 'fill-chart-1', swatch: 'bg-chart-1' },
  { fill: 'fill-chart-2', swatch: 'bg-chart-2' },
  { fill: 'fill-chart-3', swatch: 'bg-chart-3' },
  { fill: 'fill-chart-4', swatch: 'bg-chart-4' },
  { fill: 'fill-chart-5', swatch: 'bg-chart-5' }
] as const
export const OTHER_CLASS = { fill: 'fill-chart-6', swatch: 'bg-chart-6' } as const

/** Fixed mapping from the design README: output 1, input 2, cache read 3, cache write 5. */
export const KIND_SERIES: Series[] = [
  { id: 'output', label: 'Output', ...CHART_CLASSES[0] },
  { id: 'input', label: 'Input', ...CHART_CLASSES[1] },
  { id: 'cacheRead', label: 'Cache read', ...CHART_CLASSES[2] },
  { id: 'cacheCreation', label: 'Cache write', ...CHART_CLASSES[4] }
]

/** Top 5 models by tokens take chart-1..5; the rest are "Other" (chart-6). */
export function modelSeries(summary: UsageSummary): Series[] {
  const ranked = [...summary.models].sort((a, b) => totalTokens(b.tokens) - totalTokens(a.tokens))
  const top = ranked.slice(0, 5).map((m, i): Series => ({ id: m.model, label: m.model, ...CHART_CLASSES[i]! }))
  return ranked.length > 5 ? [...top, { id: '__other', label: 'Other', ...OTHER_CLASS }] : top
}

function shortDate(iso: string): string {
  return iso.slice(5)
}

export function DailyChart({ summary }: { summary: UsageSummary }): React.JSX.Element {
  const [by, setBy] = useState<'kind' | 'model'>('kind')
  const [table, setTable] = useState(false)

  const series = useMemo(() => (by === 'kind' ? KIND_SERIES : modelSeries(summary)), [by, summary])
  const data: BarDatum[] = useMemo(() => {
    const named = new Set(series.map((s) => s.id))
    return summary.days.map((d) => {
      const values: Record<string, number> = {}
      if (by === 'kind') {
        Object.assign(values, {
          output: d.tokens.output,
          input: d.tokens.input,
          cacheRead: d.tokens.cacheRead,
          cacheCreation: d.tokens.cacheCreation
        })
      } else {
        for (const [m, v] of Object.entries(d.byModel)) {
          const id = named.has(m) ? m : '__other'
          values[id] = (values[id] ?? 0) + v
        }
      }
      return { key: d.date, label: shortDate(d.date), values }
    })
  }, [by, series, summary])

  const total = summary.days.reduce((s, d) => s + totalTokens(d.tokens), 0)
  const aria = `Daily tokens, ${summary.from} to ${summary.to}, ${formatTokens(total)} in total, stacked by ${by === 'kind' ? 'token kind' : 'model'}`

  return (
    <section aria-labelledby="usage-daily-h" className="rounded-lg border border-border bg-bg-1 p-4">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h3 id="usage-daily-h" className="text-md font-medium text-fg">
          Tokens per day
        </h3>
        <div role="radiogroup" aria-label="Stack by" className="ml-auto flex gap-1">
          <Seg checked={by === 'kind'} onClick={() => setBy('kind')}>
            By kind
          </Seg>
          <Seg checked={by === 'model'} onClick={() => setBy('model')}>
            By model
          </Seg>
        </div>
        <button
          type="button"
          aria-pressed={table}
          onClick={() => setTable((v) => !v)}
          className="rounded-md border border-border-strong px-2 py-0.5 text-sm text-fg-2 hover:bg-bg-3 aria-pressed:bg-bg-3 aria-pressed:text-fg"
        >
          Table
        </button>
      </div>
      <ul className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-fg-2" aria-label="Legend">
        {series.map((s) => (
          <li key={s.id} className="flex items-center gap-1.5">
            <span aria-hidden className={`size-2 rounded-sm ${s.swatch}`} />
            {s.label}
          </li>
        ))}
      </ul>
      {table ? (
        <ChartTable
          caption="Tokens per day"
          columns={['Date', ...series.map((s) => s.label), 'Total']}
          rows={data.map((d) => ({
            key: d.key,
            cells: [
              d.key,
              ...series.map((s) => formatInt(d.values[s.id] ?? 0)),
              formatInt(series.reduce((a, s) => a + (d.values[s.id] ?? 0), 0))
            ]
          }))}
        />
      ) : (
        <StackedBars
          key={by}
          data={data}
          series={series}
          ariaLabel={aria}
          formatValue={formatInt}
          formatTick={formatTokens}
        />
      )}
    </section>
  )
}

function Seg({
  checked,
  onClick,
  children
}: {
  checked: boolean
  onClick: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      onClick={onClick}
      className="rounded-md border border-border-strong px-2 py-0.5 text-sm text-fg-2 hover:bg-bg-3 aria-checked:bg-bg-3 aria-checked:text-fg"
    >
      {children}
    </button>
  )
}
