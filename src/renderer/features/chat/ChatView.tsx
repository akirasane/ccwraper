import * as React from 'react'
import { useChatStore } from '@/stores/chat-store'
import './chat.css'
import { Composer } from './Composer'
import type { ChatTarget } from './model/types'
import { MessageList } from './MessageList'
import { PermissionDialog } from './permission/PermissionDialog'
import { selectIsStreaming } from './model/selectors'

const norm = (p: string): string => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()

/** null while unknown (fail open: the main process reports a missing cwd on start anyway). */
function useCwdExists(cwd: string): boolean | null {
  const [exists, setExists] = React.useState<boolean | null>(null)
  React.useEffect(() => {
    let cancelled = false
    setExists(null)
    const api = typeof window !== 'undefined' ? window.ccwrap?.history : undefined
    if (!api) return
    api
      .listProjects()
      .then((projects) => {
        if (cancelled) return
        const hit = projects.find((p) => norm(p.cwd) === norm(cwd) || norm(p.key) === norm(cwd))
        setExists(hit ? hit.exists : null)
      })
      .catch(() => {
        /* unknown */
      })
    return () => {
      cancelled = true
    }
  }, [cwd])
  return exists
}

/** "Working" row shown while a turn runs but nothing is streaming or executing (waiting for the first token / thinking). */
function WorkingIndicator({ convId }: { convId: string }): React.JSX.Element | null {
  const idle = useChatStore((s) => {
    const c = s.convs[convId]
    if (!c || c.status !== 'running' || selectIsStreaming(c)) return false
    const last = c.items[c.items.length - 1]
    return !(last?.kind === 'tool' && c.tools[last.toolUseId]?.status === 'running')
  })
  if (!idle) return null
  return (
    <div
      data-testid="working-indicator"
      role="status"
      className="mx-auto w-full max-w-[calc(var(--chat-max-w)+48px)] shrink-0 px-6 pb-2 text-sm text-fg-3"
    >
      <span className="ccw-shimmer">Working</span>
    </div>
  )
}

function HistoryNotice({ convId }: { convId: string }): React.JSX.Element | null {
  const notice = useChatStore((s) => s.convs[convId]?.notice)
  if (!notice) return null
  return (
    <div
      role="status"
      data-testid="history-notice"
      className="mx-auto w-full max-w-[calc(var(--chat-max-w)+48px)] shrink-0 px-6 pt-3"
    >
      <div className="rounded-md border border-warn-border bg-warn-bg px-3 py-2 text-sm text-warn">{notice}</div>
    </div>
  )
}

export function ChatView({ target }: { target: ChatTarget }): React.JSX.Element {
  const { convId } = target
  const has = useChatStore((s) => convId in s.convs)
  React.useEffect(() => {
    if (!useChatStore.getState().convs[convId]) useChatStore.getState().createConv(target)
  }, [convId, target])
  const cwdExists = useCwdExists(target.cwd)
  const missing = cwdExists === false

  return (
    <div
      data-testid="chat-view"
      data-conv-id={convId}
      className="ccw-chat relative flex h-full min-h-0 min-w-0 flex-col bg-bg-0"
    >
      {has && <HistoryNotice convId={convId} />}
      {has ? <MessageList convId={convId} /> : <div className="flex-1" />}
      {has && <WorkingIndicator convId={convId} />}
      <Composer
        convId={convId}
        disabled={missing}
        {...(missing ? { disabledReason: 'This project folder no longer exists.' } : {})}
      />
      <PermissionDialog convId={convId} />
    </div>
  )
}
