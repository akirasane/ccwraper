import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { Options, Query } from '@anthropic-ai/claude-agent-sdk'
import { DEFAULT_PREFS } from '../../shared/app'
import { PrefsService } from './prefs-service'
import { BYPASS_DISABLED, startSdkSession, type AdapterSession, type QueryImpl } from './sdk-adapter'
import { SessionManager } from './session-manager'

/** A fake Query that never talks to a model: records options and mode changes. */
function fakeQuery(): { impl: QueryImpl; options: () => Options; modes: string[]; end: () => void } {
  let opts: Options | undefined
  const modes: string[] = []
  let end!: () => void
  const impl: QueryImpl = ({ options }) => {
    opts = options
    const done = new Promise<void>((r) => (end = r))
    const q = {
      async *[Symbol.asyncIterator]() {
        await done
      },
      interrupt: async () => {},
      setModel: async () => {},
      setPermissionMode: async (m: string) => {
        modes.push(m)
      },
      supportedModels: async () => [],
      stopTask: async () => {},
      close: () => end()
    }
    return q as unknown as Query
  }
  return { impl, options: () => opts!, modes, end: () => end() }
}

describe('adapter allowDangerouslySkipPermissions gating', () => {
  it('is not passed when the preference is off', async () => {
    const f = fakeQuery()
    const s = await startSdkSession({ cwd: '.', prompt: 'x', onEvent: () => {}, queryImpl: f.impl })
    expect(f.options().allowDangerouslySkipPermissions).toBeUndefined()
    s.close()
  })

  it('is passed only when allowed, and then Bypass can be set', async () => {
    const f = fakeQuery()
    const s = await startSdkSession({ cwd: '.', prompt: 'x', onEvent: () => {}, queryImpl: f.impl, allowBypass: true })
    expect(f.options().allowDangerouslySkipPermissions).toBe(true)
    await s.setPermissionMode('bypassPermissions')
    expect(f.modes).toEqual(['bypassPermissions'])
    s.close()
  })

  it('refuses Bypass at start and via setPermissionMode when not allowed', async () => {
    const f = fakeQuery()
    await expect(
      startSdkSession({ cwd: '.', prompt: 'x', onEvent: () => {}, queryImpl: f.impl, permissionMode: 'bypassPermissions' })
    ).rejects.toThrow(BYPASS_DISABLED)
    const g = fakeQuery()
    const s = await startSdkSession({ cwd: '.', prompt: 'x', onEvent: () => {}, queryImpl: g.impl })
    await expect(s.setPermissionMode('bypassPermissions')).rejects.toThrow(BYPASS_DISABLED)
    expect(g.modes).toEqual([])
    s.close()
  })
})

describe('SessionManager bypass gate', () => {
  const fakeAdapter = (): AdapterSession => ({
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
  })

  it('rejects Bypass while the preference is off and passes allowBypass when on', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ccwrap-bypass-'))
    try {
      let allow = false
      const start = vi.fn(async (_o: unknown) => fakeAdapter())
      const m = new SessionManager(() => {}, { startSession: start, allowBypass: () => allow })
      await expect(m.start({ cwd: dir, prompt: 'hi', permissionMode: 'bypassPermissions' })).rejects.toThrow(BYPASS_DISABLED)
      expect(start).not.toHaveBeenCalled()
      const a = await m.start({ cwd: dir, prompt: 'hi', permissionMode: 'plan' })
      expect(start.mock.calls[0]![0]).not.toHaveProperty('allowBypass')
      await expect(m.setPermissionMode(a.localId, 'bypassPermissions')).rejects.toThrow(BYPASS_DISABLED)
      allow = true
      await m.start({ cwd: dir, prompt: 'hi' })
      expect(start.mock.calls[1]![0]).toMatchObject({ allowBypass: true })
      await m.setPermissionMode(a.localId, 'bypassPermissions')
      m.closeAll()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('allowBypassMode preference', () => {
  it('an old prefs.json without the key loads with the default (false)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ccwrap-prefs-'))
    try {
      const file = join(dir, 'prefs.json')
      writeFileSync(file, JSON.stringify({ version: 1, confirmQuitWhileRunning: false }))
      const p = new PrefsService(file).get()
      expect(p.allowBypassMode).toBe(false)
      expect(p.confirmQuitWhileRunning).toBe(false)
      expect(DEFAULT_PREFS.allowBypassMode).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('can be turned on, persists and reads back', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ccwrap-prefs-'))
    try {
      const file = join(dir, 'prefs.json')
      const p = new PrefsService(file)
      expect((await p.set({ allowBypassMode: true })).allowBypassMode).toBe(true)
      expect(new PrefsService(file).get().allowBypassMode).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
