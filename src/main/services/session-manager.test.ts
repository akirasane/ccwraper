import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { SessionEvent } from '../../shared/events'
import { PluginRegistry } from './plugin-registry'
import { SessionManager } from './session-manager'
import type { AdapterSession } from './sdk-adapter'

function fakeAdapter(): AdapterSession {
  return {
    send: vi.fn(),
    interrupt: vi.fn(async () => {}),
    setModel: vi.fn(async () => {}),
    setPermissionMode: vi.fn(async () => {}),
    supportedModels: vi.fn(async () => [{ value: 'sonnet', displayName: 'Sonnet' }]),
    stopTask: vi.fn(async () => {}),
    rewindFiles: vi.fn(async () => ({ canRewind: true, filesChanged: ['a.ts'] })),
    replyPermission: vi.fn(),
    done: new Promise<void>(() => {}),
    close: vi.fn()
  }
}

describe('SessionManager live activity wiring', () => {
  it('stopTask reaches the adapter', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ccwrap-'))
    try {
      const adapter = fakeAdapter()
      const m = new SessionManager(() => {}, { startSession: vi.fn(async () => adapter) })
      const { localId } = await m.start({ cwd: dir, prompt: 'hi' })
      await m.stopTask(localId, 'task-1')
      expect(adapter.stopTask).toHaveBeenCalledWith('task-1')
      expect(() => m.stopTask('nope', 't')).toThrow(/Unknown/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('feeds the plugin registry from init and still emits the event', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ccwrap-'))
    try {
      const registry = new PluginRegistry()
      const emitted: unknown[] = []
      const startSession = vi.fn(async (o: { onEvent: (e: SessionEvent) => void }) => {
        o.onEvent({
          t: 'init',
          sessionId: 's',
          model: 'm',
          tools: [],
          mcp: [],
          slashCommands: [],
          cwd: dir,
          plugins: [{ name: 'p1', path: 'C:\\fixture\\p1', version: '1.0.0' }]
        })
        return fakeAdapter()
      })
      const m = new SessionManager((_id, e) => emitted.push(e), {
        startSession: startSession as never,
        registry
      })
      await m.start({ cwd: dir, prompt: 'hi' })
      expect(registry.get('p1')).toEqual({ name: 'p1', path: 'C:\\fixture\\p1', version: '1.0.0' })
      expect(emitted).toHaveLength(1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('SessionManager', () => {
  it('rejects a missing cwd with a friendly error and never starts the SDK', async () => {
    const startSession = vi.fn()
    const m = new SessionManager(() => {}, { startSession })
    await expect(m.start({ cwd: join(tmpdir(), 'ccwrap-does-not-exist-xyz'), prompt: 'hi' })).rejects.toThrow(
      /Working directory not found: /
    )
    expect(startSession).not.toHaveBeenCalled()
    expect(m.size).toBe(0)
  })

  it('rejects a cwd that is a file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ccwrap-'))
    const file = join(dir, 'f.txt')
    writeFileSync(file, 'x')
    try {
      const m = new SessionManager(() => {}, { startSession: vi.fn() })
      await expect(m.start({ cwd: file, prompt: 'hi' })).rejects.toThrow(/Working directory not found/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('starts for an existing directory; permissionReply passes remember through', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ccwrap-'))
    try {
      const adapter = fakeAdapter()
      const m = new SessionManager(() => {}, { startSession: vi.fn(async () => adapter) })
      const { localId } = await m.start({ cwd: dir, prompt: 'hi' })
      m.permissionReply({ localId, reqId: 'r1', decision: 'allow', remember: 'always', updatedInput: { a: 1 } })
      expect(adapter.replyPermission).toHaveBeenCalledWith('r1', 'allow', 'always', { a: 1 })
      await m.interrupt(localId)
      expect(adapter.interrupt).toHaveBeenCalled()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('requests summarized thinking so thinking blocks carry text', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ccwrap-'))
    try {
      const startSession = vi.fn(async () => fakeAdapter())
      await new SessionManager(() => {}, { startSession }).start({ cwd: dir, prompt: 'hi' })
      expect(startSession).toHaveBeenCalledWith(expect.objectContaining({ thinking: true }))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('passes chrome only when the preference is on', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ccwrap-'))
    try {
      const startSession = vi.fn(async () => fakeAdapter())
      await new SessionManager(() => {}, { startSession, chrome: () => true }).start({ cwd: dir, prompt: 'hi' })
      expect(startSession).toHaveBeenLastCalledWith(expect.objectContaining({ chrome: true }))
      await new SessionManager(() => {}, { startSession, chrome: () => false }).start({ cwd: dir, prompt: 'hi' })
      expect((startSession.mock.calls as unknown[][])[1]![0]).not.toHaveProperty('chrome')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('passes setModel / setPermissionMode through and caches supportedModels', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ccwrap-'))
    try {
      const adapter = fakeAdapter()
      const m = new SessionManager(() => {}, { startSession: vi.fn(async () => adapter) })
      const { localId } = await m.start({ cwd: dir, prompt: 'hi' })
      await m.setModel(localId, 'opus')
      expect(adapter.setModel).toHaveBeenCalledWith('opus')
      await m.setPermissionMode(localId, 'plan')
      expect(adapter.setPermissionMode).toHaveBeenCalledWith('plan')
      expect(await m.supportedModels(localId)).toEqual([{ value: 'sonnet', displayName: 'Sonnet' }])
      await m.supportedModels(localId)
      expect(adapter.supportedModels).toHaveBeenCalledTimes(1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('interrupt on an unknown session is a safe no-op', async () => {
    const m = new SessionManager(() => {})
    await expect(m.interrupt('nope')).resolves.toBeUndefined()
  })
})

describe('SessionManager extra directories', () => {
  it('forwards additionalDirectories and rejects a missing folder before starting', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ccwrap-'))
    const extra = mkdtempSync(join(tmpdir(), 'ccwrap-extra-'))
    try {
      const startSession = vi.fn(async () => fakeAdapter())
      const m = new SessionManager(() => {}, { startSession })
      await m.start({ cwd: dir, prompt: 'hi', additionalDirectories: [extra] })
      expect(startSession).toHaveBeenCalledWith(expect.objectContaining({ additionalDirectories: [extra] }))
      await expect(m.start({ cwd: dir, prompt: 'hi', additionalDirectories: [join(extra, 'nope')] })).rejects.toThrow(/not found/)
      expect(startSession).toHaveBeenCalledTimes(1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
      rmSync(extra, { recursive: true, force: true })
    }
  })
})
