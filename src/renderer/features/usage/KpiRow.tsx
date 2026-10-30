import type { UsageSummary } from '@shared/usage'
import { formatUsd } from '@/components/charts'
import { formatTokens } from '@/features/chat/activity/format'
import { totalTokens } from './queries'

export const COST_LABEL = 'Est. API value (not billed)'

function Kpi({
  label,
  value,
  sub,
  testId
}: {
  label: string
  value: string
  sub?: string
  testId: string
}): React.JSX.Element {
  return (
    <div data-testid={testId} className="rounded-lg border border-border bg-bg-1 px-3.5 py-3">
      <div className="text-sm text-fg-3">{label}</div>
      <div className="mt-1 text-xl font-medium tabular-nums text-fg">{value}</div>
      {sub ? <div className="mt-0.5 text-sm tabular-nums text-fg-3">{sub}</div> : null}
    </div>
  )
}

export function KpiRow({ summary }: { summary: UsageSummary }): React.JSX.Element {
  const { totals, cost, days } = summary
  const t = totals.tokens
  const activeDays = days.filter((d) => totalTokens(d.tokens) > 0).length
  const cache = t.cacheRead + t.cacheCreation
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="kpi-row">
      <Kpi
        testId="kpi-tokens"
        label="Tokens"
        value={formatTokens(totalTokens(t))}
        sub={`in ${formatTokens(t.input)} / out ${formatTokens(t.output)} / cache ${formatTokens(cache)}`}
      />
      <Kpi
        testId="kpi-messages"
        label="Turns (assistant messages)"
        value={totals.messages.toLocaleString('en-US')}
        sub={`${activeDays} active ${activeDays === 1 ? 'day' : 'days'}`}
      />
      <Kpi testId="kpi-sessions" label="Sessions" value={totals.sessions.toLocaleString('en-US')} />
      {cost.since ? (
        <Kpi
          testId="kpi-cost"
          label={COST_LABEL}
          value={formatUsd(totals.costUsd)}
          sub={`ccwraper sessions only, since ${cost.since}`}
        />
      ) : (
        <Kpi testId="kpi-cost" label={COST_LABEL} value="No in-app sessions yet" />
      )}
    </div>
  )
}
