import { QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConfigFileRef, ConfigSnapshot, ConfigWriteResult, ResolvedSettingsView } from '@shared/config'
import { createQueryClient } from '@/lib/query-client'
import { useDirtyRegistry } from '@/stores/dirty-registry'
import { HooksPage } from './HooksPage'

vi.mock('@/components/editor', () => ({
  CodeEditor: (p: { value: string; onChange: (v: string) => void; ariaLabel: string }) => (
    <textarea aria-label={p.ariaLabel} value={p.value} onChange={(e) => p.onChange(e.target.value)} />
  )
}))

function snap(ref: ConfigFileRef, text: string, hash: string | null = 'h1'): ConfigSnapshot {
  return { ref, path: `C:\\fixture\\${ref.scope}\\settings.json`, exists: hash !== null, text, hash }
}

let files: Record<string, ConfigSnapshot>
let write: ReturnType<typeof vi.fn>
let resolve: ReturnType<typeof vi.fn>
let ccwrap: Record<string, unknown>

function installApi(): void {
  write = vi.fn(async (): Promise<ConfigWriteResult> => ({ ok: false, code: 'io', message: 'unset' }))
  resolve = vi.fn(async (): Promise<ResolvedSettingsView> => ({ effective: {}, provenance: {}, sources: [] }))
  ccwrap = {
    config: {
      read: vi.fn(async (ref: ConfigFileRef) => files[ref.scope] ?? snap(ref, '', null)),
      write,
      watchProject: vi.fn(async () => {}),
      onChanged: vi.fn(() => () => {})
    },
    settings: { resolve },
    // Present only so a test can prove nothing here calls them.
    pty: { open: vi.fn(), write: vi.fn() },
    session: { start: vi.fn(), send: vi.fn() }
  }
  ;(window as unknown as { ccwrap: unknown }).ccwrap = ccwrap
}

function mount(cwd?: string) {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <HooksPage cwd={cwd} />
    </QueryClientProvider>
  )
}

const USER = '{\n  "model": "opus",\n  "env": { "A": "1" }\n}\n'
const withHooks = (hooks: unknown, extra: Record<string, unknown> = { model: 'opus' }) => JSON.stringify({ ...extra, hooks }, null, 2) + '\n'

beforeEach(() => {
  window.localStorage.clear()
  useDirtyRegistry.setState({ dirty: {}, pending: null })
  files = { user: snap({ kind: 'settings', scope: 'user' }, USER) }
  installApi()
})

async function addPreToolUse(command: string) {
  const sel = await screen.findByRole('combobox', { name: 'Add event' })
  fireEvent.change(sel, { target: { value: 'PreToolUse' } })
  fireEvent.change(await screen.findByRole('textbox', { name: /^Command/ }), { target: { value: command } })
}

describe('HooksPage safety', () => {
  it('always shows the safety banner, in every view', async () => {
    mount('C:\\proj')
    expect(await screen.findByTestId('hooks-safety-banner')).toHaveTextContent(/ccwraper never runs hooks/)
    await userEvent.click(screen.getByRole('button', { name: 'Effective' }))
    expect(screen.getByTestId('hooks-safety-banner')).toBeInTheDocument()
  })

  it('has no Run / Test button and never calls a pty or session API', async () => {
    files.user = snap({ kind: 'settings', scope: 'user' }, withHooks({ PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo hi' }] }] }))
    mount('C:\\proj')
    await screen.findByDisplayValue('echo hi')
    await userEvent.click(screen.getByRole('button', { name: 'Effective' }))
    await screen.findByTestId('hooks-effective')
    await userEvent.click(screen.getByRole('button', { name: 'User' }))
    await screen.findByDisplayValue('echo hi')
    for (const b of screen.getAllByRole('button')) {
      expect(b.textContent ?? '').not.toMatch(/\b(run|test|execute|preview)\b/i)
      expect(b.getAttribute('aria-label') ?? '').not.toMatch(/\b(run|test|execute|preview)\b/i)
    }
    expect(screen.queryByText(/run in terminal/i)).toBeNull()
    for (const ns of ['pty', 'session']) {
      for (const fn of Object.values(ccwrap[ns] as Record<string, ReturnType<typeof vi.fn>>)) expect(fn).not.toHaveBeenCalled()
    }
  })
})

describe('HooksPage editing', () => {
  it('adding a PreToolUse command hook writes hooks.PreToolUse[0].hooks[0] and keeps other keys and order', async () => {
    write.mockResolvedValue({ ok: true, snapshot: snap({ kind: 'settings', scope: 'user' }, 'x', 'h2') })
    mount()
    await addPreToolUse('echo p3')
    await userEvent.click(screen.getByRole('button', { name: /^Save$/ }))
    const dlg = await screen.findByRole('dialog')
    expect(within(dlg).getByTestId('hooks-confirm-list')).toHaveTextContent('echo p3')
    await userEvent.click(within(dlg).getByRole('button', { name: 'Save hooks' }))
    await waitFor(() => expect(write).toHaveBeenCalledTimes(1))
    const arg = write.mock.calls[0]![0] as { text: string; baseHash: string }
    expect(arg.baseHash).toBe('h1')
    const out = JSON.parse(arg.text) as { hooks: { PreToolUse: Array<{ hooks: unknown[] }> } }
    expect(Object.keys(out)).toEqual(['model', 'env', 'hooks'])
    expect(out.hooks.PreToolUse[0]!.hooks[0]).toEqual({ type: 'command', command: 'echo p3' })
  })

  it('editing an entry keeps an unknown key on it and on the group', async () => {
    files.user = snap(
      { kind: 'settings', scope: 'user' },
      withHooks({ Stop: [{ future: 1, hooks: [{ type: 'command', command: 'a', extra: true }] }] })
    )
    write.mockResolvedValue({ ok: true, snapshot: snap({ kind: 'settings', scope: 'user' }, 'x', 'h2') })
    mount()
    fireEvent.change(await screen.findByDisplayValue('a'), { target: { value: 'b' } })
    await userEvent.click(screen.getByRole('button', { name: /^Save$/ }))
    await userEvent.click(await screen.findByRole('button', { name: 'Save hooks' }))
    await waitFor(() => expect(write).toHaveBeenCalled())
    const out = JSON.parse((write.mock.calls[0]![0] as { text: string }).text) as { hooks: { Stop: unknown[] } }
    expect(out.hooks.Stop[0]).toEqual({ future: 1, hooks: [{ type: 'command', command: 'b', extra: true }] })
  })

  it('removing the last entry deletes the event key; an unknown event survives', async () => {
    files.user = snap(
      { kind: 'settings', scope: 'user' },
      withHooks({ FutureEvent: [{ hooks: [{ type: 'command', command: 'z' }] }], Stop: [{ hooks: [{ type: 'command', command: 'a' }] }] })
    )
    write.mockResolvedValue({ ok: true, snapshot: snap({ kind: 'settings', scope: 'user' }, 'x', 'h2') })
    mount()
    expect(await screen.findByText('unknown event (newer CLI?)')).toBeInTheDocument()
    await userEvent.click(await screen.findByRole('button', { name: 'Remove hook 1 of Stop group 1' }))
    // removal adds no executable, so there is no confirm dialog
    await userEvent.click(screen.getByRole('button', { name: /^Save$/ }))
    await waitFor(() => expect(write).toHaveBeenCalled())
    const out = JSON.parse((write.mock.calls[0]![0] as { text: string }).text) as { hooks: Record<string, unknown> }
    expect(Object.keys(out.hooks)).toEqual(['FutureEvent'])
  })

  it('shows the matcher RegExp warning', async () => {
    files.user = snap({ kind: 'settings', scope: 'user' }, withHooks({ PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'a' }] }] }))
    mount()
    fireEvent.change(await screen.findByRole('textbox', { name: /Matcher for PreToolUse group 1/ }), { target: { value: 'Bash(' } })
    expect(await screen.findByText(/not a valid regular expression/)).toBeInTheDocument()
  })

  it('blocks saving while a required field is empty', async () => {
    mount()
    const sel = await screen.findByRole('combobox', { name: 'Add event' })
    fireEvent.change(sel, { target: { value: 'Stop' } })
    expect(await screen.findByText(/command is required/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Save$/ })).toBeDisabled()
  })

  it('reports dirty state under hooks:<scope>', async () => {
    mount()
    await addPreToolUse('x')
    expect(useDirtyRegistry.getState().dirty['hooks:user']).toBe(true)
  })
})

describe('HooksPage confirm dialog', () => {
  it('Project scope needs the extra checkbox', async () => {
    files.project = snap({ kind: 'settings', scope: 'project', cwd: 'C:\\proj' }, '{}\n')
    write.mockResolvedValue({ ok: true, snapshot: snap({ kind: 'settings', scope: 'project', cwd: 'C:\\proj' }, 'x', 'h2') })
    mount('C:\\proj')
    await userEvent.click(screen.getByRole('button', { name: 'Project' }))
    await addPreToolUse('echo proj')
    await userEvent.click(screen.getByRole('button', { name: /^Save$/ }))
    const dlg = await screen.findByRole('dialog')
    const confirm = within(dlg).getByRole('button', { name: 'Save hooks' })
    expect(confirm).toBeDisabled()
    expect(within(dlg).getByText(/committed to the repository/)).toBeInTheDocument()
    await userEvent.click(within(dlg).getByRole('checkbox'))
    expect(confirm).toBeEnabled()
    await userEvent.click(confirm)
    await waitFor(() => expect(write).toHaveBeenCalledTimes(1))
    expect((write.mock.calls[0]![0] as { ref: ConfigFileRef }).ref).toEqual({ kind: 'settings', scope: 'project', cwd: 'C:\\proj' })
  })

  it('Cancel writes nothing', async () => {
    mount()
    await addPreToolUse('echo no')
    await userEvent.click(screen.getByRole('button', { name: /^Save$/ }))
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    expect(write).not.toHaveBeenCalled()
  })
})

describe('HooksPage http headers', () => {
  it('keeps a header value masked until revealed, in the editor, JSON box and Effective view', async () => {
    const hooks = { Stop: [{ hooks: [{ type: 'http', url: 'https://x.test/h', headers: { Authorization: 'Bearer SECRET-1' } }] }] }
    files.user = snap({ kind: 'settings', scope: 'user' }, withHooks(hooks))
    resolve.mockResolvedValue({
      effective: {},
      provenance: {},
      sources: [{ source: 'user', settings: { hooks } }]
    })
    mount('C:\\proj')
    const input = await screen.findByLabelText('Value of header Authorization')
    expect(input).toHaveAttribute('type', 'password')
    await userEvent.click(screen.getByRole('button', { name: 'Reveal value of header Authorization' }))
    expect(input).toHaveAttribute('type', 'text')

    // the JSON box never contains the header values
    await userEvent.click(screen.getByRole('button', { name: /Entry JSON/ }))
    const box = (await screen.findByLabelText('Entry JSON')) as HTMLTextAreaElement
    expect(box.value).not.toContain('SECRET-1')

    await userEvent.click(screen.getByRole('button', { name: 'Effective' }))
    const eff = await screen.findByTestId('hooks-effective')
    await waitFor(() => expect(within(eff).getByTestId('masked-value')).toBeInTheDocument())
    expect(eff.textContent).not.toContain('SECRET-1')
  })

  it('the confirm dialog lists the URL but not header values', async () => {
    write.mockResolvedValue({ ok: true, snapshot: snap({ kind: 'settings', scope: 'user' }, 'x', 'h2') })
    files.user = snap(
      { kind: 'settings', scope: 'user' },
      withHooks({ Stop: [{ hooks: [{ type: 'http', url: 'https://x.test/h', headers: { Authorization: 'SECRET-2' } }] }] })
    )
    mount()
    fireEvent.change(await screen.findByDisplayValue('https://x.test/h'), { target: { value: 'https://x.test/new' } })
    await userEvent.click(screen.getByRole('button', { name: /^Save$/ }))
    const dlg = await screen.findByRole('dialog')
    expect(dlg).toHaveTextContent('https://x.test/new')
    expect(dlg.textContent).not.toContain('SECRET-2')
  })
})

describe('Effective view', () => {
  it('merges user + project with source chips and shows the disableAllHooks banner', async () => {
    resolve.mockResolvedValue({
      effective: { disableAllHooks: true },
      provenance: { disableAllHooks: { source: 'project' } },
      sources: [
        { source: 'user', settings: { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'from-user' }] }] } } },
        { source: 'project', settings: { disableAllHooks: true, hooks: { Stop: [{ hooks: [{ type: 'command', command: 'from-project' }] }] } } },
        { source: 'managed', settings: { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'from-managed' }] }] } } }
      ]
    })
    mount('C:\\proj')
    expect(await screen.findByTestId('hooks-disabled-banner')).toHaveTextContent(/disableAllHooks is on/)
    await userEvent.click(screen.getByRole('button', { name: 'Effective' }))
    const sec = await screen.findByRole('region', { name: 'Effective Stop' })
    const items = within(sec).getAllByRole('listitem')
    expect(items.map((li) => li.textContent)).toEqual([
      expect.stringContaining('User'),
      expect.stringContaining('Project'),
      expect.stringContaining('Managed')
    ])
    expect(sec).toHaveTextContent('from-user')
    expect(sec).toHaveTextContent('from-project')
    expect(sec).toHaveTextContent('from-managed')
  })
})

describe('dirty scope switch', () => {
  it('asks before discarding unsaved edits', async () => {
    mount('C:\\proj')
    await addPreToolUse('x')
    await userEvent.click(screen.getByRole('button', { name: 'Project' }))
    expect(await screen.findByText('Discard unsaved changes?')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Keep editing' }))
    expect(screen.getByRole('button', { name: /^Save$/ })).toBeEnabled()
  })
})
