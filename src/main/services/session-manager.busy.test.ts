import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionEvent } from '../../shared/events'
import type { AdapterSession } from './sdk-adapter'
import { SessionManager } from './session-manager'

function fakeAdapter(): AdapterSession {
  return {
    send: vi.fn(),
    interrupt: vi.fn(async () => {}),
    setModel: vi.fn(async () => {}),
    setPermissionMode: vi.fn(async () => {}),
    supportedModels: vi.fn(async () => []),
    stopTask: vi.fn(async () => {}),
    rewindFiles: vi.fn(async () => ({ canRewind: true })),
    replyPermission: vi.fn(),
    done: new Promise<void>(() => {}),
    close: vi.fn()
  }
}

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ccwrap-busy-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

/** A manager whose adapters we can drive: `fire(localId, e)` pushes an event through the real onEvent path. */
async function setup(): Promise<{ m: SessionManager; start: () => Promise<string>; fire: (id: string, e: SessionEvent) => void }> {
  const handlers = new Map<string, (e: SessionEvent) => void>()
  let pending: ((e: SessionEvent) => void) | undefined
  const startSession = vi.fn(async (o: { onEvent: (e: SessionEvent) => void }) => {
    pending = o.onEvent
    return fakeAdapter()
  })
  const m = new SessionManager(() => {}, { startSession: startSession as never })
  const start = async (): Promise<string> => {
    const { localId } = await m.start({ cwd: dir, prompt: 'hi' })
    handlers.set(localId, pending!)
    return localId
  }
  return { m, start, fire: (id, e) => handlers.get(id)!(e) }
}

const task = (taskId: string, extra: Record<string, unknown> = {}): SessionEvent =>
  ({ t: 'task_started', taskId, description: 'secret work', ...extra }) as SessionEvent

describe('SessionManager.info', () => {
  it('returns cwd, then the sdk session id once init arrives; undefined for unknown ids', async () => {
    const { m, start, fire } = await setup()
    const id = await start()
    expect(m.info(id)).toEqual({ cwd: dir })
    fire(id, { t: 'init', sessionId: 'sdk-1', model: 'm', tools: [], mcp: [], slashCommands: [], cwd: dir })
    expect(m.info(id)).toEqual({ cwd: dir, sdkSessionId: 'sdk-1' })
    expect(m.info('nope')).toBeUndefined()
    m.close(id)
    expect(m.info(id)).toBeUndefined()
  })
})

describe('SessionManager.busyCount', () => {
  it('is 0 for no sessions and for an idle session', async () => {
    const { m, start, fire } = await setup()
    expect(m.busyCount()).toBe(0)
    const id = await start()
    expect(m.busyCount()).toBe(0)
    fire(id, { t: 'status', state: 'idle' })
    expect(m.busyCount()).toBe(0)
  })

  it('counts running and waiting_permission, not idle or error', async () => {
    const { m, start, fire } = await setup()
    const a = await start()
    const b = await start()
    fire(a, { t: 'status', state: 'running' })
    expect(m.busyCount()).toBe(1)
    fire(b, { t: 'status', state: 'waiting_permission' })
    expect(m.busyCount()).toBe(2)
    fire(a, { t: 'status', state: 'idle' })
    expect(m.busyCount()).toBe(1)
    fire(b, { t: 'status', state: 'error' })
    expect(m.busyCount()).toBe(0)
  })

  it('a background task keeps the session busy after the turn ended, until task_ended', async () => {
    const { m, start, fire } = await setup()
    const id = await start()
    fire(id, { t: 'status', state: 'running' })
    fire(id, task('t1', { background: true }))
    fire(id, {
      t: 'result',
      costUsd: 0,
      durationMs: 1,
      turns: 1,
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 },
      isError: false
    })
    fire(id, { t: 'status', state: 'idle' })
    expect(m.busyCount()).toBe(1)
    fire(id, { t: 'task_ended', taskId: 't1', status: 'completed' })
    expect(m.busyCount()).toBe(0)
  })

  it('ignores hidden tasks', async () => {
    const { m, start, fire } = await setup()
    const id = await start()
    fire(id, task('h1', { hidden: true }))
    expect(m.busyCount()).toBe(0)
  })

  it('a terminal task_updated clears the task', async () => {
    const { m, start, fire } = await setup()
    const id = await start()
    fire(id, task('t1'))
    expect(m.busyCount()).toBe(1)
    fire(id, { t: 'task_updated', taskId: 't1', status: 'running' })
    expect(m.busyCount()).toBe(1)
    fire(id, { t: 'task_updated', taskId: 't1', status: 'killed' })
    expect(m.busyCount()).toBe(0)
  })

  it('session_closed clears tasks and status; a closed session no longer counts', async () => {
    const { m, start, fire } = await setup()
    const a = await start()
    const b = await start()
    fire(a, { t: 'status', state: 'running' })
    fire(a, task('t1'))
    fire(b, task('t2'))
    expect(m.busyCount()).toBe(2)
    fire(a, { t: 'session_closed' })
    expect(m.busyCount()).toBe(1)
    m.close(b)
    expect(m.busyCount()).toBe(0)
  })

  it('counts a session once even with a running turn and several tasks', async () => {
    const { m, start, fire } = await setup()
    const id = await start()
    fire(id, { t: 'status', state: 'running' })
    fire(id, task('t1'))
    fire(id, task('t2'))
    expect(m.busyCount()).toBe(1)
  })
})
