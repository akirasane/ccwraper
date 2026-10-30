import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { McpListResult, McpServerEntry, McpTestResult } from '@shared/config'
import { createQueryClient } from '@/lib/query-client'
import { useChatStore } from '@/stores/chat-store'
import { McpPage } from './McpPage'
import { patchApproval } from './mcp-model'

vi.mock('@/components/editor', () => ({
  CodeEditor: (p: { value: string; onChange: (v: string) => void; ariaLabel: string }) => (
    <textarea aria-label={p.ariaLabel} value={p.value} onChange={(e) => p.onChange(e.target.value)} />
  )
}))

const CWD = 'C:\\fixture\\proj'
const SECRET = 'sk-fixture-secret-123'

const servers: McpServerEntry[] = [
  { name: 'alpha', scope: 'local', transport: 'stdio', config: { command: 'node', args: ['a.js'], env: { TOKEN: SECRET } } },
  {
    name: 'beta',
    scope: 'project',
    transport: 'http',
    config: { type: 'http', url: 'https://example.test/mcp', headers: { Authorization: `Bearer ${SECRET}` } },
    approval: 'pending'
  },
  { name: 'gamma', scope: 'user', transport: 'stdio', config: { command: 'gamma-bin' }, shadowedBy: 'local' }
]

let api: ReturnType<typeof makeApi>
function makeApi(list: McpListResult = { servers }) {
  return {
    mcp: {
      list: vi.fn(async () => list),
      add: vi.fn(async () => ({ ok: true as const, output: 'Added' })),
      remove: vi.fn(async () => ({ ok: true as const, output: 'Removed' })),
      update: vi.fn(async () => ({ ok: true as const, output: 'Updated' })),
      test: vi.fn(
        async (a: { name: string }): Promise<McpTestResult> => ({ name: a.name, status: 'connected', output: 'Status: ok', durationMs: 1200 })
      )
    },
    config: {
      read: vi.fn(async () => ({
        ref: { kind: 'settings', scope: 'local', cwd: CWD },
        path: 'p',
        exists: true,
        text: '{\n  "model": "opus",\n  "enabledMcpjsonServers": ["old"]\n}\n',
        hash: 'h1'
      })),
      write: vi.fn(async () => ({ ok: true as const, snapshot: {} }))
    }
  }
}

function mount(cwd: string | undefined = CWD) {
  ;(window as unknown as { ccwrap: unknown }).ccwrap = api
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <McpPage cwd={cwd} />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  useChatStore.setState({ convs: {}, localToConv: {}, modes: {} })
  api = makeApi()
})

describe('McpPage', () => {
  it('groups by scope, shows approval and shadow state, and masks secrets', async () => {
    const { container } = mount()
    await screen.findByText('alpha')
    expect(screen.getByRole('group', { name: 'Local servers' })).toHaveTextContent('alpha')
    expect(screen.getByRole('group', { name: 'Project (.mcp.json) servers' })).toHaveTextContent('beta')
    expect(screen.getByRole('group', { name: 'User servers' })).toHaveTextContent('gamma')
    expect(screen.getByText('pending')).toBeInTheDocument()
    expect(screen.getByText('shadowed by local')).toBeInTheDocument()
    expect(container.textContent).toContain('TOKEN=')
    expect(container.textContent).not.toContain(SECRET)
  })

  it('adds a stdio server with env', async () => {
    const user = userEvent.setup()
    mount()
    await screen.findByText('alpha')
    await user.click(screen.getByRole('button', { name: /add server/i }))
    await user.type(await screen.findByLabelText('Name'), 'newsrv')
    await user.type(screen.getByLabelText('Command'), 'npx')
    await user.click(screen.getByRole('button', { name: 'Add argument' }))
    await user.type(screen.getByLabelText('Argument 1'), '-y')
    await user.click(screen.getByRole('button', { name: 'Add environment' }))
    await user.type(screen.getByLabelText('Environment name 1'), 'KEY')
    await user.type(screen.getByLabelText('Environment value 1'), 'v1')
    expect(screen.getByLabelText('Environment value 1')).toHaveAttribute('type', 'password')
    await user.click(screen.getByRole('button', { name: 'Add server' }))
    await waitFor(() => expect(api.mcp.add).toHaveBeenCalledTimes(1))
    expect(api.mcp.add).toHaveBeenCalledWith({
      scope: 'local',
      cwd: CWD,
      name: 'newsrv',
      config: { command: 'npx', args: ['-y'], env: { KEY: 'v1' } }
    })
  })

  it('validates before calling the CLI', async () => {
    const user = userEvent.setup()
    mount()
    await screen.findByText('alpha')
    await user.click(screen.getByRole('button', { name: /add server/i }))
    await user.type(await screen.findByLabelText('Name'), 'bad name!')
    await user.click(screen.getByRole('button', { name: 'Add server' }))
    expect(await screen.findByText(/letters, digits/)).toBeInTheDocument()
    expect(screen.getByText('Command is required')).toBeInTheDocument()
    expect(api.mcp.add).not.toHaveBeenCalled()
  })

  it('shows CLI output when add fails', async () => {
    api.mcp.add.mockResolvedValueOnce({ ok: false, message: 'add failed', output: 'MCP server x already exists' } as never)
    const user = userEvent.setup()
    mount()
    await screen.findByText('alpha')
    await user.click(screen.getByRole('button', { name: /add server/i }))
    await user.type(await screen.findByLabelText('Name'), 'x')
    await user.type(screen.getByLabelText('Command'), 'cmd')
    await user.click(screen.getByRole('button', { name: 'Add server' }))
    expect(await screen.findByText('MCP server x already exists')).toBeInTheDocument()
  })

  it('rename sends mcp.update with newName', async () => {
    const user = userEvent.setup()
    mount()
    await screen.findByText('alpha')
    await user.click(screen.getByRole('button', { name: 'Edit alpha' }))
    const name = await screen.findByLabelText('Name')
    await user.clear(name)
    await user.type(name, 'alpha2')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(api.mcp.update).toHaveBeenCalledTimes(1))
    expect(api.mcp.update).toHaveBeenCalledWith({
      scope: 'local',
      cwd: CWD,
      name: 'alpha',
      newName: 'alpha2',
      config: { command: 'node', args: ['a.js'], env: { TOKEN: SECRET } }
    })
  })

  it('asks for confirmation before removing', async () => {
    const user = userEvent.setup()
    mount()
    await screen.findByText('alpha')
    await user.click(screen.getByRole('button', { name: 'Remove alpha' }))
    expect(api.mcp.remove).not.toHaveBeenCalled()
    const dlg = await screen.findByRole('dialog')
    await user.click(within(dlg).getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(api.mcp.remove).toHaveBeenCalledWith({ scope: 'local', cwd: CWD, name: 'alpha' }))
  })

  it.each([
    ['connected', 'Connected'],
    ['failed', 'Failed'],
    ['pending', 'Pending approval']
  ] as const)('test result chip: %s', async (status, label) => {
    api.mcp.test.mockResolvedValueOnce({ name: 'alpha', status, output: 'RAW OUTPUT', durationMs: 500 })
    const user = userEvent.setup()
    mount()
    await screen.findByText('alpha')
    await user.click(screen.getByRole('button', { name: 'Test alpha' }))
    expect(await screen.findByText(label)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Toggle output for alpha' }))
    expect(screen.getByText('RAW OUTPUT')).toBeInTheDocument()
  })

  it('approve patches settings.local.json and keeps other keys', async () => {
    const user = userEvent.setup()
    mount()
    await screen.findByText('beta')
    await user.click(screen.getByRole('button', { name: 'Approve' }))
    await waitFor(() => expect(api.config.write).toHaveBeenCalledTimes(1))
    const arg = (api.config.write.mock.calls[0] as unknown as [{ ref: unknown; text: string; baseHash: string }])[0]
    expect(arg.ref).toEqual({ kind: 'settings', scope: 'local', cwd: CWD })
    expect(arg.baseHash).toBe('h1')
    expect(JSON.parse(arg.text)).toEqual({ model: 'opus', enabledMcpjsonServers: ['old', 'beta'] })
  })

  it('lists session-only servers read-only from live meta', async () => {
    useChatStore.setState({
      convs: {
        c1: {
          cwd: CWD,
          meta: { tools: [], slashCommands: [], mcp: [{ name: 'alpha', status: 'connected' }, { name: 'claude.ai Gmail', status: 'needs-auth' }] }
        }
      } as never
    })
    mount()
    await screen.findByText('alpha')
    const rows = await screen.findAllByTestId('session-only-row')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toHaveTextContent('claude.ai Gmail')
    expect(within(rows[0]!).queryByRole('button')).toBeNull()
  })
})

describe('patchApproval', () => {
  it('moves a name between lists and tolerates an empty file', () => {
    const r = patchApproval('', 'x', 'reject') as { text: string }
    expect(JSON.parse(r.text)).toEqual({ disabledMcpjsonServers: ['x'] })
    const r2 = patchApproval(r.text, 'x', 'approve') as { text: string }
    expect(JSON.parse(r2.text)).toEqual({ enabledMcpjsonServers: ['x'], disabledMcpjsonServers: [] })
    expect('error' in patchApproval('{bad', 'x', 'approve')).toBe(true)
  })
})
