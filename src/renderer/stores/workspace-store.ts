import { create } from 'zustand'
import type { HistorySessionInfo } from '@shared/events'
import { selectIsRunning, selectRunningTasks } from '@/features/chat/model/selectors'
import type { ConvState } from '@/features/chat/model/types'
import type { PersistedTabs } from '@/features/tabs/tab-persist'
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
export const APP_VIEWS = ['chat', 'settings', 'mcp', 'plugins', 'memory', 'skills', 'agents', 'hooks', 'usage', 'git', 'preferences'] as const
export type AppView = (typeof APP_VIEWS)[number]

/** One open conversation tab (P4 D2). */
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
  /** Activate the most recent tab of this project, else open a draft tab in it. */
  selectProject: (cwd: string) => void
  /** Same as newTab() for the current project. */
  newSession: () => void
  /** Activate the session's tab if it is open, else open a history tab (transcript loads on first show). */
  openSession: (s: HistorySessionInfo) => Promise<void>
  addFolder: () => Promise<void>
  // ---- Tabs (P4 D2) ----
  tabs: TabRef[]
  /** Conversations that finished a turn while their tab was in the background. */
  unread: Record<string, true>
  /** A close waiting for the user's confirmation (the conversation is busy). */
  pendingClose?: string
  activateTab: (convId: string) => void
  /** Closes now when idle; otherwise parks `pendingClose` for the confirm dialog. */
  closeTab: (convId: string) => Promise<void>
  confirmClose: () => Promise<void>
  cancelClose: () => void
  /** Reuse an empty draft tab of the project, else open a new draft tab. */
  newTab: (cwd?: string) => void
  cycleTab: (dir: 1 | -1) => void
  /** Rebuild history tabs from `tabs.v1`; transcripts load lazily on first activation. */
  restoreTabs: (data: PersistedTabs) => void
  focusItem?: FocusItem
  setFocusItem: (item: FocusItem | undefined) => void
}

/** Heuristic: a big transcript that replays to almost nothing was probably compacted or cut short. */
const TRUNCATION_BYTES = 2 * 1024 * 1024
const TRUNCATION_EVENTS = 20

let draftSeq = 0
/** Conversations whose transcript is loaded (or does not need loading). */
const loaded = new Set<string>()

/** A conversation that needs the "stop and close" confirmation (D2). */
export function isBusyConv(c: ConvState): boolean {
  return selectIsRunning(c) || c.pending.length > 0 || selectRunningTasks(c).length > 0
}

const isEmptyDraft = (t: TabRef, c: ConvState | undefined): boolean =>
  !!c && !t.sessionId && !c.localId && !c.resumeSessionId && c.items.length === 0 && !useChatStore.getState().drafts[c.convId]

export const useWorkspaceStore = create<WorkspaceState>((set, get) => {
  const addTab = (convId: string, cwd: string, extra: Partial<TabRef> = {}): void => {
    const now = Date.now()
    set((s) =>
      s.tabs.some((t) => t.convId === convId)
        ? s
        : { tabs: [...s.tabs, { convId, cwd, openedAt: now, lastActiveAt: now, ...extra }] }
    )
  }

  /** Make a conversation the shown one: cwd follows it, unread clears, LRU stamps. */
  const show = (convId: string, opts: { chatView?: boolean } = {}): void => {
    const chat = useChatStore.getState()
    const conv = chat.convs[convId]
    if (!conv) return
    const now = Date.now()
    writeLastCwd(conv.cwd)
    set((s) => {
      const { [convId]: _u, ...unread } = s.unread
      void _u
      const tab = s.tabs.find((t) => t.convId === convId)
      return {
        cwd: conv.cwd,
        activeConvId: convId,
        activeTitle: tab?.title,
        activeBranch: undefined,
        loadingSession: false,
        ...(opts.chatView ? { view: 'chat' as const } : {}),
        unread,
        tabs: s.tabs.map((t) => (t.convId === convId ? { ...t, lastActiveAt: now } : t))
      }
    })
    chat.touchConv(convId)
    void ensureLoaded(convId)
  }

  const startDraft = (cwd: string, opts: { chatView?: boolean } = {}): void => {
    const convId = `new-${Date.now()}-${++draftSeq}`
    useChatStore.getState().createConv({ convId, cwd })
    loaded.add(convId)
    addTab(convId, cwd)
    show(convId, opts)
  }

  const loadHistory = async (convId: string, sessionId: string, cwd: string, fileSize?: number): Promise<void> => {
    loaded.add(convId)
    if (get().activeConvId === convId) set({ loadingSession: true })
    try {
      const events = await window.ccwrap.history.load({ sessionId, cwd })
      useChatStore.getState().seedFromHistory(convId, events)
      if ((fileSize ?? 0) > TRUNCATION_BYTES && events.length < TRUNCATION_EVENTS) {
        useChatStore.getState().setNotice(convId, 'History may be incomplete (large or compacted session)')
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      useChatStore.getState().seedFromHistory(convId, [{ t: 'error', message }])
    } finally {
      if (get().activeConvId === convId) set({ loadingSession: false })
    }
  }

  /** Lazy restore: a history tab's transcript loads the first time it is shown. */
  const ensureLoaded = async (convId: string): Promise<void> => {
    if (loaded.has(convId)) return
    const tab = get().tabs.find((t) => t.convId === convId)
    const conv = useChatStore.getState().convs[convId]
    if (!tab?.sessionId || !conv || conv.localId || conv.items.length > 0) {
      loaded.add(convId)
      return
    }
    await loadHistory(convId, tab.sessionId, tab.cwd)
  }

  const doOpenSession = async (s: HistorySessionInfo): Promise<void> => {
    const chat = useChatStore.getState()
    const existing = get().tabs.find((t) => t.sessionId === s.sessionId)
    if (existing && chat.convs[existing.convId]) {
      show(existing.convId, { chatView: true })
      return
    }
    const convId = `hist-${s.sessionId}`
    if (!chat.convs[convId]) {
      chat.createConv({ convId, cwd: s.cwd, resumeSessionId: s.sessionId })
      loaded.add(convId)
      addTab(convId, s.cwd, { sessionId: s.sessionId, title: s.title })
      show(convId, { chatView: true })
      set({ activeBranch: s.gitBranch })
      await loadHistory(convId, s.sessionId, s.cwd, s.fileSize)
    } else {
      addTab(convId, s.cwd, { sessionId: s.sessionId, title: s.title })
      show(convId, { chatView: true })
    }
  }

  const doClose = async (convId: string): Promise<void> => {
    const { tabs, activeConvId, view } = get()
    const idx = tabs.findIndex((t) => t.convId === convId)
    const remaining = tabs.filter((t) => t.convId !== convId)
    const neighbor = remaining[Math.min(Math.max(idx, 0), remaining.length - 1)]
    const wasActive = activeConvId === convId
    const apply = (): void => {
      loaded.delete(convId)
      set((s) => {
        const { [convId]: _u, ...unread } = s.unread
        void _u
        return { tabs: s.tabs.filter((t) => t.convId !== convId), unread }
      })
      if (wasActive) {
        if (neighbor) show(neighbor.convId)
        else set({ activeConvId: undefined, activeTitle: undefined, activeBranch: undefined })
      }
      void useChatStore.getState().closeConv(convId)
    }
    if (wasActive && neighbor && view !== 'chat' && cwdKey(neighbor.cwd) !== cwdKey(get().cwd ?? '')) {
      useDirtyRegistry.getState().guard(apply)
    } else apply()
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
    tabs: [],
    unread: {},

    selectProject: (cwd) => {
      const go = (): void => {
        writeLastCwd(cwd)
        const { tabs } = get()
        const convs = useChatStore.getState().convs
        const recent = tabs
          .filter((t) => cwdKey(t.cwd) === cwdKey(cwd) && convs[t.convId])
          .reduce<TabRef | undefined>((best, t) => (!best || t.lastActiveAt >= best.lastActiveAt ? t : best), undefined)
        if (recent) show(recent.convId)
        else startDraft(cwd)
      }
      // Re-selecting the current project keeps the open page mounted, so it never loses edits.
      const cur = get().cwd
      if (cur && cwdKey(cur) === cwdKey(cwd)) go()
      else useDirtyRegistry.getState().guard(go)
    },

    newTab: (cwd) => {
      const target = cwd ?? get().cwd
      if (!target) return
      useDirtyRegistry.getState().guard(() => {
        const convs = useChatStore.getState().convs
        const reuse = get().tabs.find((t) => cwdKey(t.cwd) === cwdKey(target) && isEmptyDraft(t, convs[t.convId]))
        if (reuse) show(reuse.convId, { chatView: true })
        else startDraft(target, { chatView: true })
      })
    },

    newSession: () => get().newTab(),

    openSession: (s) => {
      // Opening a session switches to chat (and maybe project): ask first when a page has unsaved edits.
      return new Promise<void>((resolve) => {
        useDirtyRegistry.getState().guard(() => void doOpenSession(s).then(resolve, resolve))
      })
    },

    activateTab: (convId) => {
      if (!useChatStore.getState().convs[convId]) return
      if (get().activeConvId === convId && get().view === 'chat') return
      useDirtyRegistry.getState().guard(() => show(convId, { chatView: true }))
    },

    closeTab: async (convId) => {
      const conv = useChatStore.getState().convs[convId]
      if (conv && isBusyConv(conv)) {
        set({ pendingClose: convId })
        return
      }
      await doClose(convId)
    },

    confirmClose: async () => {
      const convId = get().pendingClose
      if (!convId) return
      set({ pendingClose: undefined })
      const conv = useChatStore.getState().convs[convId]
      if (conv && selectIsRunning(conv)) await useChatStore.getState().interrupt(convId)
      await doClose(convId)
    },

    cancelClose: () => set({ pendingClose: undefined }),

    cycleTab: (dir) => {
      const { tabs, activeConvId } = get()
      if (tabs.length < 2) return
      const i = tabs.findIndex((t) => t.convId === activeConvId)
      const next = tabs[(((i < 0 ? 0 : i + dir) % tabs.length) + tabs.length) % tabs.length]
      if (next) get().activateTab(next.convId)
    },

    restoreTabs: (data) => {
      if (get().tabs.length > 0) return
      const chat = useChatStore.getState()
      const now = Date.now()
      const seen = new Set<string>()
      const restored: TabRef[] = []
      for (const p of data.tabs) {
        if (!p.sessionId || seen.has(p.sessionId)) continue
        seen.add(p.sessionId)
        const convId = `hist-${p.sessionId}`
        loaded.delete(convId)
        chat.createConv({ convId, cwd: p.cwd, resumeSessionId: p.sessionId })
        // Bypass is never persisted, so a restored tab is Default unless it saved another mode.
        if (p.mode) chat.seedMode(convId, p.mode)
        restored.push({
          convId,
          cwd: p.cwd,
          sessionId: p.sessionId,
          ...(p.title ? { title: p.title } : {}),
          openedAt: now,
          lastActiveAt: now - (data.tabs.length - restored.length)
        })
      }
      if (restored.length === 0) return
      set({ tabs: restored })
      const active = restored.find((t) => t.convId === data.activeConvId)
      if (active) show(active.convId, { chatView: true })
    },

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

const TITLE_MAX = 40

/** Keep tab session ids and titles in step with their conversations, and mark background results unread. */
const lastResults = new Map<string, unknown>()
useChatStore.subscribe((state, prev) => {
  if (state.convs === prev.convs) return
  const ws = useWorkspaceStore.getState()
  let tabsChanged = false
  const tabs = ws.tabs.map((t) => {
    const c = state.convs[t.convId]
    if (!c) return t
    let next = t
    const sid = c.meta.sessionId ?? c.resumeSessionId
    if (sid && sid !== t.sessionId) next = { ...next, sessionId: sid }
    if (!t.title) {
      const first = c.items.find((i) => i.kind === 'user')
      if (first && first.kind === 'user') {
        const line = first.text.replace(/\s+/g, ' ').trim()
        if (line) next = { ...next, title: line.length > TITLE_MAX ? `${line.slice(0, TITLE_MAX - 1)}…` : line }
      }
    }
    if (next !== t) tabsChanged = true
    return next
  })
  let unread = ws.unread
  for (const c of Object.values(state.convs)) {
    const had = lastResults.has(c.convId)
    const before = lastResults.get(c.convId)
    lastResults.set(c.convId, c.lastResult)
    const isTab = ws.tabs.some((t) => t.convId === c.convId)
    if (had && isTab && c.lastResult && c.lastResult !== before && c.convId !== ws.activeConvId && !unread[c.convId]) {
      unread = { ...unread, [c.convId]: true }
    }
  }
  if (tabsChanged || unread !== ws.unread) {
    useWorkspaceStore.setState({ ...(tabsChanged ? { tabs } : {}), unread })
  }
})
