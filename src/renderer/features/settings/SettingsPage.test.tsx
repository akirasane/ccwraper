import { QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConfigFileRef, ConfigSnapshot, ConfigWriteResult, FsChangedPayload, ResolvedSettingsView } from '@shared/config'
import { createQueryClient } from '@/lib/query-client'
import { useFsChangedInvalidation } from '@/lib/config-queries'
import { setSettingsDirty } from './dirty-guard'
import { SettingsPage } from './SettingsPage'

// CodeMirror is mocked (WP5 owns the real mount test): a textarea with the same props.
vi.mock('@/components/editor', () => ({
  CodeEditor: (p: { value: string; onChange: (v: string) => void; ariaLabel: string; onSave?: () => void }) => (
    <textarea aria-label={p.ariaLabel} value={p.value} onChange={(e) => p.onChange(e.target.value)} />
  )
}))

function snap(ref: ConfigFileRef, text: string, hash: string | null = 'h1'): ConfigSnapshot {
  return { ref, path: `C:\\fixture\\${ref.scope}\\settings.json`, exists: hash !== null, text, hash }
}

let files: Record<string, ConfigSnapshot>
let write: ReturnType<typeof vi.fn>
let resolve: ReturnType<typeof vi.fn>
let changed: ((p: FsChangedPayload) => void) | undefined

function installApi(): void {
  write = vi.fn(async (): Promise<ConfigWriteResult> => ({ ok: false, code: 'io', message: 'unset' }))
  resolve = vi.fn(async (): Promise<ResolvedSettingsView> => ({ effective: {}, provenance: {}, sources: [] }))
  changed = undefined
  ;(window as unknown as { ccwrap: unknown }).ccwrap = {
    config: {
      read: vi.fn(async (ref: ConfigFileRef) => files[ref.scope] ?? snap(ref, '', null)),
      write,
      watchProject: vi.fn(async () => {}),
      onChanged: vi.fn((cb: (p: FsChangedPayload) => void) => {
        changed = cb
        return () => {}
      })
    },
    settings: { resolve }
  }
}

function Harness({ cwd }: { cwd?: string }) {
  useFsChangedInvalidation()
  return <SettingsPage cwd={cwd} />
}

function mount(cwd?: string) {
  const qc = createQueryClient()
  return render(
    <QueryClientProvider client={qc}>
      <Harness cwd={cwd} />
    </QueryClientProvider>
  )
}

const USER_TEXT = '{\n  "model": "opus",\n  "foo": { "bar": 1 },\n  "env": { "API_KEY": "sk-secret-123" }\n}\n'

// Full-tree renders and many simulated keystrokes: well under 5 s idle, but they approach it under parallel CPU load.
vi.setConfig({ testTimeout: 20_000 })

beforeEach(() => {
  window.localStorage.clear()
  setSettingsDirty(false)
  files = { user: snap({ kind: 'settings', scope: 'user' }, USER_TEXT) }
  installApi()
})

describe('SettingsPage form', () => {
  it('a form edit writes text that keeps unknown keys, with the base hash', async () => {
    write.mockResolvedValue({ ok: true, snapshot: snap({ kind: 'settings', scope: 'user' }, 'x', 'h2'), backupPath: 'C:\\ud\\b.bak' })
    mount()
    const model = await screen.findByRole('combobox', { name: 'Model' })
    expect(model).toHaveValue('opus')
    fireEvent.change(model, { target: { value: 'sonnet' } })
    await userEvent.click(screen.getByRole('button', { name: /^Save/ }))
    await waitFor(() => expect(write).toHaveBeenCalledTimes(1))
    const arg = write.mock.calls[0]![0] as { text: string; baseHash: string; ref: ConfigFileRef }
    expect(arg.baseHash).toBe('h1')
    expect(arg.ref).toEqual({ kind: 'settings', scope: 'user' })
    const parsed = JSON.parse(arg.text) as Record<string, unknown>
    expect(parsed.model).toBe('sonnet')
    expect(parsed.foo).toEqual({ bar: 1 })
    expect(parsed.env).toEqual({ API_KEY: 'sk-secret-123' })
    expect(Object.keys(parsed)).toEqual(['model', 'foo', 'env'])
    expect(arg.text.endsWith('\n')).toBe(true)
  })

  it('adds a permission rule and an env var through patches', async () => {
    write.mockResolvedValue({ ok: true, snapshot: snap({ kind: 'settings', scope: 'user' }, 'x', 'h2') })
    mount()
    await screen.findByRole('combobox', { name: 'Model' })
    fireEvent.change(screen.getByLabelText('New allow'), { target: { value: 'Bash(ls:*)' } })
    await userEvent.click(screen.getByRole('button', { name: 'Add allow' }))
    fireEvent.change(screen.getByLabelText('New variable name'), { target: { value: 'FOO' } })
    fireEvent.change(screen.getByLabelText('New variable value'), { target: { value: 'bar' } })
    await userEvent.click(screen.getByRole('button', { name: 'Add variable' }))
    await userEvent.click(screen.getByRole('button', { name: /^Save/ }))
    await waitFor(() => expect(write).toHaveBeenCalled())
    const parsed = JSON.parse((write.mock.calls[0]![0] as { text: string }).text) as Record<string, unknown>
    expect(parsed.permissions).toEqual({ allow: ['Bash(ls:*)'] })
    expect(parsed.env).toEqual({ API_KEY: 'sk-secret-123', FOO: 'bar' })
  })

  it('keeps env values masked until revealed', async () => {
    mount()
    await screen.findByRole('combobox', { name: 'Model' })
    expect(screen.queryByText('sk-secret-123')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Reveal value of API_KEY' }))
    expect(screen.getByText('sk-secret-123')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Hide value of API_KEY' }))
    expect(screen.queryByText('sk-secret-123')).not.toBeInTheDocument()
  })

  it('an unparsable file makes the form read-only and offers Raw', async () => {
    files = { user: snap({ kind: 'settings', scope: 'user' }, '{ // comment\n "model": "x" }') }
    mount()
    expect(await screen.findByText(/form is read-only/)).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Model' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Open Raw JSON' }))
    expect(await screen.findByLabelText('Raw settings JSON')).toBeInTheDocument()
  })
})

describe('SettingsPage raw', () => {
  it('invalid JSON blocks save', async () => {
    mount()
    await userEvent.click(await screen.findByRole('tab', { name: 'Raw JSON' }))
    const area = await screen.findByLabelText('Raw settings JSON')
    fireEvent.change(area, { target: { value: '{ "model": ' } })
    expect(screen.getByRole('alert')).toHaveTextContent(/Invalid JSON/)
    expect(screen.getByRole('button', { name: /^Save/ })).toBeDisabled()
    expect(write).not.toHaveBeenCalled()
  })

  it('valid raw text is written verbatim', async () => {
    write.mockResolvedValue({ ok: true, snapshot: snap({ kind: 'settings', scope: 'user' }, 'x', 'h2') })
    mount()
    await userEvent.click(await screen.findByRole('tab', { name: 'Raw JSON' }))
    const area = await screen.findByLabelText('Raw settings JSON')
    const text = '{"a":1,\n"model":"haiku"}'
    fireEvent.change(area, { target: { value: text } })
    await userEvent.click(screen.getByRole('button', { name: /^Save/ }))
    await waitFor(() => expect(write).toHaveBeenCalledWith({ ref: { kind: 'settings', scope: 'user' }, text, baseHash: 'h1' }))
  })
})

describe('conflicts and external changes', () => {
  it('shows a conflict banner; Overwrite resends with the new hash', async () => {
    const current = snap({ kind: 'settings', scope: 'user' }, '{"model":"theirs"}', 'h9')
    write.mockResolvedValueOnce({ ok: false, code: 'conflict', message: 'changed', current })
    mount()
    fireEvent.change(await screen.findByRole('combobox', { name: 'Model' }), { target: { value: 'mine' } })
    await userEvent.click(screen.getByRole('button', { name: /^Save/ }))
    const banner = await screen.findByTestId('conflict-banner')
    expect(write).toHaveBeenCalledTimes(1)
    write.mockResolvedValueOnce({ ok: true, snapshot: snap({ kind: 'settings', scope: 'user' }, 'x', 'h10') })
    await userEvent.click(within(banner).getByRole('button', { name: 'Overwrite' }))
    await waitFor(() => expect(write).toHaveBeenCalledTimes(2))
    const second = write.mock.calls[1]![0] as { baseHash: string; text: string }
    expect(second.baseHash).toBe('h9')
    expect(JSON.parse(second.text)).toMatchObject({ model: 'mine', foo: { bar: 1 } })
  })

  it('Reload on conflict takes the disk version', async () => {
    const current = snap({ kind: 'settings', scope: 'user' }, '{"model":"theirs"}', 'h9')
    write.mockResolvedValueOnce({ ok: false, code: 'conflict', message: 'changed', current })
    mount()
    fireEvent.change(await screen.findByRole('combobox', { name: 'Model' }), { target: { value: 'mine' } })
    await userEvent.click(screen.getByRole('button', { name: /^Save/ }))
    await userEvent.click(within(await screen.findByTestId('conflict-banner')).getByRole('button', { name: 'Reload' }))
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Model' })).toHaveValue('theirs'))
    expect(screen.queryByTestId('conflict-banner')).not.toBeInTheDocument()
  })

  it('refreshes a clean buffer on fs:changed', async () => {
    mount()
    expect(await screen.findByRole('combobox', { name: 'Model' })).toHaveValue('opus')
    files = { user: snap({ kind: 'settings', scope: 'user' }, '{"model":"haiku"}', 'h5') }
    act(() => changed?.({ kind: 'settings', scope: 'user', path: 'p' }))
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Model' })).toHaveValue('haiku'))
  })

  it('a dirty buffer is kept and shows a changed-on-disk banner on fs:changed', async () => {
    mount()
    fireEvent.change(await screen.findByRole('combobox', { name: 'Model' }), { target: { value: 'mine' } })
    files = { user: snap({ kind: 'settings', scope: 'user' }, '{"model":"haiku"}', 'h5') }
    act(() => changed?.({ kind: 'settings', scope: 'user', path: 'p' }))
    expect(await screen.findByTestId('external-banner')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Model' })).toHaveValue('mine')
    await userEvent.click(screen.getByRole('button', { name: 'Reload' }))
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Model' })).toHaveValue('haiku'))
  })
})

describe('unsaved-changes guard', () => {
  it('asks before switching scope with a dirty buffer', async () => {
    files.project = snap({ kind: 'settings', scope: 'project', cwd: 'C:\\p' }, '{"model":"proj"}', 'p1')
    mount('C:\\p')
    fireEvent.change(await screen.findByRole('combobox', { name: 'Model' }), { target: { value: 'mine' } })
    await userEvent.click(screen.getByRole('button', { name: 'Project' }))
    const dlg = await screen.findByRole('dialog')
    expect(dlg).toHaveTextContent('Discard unsaved changes?')
    await userEvent.click(within(dlg).getByRole('button', { name: 'Keep editing' }))
    expect(screen.getByRole('combobox', { name: 'Model' })).toHaveValue('mine')
    await userEvent.click(screen.getByRole('button', { name: 'Project' }))
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Discard' }))
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Model' })).toHaveValue('proj'))
  })

  it('disables Project and Local without a cwd', async () => {
    mount()
    await screen.findByRole('combobox', { name: 'Model' })
    expect(screen.getByRole('button', { name: 'Project' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Local' })).toBeDisabled()
  })
})

describe('precedence tab', () => {
  it('shows an overridden model, merged permission rules with source chips and an ignored defaultMode', async () => {
    resolve.mockResolvedValue({
      effective: { model: 'sonnet', env: { TOKEN: 'tok-abc' }, permissions: { allow: ['Bash(ls:*)', 'Read(*)'], defaultMode: 'default' } },
      provenance: { model: { source: 'project' }, env: { source: 'user' }, permissions: { source: 'project' } },
      sources: [
        { source: 'user', path: 'C:\\u\\settings.json', settings: { model: 'opus', env: { TOKEN: 'tok-abc' }, permissions: { allow: ['Bash(ls:*)'] } } },
        {
          source: 'project',
          path: 'C:\\p\\.claude\\settings.json',
          settings: { model: 'sonnet', permissions: { allow: ['Bash(ls:*)', 'Read(*)'], defaultMode: 'bypassPermissions' } }
        },
        { source: 'managed', settings: {} }
      ],
      ignoredDefaultMode: { source: 'project', mode: 'bypassPermissions' }
    } satisfies ResolvedSettingsView)
    mount('C:\\p')
    await userEvent.click(await screen.findByRole('tab', { name: 'Precedence' }))
    const row = await screen.findByTestId('prec-row-model')
    const cells = row.querySelectorAll('td')
    expect(cells[0]).toHaveAttribute('data-state', 'overridden')
    expect(cells[0]).toHaveTextContent('overridden by Project')
    expect(cells[1]).toHaveAttribute('data-state', 'wins')
    const allow = screen.getByTestId('prec-perm-allow')
    const items = within(allow).getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(items[0]).toHaveTextContent('Bash(ls:*)')
    expect(items[0]).toHaveTextContent('User')
    expect(items[0]).toHaveTextContent('Project')
    expect(items[1]).toHaveTextContent('Read(*)')
    expect(screen.getByTestId('prec-defaultMode')).toHaveTextContent('ignored (untrusted project scope)')
    expect(screen.getByText('Managed', { selector: 'th *, th' })).toBeInTheDocument()
    expect(screen.getAllByText(/read-only/).length).toBeGreaterThan(0)
    expect(screen.queryByText('tok-abc')).not.toBeInTheDocument()
    expect(resolve).toHaveBeenCalledWith({ cwd: 'C:\\p' })
  })
})
