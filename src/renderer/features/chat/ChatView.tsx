import * as React from 'react'
import { useChatStore } from '@/stores/chat-store'
import './chat.css'
import { Composer } from './Composer'
import type { ChatTarget } from './model/types'
import { MessageList } from './MessageList'
import { PermissionDialog } from './permission/PermissionDialog'

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
      {has ? <MessageList convId={convId} /> : <div className="flex-1" />}
      <Composer
        convId={convId}
        disabled={missing}
        {...(missing ? { disabledReason: 'This project folder no longer exists.' } : {})}
      />
      <PermissionDialog convId={convId} />
    </div>
  )
}
