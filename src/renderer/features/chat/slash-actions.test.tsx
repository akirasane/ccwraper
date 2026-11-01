import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionEvent } from '@shared/events'
import { useChatStore } from '@/stores/chat-store'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { usePaletteStore } from '../palette/palette-store'
import { Composer } from './Composer'
import { clearTranscript } from './model/reducer'

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

const box = (): HTMLTextAreaElement => screen.getByLabelText('Message') as HTMLTextAreaElement

function seed(extra: SessionEvent[] = []): void {
  useChatStore.getState().createConv({ convId: 'c1', cwd: 'C:/proj', localId: 'L1' })
  useChatStore.getState().seedFromHistory('c1', [{ t: 'user_message', text: 'old question' }, ...extra])
}

async function typeAndSend(text: string): Promise<void> {
  render(<Composer convId="c1" />)
  await userEvent.type(box(), text)
  // The popup may be open for "/x": Escape closes it so Enter sends instead of picking.
  await userEvent.keyboard('{Escape}{Enter}')
}

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
  useChatStore.setState({ convs: {}, localToConv: {}, modes: {}, draftModels: {}, drafts: {}, draftImages: {} })
  useWorkspaceStore.setState({ view: 'chat' })
  usePaletteStore.setState({ open: false })
  ;(window as unknown as { ccwrap: unknown }).ccwrap = api
})

describe('app-handled slash commands in the composer', () => {
  it('/clear empties the transcript and tells the live session', async () => {
    seed()
    expect(useChatStore.getState().convs['c1']!.items).toHaveLength(1)
    await typeAndSend('/clear')
    await waitFor(() => expect(useChatStore.getState().convs['c1']!.items).toHaveLength(0))
    expect(api.session.send).toHaveBeenCalledWith({ localId: 'L1', text: '/clear' })
    expect(box().value).toBe('')
  })

  it('/memory opens the Memory page and sends nothing', async () => {
    seed()
    await typeAndSend('/memory')
    await waitFor(() => expect(useWorkspaceStore.getState().view).toBe('memory'))
    expect(api.session.send).not.toHaveBeenCalled()
    expect(useChatStore.getState().convs['c1']!.items).toHaveLength(1)
  })

  it('/help opens the command palette', async () => {
    seed()
    await typeAndSend('/help')
    await waitFor(() => expect(usePaletteStore.getState().open).toBe(true))
    expect(api.session.send).not.toHaveBeenCalled()
  })

  it('/model opus switches the model on the live session', async () => {
    seed()
    await typeAndSend('/model opus')
    await waitFor(() => expect(api.session.setModel).toHaveBeenCalledWith('L1', 'opus'))
    expect(api.session.send).not.toHaveBeenCalled()
  })

  it('CLI-answered commands are still sent to the session', async () => {
    seed()
    await typeAndSend('/cost')
    await waitFor(() => expect(api.session.send).toHaveBeenCalledWith(expect.objectContaining({ localId: 'L1', text: '/cost' })))
    expect(useWorkspaceStore.getState().view).toBe('chat')
  })

  it('a user command named like a built-in is not intercepted', async () => {
    seed([{ t: 'commands', commands: [{ name: 'memory', description: 'mine', argumentHint: '' }] }])
    await typeAndSend('/memory')
    await waitFor(() => expect(api.session.send).toHaveBeenCalledWith(expect.objectContaining({ text: '/memory' })))
    expect(useWorkspaceStore.getState().view).toBe('chat')
  })
})

describe('clearTranscript', () => {
  it('keeps session metadata and ids, drops transcript state and the resume id', () => {
    useChatStore.getState().createConv({ convId: 'c2', cwd: 'C:/p', resumeSessionId: 'old' })
    useChatStore.getState().seedFromHistory('c2', [{ t: 'user_message', text: 'x' }])
    const before = useChatStore.getState().convs['c2']!
    const after = clearTranscript(before)
    expect(after.items).toEqual([])
    expect(after.resumeSessionId).toBeUndefined()
    expect(after.cwd).toBe('C:/p')
    expect(after.seq).toBe(before.seq)
  })
})
