import * as React from 'react'
import { Button } from '@/components/ui'
import { useChatStore } from '@/stores/chat-store'
import { isAuthError, typeSignInCommand } from './auth-hint'

/** Shown above the composer when the latest chat item is an auth-looking error. */
export function AuthHint({ convId, cwd }: { convId: string; cwd: string }): React.JSX.Element | null {
  const message = useChatStore((s) => {
    const items = s.convs[convId]?.items
    const last = items?.[items.length - 1]
    return last?.kind === 'error' ? last.message : undefined
  })
  if (!isAuthError(message)) return null
  return (
    <div
      role="status"
      data-testid="auth-hint"
      className="mx-auto flex w-full max-w-[calc(var(--chat-max-w)+48px)] shrink-0 items-center gap-3 px-6 pb-2"
    >
      <p className="min-w-0 flex-1 text-sm text-fg-2">
        Claude Code may be signed out. Sign in from a terminal, then send your message again.
      </p>
      <Button size="sm" variant="secondary" data-testid="auth-hint-signin" onClick={() => typeSignInCommand(cwd)}>
        Sign in
      </Button>
    </div>
  )
}
