import { QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConfigFileRef, ConfigItemList, ConfigItemSummary, ConfigSnapshot, ConfigWriteResult, ItemKind, ItemMutationResult } from '@shared/config'
import { createQueryClient } from '@/lib/query-client'
import { refKey } from '@/lib/config-queries'
import { useDirtyRegistry } from '@/stores/dirty-registry'
import { AgentsPage } from './AgentsPage'
import { SkillsPage } from './SkillsPage'
import { item } from './item-fixtures'

// CodeMirror is mocked: a textarea with the same props. Diagnostics are exposed as data attributes.
vi.mock('@/components/editor', () => ({
  CodeEditor: (p: { value: string; onChange: (v: string) => void; ariaLabel: string; readOnly?: boolean; diagnostics?: Array<{ message: string }> }) => (
    <textarea aria-label={p.ariaLabel} value={p.value} readOnly={p.readOnly} data-diag={(p.diagnostics ?? []).map((d) => d.message).join('|')} onChange={(e) => p.onChange(e.target.value)} />
  )
}))

const CWD = 'C:\\proj'
const SKILL_TEXT = '---\n# keep me\nname: alpha\ndescription: old\ncustom-key: 1\n---\n\nBody here\n'

let lists: Record<ItemKind, ConfigItemSummary[]>
let files: Record<string, ConfigSnapshot>
let write: ReturnType<typeof vi.fn>
let create: ReturnType<typeof vi.fn>
let rename: ReturnType<typeof vi.fn>
let del: ReturnType<typeof vi.fn>

function snap(ref: ConfigFileRef, text: string, hash = 'h1'): ConfigSnapshot {
  return { ref, path: `C:\\fx\\${refKey(ref)}.md`, exists: true, text, hash }
}

function install(): void {
  write = vi.fn(async (): Promise<ConfigWriteResult> => ({ ok: false, code: 'io', message: 'unset' }))
  create = vi.fn(async (a: { name: string }): Promise<ItemMutationResult> => ({ ok: true, ref: { kind: 'skill', scope: 'user', name: a.name } }))
  rename = vi.fn(async (): Promise<ItemMutationResult> => ({ ok: true, ref: { kind: 'skill', scope: 'user', name: 'beta' } }))
  del = vi.fn(async (): Promise<ItemMutationResult> => ({ ok: true, ref: { kind: 'skill', scope: 'user', name: 'alpha' }, trashPath: 'C:\\ud\\trash\\alpha' }))
  ;(window as unknown as { ccwrap: unknown }).ccwrap = {
    app: { info: vi.fn(async () => ({ claudeSource: 'bundled', sdkVersion: 'x', platform: 'win32', trashDir: 'C:\\ud\\trash' })) },
    items: {
      list: vi.fn(
        async ({ kind }: { kind: ItemKind }): Promise<ConfigItemList> => ({
          kind,
          items: lists[kind],
          roots: [
            { scope: 'user', path: 'C:\\u\\.claude\\skills', exists: true },
            { scope: 'project', path: `${CWD}\\.claude\\skills`, exists: false }
          ],
          pluginsKnown: true
        })
      ),
      create,
      rename,
      delete: del
    },
    config: {
      read: vi.fn(async (ref: ConfigFileRef) => files[refKey(ref)] ?? snap(ref, SKILL_TEXT)),
      write,
      onChanged: vi.fn(() => () => {})
    }
  }
}

function mount(ui: React.ReactElement) {
  return render(<QueryClientProvider client={createQueryClient()}>{ui}</QueryClientProvider>)
}

async function open(name: string) {
  await userEvent.click(await screen.findByText(name))
}

beforeEach(() => {
  window.localStorage.clear()
  useDirtyRegistry.setState({ dirty: {}, pending: null })
  lists = {
    skill: [item('skill', 'user', 'alpha', { description: 'old' })],
    command: [],
    agent: []
  }
  files = {}
  install()
})

describe('list', () => {
  it('groups by scope and shows shadow / plugin chips', async () => {
    lists.skill = [
      item('skill', 'project', 'dup'),
      item('skill', 'user', 'dup'),
      item('skill', 'plugin', 'plug', { plugin: 'pl' })
    ]
    mount(<SkillsPage cwd={CWD} />)
    await screen.findByText('Plugin: pl')
    expect(screen.getByRole('region', { name: 'skill list' })).toBeTruthy()
    expect(screen.getByText('Overrides project')).toBeTruthy()
    expect(screen.getByText('Shadowed by user')).toBeTruthy()
    expect(screen.getByText('Plugin (read-only)')).toBeTruthy()
    expect(screen.getByText(/folder does not exist yet/)).toBeTruthy()
  })

  it('a command shadowed by a skill of the same name', async () => {
    lists.skill = [item('skill', 'user', 'deploy')]
    lists.command = [item('command', 'user', 'deploy')]
    mount(<SkillsPage cwd={CWD} />)
    await userEvent.click(await screen.findByRole('tab', { name: 'Commands' }))
    expect(await screen.findByText('Shadowed by skill')).toBeTruthy()
  })

  it('an agent list renders on the Agents page', async () => {
    lists.agent = [item('agent', 'project', 'reviewer')]
    mount(<AgentsPage cwd={CWD} />)
    expect(await screen.findByText('reviewer')).toBeTruthy()
  })
})

describe('editor', () => {
  it('a Form edit of description keeps other keys, comments and the body', async () => {
    write.mockResolvedValue({ ok: true, snapshot: snap({ kind: 'skill', scope: 'user', name: 'alpha' }, 'x', 'h2') })
    mount(<SkillsPage cwd={CWD} />)
    await open('alpha')
    const desc = await screen.findByLabelText('Description')
    fireEvent.change(desc, { target: { value: 'fresh' } })
    await userEvent.click(screen.getByRole('button', { name: /^Save/ }))
    await waitFor(() => expect(write).toHaveBeenCalledTimes(1))
    const arg = write.mock.calls[0]![0] as { text: string; baseHash: string }
    expect(arg.baseHash).toBe('h1')
    expect(arg.text).toContain('description: fresh')
    expect(arg.text).toContain('# keep me')
    expect(arg.text).toContain('custom-key: 1')
    expect(arg.text.endsWith('\n\nBody here\n')).toBe(true)
  })

  it('a conflict banner Overwrite resends with the new hash', async () => {
    const ref: ConfigFileRef = { kind: 'skill', scope: 'user', name: 'alpha' }
    write.mockResolvedValueOnce({ ok: false, code: 'conflict', message: 'changed', current: snap(ref, SKILL_TEXT, 'h9') })
    mount(<SkillsPage cwd={CWD} />)
    await open('alpha')
    fireEvent.change(await screen.findByLabelText('Description'), { target: { value: 'mine' } })
    await userEvent.click(screen.getByRole('button', { name: /^Save/ }))
    const banner = await screen.findByTestId('conflict-banner')
    write.mockResolvedValueOnce({ ok: true, snapshot: snap(ref, 'x', 'h10') })
    await userEvent.click(within(banner).getByRole('button', { name: 'Overwrite' }))
    await waitFor(() => expect(write).toHaveBeenCalledTimes(2))
    expect((write.mock.calls[1]![0] as { baseHash: string }).baseHash).toBe('h9')
  })

  it('broken frontmatter: Form read-only, Raw shows the diagnostic, Save blocked', async () => {
    files[refKey({ kind: 'skill', scope: 'user', name: 'alpha' })] = snap({ kind: 'skill', scope: 'user', name: 'alpha' }, '---\nname: alpha\ndescription: x\nbody without a close\n')
    mount(<SkillsPage cwd={CWD} />)
    await open('alpha')
    expect(await screen.findByLabelText('Description')).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Open Raw' }))
    const raw = await screen.findByLabelText('alpha raw text')
    expect((raw as HTMLElement).getAttribute('data-diag')).not.toBe('')
    expect(within(screen.getByTestId('item-issues')).getAllByText(/^Error:/).length).toBeGreaterThan(0)
    fireEvent.change(raw, { target: { value: '---\nname: alpha\ndescription: x\nzzz\n' } })
    expect(screen.getByRole('button', { name: /^Save/ })).toBeDisabled()
  })

  it('lenient frontmatter: warning chip instead of Broken, Quote values makes the buffer strict and dirty', async () => {
    const ref: ConfigFileRef = { kind: 'skill', scope: 'user', name: 'alpha' }
    lists.skill = [item('skill', 'user', 'alpha', { warning: 'Non-strict YAML (the CLI accepts it)' })]
    files[refKey(ref)] = snap(ref, '---\nname: alpha\ndescription: Use this agent: when x\n---\nBody\n')
    mount(<SkillsPage cwd={CWD} />)
    expect(await screen.findByText('Non-strict YAML (the CLI accepts it)')).toBeInTheDocument()
    expect(screen.queryByText('Broken frontmatter')).toBeNull()
    await open('alpha')
    expect(await screen.findByLabelText('Description')).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Quote values (1)' }))
    await waitFor(() => expect(screen.getByLabelText('Description')).toBeEnabled())
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument()
    expect(screen.getByLabelText('Description')).toHaveValue('Use this agent: when x')
    expect(screen.getByRole('button', { name: /^Save/ })).toBeEnabled()
  })

  it('a plugin item has no Save / Rename / Delete', async () => {
    lists.skill = [item('skill', 'plugin', 'plug', { plugin: 'pl' })]
    mount(<SkillsPage cwd={CWD} />)
    await open('plug')
    expect(await screen.findByLabelText('Description')).toBeDisabled()
    expect(screen.queryByRole('button', { name: /^Save/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Rename/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Delete/ })).toBeNull()
  })

  it('switching items while dirty asks first', async () => {
    lists.skill = [item('skill', 'user', 'alpha'), item('skill', 'user', 'gamma')]
    mount(<SkillsPage cwd={CWD} />)
    await open('alpha')
    fireEvent.change(await screen.findByLabelText('Description'), { target: { value: 'dirty' } })
    await waitFor(() => expect(Object.keys(useDirtyRegistry.getState().dirty).length).toBe(1))
    await userEvent.click(screen.getByText('gamma'))
    expect(useDirtyRegistry.getState().pending).not.toBeNull()
    expect(screen.getByTestId('item-path').textContent).toContain('alpha')
    useDirtyRegistry.getState().confirm()
    await waitFor(() => expect(screen.getByTestId('item-path').textContent).toContain('gamma'))
  })
})

describe('dialogs', () => {
  it('New: an invalid name disables Create, a valid one sends the template', async () => {
    mount(<SkillsPage cwd={CWD} />)
    await userEvent.click(await screen.findByRole('button', { name: /New/ }))
    const dlg = await screen.findByRole('dialog')
    const name = within(dlg).getByLabelText('Name')
    const submit = within(dlg).getByRole('button', { name: 'Create' })
    expect(submit).toBeDisabled()
    await userEvent.type(name, 'Bad Name')
    expect(submit).toBeDisabled()
    expect(within(dlg).getByText(/lowercase letters/i)).toBeTruthy()
    await userEvent.clear(name)
    await userEvent.type(name, 'good-name')
    expect(submit).toBeEnabled()
    await userEvent.click(submit)
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    const arg = create.mock.calls[0]![0] as { kind: string; scope: string; cwd?: string; name: string; text: string }
    expect(arg).toMatchObject({ kind: 'skill', scope: 'project', cwd: CWD, name: 'good-name' })
    expect(arg.text).toContain('name: good-name')
  })

  it('Rename sends newName and the patched frontmatter name', async () => {
    mount(<SkillsPage cwd={CWD} />)
    await open('alpha')
    await screen.findByLabelText('Description')
    await userEvent.click(screen.getByRole('button', { name: /Rename/ }))
    const dlg = await screen.findByRole('dialog')
    const input = within(dlg).getByLabelText('New name')
    await userEvent.clear(input)
    await userEvent.type(input, 'beta')
    await userEvent.click(within(dlg).getByRole('button', { name: 'Rename' }))
    await waitFor(() => expect(rename).toHaveBeenCalledTimes(1))
    const arg = rename.mock.calls[0]![0] as { newName: string; baseHash: string; text: string }
    expect(arg.newName).toBe('beta')
    expect(arg.baseHash).toBe('h1')
    expect(arg.text).toContain('name: beta')
    expect(arg.text).toContain('# keep me')
  })

  it('Delete asks first, then calls items.delete', async () => {
    mount(<SkillsPage cwd={CWD} />)
    await open('alpha')
    await screen.findByLabelText('Description')
    await userEvent.click(screen.getByRole('button', { name: /Delete/ }))
    const dlg = await screen.findByRole('dialog')
    expect(del).not.toHaveBeenCalled()
    expect(within(dlg).getByText(/ccwraper trash/)).toBeTruthy()
    await waitFor(() => expect(within(dlg).getByText(/C:\\ud\\trash/)).toBeTruthy())
    await userEvent.click(within(dlg).getByRole('button', { name: 'Move to trash' }))
    await waitFor(() => expect(del).toHaveBeenCalledTimes(1))
    expect((del.mock.calls[0]![0] as { baseHash: string }).baseHash).toBe('h1')
  })
})
