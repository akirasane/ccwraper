import { Square } from 'lucide-react'
import { Button } from '@/components/ui'
import { selectIsRunning } from '@/features/chat/model/selectors'
import { useSessions } from '@/features/sessions/queries'
import { useChatStore } from '@/stores/chat-store'
import { useWorkspaceStore } from '@/stores/workspace-store'

const drag = { WebkitAppRegion: 'drag' } as React.CSSProperties
const noDrag = { WebkitAppRegion: 'no-drag' } as React.CSSProperties

/** 40px title bar. The native titleBarOverlay draws the window controls over the right edge. */
export function TitleBar(): React.JSX.Element {
  const convId = useWorkspaceStore((s) => s.activeConvId)
  const title = useWorkspaceStore((s) => s.activeTitle)
  const conv = useChatStore((s) => (convId ? s.convs[convId] : undefined))
  const interrupt = useChatStore((s) => s.interrupt)
  const running = conv ? selectIsRunning(conv) : false
  // A live session started in this app gets its title from the history list once the SDK has written it.
  const { data: sessions } = useSessions(conv?.cwd)
  const sessionId = conv?.meta.sessionId ?? conv?.resumeSessionId
  const listed = sessionId ? sessions?.find((x) => x.sessionId === sessionId)?.title : undefined

  return (
    <header
      data-testid="title-bar"
      style={{ ...drag, paddingRight: 'calc(100vw - env(titlebar-area-width, 100vw))' }}
      className="flex h-10 shrink-0 items-center gap-3 border-b border-border bg-bg-0 pl-3"
    >
      <span className="text-sm font-semibold tracking-tight text-fg-2">ccwrap</span>
      {convId && (
        <div className="relative flex h-full max-w-[320px] items-center px-3 text-base text-fg" style={noDrag}>
          <span className="truncate" data-testid="tab-title">
            {title ?? listed ?? 'New session'}
          </span>
          <span
            aria-hidden
            className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-linear-to-r from-accent-from to-accent-to"
          />
        </div>
      )}
      <div className="ml-auto flex items-center gap-2" style={noDrag}>
        {running && convId && (
          <Button variant="danger" size="sm" onClick={() => void interrupt(convId)} aria-label="Interrupt">
            <Square size={12} aria-hidden /> Interrupt
          </Button>
        )}
      </div>
    </header>
  )
}
