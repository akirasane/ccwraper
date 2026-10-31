import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UpdateState } from '../../shared/app'
import { UPDATE_INTERVAL_MS, UPDATE_START_DELAY_MS, UpdateService, shortUpdateError } from './update-service'
import type { UpdaterLike } from './update-service'

class FakeUpdater implements UpdaterLike {
  autoDownload = false
  autoInstallOnAppQuit = false
  allowPrerelease = true
  handlers = new Map<string, (...a: any[]) => void>()
  checkForUpdates = vi.fn(async (): Promise<unknown> => undefined)
  quitAndInstall = vi.fn()
  on(event: string, cb: (...a: any[]) => void): this {
    this.handlers.set(event, cb)
    return this
  }
  emit(event: string, ...a: unknown[]): void {
    this.handlers.get(event)!(...a)
  }
}

let up: FakeUpdater
let states: UpdateState[]
let autoUpdate: boolean

function make(isPackaged = true): UpdateService {
  return new UpdateService({
    ...(isPackaged ? { updater: up } : {}),
    isPackaged,
    prefs: { get: () => ({ autoUpdate }) },
    broadcast: (s) => states.push(s)
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  up = new FakeUpdater()
  states = []
  autoUpdate = true
})
afterEach(() => vi.useRealTimers())

describe('UpdateService', () => {
  it('is disabled and inert when not packaged', async () => {
    const svc = make(false)
    svc.start()
    expect(svc.getState()).toEqual({ kind: 'disabled' })
    vi.advanceTimersByTime(UPDATE_INTERVAL_MS * 2)
    expect((await svc.check()).kind).toBe('disabled')
    expect(svc.installNow()).toBe(false)
    expect(up.checkForUpdates).not.toHaveBeenCalled()
    expect(up.handlers.size).toBe(0)
  })

  it('configures the updater and walks checking -> available -> downloading -> ready', async () => {
    const svc = make()
    svc.start()
    expect(up).toMatchObject({ autoDownload: true, autoInstallOnAppQuit: true, allowPrerelease: false })
    up.checkForUpdates.mockImplementation(async () => {
      up.emit('checking-for-update')
      up.emit('update-available', { version: '0.6.0' })
    })
    await svc.check()
    up.emit('download-progress', { percent: 41.6 })
    up.emit('update-downloaded', { version: '0.6.0' })
    expect(states).toEqual([
      { kind: 'checking' },
      { kind: 'available', version: '0.6.0' },
      { kind: 'downloading', version: '0.6.0', percent: 42 },
      { kind: 'ready', version: '0.6.0' }
    ])
  })

  it('reports uptodate', async () => {
    const svc = make()
    svc.start()
    up.checkForUpdates.mockImplementation(async () => up.emit('update-not-available', {}))
    expect((await svc.check()).kind).toBe('uptodate')
  })

  it('swallows a rejected check into the error state', async () => {
    const svc = make()
    svc.start()
    up.checkForUpdates.mockRejectedValue(new Error('Cannot find latest.yml: HttpError: 404 Not Found\nheaders: {...}'))
    const s = await svc.check()
    expect(s.kind).toBe('error')
    expect((s as { message: string }).message).toMatch(/not accessible/)
    expect((s as { message: string }).message).not.toContain('\n')
  })

  it('maps an error event, offline and long messages to short text', () => {
    const svc = make()
    svc.start()
    up.emit('error', new Error('net::ERR_INTERNET_DISCONNECTED'))
    expect(svc.getState()).toEqual({ kind: 'error', message: 'Could not reach the update server (offline?)' })
    expect(shortUpdateError(new Error('ENOTFOUND github.com'))).toMatch(/offline/)
    expect(shortUpdateError(new Error('x'.repeat(500))).length).toBeLessThanOrEqual(120)
    expect(shortUpdateError(undefined)).toBe('Update check failed')
  })

  it('does not run overlapping checks and keeps a ready update through a later error', async () => {
    const svc = make()
    svc.start()
    let release!: () => void
    up.checkForUpdates.mockImplementation(() => new Promise<void>((r) => (release = r)))
    const a = svc.check()
    const b = svc.check()
    expect(up.checkForUpdates).toHaveBeenCalledTimes(1)
    release()
    await Promise.all([a, b])
    up.emit('update-downloaded', { version: '0.6.0' })
    up.emit('error', new Error('boom'))
    expect(svc.getState()).toEqual({ kind: 'ready', version: '0.6.0' })
    await svc.check()
    expect(up.checkForUpdates).toHaveBeenCalledTimes(1)
  })

  it('checks once after 10 s, then every 6 h', async () => {
    make().start()
    expect(up.checkForUpdates).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(UPDATE_START_DELAY_MS)
    expect(up.checkForUpdates).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(UPDATE_INTERVAL_MS)
    expect(up.checkForUpdates).toHaveBeenCalledTimes(2)
  })

  it('skips scheduled checks when the pref is off but still allows a manual check', async () => {
    autoUpdate = false
    const svc = make()
    svc.start()
    await vi.advanceTimersByTimeAsync(UPDATE_START_DELAY_MS + UPDATE_INTERVAL_MS)
    expect(up.checkForUpdates).not.toHaveBeenCalled()
    await svc.check()
    expect(up.checkForUpdates).toHaveBeenCalledTimes(1)
    autoUpdate = true
    await vi.advanceTimersByTimeAsync(UPDATE_INTERVAL_MS)
    expect(up.checkForUpdates).toHaveBeenCalledTimes(2)
  })

  it('installNow quits and installs only when ready', () => {
    const svc = make()
    svc.start()
    expect(svc.installNow()).toBe(false)
    up.emit('update-downloaded', { version: '0.6.0' })
    expect(svc.installNow()).toBe(true)
    expect(up.quitAndInstall).toHaveBeenCalledTimes(1)
  })

  it('dispose stops the timers and a failing broadcast never throws', async () => {
    const svc = new UpdateService({
      updater: up,
      isPackaged: true,
      prefs: { get: () => ({ autoUpdate: true }) },
      broadcast: () => {
        throw new Error('window gone')
      }
    })
    svc.start()
    up.emit('update-not-available', {})
    svc.dispose()
    await vi.advanceTimersByTimeAsync(UPDATE_INTERVAL_MS)
    expect(up.checkForUpdates).not.toHaveBeenCalled()
  })
})
