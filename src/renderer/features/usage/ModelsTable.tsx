import { formatInt, formatUsd } from '@/components/charts'
import { formatTokens } from '@/features/chat/activity/format'
import type { UsageSummary } from '@shared/usage'
import { modelSeries } from './DailyChart'
import { COST_LABEL } from './KpiRow'
import { totalTokens } from './queries'

export function ModelsTable({ summary }: { summary: UsageSummary }): React.JSX.Element {
  const ranked = [...summary.models].sort((a, b) => totalTokens(b.tokens) - totalTokens(a.tokens))
  const max = Math.max(0, ...ranked.map((m) => totalTokens(m.tokens)))
  const colorOf = new Map(modelSeries(summary).map((s) => [s.id, s.swatch]))
  const hasCost = summary.cost.since !== undefined
  return (
    <section aria-labelledby="usage-models-h" className="rounded-lg border border-border bg-bg-1 p-4">
      <h3 id="usage-models-h" className="mb-3 text-md font-medium text-fg">
        Models
      </h3>
      {ranked.length === 0 ? (
        <p className="text-sm text-fg-3">No model usage in this range.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm tabular-nums">
            <caption className="sr-only">Tokens and est. API value by model</caption>
            <thead className="text-fg-3">
              <tr>
                <th scope="col" className="px-2 py-1 text-left font-medium">Model</th>
                <th scope="col" className="px-2 py-1 text-right font-medium">Input</th>
                <th scope="col" className="px-2 py-1 text-right font-medium">Output</th>
                <th scope="col" className="px-2 py-1 text-right font-medium">Cache</th>
                <th scope="col" className="w-40 px-2 py-1 text-left font-medium">Total</th>
                <th scope="col" className="whitespace-nowrap px-2 py-1 text-right font-medium" title="Estimated API-equivalent value of in-app sessions. Not a bill.">
                  <span aria-hidden>Est. value</span>
                  <span className="sr-only">{COST_LABEL}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {ranked.map((m) => {
                const total = totalTokens(m.tokens)
                return (
                  <tr key={m.model} className="border-t border-border">
                    <th scope="row" className="whitespace-nowrap px-2 py-1.5 text-left font-normal text-fg">
                      <span aria-hidden className={`mr-2 inline-block size-2 rounded-sm ${colorOf.get(m.model) ?? 'bg-chart-6'}`} />
                      {m.model}
                    </th>
                    <td className="px-2 py-1.5 text-right" title={formatInt(m.tokens.input)}>{formatTokens(m.tokens.input)}</td>
                    <td className="px-2 py-1.5 text-right" title={formatInt(m.tokens.output)}>{formatTokens(m.tokens.output)}</td>
                    <td className="px-2 py-1.5 text-right" title={formatInt(m.tokens.cacheRead + m.tokens.cacheCreation)}>
                      {formatTokens(m.tokens.cacheRead + m.tokens.cacheCreation)}
                    </td>
                    <td className="px-2 py-1.5">
                      <div className="flex items-center gap-2">
                        <span aria-hidden className="h-1.5 w-20 overflow-hidden rounded-full bg-bg-3">
                          <span
                            data-testid="model-bar"
                            className={`block h-full w-full origin-left rounded-full ${colorOf.get(m.model) ?? 'bg-chart-6'} transition-transform duration-slow ease-out motion-reduce:transition-none`}
                            style={{ transform: `scaleX(${max > 0 ? total / max : 0})` }}
                          />
                        </span>
                        <span title={formatInt(total)}>{formatTokens(total)}</span>
                      </div>
                    </td>
                    <td className="px-2 py-1.5 text-right text-fg-2">{hasCost ? formatUsd(m.costUsd) : '-'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
