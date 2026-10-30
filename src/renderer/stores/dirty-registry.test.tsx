import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { act } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppShell } from '@/app/shell/AppShell'
import { queryClient } from '@/lib/query-client'
import { isAnyDirty, setDirty, useDirtyRegistry } from './dirty-registry'
import { useChatStore } from './chat-store'
import { useWorkspaceStore } from './workspace-store'

beforeEach(() => {
  queryClient.clear()
  useDirtyRegistry.setState({ dirty: {}, pending: null })
  useChatStore.setState({ convs: {}, localToConv: {}, modes: {} })
  useWorkspaceStore.setState({
    cwd: 'C:\\fixture\\alpha',
    extraCwds: [],
    activeConvId: undefined,
    loadingSession: false,
    view: 'settings',
    terminalOpen: false
  })
  window.localStorage.clear()
})

describe('dirty registry + workspace store', () => {
  it('setView runs immediately when nothing is dirty', () => {
    useWorkspaceStore.getState().setView('chat')
    expect(useWorkspaceStore.getState().view).toBe('chat')
  })

  it('setView parks the change while dirty; confirm applies it, cancel drops it', () => {
    setDirty('memory', true)
    expect(isAnyDirty()).toBe(true)
    useWorkspaceStore.getState().setView('mcp')
    expect(useWorkspaceStore.getState().view).toBe('settings')
    expect(useDirtyRegistry.getState().pending).not.toBeNull()
    useDirtyRegistry.getState().cancel()
    expect(useWorkspaceStore.getState().view).toBe('settings')

    useWorkspaceStore.getState().setView('mcp')
    useDirtyRegistry.getState().confirm()
    expect(useWorkspaceStore.getState().view).toBe('mcp')
    expect(isAnyDirty()).toBe(false)
  })

  it('a project change is guarded; re-selecting the same project is not', () => {
    setDirty('settings', true)
    useWorkspaceStore.getState().selectProject('c:/fixture/ALPHA/')
    expect(useDirtyRegistry.getState().pending).toBeNull()
    useWorkspaceStore.setState({ cwd: 'C:\\fixture\\alpha' })
    useWorkspaceStore.getState().selectProject('C:\\fixture\\beta')
    expect(useWorkspaceStore.getState().cwd).toBe('C:\\fixture\\alpha')
    useDirtyRegistry.getState().confirm()
    expect(useWorkspaceStore.getState().cwd).toBe('C:\\fixture\\beta')
  })

  it('openSession waits for the decision', async () => {
    const load = vi.fn(async () => [])
    ;(window as unknown as { ccwrap: unknown }).ccwrap = { history: { load } }
    setDirty('settings', true)
    const p = useWorkspaceStore.getState().openSession({ sessionId: 's1', cwd: 'C:\\fixture\\alpha', title: 't' } as never)
    expect(load).not.toHaveBeenCalled()
    useDirtyRegistry.getState().confirm()
    await p
    expect(load).toHaveBeenCalled()
    expect(useWorkspaceStore.getState().view).toBe('chat')
  })
})

describe('AppShell discard dialog', () => {
  it('asks before leaving a dirty view; Keep editing stays, Discard navigates', async () => {
    ;(window as unknown as { ccwrap: unknown }).ccwrap = {
      session: { onEvent: vi.fn(() => () => {}), supportedModels: vi.fn(async () => []) },
      dialog: { pickDirectory: vi.fn(async () => null) },
      history: { listProjects: vi.fn(async () => []), list: vi.fn(async () => []), load: vi.fn(async () => []) },
      app: { info: vi.fn(async () => ({ claudeSource: 'bundled', sdkVersion: '0', platform: 'win32' })) },
      config: { watchProject: vi.fn(async () => {}), onChanged: vi.fn(() => () => {}) }
    }
    const user = userEvent.setup()
    render(<AppShell />)
    act(() => setDirty('memory', true))
    await user.click(screen.getByRole('button', { name: 'MCP' }))
    const dlg = await screen.findByRole('dialog')
    expect(dlg).toHaveTextContent('Discard unsaved changes?')
    await user.click(within(dlg).getByRole('button', { name: 'Keep editing' }))
    expect(useWorkspaceStore.getState().view).toBe('settings')
    await user.click(screen.getByRole('button', { name: 'MCP' }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Discard' }))
    expect(useWorkspaceStore.getState().view).toBe('mcp')
  })
})
