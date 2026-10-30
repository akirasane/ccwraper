import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PREFS } from '../../shared/app'
import { PrefsService } from './prefs-service'

let dir: string
let file: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ccwrap-prefs-'))
  file = join(dir, 'prefs.json')
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('PrefsService', () => {
  it('returns the defaults when there is no file', () => {
    const p = new PrefsService(file)
    expect(p.get()).toEqual(DEFAULT_PREFS)
    expect(p.get().hotkey.enabled).toBe(false)
  })

  it('get() returns a copy, not the live object', () => {
    const p = new PrefsService(file)
    p.get().notifications.enabled = false
    expect(p.get().notifications.enabled).toBe(true)
  })

  it('deep-merges patches, persists them and emits the change', async () => {
    const p = new PrefsService(file)
    const seen = vi.fn()
    p.onChange(seen)
    const next = await p.set({ notifications: { turnDoneMinSeconds: 40 }, hotkey: { enabled: true } })
    expect(next.notifications.turnDoneMinSeconds).toBe(40)
    expect(next.notifications.permission).toBe(true) // untouched sibling
    expect(next.hotkey).toEqual({ enabled: true, accelerator: 'Control+Alt+Space' })
    expect(seen).toHaveBeenCalledTimes(1)
    expect(seen.mock.calls[0]![0]).toEqual(next)
    const onDisk = JSON.parse(await readFile(file, 'utf8')) as unknown
    expect(onDisk).toEqual(next)
    // a new instance reads it back
    expect(new PrefsService(file).get()).toEqual(next)
  })

  it('rejects an invalid patch without writing or emitting', async () => {
    const p = new PrefsService(file)
    const seen = vi.fn()
    p.onChange(seen)
    await expect(p.set({ notifications: { turnDoneMinSeconds: -5 } })).rejects.toThrow()
    expect(seen).not.toHaveBeenCalled()
    expect(await readdir(dir)).toEqual([])
    expect(p.get()).toEqual(DEFAULT_PREFS)
  })

  it('unsubscribes', async () => {
    const p = new PrefsService(file)
    const seen = vi.fn()
    const off = p.onChange(seen)
    off()
    await p.set({ confirmQuitWhileRunning: false })
    expect(seen).not.toHaveBeenCalled()
  })

  it('keeps a corrupt file next to the defaults instead of deleting it', async () => {
    await writeFile(file, '{ not json')
    const onCorrupt = vi.fn()
    const p = new PrefsService(file, { now: () => 1234, onCorrupt })
    expect(p.get()).toEqual(DEFAULT_PREFS)
    expect(onCorrupt).toHaveBeenCalledTimes(1)
    const names = await readdir(dir)
    expect(names).toContain('prefs.json')
    expect(names).toContain('prefs.json.corrupt-1234')
    expect(await readFile(join(dir, 'prefs.json.corrupt-1234'), 'utf8')).toBe('{ not json')
  })

  it('treats a schema-invalid file as corrupt too', async () => {
    await writeFile(file, JSON.stringify({ notifications: { turnDoneMinSeconds: 99999 } }))
    const p = new PrefsService(file, { now: () => 7 })
    expect(p.get()).toEqual(DEFAULT_PREFS)
    expect((await readdir(dir)).some((n) => n.startsWith('prefs.json.corrupt-'))).toBe(true)
  })

  it('merges a partial valid file over the defaults and ignores unknown keys', async () => {
    await writeFile(file, JSON.stringify({ version: 1, hotkey: { enabled: true }, future: { x: 1 } }))
    const p = new PrefsService(file)
    expect(p.get().hotkey).toEqual({ enabled: true, accelerator: 'Control+Alt+Space' })
    expect(p.get().notifications).toEqual(DEFAULT_PREFS.notifications)
    expect(await readdir(dir)).toEqual(['prefs.json'])
  })

  it('serializes concurrent sets so the last one wins on disk', async () => {
    const p = new PrefsService(file)
    await Promise.all([p.set({ notifications: { turnDoneMinSeconds: 1 } }), p.set({ notifications: { turnDoneMinSeconds: 2 } })])
    expect(p.get().notifications.turnDoneMinSeconds).toBe(2)
    expect(new PrefsService(file).get().notifications.turnDoneMinSeconds).toBe(2)
  })
})
