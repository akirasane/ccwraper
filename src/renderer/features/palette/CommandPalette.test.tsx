import { QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { rankCommands } from '@/lib/commands/registry'
import type { PaletteCommand } from '@/lib/commands/types'
import { insertIntoComposer, setComposerInserter } from '@/lib/composer-bus'
import { createQueryClient } from '@/lib/query-client'
import { useChatStore } from '@/stores/chat-store'
import { APP_VIEWS, useWorkspaceStore } from '@/stores/workspace-store'
import { CommandPalette } from './CommandPalette'
import { isPaletteShortcut } from './palette-keys'
import { usePaletteStore } from './palette-store'
import { PaletteTrigger } from './PaletteTrigger'
import { RECENT_KEY, readRecent } from './recent'
import { buildNavigationCommands } from './sources/navigation'
import { buildSlashCommands } from './sources/slash'
import { buildItemCommands } from './sources/items'

const itemsList = vi.fn()

function setup() {
  const client = createQueryClient()
  const utils = render(
    <QueryClientProvider client={client}>
      <PaletteTrigger />
      <CommandPalette />
    </QueryClientProvider>
  )
  return { client, ...utils }
}

beforeEach(() => {
  window.localStorage.clear()
  usePaletteStore.setState({ open: false })
  itemsList.mockReset()
  itemsList.mockResolvedValue({ kind: 'skill', items: [], roots: [], pluginsKnown: true })
  ;(window as unknown as { ccwrap: unknown }).ccwrap = {
    items: { list: itemsList },
    history: { list: vi.fn().mockResolvedValue([]), listProjects: vi.fn().mockResolvedValue([]) },
    config: {}
  }
  useWorkspaceStore.setState({ view: 'chat', activeConvId: undefined, cwd: undefined })
})

describe('registry', () => {
  it('every APP_VIEW has a Navigation command and running it calls setView', () => {
    const setView = vi.fn()
    useWorkspaceStore.setState({ setView })
    const cmds = buildNavigationCommands()
    for (const v of APP_VIEWS) {
      const c = cmds.find((x) => x.id === `nav:${v}`)
      expect(c, v).toBeDefined()
      expect(c!.group).toBe('Navigation')
      c!.run()
      expect(setView).toHaveBeenLastCalledWith(v)
    }
  })

  it('item commands switch to the Skills page with focusItem set', () => {
    const setView = vi.fn()
    const setFocusItem = vi.fn()
    useWorkspaceStore.setState({ setView, setFocusItem })
    const cmds = buildItemCommands({
      skill: {
        kind: 'skill',
        roots: [],
        pluginsKnown: true,
        items: [{ ref: { kind: 'skill', scope: 'user', name: 'x' }, kind: 'skill', scope: 'user', name: 'x', path: 'p', readOnly: false }]
      }
    })
    expect(cmds).toHaveLength(1)
    expect(cmds[0]!.group).toBe('Skills')
    cmds[0]!.run()
    expect(setFocusItem).toHaveBeenCalledWith({ kind: 'skill', name: 'x' })
    expect(setView).toHaveBeenCalledWith('skills')
  })

  it('a slash command inserts "/<name> " through composer-bus', () => {
    const ins = vi.fn()
    setComposerInserter(ins)
    const [c] = buildSlashCommands(['review'])
    c!.run()
    expect(ins).toHaveBeenCalledWith('/review ')
    setComposerInserter(undefined)
    expect(insertIntoComposer('x')).toBe(false)
  })

  it('empty query: Recent first, then Actions and Navigation; ids deduped', () => {
    const mk = (id: string, group: PaletteCommand['group']): PaletteCommand => ({ id, title: id, group, run: () => {} })
    const cmds = [mk('s1', 'Sessions'), mk('n1', 'Navigation'), mk('a1', 'Actions')]
    const rows = rankCommands(cmds, '', ['n1'])
    expect(rows.map((r) => [r.group, r.command.id])).toEqual([
      ['Recent', 'n1'],
      ['Actions', 'a1']
    ])
  })

  it('query: fixed group order, then score', () => {
    const mk = (id: string, title: string, group: PaletteCommand['group']): PaletteCommand => ({ id, title, group, run: () => {} })
    const rows = rankCommands(
      [mk('p', 'git project', 'Projects'), mk('a', 'git status', 'Actions'), mk('a2', 'toggle gist', 'Actions')],
      'git',
      []
    )
    expect(rows.map((r) => r.command.id)).toEqual(['a', 'a2', 'p'])
  })

  it('renders at most 50 rows', () => {
    const cmds: PaletteCommand[] = Array.from({ length: 120 }, (_, i) => ({ id: `c${i}`, title: `cmd ${i}`, group: 'Actions', run: () => {} }))
    expect(rankCommands(cmds, 'cmd', [])).toHaveLength(50)
  })
})

describe('shortcuts', () => {
  const ev = (o: Partial<KeyboardEvent>, target: EventTarget | null = document.body) =>
    ({ key: 'k', ctrlKey: true, shiftKey: false, altKey: false, metaKey: false, target, ...o }) as KeyboardEvent

  it('Ctrl+K opens, Ctrl+Shift+P opens', () => {
    expect(isPaletteShortcut(ev({}))).toBe(true)
    expect(isPaletteShortcut(ev({ key: 'P', shiftKey: true }))).toBe(true)
    expect(isPaletteShortcut(ev({ ctrlKey: false }))).toBe(false)
  })

  it('Ctrl+K inside .xterm is ignored, Ctrl+Shift+P still works', () => {
    const term = document.createElement('div')
    term.className = 'xterm'
    const inner = document.createElement('textarea')
    term.appendChild(inner)
    document.body.appendChild(term)
    expect(isPaletteShortcut(ev({}, inner))).toBe(false)
    expect(isPaletteShortcut(ev({ key: 'P', shiftKey: true }, inner))).toBe(true)
    term.remove()
  })

  it('the always-loaded listener opens the store (window keydown, capture)', () => {
    setup()
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    expect(usePaletteStore.getState().open).toBe(true)
  })

  it('Ctrl+K from a focused .xterm does not open; Ctrl+Shift+P does', () => {
    setup()
    const term = document.createElement('div')
    term.className = 'xterm'
    const ta = document.createElement('textarea')
    term.appendChild(ta)
    document.body.appendChild(term)
    fireEvent.keyDown(ta, { key: 'k', ctrlKey: true })
    expect(usePaletteStore.getState().open).toBe(false)
    fireEvent.keyDown(ta, { key: 'P', ctrlKey: true, shiftKey: true })
    expect(usePaletteStore.getState().open).toBe(true)
    term.remove()
  })

  it('the title-bar trigger opens the palette', () => {
    setup()
    fireEvent.click(screen.getByTestId('palette-trigger'))
    expect(usePaletteStore.getState().open).toBe(true)
  })
})

describe('CommandPalette UI', () => {
  async function openIt() {
    const utils = setup()
    act(() => usePaletteStore.getState().setOpen(true))
    const input = await screen.findByRole('combobox')
    return { ...utils, input }
  }

  it('has combobox / listbox / option roles and aria-activedescendant follows the selection', async () => {
    const { input } = await openIt()
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    const opts = screen.getAllByRole('option')
    expect(opts.length).toBeGreaterThan(5)
    expect(input).toHaveAttribute('aria-activedescendant', opts[0]!.id)
    expect(opts[0]).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(input).toHaveAttribute('aria-activedescendant', opts[1]!.id)
    expect(opts[1]).toHaveAttribute('aria-selected', 'true')
    expect(input).toHaveAttribute('aria-controls', screen.getByRole('listbox').id)
  })

  it('arrowing down scrolls the new row into view and moves the pill with translateY', async () => {
    const spy = vi.fn()
    Element.prototype.scrollIntoView = spy
    const { input } = await openIt()
    spy.mockClear()
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    const opts = screen.getAllByRole('option')
    expect(spy).toHaveBeenCalled()
    expect(spy.mock.instances.at(-1)).toBe(opts[1])
    expect(spy).toHaveBeenLastCalledWith({ block: 'nearest' })
    expect(screen.getByTestId('palette-pill').style.transform).toMatch(/translateY\(/)
  })

  it('Enter runs the command, closes, and records it in recents', async () => {
    const setView = vi.fn()
    useWorkspaceStore.setState({ setView })
    const { input } = await openIt()
    fireEvent.change(input, { target: { value: 'Go to Git' } })
    await waitFor(() => expect(screen.getAllByRole('option')[0]).toHaveTextContent('Go to Git'))
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(setView).toHaveBeenCalledWith('git')
    await waitFor(() => expect(usePaletteStore.getState().open).toBe(false))
    expect(readRecent()).toEqual(['nav:git'])
  })

  it('shows recents first on an empty query', async () => {
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(['nav:usage']))
    await openIt()
    expect(screen.getAllByRole('option')[0]).toHaveTextContent('Go to Usage')
  })

  it('does not run a disabled command', async () => {
    const closeTab = vi.fn()
    useWorkspaceStore.setState({ closeTab })
    const { input } = await openIt()
    fireEvent.change(input, { target: { value: 'Close tab' } })
    await waitFor(() => expect(screen.getAllByRole('option')[0]).toHaveTextContent('Close tab'))
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(closeTab).not.toHaveBeenCalled()
    expect(usePaletteStore.getState().open).toBe(true)
  })

  it('Escape closes it', async () => {
    const { input } = await openIt()
    fireEvent.keyDown(input, { key: 'Escape' })
    await waitFor(() => expect(usePaletteStore.getState().open).toBe(false))
  })

  it('lists the active conversation slash commands and inserts through the bus', async () => {
    useChatStore.getState().createConv({ convId: 'c1', cwd: 'C:\\p' })
    useChatStore.setState((s) => ({
      convs: { ...s.convs, c1: { ...s.convs.c1!, meta: { ...s.convs.c1!.meta, slashCommands: ['review'] } } }
    }))
    useWorkspaceStore.setState({ activeConvId: 'c1', cwd: 'C:\\p' })
    const ins = vi.fn()
    setComposerInserter(ins)
    const { input } = await openIt()
    fireEvent.change(input, { target: { value: '/review' } })
    await waitFor(() => expect(screen.getAllByRole('option')[0]).toHaveTextContent('/review'))
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(ins).toHaveBeenCalledWith('/review ')
    setComposerInserter(undefined)
  })
})

describe('lazy chunk', () => {
  it('AppShell imports CommandPalette only through lazy()', () => {
    const src = readFileSync(resolve(__dirname, '../../app/shell/AppShell.tsx'), 'utf8')
    expect(src).not.toMatch(/^import .*CommandPalette.* from/m)
    expect(src).toMatch(/lazy\(\(\) =>\s*import\('@\/features\/palette\/CommandPalette'\)/)
  })

  it('the always-loaded files do not import the palette UI', () => {
    for (const f of ['PaletteTrigger.tsx', 'palette-keys.ts', 'palette-store.ts']) {
      expect(readFileSync(resolve(__dirname, f), 'utf8')).not.toMatch(/from '\.\/CommandPalette'|from '\.\/sources/)
    }
  })
})

describe('input focus ring', () => {
  it('the search input suppresses the global :focus-visible ring (it was clipped by the panel)', async () => {
    setup()
    act(() => usePaletteStore.setState({ open: true }))
    const input = await screen.findByRole('combobox')
    expect(input.style.boxShadow).toBe('none')
  })
})
