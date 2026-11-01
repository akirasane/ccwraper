import { render, screen, waitFor, within, fireEvent, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionEvent, SlashCommandInfo } from '@shared/events'
import { useChatStore } from '@/stores/chat-store'
import { Composer } from './Composer'
import { filterCommands, slashQuery } from './slash-commands'

const target = { convId: 'c1', cwd: 'C:\\fixture\\proj' }

beforeAll(() => {
  HTMLElement.prototype.scrollIntoView = () => {}
  class RO {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  vi.stubGlobal('ResizeObserver', RO)
})

const api = {
  session: {
    start: vi.fn().mockResolvedValue({ localId: 'L1' }),
    send: vi.fn().mockResolvedValue(undefined),
    interrupt: vi.fn().mockResolvedValue(undefined),
    setPermissionMode: vi.fn().mockResolvedValue(undefined),
    setModel: vi.fn().mockResolvedValue(undefined),
    supportedModels: vi.fn().mockResolvedValue([]),
    permissionReply: vi.fn().mockResolvedValue(undefined)
  },
  history: { listProjects: vi.fn().mockResolvedValue([]) }
}

const COMMANDS: SlashCommandInfo[] = [
  { name: 'compact', description: 'Summarize the conversation', argumentHint: '[instructions]', builtin: true },
  { name: 'usage', description: 'Plan usage', argumentHint: '', aliases: ['cost', 'stats'], builtin: true },
  { name: 'review', description: 'Review a PR', argumentHint: '[pr]', builtin: true },
  { name: 'my-plugin:deploy', description: 'Deploy it', argumentHint: '<env>' }
]

function seedLive(commands?: SlashCommandInfo[], extra: SessionEvent[] = []): void {
  useChatStore.getState().createConv({ ...target, localId: 'L1' })
  const events: SessionEvent[] = [...extra]
  if (commands) events.push({ t: 'commands', commands })
  useChatStore.getState().seedFromHistory(target.convId, events)
}

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
  useChatStore.setState({ convs: {}, localToConv: {}, modes: {}, draftModels: {}, drafts: {}, draftImages: {} })
  ;(window as unknown as { ccwrap: unknown }).ccwrap = api
})

const box = (): HTMLTextAreaElement => screen.getByLabelText('Message') as HTMLTextAreaElement
const options = (): string[] => screen.queryAllByRole('option').map((o) => o.textContent ?? '')

describe('slash helpers', () => {
  it('slashQuery only inside the first token', () => {
    expect(slashQuery('/co', 3)).toBe('co')
    expect(slashQuery('/co ', 4)).toBeNull()
    expect(slashQuery('/co arg', 2)).toBe('co')
    expect(slashQuery('hi /co', 6)).toBeNull()
    expect(slashQuery('/', 1)).toBe('')
    expect(slashQuery('/', 0)).toBeNull()
  })
  it('filterCommands matches aliases and dedupes names', () => {
    expect(filterCommands(COMMANDS, 'cost').map((c) => c.name)).toEqual(['usage'])
    expect(filterCommands([...COMMANDS, COMMANDS[0]!], '').length).toBe(COMMANDS.length)
  })
})

describe('slash popup', () => {
  it('opens on "/" with listbox semantics, filters as you type, closes on space', async () => {
    seedLive(COMMANDS)
    render(<Composer convId="c1" />)
    expect(screen.queryByRole('listbox')).toBeNull()
    await userEvent.type(box(), '/')
    const lb = await screen.findByRole('listbox')
    expect(within(lb).getAllByRole('option')).toHaveLength(4)
    expect(screen.getAllByText('built-in').length).toBe(3)
    expect(screen.getByText('plugin')).toBeInTheDocument()
    expect(screen.getByText('[instructions]')).toBeInTheDocument()
    await userEvent.type(box(), 'comp')
    expect(options()).toHaveLength(1)
    expect(options()[0]).toContain('/compact')
    await userEvent.type(box(), ' ')
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('does not open when the text does not start with "/"', async () => {
    seedLive(COMMANDS)
    render(<Composer convId="c1" />)
    await userEvent.type(box(), 'a /')
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('Up/Down move aria-activedescendant; Tab and Enter insert "/name " without sending', async () => {
    seedLive(COMMANDS)
    render(<Composer convId="c1" />)
    await userEvent.type(box(), '/')
    const first = screen.getAllByRole('option')[0]!
    expect(box()).toHaveAttribute('aria-activedescendant', first.id)
    await userEvent.keyboard('{ArrowDown}')
    const second = screen.getAllByRole('option')[1]!
    expect(box()).toHaveAttribute('aria-activedescendant', second.id)
    expect(second).toHaveAttribute('aria-selected', 'true')
    await userEvent.keyboard('{ArrowUp}{ArrowUp}')
    expect(box()).toHaveAttribute('aria-activedescendant', screen.getAllByRole('option')[3]!.id)
    await userEvent.keyboard('{Tab}')
    expect(box()).toHaveValue('/my-plugin:deploy ')
    expect(screen.queryByRole('listbox')).toBeNull()

    await userEvent.clear(box())
    await userEvent.type(box(), '/rev{Enter}')
    expect(box()).toHaveValue('/review ')
    expect(api.session.send).not.toHaveBeenCalled()
    expect(api.session.start).not.toHaveBeenCalled()
  })

  it('Esc closes only the popup and does not interrupt a running turn', async () => {
    seedLive(COMMANDS, [{ t: 'status', state: 'running' }])
    render(<Composer convId="c1" />)
    await userEvent.type(box(), '/c')
    expect(await screen.findByRole('listbox')).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(api.session.interrupt).not.toHaveBeenCalled()
    expect(box()).toHaveValue('/c')
    // The next Esc (popup already closed) interrupts as before.
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(api.session.interrupt).toHaveBeenCalledWith('L1'))
  })

  it('mouse click inserts the command', async () => {
    seedLive(COMMANDS)
    render(<Composer convId="c1" />)
    await userEvent.type(box(), '/')
    await userEvent.click(screen.getByRole('option', { name: /\/compact/ }))
    expect(box()).toHaveValue('/compact ')
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(api.session.send).not.toHaveBeenCalled()
  })

  it('a fully typed "/compact" + Enter sends the plain prompt string; the user bubble keeps it', async () => {
    seedLive(COMMANDS)
    render(<Composer convId="c1" />)
    await userEvent.type(box(), '/compact{Enter}')
    await waitFor(() => expect(api.session.send).toHaveBeenCalledWith({ localId: 'L1', text: '/compact' }))
    const items = useChatStore.getState().convs.c1!.items
    expect(items.some((i) => i.kind === 'user' && i.text === '/compact')).toBe(true)
  })

  it('inserted "/compact " then Enter sends "/compact" (trimmed), nothing else added', async () => {
    seedLive(COMMANDS)
    render(<Composer convId="c1" />)
    await userEvent.type(box(), '/comp{Tab}{Enter}')
    await waitFor(() => expect(api.session.send).toHaveBeenCalledWith({ localId: 'L1', text: '/compact' }))
  })

  it('Enter still sends normal text; no popup flicker', async () => {
    seedLive(COMMANDS)
    render(<Composer convId="c1" />)
    await userEvent.type(box(), 'hello{Enter}')
    await waitFor(() => expect(api.session.send).toHaveBeenCalledWith({ localId: 'L1', text: 'hello' }))
  })

  it('before the session has commands: static fallback with a note', async () => {
    useChatStore.getState().createConv(target)
    render(<Composer convId="c1" />)
    await userEvent.type(box(), '/')
    expect(await screen.findByRole('listbox')).toBeInTheDocument()
    expect(options().some((o) => o.includes('/compact'))).toBe(true)
    expect(screen.getByText(/Full list loads after the session starts/)).toBeInTheDocument()
  })

  it('falls back to init names (no descriptions) when the full list never arrived', async () => {
    seedLive(undefined, [
      { t: 'init', sessionId: 's', model: 'm', tools: [], mcp: [], slashCommands: ['foo', 'bar'], cwd: target.cwd }
    ])
    render(<Composer convId="c1" />)
    await userEvent.type(box(), '/')
    expect(options()).toHaveLength(2)
    expect(screen.queryByText(/Full list loads/)).toBeNull()
  })

  it('updates when a commands event arrives mid-session', async () => {
    seedLive(COMMANDS)
    render(<Composer convId="c1" />)
    await userEvent.type(box(), '/')
    act(() =>
      useChatStore.getState().applyEvent('L1', {
        t: 'commands',
        commands: [{ name: 'newskill', description: 'fresh', argumentHint: '' }]
      })
    )
    await waitFor(() => expect(options()).toHaveLength(1))
    expect(options()[0]).toContain('/newskill')
  })
})

describe('image attachments', () => {
  const png = (): File => new File([new Uint8Array([1, 2, 3])], 'shot.png', { type: 'image/png' })

  it('attaches via the file input, shows a thumbnail, sends with images, then clears', async () => {
    seedLive()
    render(<Composer convId="c1" />)
    fireEvent.change(screen.getByTestId('composer-file-input'), { target: { files: [png()] } })
    await waitFor(() => expect(screen.getByTestId('composer-images').querySelectorAll('img').length).toBe(1))
    // images alone are enough to send
    await userEvent.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(api.session.send).toHaveBeenCalled())
    const arg = api.session.send.mock.calls[0]![0]
    expect(arg.text).toBe('')
    expect(arg.images).toEqual([{ mediaType: 'image/png', data: 'AQID' }])
    expect(screen.queryByTestId('composer-images')).toBeNull()
  })

  it('removes an attachment', async () => {
    seedLive()
    render(<Composer convId="c1" />)
    fireEvent.change(screen.getByTestId('composer-file-input'), { target: { files: [png()] } })
    await waitFor(() => screen.getByTestId('composer-images'))
    await userEvent.click(screen.getByRole('button', { name: 'Remove image 1' }))
    expect(screen.queryByTestId('composer-images')).toBeNull()
  })

  it('attaches an image pasted into the textarea', async () => {
    seedLive()
    render(<Composer convId="c1" />)
    fireEvent.paste(box(), { clipboardData: { files: [png()], getData: () => '' } })
    await waitFor(() => screen.getByTestId('composer-images'))
  })
})

describe('@file mention popup', () => {
  beforeEach(() => {
    ;(api as unknown as { files: unknown }).files = {
      search: vi.fn().mockResolvedValue(['src/main/index.ts', 'src/renderer/App.tsx'])
    }
  })

  it('opens on @, queries the cwd, and Enter inserts the path', async () => {
    seedLive()
    render(<Composer convId="c1" />)
    await userEvent.type(box(), 'open @src')
    await waitFor(() => expect(screen.getByTestId('mention-popup')).toBeTruthy())
    const search = (api as unknown as { files: { search: ReturnType<typeof vi.fn> } }).files.search
    expect(search).toHaveBeenLastCalledWith({ cwd: target.cwd, query: 'src', limit: 20 })
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['index.tssrc/main/', 'App.tsxsrc/renderer/'])
    await userEvent.keyboard('{ArrowDown}{Enter}')
    expect(box().value).toBe('open @src/renderer/App.tsx ')
    expect(screen.queryByTestId('mention-popup')).toBeNull()
    expect(api.session.send).not.toHaveBeenCalled()
  })

  it('Escape closes the popup without interrupting', async () => {
    seedLive()
    render(<Composer convId="c1" />)
    await userEvent.type(box(), '@s')
    await waitFor(() => screen.getByTestId('mention-popup'))
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByTestId('mention-popup')).toBeNull()
    expect(box().value).toBe('@s')
  })

  it('does not open for emails', async () => {
    seedLive()
    render(<Composer convId="c1" />)
    await userEvent.type(box(), 'mail me@host')
    await new Promise((r) => setTimeout(r, 150))
    expect(screen.queryByTestId('mention-popup')).toBeNull()
  })
})
