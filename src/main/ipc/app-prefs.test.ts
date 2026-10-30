import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IpcChannels } from '../../shared/ipc'

const handlers = new Map<string, (e: unknown, raw?: unknown) => unknown>()
const listeners = new Map<string, (e: unknown, raw?: unknown) => void>()
vi.mock('electron', () => ({
  app: { getPath: () => 'C:\\synthetic', getVersion: () => '0.0.0', isPackaged: false },
  ipcMain: {
    handle: (ch: string, fn: (e: unknown, raw?: unknown) => unknown) => void handlers.set(ch, fn),
    removeHandler: (ch: string) => void handlers.delete(ch),
    on: (ch: string, fn: (e: unknown, raw?: unknown) => void) => void listeners.set(ch, fn),
    removeListener: (ch: string) => void listeners.delete(ch)
  }
}))

import { PrefsService } from '../services/prefs-service'
import { registerAppIpc } from './app'
import { registerPrefsIpc } from './prefs'

const call = (ch: string, raw?: unknown): any => handlers.get(ch)!({}, raw)

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ccwrap-ipc-prefs-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  handlers.clear()
  listeners.clear()
})

describe('app IPC', () => {
  it('authStatus validates args and forwards refresh', async () => {
    const get = vi.fn(async (_r?: boolean) => ({ state: 'signed_out' as const, checkedAt: 1 }))
    const setActiveSession = vi.fn()
    const off = registerAppIpc({ auth: { get }, setActiveSession })
    expect((await call(IpcChannels.appAuthStatus)).state).toBe('signed_out')
    expect(get).toHaveBeenLastCalledWith(undefined)
    await call(IpcChannels.appAuthStatus, { refresh: true })
    expect(get).toHaveBeenLastCalledWith(true)
    expect(() => call(IpcChannels.appAuthStatus, { refresh: 'yes' })).toThrow()
    off()
    expect(handlers.has(IpcChannels.appAuthStatus)).toBe(false)
    expect(listeners.has(IpcChannels.appSetActiveSession)).toBe(false)
  })

  it('setActiveSession goes to the sink; invalid payloads are ignored', () => {
    const setActiveSession = vi.fn()
    registerAppIpc({ auth: { get: async () => ({ state: 'unknown', checkedAt: 0 }) }, setActiveSession })
    const on = listeners.get(IpcChannels.appSetActiveSession)!
    on({}, { localId: 'abc' })
    on({}, { localId: null })
    on({}, { localId: 5 })
    on({}, 'junk')
    expect(setActiveSession.mock.calls).toEqual([['abc'], [null]])
  })
})

describe('getAppInfo', () => {
  it('reports the unpacked bundled path (not empty) when the bundled binary is used', async () => {
    const paths = await import('../paths')
    const prev = process.env['CCWRAP_CLAUDE_SOURCE']
    process.env['CCWRAP_CLAUDE_SOURCE'] = 'bundled'
    paths.resetClaudeBinaryCache()
    try {
      const { getAppInfo } = await import('./app')
      const info = getAppInfo()
      expect(info.claudeSource).toBe('bundled')
      expect(info.claudePath).toBe(paths.resolveClaudeExecutable())
      expect(info.claudePath).toBeTruthy()
      expect(info.claudePath).not.toContain('app.asar' + require('node:path').sep + 'node_modules')
    } finally {
      if (prev === undefined) delete process.env['CCWRAP_CLAUDE_SOURCE']
      else process.env['CCWRAP_CLAUDE_SOURCE'] = prev
      paths.resetClaudeBinaryCache()
    }
  })
})

describe('prefs IPC', () => {
  it('get, set (with hotkey status), validation and prefs:changed broadcast', async () => {
    const prefs = new PrefsService(join(dir, 'prefs.json'))
    const sent: [string, unknown][] = []
    const status = vi.fn(() => ({ registered: true }))
    const off = registerPrefsIpc({ prefs, hotkey: { status } as never, send: (c, p) => void sent.push([c, p]) })
    const initial = await call(IpcChannels.prefsGet)
    expect(initial.confirmQuitWhileRunning).toBe(true)
    const res = await call(IpcChannels.prefsSet, { confirmQuitWhileRunning: false })
    expect(res.prefs.confirmQuitWhileRunning).toBe(false)
    expect(res.hotkey).toEqual({ registered: true })
    expect(sent.some(([c, p]) => c === IpcChannels.prefsChanged && (p as { confirmQuitWhileRunning: boolean }).confirmQuitWhileRunning === false)).toBe(true)
    await expect(Promise.resolve().then(() => call(IpcChannels.prefsSet, { confirmQuitWhileRunning: 'x' }))).rejects.toThrow()
    off()
    expect(handlers.has(IpcChannels.prefsGet)).toBe(false)
  })
})
