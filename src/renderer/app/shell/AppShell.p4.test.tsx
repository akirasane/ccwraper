import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { queryClient } from '@/lib/query-client'
import { useChatStore } from '@/stores/chat-store'
import { APP_VIEWS, useWorkspaceStore } from '@/stores/workspace-store'
import { AppShell } from './AppShell'

beforeEach(() => {
  queryClient.clear()
  useChatStore.setState({ convs: {}, localToConv: {}, modes: {} })
  useWorkspaceStore.setState({
    cwd: 'C:\\fixture\\alpha',
    extraCwds: [],
    activeConvId: undefined,
    activeTitle: undefined,
    activeBranch: undefined,
    loadingSession: false,
    tabs: [],
    unread: {},
    view: 'chat',
    terminalOpen: false
  })
  window.localStorage.clear()
  ;(window as unknown as { ccwrap: unknown }).ccwrap = {
    session: { onEvent: vi.fn(() => () => {}), supportedModels: vi.fn(async () => []) },
    dialog: { pickDirectory: vi.fn(async () => null) },
    history: { listProjects: vi.fn(async () => []), list: vi.fn(async () => []), load: vi.fn(async () => []) },
    app: { info: vi.fn(async () => ({ claudeSource: 'bundled', sdkVersion: '0', platform: 'win32' })) },
    config: { watchProject: vi.fn(async () => {}), onChanged: vi.fn(() => () => {}) }
  }
})

describe('P4 shell seams', () => {
  it('APP_VIEWS lists the P4 views', () => {
    expect(APP_VIEWS).toEqual(['chat', 'settings', 'mcp', 'plugins', 'memory', 'skills', 'agents', 'hooks', 'usage', 'git', 'preferences'])
  })

  it('the rail has Usage and Git rows, and Preferences under Settings', () => {
    render(<AppShell />)
    const nav = screen.getByRole('navigation', { name: 'Main' })
    expect(within(nav).getByRole('button', { name: 'Usage' })).toBeInTheDocument()
    expect(within(nav).getByRole('button', { name: 'Git' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Preferences' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument()
  })

  it.each([
    ['Usage', 'usage-page'],
    ['Git', 'git-page'],
    ['Preferences', 'preferences-page']
  ])('%s renders its lazy placeholder page', async (label, testId) => {
    const user = userEvent.setup()
    render(<AppShell />)
    await user.click(screen.getByRole('button', { name: label }))
    expect(await screen.findByTestId(testId)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: label })).toHaveAttribute('aria-current', 'page')
  })

  it('tab seams are inert stubs: newTab behaves like newSession', () => {
    const s = useWorkspaceStore.getState()
    expect(s.tabs).toEqual([])
    s.newTab()
    expect(useWorkspaceStore.getState().activeConvId).toBeDefined()
    s.setFocusItem({ kind: 'skill', name: 'x' })
    expect(useWorkspaceStore.getState().focusItem).toEqual({ kind: 'skill', name: 'x' })
  })
})
