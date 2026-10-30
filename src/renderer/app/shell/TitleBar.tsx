import { Square } from 'lucide-react'
import { Button } from '@/components/ui'
import { selectIsRunning } from '@/features/chat/model/selectors'
import { PaletteTrigger } from '@/features/palette/PaletteTrigger'
import { TabStrip } from '@/features/tabs/TabStrip'
import { useChatStore } from '@/stores/chat-store'
import { useWorkspaceStore } from '@/stores/workspace-store'

const drag = { WebkitAppRegion: 'drag' } as React.CSSProperties
const noDrag = { WebkitAppRegion: 'no-drag' } as React.CSSProperties

/**
 * 40px title bar. The native titleBarOverlay draws the window controls over the right edge, so the
 * right padding follows `env(titlebar-area-width)`. Left to right: label, tab strip (+), drag gap, palette, Interrupt.
 */
export function TitleBar(): React.JSX.Element {
  const convId = useWorkspaceStore((s) => s.activeConvId)
  const conv = useChatStore((s) => (convId ? s.convs[convId] : undefined))
  const interrupt = useChatStore((s) => s.interrupt)
  const running = conv ? selectIsRunning(conv) : false

  return (
    <header
      data-testid="title-bar"
      style={{ ...drag, paddingRight: 'calc(100vw - env(titlebar-area-width, 100vw))' }}
      className="flex h-10 shrink-0 items-center gap-3 border-b border-border bg-bg-0 pl-3"
    >
      <span className="shrink-0 text-sm font-semibold tracking-tight text-fg-2">ccwrap</span>
      <TabStrip />
      <div data-testid="title-drag-gap" aria-hidden className="h-full min-w-4 flex-1" style={drag} />
      <div className="flex shrink-0 items-center gap-2" style={noDrag}>
        <PaletteTrigger />
        {running && convId && (
          <Button variant="danger" size="sm" onClick={() => void interrupt(convId)} aria-label="Interrupt">
            <Square size={12} aria-hidden /> Interrupt
          </Button>
        )}
      </div>
    </header>
  )
}
