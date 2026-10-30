import { useQuery } from '@tanstack/react-query'
import * as React from 'react'
import type { AuthStatus } from '@shared/app'
import type { AppInfo } from '@shared/events'
import { Button } from '@/components/ui'
import { cn } from '@/lib/cn'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { typeSignInCommand } from './auth-hint'

export const FIRST_RUN_DISMISSED_KEY = 'ccwrap.firstRun.dismissed'

function readDismissed(): boolean {
  try {
    return window.localStorage.getItem(FIRST_RUN_DISMISSED_KEY) === '1'
  } catch {
    return false
  }
}

/** Category only. Never a plan name: the signed-in method values are not verified (P3 findings). */
export function describeAuth(a: AuthStatus | undefined): { ok: boolean; text: string } {
  if (!a) return { ok: false, text: 'Checking sign-in...' }
  if (a.state === 'signed_out') return { ok: false, text: 'Signed out' }
  if (a.state === 'unknown') return { ok: true, text: 'Sign-in state unknown (not blocking)' }
  const m = a.method === 'api_key' ? ' with an API key' : a.method === 'subscription' ? ' with an account login' : ''
  return { ok: true, text: `Signed in${m}` }
}

function Row({
  ok,
  label,
  detail,
  action,
  testId
}: {
  ok: boolean
  label: string
  detail: string
  action?: React.ReactNode
  testId: string
}): React.JSX.Element {
  return (
    <li data-testid={testId} data-ok={ok} className="flex items-center gap-3 py-2">
      <span
        aria-hidden
        className={cn(
          'flex size-4 shrink-0 items-center justify-center rounded-full border text-2xs',
          ok ? 'border-transparent bg-accent-solid text-on-accent' : 'border-border-strong text-fg-muted'
        )}
      >
        {ok ? '✓' : ''}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-base text-fg">{label}</div>
        <div className="truncate text-sm text-fg-3">{detail}</div>
      </div>
      {action}
    </li>
  )
}

export interface FirstRunCardProps {
  cwd?: string
  /** Defaults to the workspace store's folder picker. */
  onOpenFolder?: () => void
}

/** Non-blocking setup checklist: binary, sign-in, project. Hidden when all pass or dismissed. */
export function FirstRunCard({ cwd, onOpenFolder }: FirstRunCardProps): React.JSX.Element | null {
  const [dismissed, setDismissed] = React.useState(readDismissed)
  const info = useQuery<AppInfo>({ queryKey: ['app', 'info'], queryFn: () => window.ccwrap.app.info(), retry: false })
  const auth = useQuery<AuthStatus>({
    queryKey: ['app', 'authStatus'],
    queryFn: () => window.ccwrap.app.authStatus(),
    retry: false
  })

  if (dismissed) return null

  const binaryOk = !!info.data?.claudePath
  const a = describeAuth(auth.data)
  const projectOk = !!cwd
  if (info.data && auth.data && binaryOk && a.ok && projectOk) return null

  const dismiss = (): void => {
    try {
      window.localStorage.setItem(FIRST_RUN_DISMISSED_KEY, '1')
    } catch {
      /* storage unavailable: dismissed for this view only */
    }
    setDismissed(true)
  }
  const openFolder = onOpenFolder ?? ((): void => void useWorkspaceStore.getState().addFolder())

  return (
    <section
      data-testid="first-run-card"
      aria-label="Getting started"
      className="m-auto w-full max-w-md rounded-lg border border-border-strong bg-bg-1 p-5"
    >
      <h2 className="text-lg font-medium text-fg">Get started</h2>
      <p className="mt-1 text-base text-fg-3">A few things to check before your first session.</p>
      <ul className="mt-3 divide-y divide-border">
        <Row
          testId="first-run-binary"
          ok={binaryOk}
          label="Claude Code"
          detail={
            info.data
              ? binaryOk
                ? `${info.data.claudeVersion ?? 'version unknown'} (${info.data.claudeSource})`
                : 'Not found'
              : 'Checking...'
          }
        />
        <Row
          testId="first-run-auth"
          ok={a.ok}
          label="Sign-in"
          detail={a.text}
          action={
            auth.data?.state === 'signed_out' ? (
              <Button
                size="sm"
                variant="primary"
                data-testid="first-run-signin"
                onClick={() => typeSignInCommand(cwd ?? info.data?.userDataDir ?? '')}
              >
                Sign in
              </Button>
            ) : undefined
          }
        />
        <Row
          testId="first-run-project"
          ok={projectOk}
          label="Project"
          detail={cwd ?? 'No folder selected'}
          action={
            projectOk ? undefined : (
              <Button size="sm" data-testid="first-run-open-folder" onClick={openFolder}>
                Open folder...
              </Button>
            )
          }
        />
      </ul>
      <p className="mt-2 text-sm text-fg-muted">Sign in types the command in a terminal. Press Enter there to run it.</p>
      <div className="mt-3 flex justify-end">
        <Button size="sm" variant="ghost" data-testid="first-run-dismiss" onClick={dismiss}>
          Dismiss
        </Button>
      </div>
    </section>
  )
}
