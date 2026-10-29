import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { SessionManager } from './session-manager'
import type { AdapterSession } from './sdk-adapter'

function fakeAdapter(): AdapterSession {
  return {
    send: vi.fn(),
    interrupt: vi.fn(async () => {}),
    setModel: vi.fn(async () => {}),
    setPermissionMode: vi.fn(async () => {}),
    replyPermission: vi.fn(),
    done: new Promise<void>(() => {}),
    close: vi.fn()
  }
}

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

  it('interrupt on an unknown session is a safe no-op', async () => {
    const m = new SessionManager(() => {})
    await expect(m.interrupt('nope')).resolves.toBeUndefined()
  })
})
