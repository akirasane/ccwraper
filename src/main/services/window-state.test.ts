import { EventEmitter } from 'node:events'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'
import { fitToDisplays, loadWindowState, trackWindowState } from './window-state'

const primary = { x: 0, y: 0, width: 1920, height: 1040 }
const second = { x: 1920, y: 0, width: 2560, height: 1400 }

let dir: string
let file: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ccwrap-ws-'))
  file = join(dir, 'window-state.json')
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  vi.useRealTimers()
})

describe('fitToDisplays', () => {
  it('keeps bounds that fit a display', () => {
    expect(fitToDisplays({ x: 100, y: 50, width: 1280, height: 800 }, [primary])).toEqual({ x: 100, y: 50, width: 1280, height: 800 })
  })
  it('keeps a window on the second monitor while it is connected', () => {
    const r = fitToDisplays({ x: 2200, y: 100, width: 1400, height: 900 }, [primary, second])
    expect(r).toMatchObject({ x: 2200, y: 100 })
  })
  it('second monitor removed: position dropped, size clamped to the remaining display', () => {
    const r = fitToDisplays({ x: 2200, y: 100, width: 3000, height: 1300 }, [primary])
    expect(r.x).toBeUndefined()
    expect(r.y).toBeUndefined()
    expect(r.width).toBe(1920)
    expect(r.height).toBe(1040)
  })
  it('partly off-screen window is pulled fully inside', () => {
    const r = fitToDisplays({ x: 1500, y: 900, width: 1280, height: 800 }, [primary])
    expect(r).toEqual({ x: 640, y: 240, width: 1280, height: 800 })
  })
  it('enforces minimum size and carries maximized', () => {
    const r = fitToDisplays({ x: 0, y: 0, width: 300, height: 200, maximized: true }, [primary])
    expect(r).toMatchObject({ width: 1024, height: 640, maximized: true })
  })
  it('no displays: only maximized survives', () => {
    expect(fitToDisplays({ x: 0, y: 0, width: 1280, height: 800 }, [])).toEqual({})
  })
})

describe('loadWindowState', () => {
  it('missing, corrupt, or invalid file gives {}', () => {
    expect(loadWindowState(file, [primary])).toEqual({})
    writeFileSync(file, '{not json')
    expect(loadWindowState(file, [primary])).toEqual({})
    writeFileSync(file, JSON.stringify({ width: 'x' }))
    expect(loadWindowState(file, [primary])).toEqual({})
  })
  it('reads a valid file', () => {
    writeFileSync(file, JSON.stringify({ x: 10, y: 20, width: 1300, height: 820, maximized: true }))
    expect(loadWindowState(file, [primary])).toEqual({ x: 10, y: 20, width: 1300, height: 820, maximized: true })
  })
})

class FakeWin extends EventEmitter {
  bounds = { x: 5, y: 6, width: 1300, height: 810 }
  maximized = false
  getBounds = (): typeof this.bounds => this.bounds
  getNormalBounds = (): typeof this.bounds => this.bounds
  isMaximized = (): boolean => this.maximized
  isMinimized = (): boolean => false
  isFullScreen = (): boolean => false
  isDestroyed = (): boolean => false
}

describe('trackWindowState', () => {
  it('debounces writes and saves bounds', () => {
    vi.useFakeTimers()
    const w = new FakeWin()
    const off = trackWindowState(w as unknown as BrowserWindow, file, 500)
    w.emit('resize')
    w.emit('move')
    expect(existsSync(file)).toBe(false)
    vi.advanceTimersByTime(500)
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ x: 5, y: 6, width: 1300, height: 810 })
    off()
  })
  it('maximized keeps the normal bounds and sets the flag; close flushes', () => {
    vi.useFakeTimers()
    const w = new FakeWin()
    trackWindowState(w as unknown as BrowserWindow, file, 500)
    w.emit('resize')
    w.maximized = true
    w.bounds = { x: 0, y: 0, width: 1920, height: 1040 }
    w.emit('maximize')
    w.emit('close')
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ x: 5, y: 6, width: 1300, height: 810, maximized: true })
  })
  it('dispose stops tracking', () => {
    vi.useFakeTimers()
    const w = new FakeWin()
    const off = trackWindowState(w as unknown as BrowserWindow, file, 500)
    off()
    w.emit('resize')
    vi.advanceTimersByTime(1000)
    expect(existsSync(file)).toBe(false)
  })
})
