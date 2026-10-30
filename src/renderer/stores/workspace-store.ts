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

/** Main-column view. 'chat' is the default; the others are the config pages (P2) and the item / hook editors (P3). */
export type AppView = 'chat' | 'settings' | 'mcp' | 'memory' | 'skills' | 'agents' | 'hooks'

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
