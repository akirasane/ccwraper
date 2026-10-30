import { useAutoResumeStore, getAutoResume } from './autoresume'
import { formatCountdown } from './format'
import { useNow } from './use-now'

/** Live "1h 23m" next to a paused tab's title. Renders nothing unless the tab will resume by itself. */
export function TabCountdown({ convId }: { convId: string }): React.JSX.Element | null {
  const pause = useAutoResumeStore((s) => s.pauses[convId])
  const enabled = useAutoResumeStore((s) => s.prefs.enabled)
  const armed = !!pause && enabled && !pause.cancelled && !pause.blocked && pause.resetAt !== undefined
  const now = useNow(armed)
  if (!armed || !pause) return null
  const at = getAutoResume()?.fireAt(pause) ?? (pause.resetAt as number)
  return (
    <span data-testid="tab-countdown" className="shrink-0 font-mono text-xs tabular-nums text-warn">
      {formatCountdown(at - now)}
    </span>
  )
}
