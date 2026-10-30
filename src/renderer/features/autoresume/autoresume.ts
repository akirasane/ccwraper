import { useEffect } from 'react'
import { create } from 'zustand'
import { DEFAULT_PREFS } from '@shared/app'
import type { AutoResumePrefs } from '@shared/app'
import { tabTitle } from '@/features/tabs/tab-status'
import { useChatStore } from '@/stores/chat-store'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { AutoResumeController, type Pause, type PersistedAutoResume } from './controller'

/** localStorage key for pending pauses and the loop-guard history (survives an app restart). */
export const AUTORESUME_KEY = 'ccwrap.autoresume.v1'

interface AutoResumeView {
  pauses: Record<string, Pause>
  prefs: AutoResumePrefs
}

export const useAutoResumeStore = create<AutoResumeView>(() => ({
  pauses: {},
  prefs: { ...DEFAULT_PREFS.autoResume }
}))

let controller: AutoResumeController | undefined

/** The running controller (undefined before the app shell mounted it). */
export const getAutoResume = (): AutoResumeController | undefined => controller

export function parsePersisted(raw: string | null): PersistedAutoResume | undefined {
  if (!raw) return undefined
  try {
    const v = JSON.parse(raw) as Partial<PersistedAutoResume> | null
    if (!v || !Array.isArray(v.pauses)) return undefined
    const pauses = v.pauses.filter(
      (p) =>
        p &&
        typeof p.convId === 'string' &&
        typeof p.sessionId === 'string' &&
        p.sessionId &&
        typeof p.resetAt === 'number' &&
        Number.isFinite(p.resetAt)
    )
    const history: Record<string, number[]> = {}
    if (v.history && typeof v.history === 'object') {
      for (const [k, arr] of Object.entries(v.history)) {
        if (Array.isArray(arr)) history[k] = arr.filter((t): t is number => typeof t === 'number')
      }
    }
    return { pauses, history }
  } catch {
    return undefined
  }
}

async function resumeConv(convId: string, prompt: string): Promise<void> {
  const chat = useChatStore.getState()
  const c = chat.convs[convId]
  if (!c) return
  // The query loop ended (crash, suspended, restart): resume the saved session id instead of sending to a dead handle.
  if (c.localId && c.closed) await chat.suspend(convId)
  await useChatStore.getState().submit(convId, prompt)
}

/**
 * Wire the controller to the stores: a conversation that gets `limit` becomes a pause; one whose `limit` clears
 * (a new turn started) or whose tab closed drops it. Call once after tabs were restored. Returns the disposer.
 */
export function startAutoResume(): () => void {
  if (controller) return () => {}
  const report = (r: Parameters<NonNullable<Window['ccwrap']['autoResume']>['report']>[0]): void => {
    try {
      window.ccwrap?.autoResume?.report(r)
    } catch {
      /* fire-and-forget */
    }
  }
  const c = new AutoResumeController({
    now: () => Date.now(),
    setInterval: (fn, ms) => setInterval(fn, ms),
    clearInterval: (h) => clearInterval(h as ReturnType<typeof setInterval>),
    getPrefs: () => useAutoResumeStore.getState().prefs,
    resume: resumeConv,
    titleOf: (convId) => {
      const tab = useWorkspaceStore.getState().tabs.find((t) => t.convId === convId)
      const conv = useChatStore.getState().convs[convId]
      return tab ? tabTitle(tab, conv) : undefined
    },
    report,
    load: () => {
      try {
        return parsePersisted(window.localStorage.getItem(AUTORESUME_KEY))
      } catch {
        return undefined
      }
    },
    save: (p) => {
      try {
        window.localStorage.setItem(AUTORESUME_KEY, JSON.stringify(p))
      } catch {
        /* ignore */
      }
    },
    onChange: (pauses) => useAutoResumeStore.setState({ pauses })
  })
  controller = c

  const lastLimit = new Map<string, unknown>()
  const sync = (convs: ReturnType<typeof useChatStore.getState>['convs']): void => {
    for (const conv of Object.values(convs)) {
      if (lastLimit.get(conv.convId) === conv.limit) continue
      lastLimit.set(conv.convId, conv.limit)
      if (conv.limit) {
        const sessionId = conv.meta.sessionId ?? conv.resumeSessionId
        c.noteLimit(conv.convId, {
          ...(conv.limit.resetsAt !== undefined ? { resetsAt: conv.limit.resetsAt } : {}),
          ...(conv.limit.limitType ? { limitType: conv.limit.limitType } : {}),
          ...(sessionId ? { sessionId } : {})
        })
      } else c.drop(conv.convId)
    }
    for (const id of [...lastLimit.keys()]) {
      if (!convs[id]) {
        lastLimit.delete(id)
        c.drop(id)
      }
    }
  }

  // Pauses saved by a previous run: show the limit state again on their (restored) tabs, then let the tick decide.
  const restored = c.restore((id, sessionId) => {
    const convs = useChatStore.getState().convs
    if (convs[id]) return id
    return convs[`hist-${sessionId}`] ? `hist-${sessionId}` : undefined
  })
  for (const p of restored) {
    useChatStore.getState().seedFromHistory(p.convId, [
      { t: 'rate_limited', source: 'event', ...(p.resetAt !== undefined ? { resetsAt: p.resetAt } : {}), ...(p.limitType ? { limitType: p.limitType } : {}) }
    ])
  }
  sync(useChatStore.getState().convs)
  const offChat = useChatStore.subscribe((s, prev) => {
    if (s.convs !== prev.convs) sync(s.convs)
  })

  const applyPrefs = (p: AutoResumePrefs | undefined): void => {
    if (!p) return
    useAutoResumeStore.setState({ prefs: { enabled: p.enabled, prompt: p.prompt } })
    c.refresh()
  }
  let offPrefs: (() => void) | undefined
  try {
    void window.ccwrap?.prefs
      ?.get()
      .then((p) => applyPrefs(p.autoResume))
      .catch(() => {})
    offPrefs = window.ccwrap?.prefs?.onChanged((p) => applyPrefs(p.autoResume))
  } catch {
    /* prefs unavailable: auto-resume stays off */
  }

  return () => {
    offChat()
    offPrefs?.()
    c.dispose()
    controller = undefined
    useAutoResumeStore.setState({ pauses: {} })
  }
}

/** Mount once in the app shell, after the tab restore effect. */
export function useAutoResume(): void {
  useEffect(() => startAutoResume(), [])
}
