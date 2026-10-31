import { QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { StatusBar } from '@/app/shell/StatusBar'
import { toast } from '@/components/ui/toaster'
import { Composer } from '@/features/chat/Composer'
import { buildModeCommands } from '@/features/palette/sources/modes'
import { parseTabs, serializeTabs } from '@/features/tabs/tab-persist'
import { TabStrip } from '@/features/tabs/TabStrip'
import { queryClient } from '@/lib/query-client'
import { flushChatEvents, useChatStore } from '@/stores/chat-store'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { BypassConfirmDialog, chooseMode, useBypassConfirm } from './choose-mode'
import { resetModePrefsForTest, useModePrefs } from './mode-prefs'
import { MODES, visibleModes } from './modes'

vi.mock('@/components/ui/toaster', async (orig) => ({
  ...(await orig<typeof import('@/components/ui/toaster')>()),
  toast: Object.assign(vi.fn(), { error: vi.fn(), info: vi.fn() })
}))

const CONV = 'c1'
let api: ReturnType<typeof makeApi>

function makeApi() {
  return {
    session: {
      start: vi.fn(async () => ({ localId: 'L1' })),
      send: vi.fn(async () => {}),
      interrupt: vi.fn(async () => {}),
      close: vi.fn(async () => {}),
      setModel: vi.fn(async () => {}),
      setPermissionMode: vi.fn(async (_id: string, _m: string) => {}),
      supportedModels: vi.fn(async () => [])
    },
    app: { info: vi.fn(async () => ({ claudeSource: 'bundled', sdkVersion: '0', platform: 'win32' })) },
    prefs: { get: vi.fn(async () => ({ allowBypassMode: false })), onChanged: vi.fn(() => () => {}) }
  }
}

beforeAll(() => {
  class RO {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  vi.stubGlobal('ResizeObserver', RO)
})

beforeEach(() => {
  vi.clearAllMocks()
  api = makeApi()
  ;(window as unknown as { ccwrap: unknown }).ccwrap = api
  resetModePrefsForTest()
  useBypassConfirm.getState().close()
  useChatStore.setState({ convs: {}, localToConv: {}, modes: {}, draftModels: {}, drafts: {}, lastActive: {} })
  useWorkspaceStore.setState({ tabs: [], activeConvId: undefined })
  useChatStore.getState().createConv({ convId: CONV, cwd: 'C:\\fixture\\proj', localId: 'L1' })
})

const live = (): string => useChatStore.getState().convs[CONV]!.meta.permissionMode ?? 'default'

async function openMenu(user = userEvent.setup()): Promise<ReturnType<typeof userEvent.setup>> {
  await user.click(screen.getByTestId('mode-chip'))
  return user
}

describe('mode menu', () => {
  it('lists the five modes with descriptions and hides Bypass until the preference is on', async () => {
    render(<Composer convId={CONV} />)
    await openMenu()
    expect(screen.getByRole('menu')).toBeInTheDocument()
    const rows = await screen.findAllByRole('menuitemradio')
    expect(rows.map((r) => r.getAttribute('data-mode'))).toEqual(['default', 'acceptEdits', 'plan', 'auto', 'dontAsk'])
    for (const r of rows) expect(r.querySelectorAll('span')[2]!.textContent!.length).toBeGreaterThan(20)
    expect(screen.getByRole('menuitemradio', { name: /Auto/ })).toHaveTextContent(/subscription usage/)
    expect(screen.queryByRole('menuitemradio', { name: /Bypass/ })).toBeNull()
  })

  it('shows Bypass when the preference is on', async () => {
    api.prefs.get.mockResolvedValue({ allowBypassMode: true })
    render(<Composer convId={CONV} />)
    await waitFor(() => expect(useModePrefs.getState().allowBypass).toBe(true))
    await openMenu()
    expect(await screen.findByRole('menuitemradio', { name: /Bypass/ })).toBeInTheDocument()
  })

  it('Auto is selectable directly and calls the engine', async () => {
    render(<Composer convId={CONV} />)
    const user = await openMenu()
    await user.click(await screen.findByRole('menuitemradio', { name: /Auto/ }))
    expect(api.session.setPermissionMode).toHaveBeenCalledWith('L1', 'auto')
    await waitFor(() => expect(screen.getByTestId('mode-chip')).toHaveTextContent('Auto'))
  })

  it('visibleModes gates Bypass', () => {
    expect(visibleModes(false).some((m) => m.value === 'bypassPermissions')).toBe(false)
    expect(visibleModes(true)).toHaveLength(MODES.length)
  })
})

describe('bypass confirm flow', () => {
  it('chooseMode ignores Bypass while the preference is off', () => {
    chooseMode(CONV, 'bypassPermissions')
    expect(useBypassConfirm.getState().convId).toBeUndefined()
    expect(api.session.setPermissionMode).not.toHaveBeenCalled()
  })

  it('asks every time, focuses Cancel, and does nothing on Cancel', async () => {
    api.prefs.get.mockResolvedValue({ allowBypassMode: true })
    useModePrefs.getState().set(true)
    render(
      <>
        <Composer convId={CONV} />
        <BypassConfirmDialog />
      </>
    )
    const user = await openMenu()
    await user.click(await screen.findByRole('menuitemradio', { name: /Bypass/ }))
    const dialog = await screen.findByTestId('bypass-confirm')
    expect(dialog).toHaveTextContent(/shell commands/)
    expect(dialog).toHaveTextContent(/file deletes/)
    expect(dialog).toHaveTextContent(/disposable project/)
    await waitFor(() => expect(screen.getByTestId('bypass-cancel')).toHaveFocus())
    await user.click(screen.getByTestId('bypass-cancel'))
    expect(api.session.setPermissionMode).not.toHaveBeenCalled()
    expect(live()).toBe('default')
  })

  it('confirming switches to Bypass and shows the danger indicator on chip, status bar and tab', async () => {
    api.prefs.get.mockResolvedValue({ allowBypassMode: true })
    useModePrefs.getState().set(true)
    useWorkspaceStore.setState({
      tabs: [{ convId: CONV, cwd: 'C:\\fixture\\proj', openedAt: 1, lastActiveAt: 1 }],
      activeConvId: CONV
    })
    render(
      <QueryClientProvider client={queryClient}>
        <Composer convId={CONV} />
        <BypassConfirmDialog />
        <TabStrip />
        <StatusBar />
      </QueryClientProvider>
    )
    expect(screen.getByTestId('mode-chip')).not.toHaveAttribute('data-bypass')
    expect(screen.queryByTestId('tab-bypass')).toBeNull()
    const user = await openMenu()
    await user.click(await screen.findByRole('menuitemradio', { name: /Bypass/ }))
    await user.click(await screen.findByTestId('bypass-confirm-go'))
    expect(api.session.setPermissionMode).toHaveBeenCalledWith('L1', 'bypassPermissions')
    await waitFor(() => expect(screen.getByTestId('mode-chip')).toHaveAttribute('data-bypass', 'true'))
    expect(screen.getByTestId('mode-chip').className).toMatch(/text-danger/)
    expect(screen.getByTestId('status-mode')).toHaveAttribute('data-bypass', 'true')
    expect(screen.getByTestId('status-mode').className).toMatch(/text-danger/)
    expect(screen.getByTestId('tab-bypass')).toBeInTheDocument()
  })
})

describe('refused mode and engine truth', () => {
  it('rolls back and toasts the reason when setPermissionMode throws', async () => {
    api.session.setPermissionMode.mockRejectedValueOnce(new Error('Disabled by settings'))
    await useChatStore.getState().setPermissionMode(CONV, 'auto')
    expect(live()).toBe('default')
    expect(useChatStore.getState().modes[CONV]).toBeUndefined()
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('Auto'), { description: 'Disabled by settings' })
  })

  it('rollback restores the previous non-default mode', async () => {
    await useChatStore.getState().setPermissionMode(CONV, 'plan')
    api.session.setPermissionMode.mockRejectedValueOnce(new Error('nope'))
    await useChatStore.getState().setPermissionMode(CONV, 'dontAsk')
    expect(live()).toBe('plan')
    expect(useChatStore.getState().modes[CONV]).toBe('plan')
  })

  it('an init echo that differs from the requested start mode wins and toasts', async () => {
    useChatStore.getState().createConv({ convId: 'd1', cwd: 'C:\\fixture\\proj' })
    useChatStore.setState((s) => ({ modes: { ...s.modes, d1: 'auto' } }))
    await useChatStore.getState().submit('d1', 'hello')
    expect(api.session.start).toHaveBeenCalledWith(expect.objectContaining({ permissionMode: 'auto' }))
    act(() => {
      useChatStore.getState().applyEvent('L1', {
        t: 'init',
        sessionId: 's',
        model: 'm',
        tools: [],
        mcp: [],
        slashCommands: [],
        cwd: 'C:\\fixture\\proj',
        permissionMode: 'default'
      })
      flushChatEvents()
    })
    await waitFor(() => expect(useChatStore.getState().modes.d1).toBe('default'))
    expect(useChatStore.getState().convs.d1!.meta.permissionMode).toBe('default')
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('Auto'), expect.anything())
  })

  it('a start refused in Bypass falls back to Default with a toast', async () => {
    useChatStore.getState().createConv({ convId: 'd2', cwd: 'C:\\fixture\\proj' })
    useChatStore.setState((s) => ({ modes: { ...s.modes, d2: 'bypassPermissions' } }))
    api.session.start.mockRejectedValueOnce(new Error('Bypass mode is disabled.'))
    await useChatStore.getState().submit('d2', 'hello')
    expect(useChatStore.getState().modes.d2).toBe('default')
    expect(toast.error).toHaveBeenCalled()
  })
})

describe('Bypass is never carried over', () => {
  it('a suspended Bypass session resumes in Default, with a toast', async () => {
    await useChatStore.getState().setPermissionMode(CONV, 'bypassPermissions')
    expect(live()).toBe('bypassPermissions')
    await useChatStore.getState().suspend(CONV)
    expect(useChatStore.getState().modes[CONV]).toBe('default')
    expect(useChatStore.getState().convs[CONV]!.meta.permissionMode).toBe('default')
    expect(toast.info).toHaveBeenCalled()
  })

  it('a suspended non-Bypass session keeps its mode', async () => {
    await useChatStore.getState().setPermissionMode(CONV, 'plan')
    await useChatStore.getState().suspend(CONV)
    expect(useChatStore.getState().modes[CONV]).toBe('plan')
    expect(toast.info).not.toHaveBeenCalled()
  })

  it('tab persistence never writes or reads Bypass; other modes round-trip', () => {
    const tabs = [
      { convId: 'a', cwd: 'C:\\p', sessionId: 's1', openedAt: 1, lastActiveAt: 1 },
      { convId: 'b', cwd: 'C:\\p', sessionId: 's2', openedAt: 1, lastActiveAt: 1 },
      { convId: 'c', cwd: 'C:\\p', sessionId: 's3', openedAt: 1, lastActiveAt: 1 }
    ]
    const out = serializeTabs(tabs, 'a', { a: 'bypassPermissions', b: 'plan', c: 'default' })
    expect(JSON.stringify(out)).not.toContain('bypassPermissions')
    expect(out.tabs.map((t) => t.mode)).toEqual([undefined, 'plan', undefined])
    // An old or hand-edited file with Bypass is ignored on read.
    const raw = JSON.stringify({ tabs: [{ cwd: 'C:\\p', sessionId: 's1', mode: 'bypassPermissions' }, { cwd: 'C:\\p', sessionId: 's2', mode: 'acceptEdits' }] })
    expect(parseTabs(raw)!.tabs.map((t) => t.mode)).toEqual([undefined, 'acceptEdits'])
  })

  it('restoring tabs seeds the saved mode but never Bypass', () => {
    useWorkspaceStore.getState().restoreTabs({
      tabs: [
        { convId: 'hist-s1', cwd: 'C:\\p', sessionId: 's1', mode: 'plan' },
        { convId: 'hist-s2', cwd: 'C:\\p', sessionId: 's2', mode: 'bypassPermissions' }
      ]
    })
    expect(useChatStore.getState().modes['hist-s1']).toBe('plan')
    expect(useChatStore.getState().modes['hist-s2']).toBeUndefined()
  })

  it('a replayed history init does not display a stale mode on a session that is not running', () => {
    useChatStore.getState().createConv({ convId: 'h1', cwd: 'C:\\p', resumeSessionId: 's' })
    useChatStore.getState().seedFromHistory('h1', [
      { t: 'init', sessionId: 's', model: 'm', tools: [], mcp: [], slashCommands: [], cwd: 'C:\\p', permissionMode: 'bypassPermissions' }
    ])
    render(<Composer convId="h1" />)
    expect(screen.getByTestId('mode-chip')).toHaveAttribute('data-mode', 'default')
    expect(screen.getByTestId('mode-chip')).not.toHaveAttribute('data-bypass')
  })
})

describe('palette mode commands', () => {
  it('lists Mode: Default / Accept edits / Plan / Auto, and Bypass only when enabled', () => {
    const titles = (allow: boolean): string[] => buildModeCommands(CONV, allow).map((c) => c.title)
    expect(titles(false)).toEqual(expect.arrayContaining(['Mode: Default', 'Mode: Accept edits', 'Mode: Plan', 'Mode: Auto']))
    expect(titles(false).some((t) => /Bypass/.test(t))).toBe(false)
    expect(titles(true).some((t) => /Bypass/.test(t))).toBe(true)
  })

  it('Bypass goes through the confirm dialog, others apply directly', () => {
    useModePrefs.getState().set(true)
    const cmds = buildModeCommands(CONV, true)
    cmds.find((c) => c.id === 'mode:bypassPermissions')!.run()
    expect(useBypassConfirm.getState().convId).toBe(CONV)
    expect(api.session.setPermissionMode).not.toHaveBeenCalled()
    cmds.find((c) => c.id === 'mode:auto')!.run()
    expect(api.session.setPermissionMode).toHaveBeenCalledWith('L1', 'auto')
  })
})
