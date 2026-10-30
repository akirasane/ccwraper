import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { dirname } from 'node:path'
import type { BrowserWindow, BrowserWindowConstructorOptions } from 'electron'
import type { Disposer } from '../ipc/dispose'

// D11: bounds + maximized flag saved to window-state.json (debounced); restored only when they still
// fit a connected display.

/** A connected display's usable area. */
export interface ScreenRect {
  x: number
  y: number
  width: number
  height: number
}

export type RestoredWindowState = Partial<BrowserWindowConstructorOptions> & { maximized?: boolean }

interface Saved {
  x?: number
  y?: number
  width: number
  height: number
  maximized?: boolean
}

const MIN_W = 1024
const MIN_H = 640
const MIN_VISIBLE = 120

function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

function parse(raw: string): Saved | undefined {
  try {
    const o = JSON.parse(raw) as Record<string, unknown>
    if (!o || typeof o !== 'object' || !isNum(o['width']) || !isNum(o['height'])) return undefined
    return {
      width: o['width'],
      height: o['height'],
      ...(isNum(o['x']) && isNum(o['y']) ? { x: o['x'], y: o['y'] } : {}),
      ...(o['maximized'] === true ? { maximized: true } : {})
    }
  } catch {
    return undefined
  }
}

function overlap(a: ScreenRect, s: ScreenRect): { w: number; h: number } {
  return {
    w: Math.min(a.x + a.width, s.x + s.width) - Math.max(a.x, s.x),
    h: Math.min(a.y + a.height, s.y + s.height) - Math.max(a.y, s.y)
  }
}

/** Pure: fit saved bounds to the connected displays. Returns {} when nothing sensible remains. */
export function fitToDisplays(saved: Saved, screens: ScreenRect[]): RestoredWindowState {
  const out: RestoredWindowState = {}
  if (saved.maximized) out.maximized = true
  if (screens.length === 0) return out
  const width = Math.max(MIN_W, Math.round(saved.width))
  const height = Math.max(MIN_H, Math.round(saved.height))
  if (saved.x === undefined || saved.y === undefined) {
    const s = screens[0]!
    return { ...out, width: Math.min(width, s.width), height: Math.min(height, s.height) }
  }
  const rect = { x: Math.round(saved.x), y: Math.round(saved.y), width, height }
  // Best display = the one with the largest overlap; none visible enough -> position dropped.
  let best: ScreenRect | undefined
  let bestArea = 0
  for (const s of screens) {
    const o = overlap(rect, s)
    if (o.w >= MIN_VISIBLE && o.h >= MIN_VISIBLE && o.w * o.h > bestArea) {
      best = s
      bestArea = o.w * o.h
    }
  }
  if (!best) {
    const s = screens[0]!
    return { ...out, width: Math.min(width, s.width), height: Math.min(height, s.height) }
  }
  const w = Math.min(width, best.width)
  const h = Math.min(height, best.height)
  const x = Math.min(Math.max(rect.x, best.x), best.x + best.width - w)
  const y = Math.min(Math.max(rect.y, best.y), best.y + best.height - h)
  return { ...out, x, y, width: w, height: h }
}

/** Saved bounds, only when they still fit a connected display. */
export function loadWindowState(file: string, screens: ScreenRect[]): RestoredWindowState {
  let raw: string
  try {
    raw = readFileSync(file, 'utf8')
  } catch {
    return {}
  }
  const saved = parse(raw)
  return saved ? fitToDisplays(saved, screens) : {}
}

/** Saves bounds and the maximized flag (debounced) until disposed. */
export function trackWindowState(win: BrowserWindow, file: string, debounceMs = 500): Disposer {
  let timer: NodeJS.Timeout | undefined
  let last: Saved | undefined
  const snapshot = (): void => {
    if (win.isDestroyed()) return
    const maximized = win.isMaximized()
    // While maximized/minimized/fullscreen keep the previous normal bounds.
    if (!maximized && !win.isMinimized() && !win.isFullScreen()) {
      const b = win.getBounds()
      last = { x: b.x, y: b.y, width: b.width, height: b.height }
    }
    if (!last) {
      const b = win.getNormalBounds()
      last = { x: b.x, y: b.y, width: b.width, height: b.height }
    }
    last = { ...last, ...(maximized ? { maximized: true } : {}) }
    if (!maximized) delete last.maximized
  }
  const write = (): void => {
    timer = undefined
    if (!last) return
    try {
      mkdirSync(dirname(file), { recursive: true })
      const tmp = `${file}.tmp`
      writeFileSync(tmp, JSON.stringify(last))
      renameSync(tmp, file)
    } catch {
      // best effort
    }
  }
  const schedule = (): void => {
    snapshot()
    if (timer) clearTimeout(timer)
    timer = setTimeout(write, debounceMs)
  }
  const events = ['resize', 'move', 'maximize', 'unmaximize'] as const
  for (const e of events) win.on(e as 'resize', schedule)
  const onClose = (): void => {
    snapshot()
    if (timer) clearTimeout(timer)
    write()
  }
  win.on('close', onClose)
  return () => {
    if (timer) clearTimeout(timer)
    timer = undefined
    if (win.isDestroyed()) return
    for (const e of events) win.removeListener(e as 'resize', schedule)
    win.removeListener('close', onClose)
  }
}
