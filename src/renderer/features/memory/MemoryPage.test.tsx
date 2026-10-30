import { QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConfigFileRef, ConfigSnapshot } from '@shared/config'
import { createQueryClient } from '@/lib/query-client'
import { MemoryPage } from './MemoryPage'

beforeAll(() => {
  const rect = { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) }
  Range.prototype.getBoundingClientRect = () => rect as DOMRect
  Range.prototype.getClientRects = () =>
    ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList
})

const CWD = 'C:\\fixture\\proj'
let files: Record<string, ConfigSnapshot>
const read = vi.fn()
const write = vi.fn()

function snap(ref: ConfigFileRef, text: string | null, hash: string | null): ConfigSnapshot {
  return { ref, path: `C:\\fixture\\${ref.scope}\\CLAUDE.md`, exists: text !== null, text: text ?? '', hash }
}

function setup(cwd: string | null = CWD) {
  const client = createQueryClient()
  const utils = render(
    <QueryClientProvider client={client}>
      <MemoryPage {...(cwd ? { cwd } : {})} />
    </QueryClientProvider>
  )
  return { client, ...utils }
}

// Full-tree renders and many simulated keystrokes: well under 5 s idle, but they approach it under parallel CPU load.
vi.setConfig({ testTimeout: 20_000 })

beforeEach(() => {
  read.mockReset()
  write.mockReset()
  files = {}
  read.mockImplementation(async (ref: ConfigFileRef) => files[ref.scope] ?? snap(ref, null, null))
  ;(window as unknown as { ccwrap: unknown }).ccwrap = { config: { read, write } }
})

describe('MemoryPage', () => {
  it('Create on a missing file sends baseHash null', async () => {
    write.mockImplementation(async ({ ref }: { ref: ConfigFileRef }) => ({ ok: true, snapshot: snap(ref, '', 'h0') }))
    setup()
    await userEvent.click(await screen.findByRole('button', { name: 'Create' }))
    await waitFor(() =>
      expect(write).toHaveBeenCalledWith({ ref: { kind: 'memory', scope: 'user' }, text: '', baseHash: null })
    )
    expect(await screen.findByRole('textbox', { name: /CLAUDE.md editor/ })).toBeInTheDocument()
  })

  it('shows dirty indicator and save sends the current hash', async () => {
    files.user = snap({ kind: 'memory', scope: 'user' }, '# Hi', 'h1')
    write.mockImplementation(async ({ ref, text }: { ref: ConfigFileRef; text: string }) => ({
      ok: true,
      snapshot: snap(ref, text, 'h2')
    }))
    setup()
    const box = await screen.findByRole('textbox', { name: /CLAUDE.md editor/ })
    expect(screen.queryByTestId('dirty-indicator')).toBeNull()
    const { EditorView } = await import('@codemirror/view')
    const view = EditorView.findFromDOM(box.closest('.cm-editor') as HTMLElement)!
    act(() => view.dispatch({ changes: { from: 4, insert: '!' }, userEvent: 'input.type' }))
    expect(await screen.findByTestId('dirty-indicator')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(write).toHaveBeenCalledWith({ ref: { kind: 'memory', scope: 'user' }, text: '# Hi!', baseHash: 'h1' })
    )
    await waitFor(() => expect(screen.queryByTestId('dirty-indicator')).toBeNull())
  })

  it('shows the conflict banner and Overwrite re-writes with the current hash', async () => {
    const ref: ConfigFileRef = { kind: 'memory', scope: 'user' }
    files.user = snap(ref, 'a', 'h1')
    write.mockResolvedValueOnce({ ok: false, code: 'conflict', message: 'x', current: snap(ref, 'disk', 'h9') })
    write.mockResolvedValueOnce({ ok: true, snapshot: snap(ref, 'a!', 'h10') })
    setup()
    const box = await screen.findByRole('textbox', { name: /CLAUDE.md editor/ })
    const { EditorView } = await import('@codemirror/view')
    const view = EditorView.findFromDOM(box.closest('.cm-editor') as HTMLElement)!
    act(() => view.dispatch({ changes: { from: 1, insert: '!' }, userEvent: 'input.type' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Save' }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/changed on disk/)
    await userEvent.click(within(alert).getByRole('button', { name: 'Overwrite' }))
    await waitFor(() => expect(write).toHaveBeenLastCalledWith({ ref, text: 'a!', baseHash: 'h9' }))
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
  })

  it('renders markdown in preview mode', async () => {
    files.user = snap({ kind: 'memory', scope: 'user' }, '# Title here\n\n- one', 'h1')
    setup()
    await screen.findByRole('textbox', { name: /CLAUDE.md editor/ })
    await userEvent.click(screen.getByRole('button', { name: 'Preview' }))
    const prev = screen.getByTestId('memory-preview')
    expect(within(prev).getByRole('heading', { name: 'Title here' })).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: /CLAUDE.md editor/ })).toBeNull()
  })

  it('asks before switching tabs with unsaved changes', async () => {
    files.user = snap({ kind: 'memory', scope: 'user' }, 'a', 'h1')
    files.project = snap({ kind: 'memory', scope: 'project', cwd: CWD }, 'p', 'hp')
    setup()
    const box = await screen.findByRole('textbox', { name: /CLAUDE.md editor/ })
    const { EditorView } = await import('@codemirror/view')
    const view = EditorView.findFromDOM(box.closest('.cm-editor') as HTMLElement)!
    act(() => view.dispatch({ changes: { from: 1, insert: 'x' }, userEvent: 'input.type' }))
    await screen.findByTestId('dirty-indicator')

    await userEvent.click(screen.getByRole('tab', { name: 'Project' }))
    const dlg = await screen.findByRole('dialog')
    expect(dlg).toHaveTextContent('Discard unsaved changes?')
    await userEvent.click(within(dlg).getByRole('button', { name: 'Keep editing' }))
    expect(screen.getByRole('tab', { name: 'User' })).toHaveAttribute('aria-selected', 'true')

    await userEvent.click(screen.getByRole('tab', { name: 'Project' }))
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Discard' }))
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Project' })).toHaveAttribute('aria-selected', 'true'))
    expect(read).toHaveBeenCalledWith({ kind: 'memory', scope: 'project', cwd: CWD })
  })

  it('switches tabs freely when clean, and project tabs are disabled without a cwd', async () => {
    files.user = snap({ kind: 'memory', scope: 'user' }, 'a', 'h1')
    setup(null)
    await screen.findByRole('textbox', { name: /CLAUDE.md editor/ })
    expect(screen.getByRole('tab', { name: 'Local' })).toBeDisabled()
    expect(screen.getByRole('tab', { name: 'Project .claude' })).toBeDisabled()
  })

  it('refreshes silently on an external change when clean, banners when dirty', async () => {
    const ref: ConfigFileRef = { kind: 'memory', scope: 'user' }
    files.user = snap(ref, 'one', 'h1')
    const { client } = setup()
    await screen.findByRole('textbox', { name: /CLAUDE.md editor/ })
    files.user = snap(ref, 'two', 'h2')
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['config'] })
    })
    await waitFor(() => expect(document.querySelector('.cm-content')?.textContent).toBe('two'))
    expect(screen.queryByRole('alert')).toBeNull()

    const { EditorView } = await import('@codemirror/view')
    const view = EditorView.findFromDOM(document.querySelector('.cm-editor') as HTMLElement)!
    act(() => view.dispatch({ changes: { from: 0, insert: 'x' }, userEvent: 'input.type' }))
    files.user = snap(ref, 'three', 'h3')
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['config'] })
    })
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/changed on disk/)
    fireEvent.click(within(alert).getByRole('button', { name: 'Reload' }))
    await waitFor(() => expect(document.querySelector('.cm-content')?.textContent).toBe('three'))
  })
})
