import { useWorkspaceStore, type TabRef } from '@/stores/workspace-store'

/** localStorage key for the open tabs (P4 D2). */
export const TABS_KEY = 'ccwrap.tabs.v1'
const DEBOUNCE_MS = 300

export interface PersistedTab {
  convId: string
  cwd: string
  sessionId?: string
  title?: string
}
export interface PersistedTabs {
  tabs: PersistedTab[]
  activeConvId?: string
}

/** Only tabs with a session survive a restart; the active one is stored under its history conv id. */
export function serializeTabs(tabs: TabRef[], activeConvId: string | undefined): PersistedTabs {
  const kept = tabs.filter((t) => !!t.sessionId)
  const active = kept.find((t) => t.convId === activeConvId)
  return {
    tabs: kept.map((t) => ({
      convId: `hist-${t.sessionId}`,
      cwd: t.cwd,
      sessionId: t.sessionId,
      ...(t.title ? { title: t.title } : {})
    })),
    ...(active ? { activeConvId: `hist-${active.sessionId}` } : {})
  }
}

/** Tolerant parse: anything malformed gives undefined (a fresh start). */
export function parseTabs(raw: string | null): PersistedTabs | undefined {
  if (!raw) return undefined
  try {
    const v = JSON.parse(raw) as unknown
    if (!v || typeof v !== 'object' || !Array.isArray((v as PersistedTabs).tabs)) return undefined
    const tabs: PersistedTab[] = []
    for (const t of (v as PersistedTabs).tabs as unknown[]) {
      const o = t as Partial<PersistedTab> | null
      if (o && typeof o.cwd === 'string' && typeof o.sessionId === 'string' && o.sessionId) {
        tabs.push({
          convId: typeof o.convId === 'string' ? o.convId : `hist-${o.sessionId}`,
          cwd: o.cwd,
          sessionId: o.sessionId,
          ...(typeof o.title === 'string' && o.title ? { title: o.title } : {})
        })
      }
    }
    const active = (v as PersistedTabs).activeConvId
    return { tabs, ...(typeof active === 'string' ? { activeConvId: active } : {}) }
  } catch {
    return undefined
  }
}

export function readPersistedTabs(): PersistedTabs | undefined {
  try {
    return parseTabs(window.localStorage.getItem(TABS_KEY))
  } catch {
    return undefined
  }
}

function write(): void {
  try {
    const { tabs, activeConvId } = useWorkspaceStore.getState()
    window.localStorage.setItem(TABS_KEY, JSON.stringify(serializeTabs(tabs, activeConvId)))
  } catch {
    /* storage unavailable: tabs just will not come back */
  }
}

/** Write `tabs.v1` (debounced 300 ms) on every tab-list or active-tab change. Returns the unsubscribe. */
export function startTabPersistence(): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  const off = useWorkspaceStore.subscribe((s, prev) => {
    if (s.tabs === prev.tabs && s.activeConvId === prev.activeConvId) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = undefined
      write()
    }, DEBOUNCE_MS)
  })
  return () => {
    off()
    if (timer) {
      clearTimeout(timer)
      write()
    }
  }
}
