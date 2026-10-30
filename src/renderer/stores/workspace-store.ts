import { create } from 'zustand'
import type { HistorySessionInfo } from '@shared/events'
import { useChatStore } from '@/stores/chat-store'

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

/** Main-column view. 'chat' is the default; the others are the P2 config pages. */
export type AppView = 'chat' | 'settings' | 'mcp' | 'memory'

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

let draftSeq = 0

export const useWorkspaceStore = create<WorkspaceState>((set, get) => {
  const startDraft = (cwd: string): void => {
    const convId = `new-${Date.now()}-${++draftSeq}`
    useChatStore.getState().createConv({ convId, cwd })
    set({ cwd, activeConvId: convId, activeTitle: undefined, activeBranch: undefined, loadingSession: false })
  }

  return {
    view: 'chat',
    setView: (view) => set({ view }),
    terminalOpen: false,
    toggleTerminal: () => set((s) => ({ terminalOpen: !s.terminalOpen })),
    cwd: readLastCwd(),
    extraCwds: [],
    loadingSession: false,

    selectProject: (cwd) => {
      writeLastCwd(cwd)
      startDraft(cwd)
    },

    newSession: () => {
      const { cwd } = get()
      set({ view: 'chat' })
      if (cwd) startDraft(cwd)
    },

    openSession: async (s) => {
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
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        useChatStore.getState().seedFromHistory(convId, [{ t: 'error', message }])
      } finally {
        set({ loadingSession: false })
      }
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
