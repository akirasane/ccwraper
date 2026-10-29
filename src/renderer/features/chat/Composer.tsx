import { ArrowUp, Cpu, ShieldCheck, Square } from 'lucide-react'
import * as React from 'react'
import type { PermissionMode } from '@shared/ipc'
import { Button, Chip, Kbd } from '@/components/ui'
import { useChatStore } from '@/stores/chat-store'
import { selectIsRunning } from './model/selectors'

const CYCLE: PermissionMode[] = ['default', 'acceptEdits', 'plan']
const MODE_LABEL: Partial<Record<PermissionMode, string>> = {
  default: 'Default',
  acceptEdits: 'Accept edits',
  plan: 'Plan',
  bypassPermissions: 'Bypass',
  dontAsk: "Don't ask",
  auto: 'Auto'
}

export interface ComposerProps {
  convId: string
  /** Disables input (e.g. the project folder no longer exists). */
  disabled?: boolean
  disabledReason?: string
}

export function Composer({ convId, disabled = false, disabledReason }: ComposerProps): React.JSX.Element {
  const running = useChatStore((s) => {
    const c = s.convs[convId]
    return c ? selectIsRunning(c) : false
  })
  const hasPending = useChatStore((s) => (s.convs[convId]?.pending.length ?? 0) > 0)
  const model = useChatStore((s) => s.convs[convId]?.meta.model)
  const mode = useChatStore((s) => s.convs[convId]?.meta.permissionMode ?? s.modes[convId] ?? 'default') as PermissionMode
  const [text, setText] = React.useState('')
  const ref = React.useRef<HTMLTextAreaElement>(null)

  // Auto-grow up to ~10 lines.
  React.useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`
  }, [text])

  // Global Esc interrupts while running. The permission dialog owns Esc (deny) while a request is pending.
  React.useEffect(() => {
    if (!running || hasPending) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      e.preventDefault()
      void useChatStore.getState().interrupt(convId)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [running, hasPending, convId])

  const canSend = !disabled && !running && text.trim().length > 0
  const send = (): void => {
    if (!canSend) return
    const value = text.trim()
    setText('')
    void useChatStore.getState().submit(convId, value)
  }
  const stop = (): void => {
    void useChatStore.getState().interrupt(convId)
  }
  const cycleMode = (): void => {
    const i = CYCLE.indexOf(mode)
    void useChatStore.getState().setPermissionMode(convId, CYCLE[(i + 1) % CYCLE.length]!)
  }

  return (
    <div className="relative shrink-0 px-6 pb-4 pt-2" data-testid="composer-dock">
      <div className="ccw-glow" aria-hidden />
      <div className="relative mx-auto w-full max-w-[var(--chat-max-w)]">
        <div className="ccw-composer min-h-[var(--composer-min-h)]" data-running={running} data-testid="composer">
          <textarea
            ref={ref}
            value={text}
            rows={2}
            disabled={disabled}
            aria-label="Message"
            placeholder={disabled ? (disabledReason ?? 'Unavailable') : 'Ask Claude to work on this project...'}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                send()
              }
            }}
            className="block max-h-[220px] w-full resize-none bg-transparent px-3.5 pb-1 pt-3 text-md leading-[1.55] text-fg outline-none placeholder:text-fg-muted disabled:cursor-not-allowed disabled:opacity-[0.42]"
          />
          <div className="flex items-center gap-2 px-2.5 pb-2.5 pt-1">
            <Chip onClick={cycleMode} disabled={disabled} aria-label={`Permission mode: ${MODE_LABEL[mode] ?? mode}`} title="Cycle permission mode">
              <ShieldCheck size={12} aria-hidden />
              {MODE_LABEL[mode] ?? mode}
            </Chip>
            {model && (
              <Chip aria-label={`Model: ${model}`}>
                <Cpu size={12} aria-hidden />
                {model}
              </Chip>
            )}
            <div className="min-w-0 flex-1" />
            <span className="flex items-center gap-1.5 text-xs text-fg-3">
              {running ? (
                <>
                  <Kbd>Esc</Kbd> to interrupt
                </>
              ) : (
                <>
                  <Kbd>Enter</Kbd> to send
                </>
              )}
            </span>
            {running ? (
              <Button variant="danger" size="icon-md" aria-label="Stop" onClick={stop}>
                <Square size={12} fill="currentColor" aria-hidden />
              </Button>
            ) : (
              <Button variant="primary" size="icon-md" aria-label="Send" disabled={!canSend} onClick={send}>
                <ArrowUp size={15} aria-hidden />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
