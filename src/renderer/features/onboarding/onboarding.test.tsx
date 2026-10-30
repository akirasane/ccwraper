import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthStatus } from '@shared/app'
import { onRunInTerminal, resetTerminalBus, type RunInTerminalRequest } from '@/lib/terminal-bus'
import { useChatStore } from '@/stores/chat-store'
import { AuthHint } from './AuthHint'
import { isAuthError } from './auth-hint'
import { FIRST_RUN_DISMISSED_KEY, FirstRunCard } from './FirstRunCard'

const info = {
  claudePath: 'C:\\claude.exe',
  claudeVersion: '2.1.0',
  claudeSource: 'bundled',
  sdkVersion: '1',
  platform: 'win32',
  version: '0.1.0',
  electronVersion: '33',
  packaged: true,
  userDataDir: 'C:\\ud'
}

function mount(auth: AuthStatus, cwd?: string) {
  ;(window as unknown as { ccwrap: unknown }).ccwrap = {
    app: { info: vi.fn(async () => info), authStatus: vi.fn(async () => auth) }
  }
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <FirstRunCard cwd={cwd} onOpenFolder={vi.fn()} />
    </QueryClientProvider>
  )
}

const out = { state: 'signed_out', checkedAt: 1 } as const

beforeEach(() => {
  resetTerminalBus()
  window.localStorage.removeItem(FIRST_RUN_DISMISSED_KEY)
})
afterEach(cleanup)

describe('isAuthError', () => {
  it('matches auth failures only', () => {
    expect(isAuthError('Invalid API key - Please run /login')).toBe(true)
    expect(isAuthError('Not logged in')).toBe(true)
    expect(isAuthError('API Error: 401 Unauthorized')).toBe(true)
    expect(isAuthError('Rate limit reached')).toBe(false)
    expect(isAuthError('Request 4012 ms timeout')).toBe(false)
    expect(isAuthError(undefined)).toBe(false)
  })
})

describe('FirstRunCard', () => {
  it('signed out: Sign in types the command without Enter', async () => {
    const got: RunInTerminalRequest[] = []
    onRunInTerminal((r) => got.push(r))
    mount(out, 'C:\\proj')
    await userEvent.click(await screen.findByTestId('first-run-signin'))
    expect(got).toEqual([{ cwd: 'C:\\proj', command: 'claude auth login' }])
    expect(got[0]!.command).not.toMatch(/[\r\n]/)
    expect(screen.getByTestId('first-run-auth').textContent).toContain('Signed out')
  })

  it('hides when every check passes', async () => {
    mount({ state: 'signed_in', method: 'subscription', checkedAt: 1 }, 'C:\\proj')
    await waitFor(() => expect(window.ccwrap.app.authStatus).toHaveBeenCalled())
    await waitFor(() => expect(screen.queryByTestId('first-run-card')).toBeNull())
  })

  it('unknown sign-in state does not block and shows no plan name', async () => {
    mount({ state: 'unknown', checkedAt: 1, reason: 'timeout' })
    await waitFor(() => expect(screen.getByTestId('first-run-auth').textContent).toContain('unknown'))
    expect(screen.getByTestId('first-run-open-folder')).toBeTruthy()
  })

  it('dismiss hides and persists', async () => {
    const { unmount } = mount(out)
    await userEvent.click(await screen.findByTestId('first-run-dismiss'))
    expect(screen.queryByTestId('first-run-card')).toBeNull()
    expect(window.localStorage.getItem(FIRST_RUN_DISMISSED_KEY)).toBe('1')
    unmount()
    mount(out)
    await waitFor(() => expect(window.ccwrap.app.info).toHaveBeenCalled())
    expect(screen.queryByTestId('first-run-card')).toBeNull()
  })
})

describe('AuthHint', () => {
  function seed(message: string) {
    useChatStore.getState().createConv({ convId: 'c1', cwd: 'C:\\proj' })
    useChatStore.setState((st) => {
      const c = st.convs['c1']!
      return { convs: { ...st.convs, c1: { ...c, items: [...c.items, { kind: 'error', id: 'e1', message }] } } }
    })
  }

  it('shows for an auth error and types the command', async () => {
    const got: RunInTerminalRequest[] = []
    onRunInTerminal((r) => got.push(r))
    seed('Invalid API key')
    render(<AuthHint convId="c1" cwd="C:\\proj" />)
    await userEvent.click(screen.getByTestId('auth-hint-signin'))
    // The JSX attribute above is a literal (no escape processing), so it holds two backslashes.
    expect(got).toEqual([{ cwd: 'C:\\\\proj', command: 'claude auth login' }])
  })

  it('does not show for an unrelated error', () => {
    seed('Rate limit reached')
    render(<AuthHint convId="c1" cwd="C:\\proj" />)
    expect(screen.queryByTestId('auth-hint')).toBeNull()
  })
})

describe('FirstRunCard in the chat empty state', () => {
  it('shows inside an empty MessageList for a signed-out user and stays out without a QueryClient', async () => {
    const { MessageList } = await import('../chat/MessageList')
    useChatStore.getState().createConv({ convId: 'fr1', cwd: 'C:\proj' })
    ;(window as unknown as { ccwrap: unknown }).ccwrap = {
      app: { info: vi.fn(async () => info), authStatus: vi.fn(async () => out) }
    }
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const r = render(
      <QueryClientProvider client={qc}>
        <MessageList convId="fr1" cwd="C:\proj" />
      </QueryClientProvider>
    )
    expect(await screen.findByTestId('first-run-card')).toBeTruthy()
    expect(screen.getByText('Send a message to start the session.')).toBeTruthy()
    r.unmount()
    render(<MessageList convId="fr1" cwd="C:\proj" />)
    expect(screen.queryByTestId('first-run-card')).toBeNull()
  })
})
