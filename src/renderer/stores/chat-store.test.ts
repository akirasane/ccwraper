import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CcwrapApi, SessionEventPayload } from '@shared/ipc'
import { eventFixtures as fx } from '@/features/chat/model/fixtures'
import { initIpcBridge } from '@/lib/ipc-bridge'
import { flushChatEvents, useChatStore } from './chat-store'

type Session = CcwrapApi['session']
let listener: ((p: SessionEventPayload) => void) | undefined
let session: { [K in keyof Session]: ReturnType<typeof vi.fn> }

beforeEach(() => {
  listener = undefined
  session = {
    start: vi.fn(async () => ({ localId: 'L1' })),
    send: vi.fn(async () => {}),
    interrupt: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    setModel: vi.fn(async () => {}),
    setPermissionMode: vi.fn(async () => {}),
    permissionReply: vi.fn(async () => {}),
    onEvent: vi.fn((cb: (p: SessionEventPayload) => void) => {
      listener = cb
      return () => {
        listener = undefined
      }
    })
  }
  ;(globalThis as unknown as { window: { ccwrap: unknown } }).window.ccwrap = { session }
  useChatStore.setState({ convs: {}, localToConv: {}, modes: {} })
})

afterEach(() => {
  vi.restoreAllMocks()
})

const conv = (): NonNullable<ReturnType<typeof useChatStore.getState>['convs'][string]> =>
  useChatStore.getState().convs['c1']!

describe('chat-store', () => {
  it('submit on unbound conv starts a session with resume id and binds localId', async () => {
    const st = useChatStore.getState()
    st.createConv({ convId: 'c1', cwd: 'C:\\fixture\\proj', resumeSessionId: 'old' })
    await st.submit('c1', 'hello')
    expect(session.start).toHaveBeenCalledWith({ cwd: 'C:\\fixture\\proj', prompt: 'hello', resumeId: 'old' })
    expect(conv().localId).toBe('L1')
    expect(conv().items[0]).toMatchObject({ kind: 'user', text: 'hello' })
    expect(conv().status).toBe('running')
    await useChatStore.getState().submit('c1', 'again')
    expect(session.send).toHaveBeenCalledWith({ localId: 'L1', text: 'again' })
  })

  it('events arriving before bind are buffered and replayed in order', async () => {
    session.start.mockImplementation(async () => {
      // events emitted before start() resolves
      useChatStore.getState().applyEvent('L1', { t: 'text_delta', msgId: 'm', text: 'a' })
      useChatStore.getState().applyEvent('L1', { t: 'status', state: 'running' })
      return { localId: 'L1' }
    })
    useChatStore.getState().createConv({ convId: 'c1', cwd: 'x' })
    await useChatStore.getState().submit('c1', 'go')
    const a = conv().items.find((i) => i.kind === 'assistant')
    expect(a).toMatchObject({ parts: [{ kind: 'text', text: 'a' }] })
  })

  it('bridge routes events; deltas coalesce to one update per frame', async () => {
    vi.useFakeTimers()
    try {
      useChatStore.getState().createConv({ convId: 'c1', cwd: 'x', localId: 'L1' })
      initIpcBridge()
      expect(session.onEvent).toHaveBeenCalledTimes(1)
      initIpcBridge()
      expect(session.onEvent).toHaveBeenCalledTimes(1)
      let updates = 0
      const unsub = useChatStore.subscribe(() => updates++)
      for (const ch of ['a', 'b', 'c', 'd']) listener!({ localId: 'L1', event: { t: 'text_delta', msgId: 'm', text: ch } })
      expect(updates).toBe(0)
      await vi.advanceTimersByTimeAsync(40)
      expect(updates).toBe(1)
      expect(conv().items[0]).toMatchObject({ parts: [{ kind: 'text', text: 'abcd' }] })
      // non-delta flushes queued deltas first, preserving order
      listener!({ localId: 'L1', event: { t: 'text_delta', msgId: 'm2', text: 'z' } })
      listener!({ localId: 'L1', event: { t: 'assistant_message', msgId: 'm2', blocks: [{ type: 'text', text: 'Z' }] } })
      expect(conv().items.at(-1)).toMatchObject({ streaming: false, parts: [{ text: 'Z' }] })
      unsub()
    } finally {
      vi.useRealTimers()
    }
  })

  it('fixture playthrough via applyEvent ends idle with cost', () => {
    useChatStore.getState().createConv({ convId: 'c1', cwd: 'x', localId: 'L1' })
    for (const event of fx.toolEditTurn) useChatStore.getState().applyEvent('L1', event)
    flushChatEvents()
    expect(conv().status).toBe('idle')
    expect(conv().tools['tu1']!.status).toBe('done')
  })

  it('seedFromHistory, interrupt, permission reply, permission mode', async () => {
    const st = useChatStore.getState()
    st.createConv({ convId: 'c1', cwd: 'x', localId: 'L1' })
    st.seedFromHistory('c1', fx.historyReplay)
    expect(conv().items).toHaveLength(6)
    await st.interrupt('c1')
    expect(session.interrupt).toHaveBeenCalledWith('L1')
    for (const e of fx.permissionFlow.slice(0, fx.permissionFlow.findIndex((x) => x.t === 'permission_request') + 1))
      st.applyEvent('L1', e)
    await useChatStore.getState().replyPermission('c1', 'r1', 'allow', 'always')
    expect(session.permissionReply).toHaveBeenCalledWith({ localId: 'L1', reqId: 'r1', decision: 'allow', remember: 'always' })
    expect(conv().pending).toHaveLength(0)
    await useChatStore.getState().setPermissionMode('c1', 'plan')
    expect(session.setPermissionMode).toHaveBeenCalledWith('L1', 'plan')
    expect(conv().meta.permissionMode).toBe('plan')
  })

  it('ipc failure becomes an inline error item', async () => {
    session.start.mockRejectedValue(new Error('Working directory not found: x'))
    useChatStore.getState().createConv({ convId: 'c1', cwd: 'x' })
    await useChatStore.getState().submit('c1', 'hi')
    expect(conv().items.at(-1)).toMatchObject({ kind: 'error', message: 'Working directory not found: x' })
    expect(conv().status).toBe('error')
  })
})
