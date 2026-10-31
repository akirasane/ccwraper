import { useQuery } from '@tanstack/react-query'
import type { AppPrefs } from '@shared/app'
import { DEFAULT_PREFS } from '@shared/app'
import type { LimitEntry, LimitKind, LimitView } from '@shared/limits'
import { formatClock, formatCountdown, viewLimit } from '@shared/limits'
import { Tooltip } from '@/components/ui'
import { cn } from '@/lib/cn'
import { useNow } from '@/lib/use-now'
import { useCavemanState, useLimitsState } from './use-limits-state'

/** Prefs are shared with the Preferences page through the same query key; a missing bridge means the defaults. */
function useShellPrefs(): Pick<AppPrefs, 'showLimitsBar' | 'showCavemanBadge'> {
  const q = useQuery<AppPrefs>({
    queryKey: ['prefs'],
    queryFn: () => window.ccwrap.prefs.get(),
    retry: false,
    staleTime: Infinity
  })
  return {
    showLimitsBar: q.data?.showLimitsBar ?? DEFAULT_PREFS.showLimitsBar,
    showCavemanBadge: q.data?.showCavemanBadge ?? DEFAULT_PREFS.showCavemanBadge
  }
}

const LABEL: Record<LimitKind, string> = {
  five_hour: '5-hour',
  seven_day: '7-day',
  seven_day_opus: '7-day Opus',
  seven_day_sonnet: '7-day Sonnet'
}
const SHORT: Partial<Record<LimitKind, string>> = { five_hour: '5h', seven_day: '7d' }

const FILL = { ok: 'bg-ok', warn: 'bg-warn', danger: 'bg-danger' } as const
const TEXT = { ok: 'text-fg-2', warn: 'text-warn', danger: 'text-danger' } as const

function describe(v: LimitView, now: number): string {
  const pct = v.percent === undefined ? 'usage unknown' : `${v.percent}% used`
  let reset = ''
  if (v.expired) reset = ' · window reset'
  else if (v.resetsAt !== undefined) reset = ` · resets in ${formatCountdown(v.resetsAt - now)} (${formatClock(v.resetsAt)})`
  const stale = v.stale ? ` · last seen ${formatClock(v.seenAt)}` : ''
  const warn = !v.expired && v.status === 'rejected' ? ' · limit reached' : !v.expired && v.status === 'allowed_warning' ? ' · approaching limit' : ''
  return `${LABEL[v.type]}: ${pct}${reset}${warn}${stale}`
}

function LimitItem({ kind, view, now }: { kind: 'five_hour' | 'seven_day'; view: LimitView | undefined; now: number }): React.JSX.Element {
  const short = SHORT[kind]!
  if (!view) {
    return (
      <span data-testid={`limit-${kind}`} data-empty="" className="inline-flex items-center gap-1 text-fg-muted" aria-label={`${LABEL[kind]} limit: no data yet`}>
        {short} --
      </span>
    )
  }
  const pct = view.percent
  const countdown = view.expired ? 'reset' : view.resetsAt !== undefined ? formatCountdown(view.resetsAt - now) : undefined
  return (
    <span
      data-testid={`limit-${kind}`}
      data-level={view.level}
      data-stale={view.stale || undefined}
      data-expired={view.expired || undefined}
      className={cn('inline-flex items-center gap-1 tabular-nums', view.stale && 'italic opacity-75')}
    >
      <span className="text-fg-3">{short}</span>
      <span
        role="meter"
        aria-label={`${LABEL[kind]} limit used`}
        aria-valuemin={0}
        aria-valuemax={100}
        {...(pct !== undefined ? { 'aria-valuenow': pct } : {})}
        aria-valuetext={describe(view, now)}
        data-testid={`limit-${kind}-bar`}
        className="relative h-1 w-9 shrink-0 overflow-hidden rounded-full bg-bg-3"
      >
        <span
          data-testid={`limit-${kind}-fill`}
          className={cn('absolute inset-y-0 left-0 rounded-full', FILL[view.level])}
          style={{ width: `${pct ?? 0}%` }}
        />
      </span>
      <span data-testid={`limit-${kind}-pct`} className={TEXT[view.level]}>
        {pct === undefined ? '--' : `${pct}%`}
      </span>
      {countdown && (
        <span data-testid={`limit-${kind}-reset`} className="text-fg-3">
          {countdown}
        </span>
      )}
    </span>
  )
}

const NO_DATA_TIP = 'Updates after the first message of a session'

/** Always-visible 5-hour / 7-day subscription usage, from the SDK rate_limit_event (aggregated in main). */
export function LimitsCluster(): React.JSX.Element | null {
  const { showLimitsBar } = useShellPrefs()
  const state = useLimitsState()
  const now = useNow(showLimitsBar)
  if (!showLimitsBar) return null
  const by = new Map<LimitKind, LimitEntry>(state.limits.map((e) => [e.type, e]))
  const views = state.limits.map((e) => viewLimit(e, now))
  const view = (k: LimitKind): LimitView | undefined => {
    const e = by.get(k)
    return e ? viewLimit(e, now) : undefined
  }
  const hasData = !!by.get('five_hour') || !!by.get('seven_day')
  const tip = hasData ? (
    <div className="space-y-0.5 tabular-nums" data-testid="limits-tip">
      <div className="font-medium">Subscription usage limits</div>
      {views.map((v) => (
        <div key={v.type}>{describe(v, now)}</div>
      ))}
    </div>
  ) : (
    <span data-testid="limits-tip">{NO_DATA_TIP}</span>
  )
  return (
    <Tooltip content={tip}>
      <span
        data-testid="status-limits"
        data-empty={!hasData || undefined}
        tabIndex={0}
        aria-label={hasData ? views.map((v) => describe(v, now)).join('; ') : `Usage limits: ${NO_DATA_TIP}`}
        className="inline-flex shrink-0 items-center gap-2 whitespace-nowrap"
      >
        <LimitItem kind="five_hour" view={view('five_hour')} now={now} />
        <LimitItem kind="seven_day" view={view('seven_day')} now={now} />
      </span>
    </Tooltip>
  )
}

/** "CAVEMAN" / "CAVEMAN:ULTRA" plus the plugin's savings text; hidden when the plugin is off or absent. */
export function CavemanBadge(): React.JSX.Element | null {
  const { showCavemanBadge } = useShellPrefs()
  const st = useCavemanState()
  if (!showCavemanBadge || !st.mode) return null
  const label = st.mode === 'full' ? 'CAVEMAN' : `CAVEMAN:${st.mode.toUpperCase()}`
  return (
    <Tooltip
      content={
        <span data-testid="caveman-tip">
          Caveman token-saving mode ({st.mode}). Read from the caveman plugin&apos;s status files in your Claude config folder; ccwraper
          never writes them.
        </span>
      }
    >
      <span
        data-testid="status-caveman"
        data-mode={st.mode}
        tabIndex={0}
        className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xs bg-accent-tint px-1.5 text-accent-text"
      >
        <span className="font-medium">{label}</span>
        {st.suffix && <span data-testid="status-caveman-suffix">{st.suffix}</span>}
      </span>
    </Tooltip>
  )
}
