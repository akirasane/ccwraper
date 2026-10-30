import { create } from 'zustand'
import type { HistorySessionInfo } from '@shared/events'
import { useChatStore } from '@/stores/chat-store'
import { useDirtyRegistry } from '@/stores/dirty-registry'

const STORAGE_KEY = 'ccwrap.lastCwd'

/** Same idea as main's normalizeCwdKey: slash style, trailing separator and (Windows) case are ignored. */
export function cwdKey(p: string): string {
  return p.replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase()
}

function readLastCwd(): string | undefined {
  try {
    return window.localStorage.getItem(STORAGE_KEY) ?? undefined
  } catch {
    return undefined
  }
}

function writeLastCwd(cwd: string): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, cwd)
  } catch {
    /* storage unavailable: persistence is a convenience only */
  }
}

/** Main-column views. 'chat' is the default; the others are config pages (P2), item / hook editors (P3), data views and prefs (P4). */
export const APP_VIEWS = ['chat', 'settings', 'mcp', 'memory', 'skills', 'agents', 'hooks', 'usage', 'git', 'preferences'] as const
export type AppView = (typeof APP_VIEWS)[number]

/** One open conversation tab (P4 D2). WP5 owns the behaviour; WP0 freezes the shape. */
export interface TabRef {
  convId: string
  cwd: string
  sessionId?: string
  title?: string
  openedAt: number
  lastActiveAt: number
}

/** A config item the command palette asks a page to select (`focusItem`, P4 D7). */
export interface FocusItem {
  kind: 'skill' | 'command' | 'agent'
  name: string
}

interface WorkspaceState {
  view: AppView
  setView: (view: AppView) => void
  terminalOpen: boolean
  toggleTerminal: () => void
  cwd?: string
  /** Folders added via "Open folder..." that history does not know yet. */
  extraCwds: string[]
  activeConvId?: string
  activeTitle?: string
  activeBranch?: string
  loadingSession: boolean
  /** Select a project and start a fresh draft conversation in it. */
  selectProject: (cwd: string) => void
  newSession: () => void
  openSession: (s: HistorySessionInfo) => Promise<void>
  addFolder: () => Promise<void>
  // ---- P4 seams (WP0 stubs; WP5 owns the implementation from W1 on) ----
  tabs: TabRef[]
  activateTab: (convId: string) => void
  closeTab: (convId: string) => Promise<void>
  /** Stub: same as newSession (an optional cwd selects that project's draft). */
  newTab: (cwd?: string) => void
  cycleTab: (dir: 1 | -1) => void
  focusItem?: FocusItem
  setFocusItem: (item: FocusItem | undefined) => void
}

/** Heuristic: a big transcript that replays to almost nothing was probably compacted or cut short. */
const TRUNCATION_BYTES = 2 * 1024 * 1024
const TRUNCATION_EVENTS = 20

let draftSeq = 0

export const useWorkspaceStore = create<WorkspaceState>((set, get) => {
  const startDraft = (cwd: string): void => {
    const convId = `new-${Date.now()}-${++draftSeq}`
    useChatStore.getState().createConv({ convId, cwd })
    set({ cwd, activeConvId: convId, activeTitle: undefined, activeBranch: undefined, loadingSession: false })
  }

  const doOpenSession = async (s: HistorySessionInfo): Promise<void> => {
    const convId = `hist-${s.sessionId}`
    const chat = useChatStore.getState()
    writeLastCwd(s.cwd)
    set({ cwd: s.cwd, activeConvId: convId, activeTitle: s.title, activeBranch: s.gitBranch, view: 'chat' })
    if (chat.convs[convId]) return // already open (possibly live): just show it
    chat.createConv({ convId, cwd: s.cwd, resumeSessionId: s.sessionId })
    set({ loadingSession: true })
    try {
      const events = await window.ccwrap.history.load({ sessionId: s.sessionId, cwd: s.cwd })
      useChatStore.getState().seedFromHistory(convId, events)
      if ((s.fileSize ?? 0) > TRUNCATION_BYTES && events.length < TRUNCATION_EVENTS) {
        useChatStore.getState().setNotice(convId, 'History may be incomplete (large or compacted session)')
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      useChatStore.getState().seedFromHistory(convId, [{ t: 'error', message }])
    } finally {
      set({ loadingSession: false })
    }
  }

  return {
    view: 'chat',
    setView: (view) => {
      if (view === get().view) return
      useDirtyRegistry.getState().guard(() => set({ view }))
    },
    terminalOpen: false,
    toggleTerminal: () => set((s) => ({ terminalOpen: !s.terminalOpen })),
    cwd: readLastCwd(),
    extraCwds: [],
    loadingSession: false,

    selectProject: (cwd) => {
      const go = (): void => {
        writeLastCwd(cwd)
        startDraft(cwd)
      }
      // Re-selecting the current project keeps the open page mounted, so it never loses edits.
      const cur = get().cwd
      if (cur && cwdKey(cur) === cwdKey(cwd)) go()
      else useDirtyRegistry.getState().guard(go)
    },

    newSession: () => {
      const { cwd } = get()
      useDirtyRegistry.getState().guard(() => {
        set({ view: 'chat' })
        if (cwd) startDraft(cwd)
      })
    },

    openSession: (s) => {
      // Opening a session switches to chat (and maybe project): ask first when a page has unsaved edits.
      return new Promise<void>((resolve) => {
        useDirtyRegistry.getState().guard(() => void doOpenSession(s).then(resolve, resolve))
      })
    },

    tabs: [],
    activateTab: (convId) => {
      const conv = useChatStore.getState().convs[convId]
      if (!conv) return
      useDirtyRegistry.getState().guard(() => set({ cwd: conv.cwd, activeConvId: convId, view: 'chat' }))
    },
    closeTab: async () => {},
    newTab: (cwd) => {
      if (cwd) get().selectProject(cwd)
      else get().newSession()
    },
    cycleTab: () => {},
    setFocusItem: (focusItem) => set({ focusItem }),

    addFolder: async () => {
      const picked = await window.ccwrap.dialog.pickDirectory()
      if (!picked) return
      set((s) => ({
        extraCwds: s.extraCwds.some((c) => cwdKey(c) === cwdKey(picked)) ? s.extraCwds : [...s.extraCwds, picked]
      }))
      get().selectProject(picked)
    }
  }
})
