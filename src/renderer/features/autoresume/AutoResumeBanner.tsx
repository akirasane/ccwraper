import { Button } from '@/components/ui'
import { useChatStore } from '@/stores/chat-store'
import { getAutoResume, useAutoResumeStore } from './autoresume'
import { formatClock, formatCountdown } from './format'
import { useNow } from './use-now'

/**
 * Shown above the composer while the last turn was stopped by a usage limit. Armed: "Paused until 4:10 PM" with a
 * live countdown plus Cancel and Resume now. Otherwise (auto-resume off, cancelled, unknown reset time, loop guard):
 * the limit state with a manual Resume now.
 */
export function AutoResumeBanner({ convId }: { convId: string }): React.JSX.Element | null {
  const limit = useChatStore((s) => s.convs[convId]?.limit)
  const busy = useChatStore((s) => s.convs[convId]?.status === 'running')
  const pause = useAutoResumeStore((s) => s.pauses[convId])
  const enabled = useAutoResumeStore((s) => s.prefs.enabled)
  const armed = !!pause && enabled && !pause.cancelled && !pause.blocked && pause.resetAt !== undefined
  const now = useNow(!!limit && limit.resetsAt !== undefined)
  if (!limit || busy) return null

  const reset = limit.resetsAt
  const controller = getAutoResume()
  const fireAt = pause && controller ? controller.fireAt(pause) : undefined
  let headline: string
  let detail: string | undefined
  if (armed && fireAt !== undefined && reset !== undefined) {
    headline = `Paused until ${formatClock(reset, now)}`
    detail = `Resumes automatically in ${formatCountdown(fireAt - now)}. Keep ccwraper open.`
  } else {
    headline = reset !== undefined ? `Usage limit reached. Resets ${formatClock(reset, now)}` : 'Usage limit reached'
    if (pause?.blocked === 'loop') detail = 'Auto-resume stopped: 3 resumes this hour already.'
    else if (pause?.blocked === 'stale') detail = 'The reset passed long ago, so auto-resume skipped it.'
    else if (pause?.cancelled) detail = 'Auto-resume cancelled.'
    else if (reset === undefined) detail = 'The reset time is unknown, so it will not resume by itself.'
    else if (!enabled) detail = 'Auto-resume is off (Preferences).'
  }

  return (
    <div
      role="status"
      data-testid="autoresume-banner"
      data-armed={armed || undefined}
      className="mx-auto w-full max-w-[calc(var(--chat-max-w)+48px)] shrink-0 px-6 pb-2"
    >
      <div className="flex items-center gap-3 rounded-md border border-warn-border bg-warn-bg px-3 py-2 text-sm text-warn">
        <div className="min-w-0 flex-1">
          <div className="font-medium">{headline}</div>
          {detail && <div className="text-fg-2">{detail}</div>}
        </div>
        {armed && (
          <Button size="sm" variant="ghost" onClick={() => controller?.cancel(convId)}>
            Cancel
          </Button>
        )}
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            const c = getAutoResume()
            if (c) void c.resumeNow(convId)
          }}
        >
          Resume now
        </Button>
      </div>
    </div>
  )
}
