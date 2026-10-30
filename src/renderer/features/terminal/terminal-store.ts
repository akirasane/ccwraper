import { create } from 'zustand'
import type { ShellId } from '@shared/config'
import { clampPanelHeight, PANEL_DEFAULT_HEIGHT } from './theme'

export const HEIGHT_KEY = 'ccwrap.terminal.height'
export const DEFAULT_SHELL_KEY = 'ccwrap.terminal.defaultShell'

export interface TerminalTab {
  id: string
  shellId: ShellId
  label: string
  cwd: string
  ptyId?: string
  /** Set once the process ended (exit code), was killed (-1 with killed) or failed to start. */
  exitCode?: number
  killed?: boolean
  /** Text to type into the pty WITHOUT Enter, as soon as it has a ptyId (run-in-terminal). */
  pendingInput?: string
}

interface TerminalState {
  tabs: TerminalTab[]
  activeId: string | undefined
  height: number
  defaultShell: ShellId | undefined
  addTab: (t: { shellId: ShellId; label: string; cwd: string; pendingInput?: string }) => string
  closeTab: (id: string) => void
  setActive: (id: string) => void
  setPty: (id: string, ptyId: string) => void
  markExited: (id: string, exitCode: number, killed?: boolean) => void
  consumeInput: (id: string) => void
  setPendingInput: (id: string, text: string) => void
  setHeight: (height: number) => void
  setDefaultShell: (id: ShellId) => void
  reset: () => void
}

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}
function write(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    /* storage unavailable: the preference is just not kept */
  }
}

function initialHeight(): number {
  const n = Number(read(HEIGHT_KEY))
  return Number.isFinite(n) && n > 0 ? n : PANEL_DEFAULT_HEIGHT
}

let seq = 0

export const useTerminalStore = create<TerminalState>((set, get) => ({
  tabs: [],
  activeId: undefined,
  height: initialHeight(),
  defaultShell: (read(DEFAULT_SHELL_KEY) as ShellId | null) ?? undefined,

  addTab: ({ shellId, label, cwd, pendingInput }) => {
    const id = `t${++seq}`
    set((s) => ({ tabs: [...s.tabs, { id, shellId, label, cwd, pendingInput }], activeId: id }))
    return id
  },
  closeTab: (id) =>
    set((s) => {
      const i = s.tabs.findIndex((t) => t.id === id)
      if (i < 0) return s
      const tabs = s.tabs.filter((t) => t.id !== id)
      const activeId = s.activeId === id ? (tabs[Math.min(i, tabs.length - 1)]?.id ?? undefined) : s.activeId
      return { tabs, activeId }
    }),
  setActive: (id) => set((s) => (s.tabs.some((t) => t.id === id) ? { activeId: id } : s)),
  setPty: (id, ptyId) => set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, ptyId } : t)) })),
  markExited: (id, exitCode, killed) =>
    set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, exitCode, killed } : t)) })),
  consumeInput: (id) =>
    set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, pendingInput: undefined } : t)) })),
  setPendingInput: (id, text) =>
    set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, pendingInput: text } : t)) })),
  setHeight: (height) => {
    const h = clampPanelHeight(height, window.innerHeight)
    if (h === get().height) return
    set({ height: h })
    write(HEIGHT_KEY, String(h))
  },
  setDefaultShell: (id) => {
    set({ defaultShell: id })
    write(DEFAULT_SHELL_KEY, id)
  },
  reset: () => set({ tabs: [], activeId: undefined, height: PANEL_DEFAULT_HEIGHT, defaultShell: undefined })
}))
