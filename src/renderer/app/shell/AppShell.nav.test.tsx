import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { queryClient } from '@/lib/query-client'
import { resetTerminalBus, requestRunInTerminal } from '@/lib/terminal-bus'
import { useChatStore } from '@/stores/chat-store'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { AppShell } from './AppShell'

let changed: ((p: unknown) => void) | undefined
const watchProject = vi.fn(async () => {})

beforeEach(() => {
  queryClient.clear()
  resetTerminalBus()
  watchProject.mockClear()
  changed = undefined
  useChatStore.setState({ convs: {}, localToConv: {}, modes: {} })
  useWorkspaceStore.setState({
    cwd: 'C:\\fixture\\alpha',
    extraCwds: [],
    activeConvId: undefined,
    activeTitle: undefined,
    activeBranch: undefined,
    loadingSession: false,
    view: 'chat',
    terminalOpen: false
  })
  window.localStorage.clear()
  ;(window as unknown as { ccwrap: unknown }).ccwrap = {
    session: { onEvent: vi.fn(() => () => {}), supportedModels: vi.fn(async () => []) },
    dialog: { pickDirectory: vi.fn(async () => null) },
    history: { listProjects: vi.fn(async () => []), list: vi.fn(async () => []), load: vi.fn(async () => []) },
    app: { info: vi.fn(async () => ({ claudeSource: 'bundled', sdkVersion: '0', platform: 'win32' })) },
    config: {
      watchProject,
      onChanged: vi.fn((cb: (p: unknown) => void) => {
        changed = cb
        return () => {}
      })
    }
  }
})

describe('AppShell navigation skeleton', () => {
  it('shows the nav rows and Settings', () => {
    render(<AppShell />)
    const nav = screen.getByRole('navigation', { name: 'Main' })
    for (const n of ['Sessions', 'MCP', 'Memory', 'Skills', 'Agents', 'Hooks']) expect(within(nav).getByRole('button', { name: n })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument()
  })

  it.each([
    ['MCP', 'mcp-page'],
    ['Memory', 'memory-page'],
    ['Skills', 'skills-page'],
    ['Agents', 'agents-page'],
    ['Hooks', 'hooks-page'],
    ['Settings', 'settings-page']
  ])('%s renders its placeholder page with the cwd, and Sessions returns to chat', async (label, testId) => {
    const user = userEvent.setup()
    render(<AppShell />)
    await user.click(screen.getByRole('button', { name: label }))
    // lazy route chunk: first import is transformed on demand, which can take >1 s under CPU load
    const page = await screen.findByTestId(testId, undefined, { timeout: 10_000 })
    expect(page).toHaveTextContent('C:\\fixture\\alpha')
    expect(screen.getByRole('button', { name: label })).toHaveAttribute('aria-current', 'page')
    await user.click(screen.getByRole('button', { name: 'Sessions' }))
    expect(screen.queryByTestId(testId)).toBeNull()
    expect(useWorkspaceStore.getState().view).toBe('chat')
  }, 20_000)

  it('Ctrl+Backquote toggles the terminal slot', async () => {
    render(<AppShell />)
    expect(screen.queryByTestId('terminal-panel')).toBeNull()
    fireEvent.keyDown(window, { key: '`', code: 'Backquote', ctrlKey: true })
    expect(await screen.findByTestId('terminal-panel')).toBeInTheDocument()
    expect(useWorkspaceStore.getState().terminalOpen).toBe(true)
    fireEvent.keyDown(window, { key: '`', code: 'Backquote', ctrlKey: true })
    expect(useWorkspaceStore.getState().terminalOpen).toBe(false)
    expect(screen.getByTestId('terminal-slot')).toHaveClass('hidden')
  })

  it('requestRunInTerminal opens the panel', async () => {
    render(<AppShell />)
    act(() => requestRunInTerminal({ cwd: 'C:\\fixture\\alpha', command: 'echo hi' }))
    expect(await screen.findByTestId('terminal-panel')).toBeInTheDocument()
    expect(useWorkspaceStore.getState().terminalOpen).toBe(true)
  })

  it('watches the active project and drops the watch when there is none', async () => {
    render(<AppShell />)
    await act(async () => {})
    expect(watchProject).toHaveBeenCalledWith('C:\\fixture\\alpha')
    act(() => useWorkspaceStore.setState({ cwd: undefined }))
    expect(watchProject).toHaveBeenLastCalledWith(null)
  })

  it('invalidates the matching config queries on fs:changed', async () => {
    const spy = vi.spyOn(queryClient, 'invalidateQueries')
    render(<AppShell />)
    await act(async () => {})
    act(() => changed?.({ kind: 'mcp', path: 'x' }))
    expect(spy).toHaveBeenCalledWith({ queryKey: ['mcp'] })
    act(() => changed?.({ kind: 'settings', scope: 'user', path: 'x' }))
    expect(spy).toHaveBeenCalledWith({ queryKey: ['config', 'settings:user:'] })
    expect(spy).toHaveBeenCalledWith({ queryKey: ['settings-resolve'] })
  })
})
