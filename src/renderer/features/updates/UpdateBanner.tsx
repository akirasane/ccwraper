import { Download, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui'
import { selectIsRunning } from '@/features/chat/model/selectors'
import { useChatStore } from '@/stores/chat-store'
import { useUpdateState } from './use-update-state'

const DISMISS_KEY = 'ccwrap.update.dismissed'

function readDismissed(): string | null {
  try {
    return localStorage.getItem(DISMISS_KEY)
  } catch {
    return null
  }
}

/** Non-modal strip under the title bar: download progress, then a Restart button. Dismissible per version. */
export function UpdateBanner(): React.JSX.Element | null {
  const state = useUpdateState()
  const [dismissed, setDismissed] = useState<string | null>(readDismissed)
  const busy = useChatStore((s) => Object.values(s.convs).some((c) => selectIsRunning(c)))
  const [installing, setInstalling] = useState(false)

  useEffect(() => {
    if (state.kind !== 'ready') setInstalling(false)
  }, [state.kind])

  if (state.kind !== 'available' && state.kind !== 'downloading' && state.kind !== 'ready') return null
  if (dismissed === state.version) return null

  const dismiss = (): void => {
    setDismissed(state.version)
    try {
      localStorage.setItem(DISMISS_KEY, state.version)
    } catch {
      /* per-viewer convenience only */
    }
  }
  const install = (): void => {
    setInstalling(true)
    void window.ccwrap.update.install().catch(() => setInstalling(false))
  }

  const text =
    state.kind === 'ready'
      ? `Update v${state.version} is ready`
      : state.kind === 'downloading'
        ? `Update v${state.version} downloading ${state.percent}%`
        : `Update v${state.version} found`

  return (
    <div
      role="status"
      data-testid="update-banner"
      className="flex h-8 shrink-0 items-center gap-3 border-b border-info-border bg-info-bg px-3 text-sm text-fg-2"
    >
      <Download size={13} className="shrink-0 text-info" aria-hidden />
      <span data-testid="update-banner-text" className="min-w-0 truncate">
        {text}
        {state.kind === 'ready' && busy && ' (sessions are running; you will be asked before they stop)'}
      </span>
      {state.kind === 'ready' && (
        <Button size="sm" variant="primary" disabled={installing} onClick={install} data-testid="update-banner-install">
          Restart to update
        </Button>
      )}
      <Button
        size="icon-sm"
        variant="ghost"
        className="ml-auto"
        aria-label="Dismiss update notice"
        data-testid="update-banner-dismiss"
        onClick={dismiss}
      >
        <X size={13} aria-hidden />
      </Button>
    </div>
  )
}
