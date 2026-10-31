import { create } from 'zustand'
import type { SessionEvent } from '@shared/events'
import type { PermissionMode } from '@shared/ipc'
import {
  addUserItem,
  createConvState,
  reduce,
  reduceAll,
  resolvePermission
} from '@/features/chat/model/reducer'
import { selectIsRunning, selectRunningTasks } from '@/features/chat/model/selectors'
import type { ChatTarget, ConvState } from '@/features/chat/model/types'
import { isBypass, modeLabel } from '@/features/chat/mode/modes'
import { toast } from '@/components/ui/toaster'

/** Main caps live sessions at this many; the renderer suspends the least recently used idle one first (P4 D2). */
export const MAX_LIVE_SESSIONS = 5
export const CAP_MESSAGE = '5 sessions are active. Stop or close one to start another.'

/** A conversation with an open session in main (bound and not ended). */
export const isLive = (c: ConvState): boolean => !!c.localId && !c.closed

/** No running turn, no pending permission, no running task: safe to suspend or close silently. */
export const isIdleConv = (c: ConvState): boolean =>
  !selectIsRunning(c) && c.pending.length === 0 && selectRunningTasks(c).length === 0

interface ChatState {
  convs: Record<string, ConvState>
  /** main-process session handle -> conversation id */
  localToConv: Record<string, string>
  /** Permission mode to use when the session starts / was last chosen. */
  modes: Record<string, PermissionMode>
  /** Model chosen on a draft (no live session yet); sent with session:start. */
  draftModels: Record<string, string>
  /** Composer text per conversation (P4 D2); survives tab switches, not restarts. */
  drafts: Record<string, string>
  /** Last time each conversation was shown or submitted to (LRU for suspension). */
  lastActive: Record<string, number>
  setDraft: (convId: string, text: string) => void
  touchConv: (convId: string) => void
  /** Close the main session but keep the conversation; its next submit resumes it. */
  suspend: (convId: string) => Promise<void>
  /** Close the main session (if any) and drop the conversation. */
  closeConv: (convId: string) => Promise<void>
  createConv: (target: ChatTarget) => void
  removeConv: (convId: string) => void
  seedFromHistory: (convId: string, events: SessionEvent[]) => void
  bindLocalId: (convId: string, localId: string) => void
  applyEvent: (localId: string, e: SessionEvent) => void
  submit: (convId: string, text: string) => Promise<void>
  interrupt: (convId: string) => Promise<void>
  stopTask: (convId: string, taskId: string) => Promise<void>
  replyPermission: (
    convId: string,
    reqId: string,
    decision: 'allow' | 'deny',
    remember?: 'once' | 'session' | 'always' | 'user',
    updatedInput?: Record<string, unknown>
  ) => Promise<void>
  setPermissionMode: (convId: string, mode: PermissionMode) => Promise<void>
  /** Restores a persisted (never Bypass) mode for a tab whose session has not started yet. */
  seedMode: (convId: string, mode: PermissionMode) => void
  setModel: (convId: string, model: string) => Promise<void>
  setNotice: (convId: string, notice: string | undefined) => void
}

// Events that arrive before start() resolves have no binding yet; replayed on bind.
const orphans = new Map<string, SessionEvent[]>()
// Mode asked for at session start, checked against the init echo (the engine's answer is the truth).
const startRequested = new Map<string, PermissionMode>()
// Handles of sessions we closed on purpose: their trailing events must not pile up as orphans.
const retired = new Set<string>()
// Delta coalescing: at most one store update per animation frame.
let queue: { localId: string; event: SessionEvent }[] = []
let scheduled: number | ReturnType<typeof setTimeout> | undefined
let usingRaf = false

function schedule(flush: () => void): void {
  if (scheduled !== undefined) return
  if (typeof requestAnimationFrame === 'function') {
    usingRaf = true
    scheduled = requestAnimationFrame(flush)
  } else {
    usingRaf = false
    scheduled = setTimeout(flush, 16)
  }
}

function cancelScheduled(): void {
  if (scheduled === undefined) return
  if (usingRaf) cancelAnimationFrame(scheduled as number)
  else clearTimeout(scheduled as ReturnType<typeof setTimeout>)
  scheduled = undefined
}

let flushNow: () => void = () => {}

// High-frequency events coalesced to one store update per frame (FIFO order kept).
const isDelta = (e: SessionEvent): boolean =>
  e.t === 'text_delta' ||
  e.t === 'thinking_delta' ||
  e.t === 'usage_live' ||
  e.t === 'task_progress' ||
  e.t === 'tool_progress'

const CTX_KEY = 'ccwrap.ctxWindow'

/** model -> context window learned from past results (localStorage; best effort). */
export function getCachedCtxWindow(model: string | undefined): number | undefined {
  if (!model) return undefined
  try {
    const raw = localStorage.getItem(CTX_KEY)
    const v = raw ? (JSON.parse(raw) as Record<string, number>)[model] : undefined
    return typeof v === 'number' && v > 0 ? v : undefined
  } catch {
    return undefined
  }
}

function cacheCtxWindow(model: string | undefined, window: number): void {
  if (!model || getCachedCtxWindow(model) === window) return
  try {
    const raw = localStorage.getItem(CTX_KEY)
    const map = raw ? (JSON.parse(raw) as Record<string, number>) : {}
    localStorage.setItem(CTX_KEY, JSON.stringify({ ...map, [model]: window }))
  } catch {
    /* storage unavailable */
  }
}

/** Optimistic: running tasks (or just one) show as stopping until the CLI confirms. */
function markTasksStopping(c: ConvState, only?: string): ConvState {
  let tasks: ConvState['tasks'] | undefined
  for (const [id, t] of Object.entries(c.tasks)) {
    if (t.status !== 'running' || (only !== undefined && id !== only)) continue
    tasks ??= { ...c.tasks }
    tasks[id] = { ...t, status: 'stopping' }
  }
  return tasks ? { ...c, tasks } : c
}

/** The mode to show: a live session reports its own (init echo or confirmed change); otherwise what the next start will request. Never a stale replayed mode. */
export function effectiveMode(s: Pick<ChatState, 'convs' | 'modes'>, convId: string): PermissionMode {
  const c = s.convs[convId]
  const live = !!c?.localId && !c.closed
  const m = live ? (c.meta.permissionMode ?? s.modes[convId]) : s.modes[convId]
  return (m ?? 'default') as PermissionMode
}

function reasonOf(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).replace(/^Error invoking remote method '[^']*': (Error: )?/, '')
}

export const useChatStore = create<ChatState>((set, get) => {
  const patch = (convId: string, fn: (c: ConvState) => ConvState): void =>
    set((s) => {
      const c = s.convs[convId]
      return c ? { convs: { ...s.convs, [convId]: fn(c) } } : s
    })

  const applyBatch = (items: { localId: string; event: SessionEvent }[]): void => {
    if (items.length === 0) return
    const now = Date.now()
    set((s) => {
      const convs = { ...s.convs }
      for (const { localId, event } of items) {
        if (retired.has(localId)) continue
        const convId = s.localToConv[localId]
        const c = convId ? convs[convId] : undefined
        if (!convId || !c) {
          const buf = orphans.get(localId) ?? []
          buf.push(event)
          orphans.set(localId, buf)
          continue
        }
        if (event.t === 'result' && event.contextWindow) cacheCtxWindow(c.meta.model, event.contextWindow)
        if (event.t === 'init') verifyStartMode(convId, event.permissionMode)
        convs[convId] = reduce(c, event, now)
      }
      return { convs }
    })
  }

  /** The init echo is the truth. A mismatch with what start asked for gets a toast, and the UI follows the engine. */
  const verifyStartMode = (convId: string, engine: string | undefined): void => {
    const asked = startRequested.get(convId)
    startRequested.delete(convId)
    if (!asked || !engine || engine === asked) return
    // Deferred: applyBatch is inside a set() call.
    queueMicrotask(() => {
      set((s) => ({ modes: { ...s.modes, [convId]: engine as PermissionMode } }))
      toast.error(`Could not start in ${modeLabel(asked)} mode`, {
        description: `The session is in ${modeLabel(engine)} mode. ${isBypass(asked) ? "The folder's settings or this Claude Code build may disable Bypass." : 'This Claude Code build or the folder settings may not allow it.'}`
      })
    })
  }

  const flush = (): void => {
    cancelScheduled()
    const batch = queue
    queue = []
    applyBatch(batch)
  }

  flushNow = flush

  const fail = (convId: string, err: unknown): void => {
    const message = err instanceof Error ? err.message : String(err)
    patch(convId, (c) => reduce(c, { t: 'error', message }, Date.now()))
  }

  return {
    convs: {},
    localToConv: {},
    modes: {},
    draftModels: {},
    drafts: {},
    lastActive: {},

    setDraft: (convId, text) =>
      set((s) => {
        if ((s.drafts[convId] ?? '') === text) return s
        if (text === '') {
          const { [convId]: _d, ...drafts } = s.drafts
          void _d
          return { drafts }
        }
        return { drafts: { ...s.drafts, [convId]: text } }
      }),

    touchConv: (convId) => set((s) => ({ lastActive: { ...s.lastActive, [convId]: Date.now() } })),

    suspend: async (convId) => {
      const c = get().convs[convId]
      const localId = c?.localId
      if (!c || !localId) return
      retired.add(localId)
      const { localId: _l, closed: _c, ...rest } = c
      void _l
      void _c
      const resume = c.meta.sessionId ?? c.resumeSessionId
      // Bypass never survives a suspend: the resumed session starts in Default.
      const wasBypass = isBypass(effectiveMode(get(), convId))
      set((s) => ({
        localToConv: Object.fromEntries(Object.entries(s.localToConv).filter(([k]) => k !== localId)),
        ...(wasBypass ? { modes: { ...s.modes, [convId]: 'default' as const } } : {}),
        convs: {
          ...s.convs,
          [convId]: {
            ...rest,
            ...(wasBypass ? { meta: { ...rest.meta, permissionMode: 'default' } } : {}),
            ...(resume ? { resumeSessionId: resume } : {}),
            status: 'idle'
          }
        }
      }))
      if (wasBypass) toast.info('Bypass mode ended', { description: 'This session was suspended. It resumes in Default mode.' })
      try {
        await window.ccwrap.session.close(localId)
      } catch {
        /* already gone in main */
      }
    },

    closeConv: async (convId) => {
      const localId = get().convs[convId]?.localId
      if (localId) {
        try {
          await window.ccwrap.session.close(localId)
        } catch {
          /* already gone in main */
        }
      }
      get().removeConv(convId)
    },

    createConv: (target) =>
      set((s) => {
        if (s.convs[target.convId]) return s
        return {
          convs: { ...s.convs, [target.convId]: createConvState(target) },
          localToConv: target.localId ? { ...s.localToConv, [target.localId]: target.convId } : s.localToConv
        }
      }),

    removeConv: (convId) =>
      set((s) => {
        const { [convId]: gone, ...convs } = s.convs
        const localToConv = Object.fromEntries(Object.entries(s.localToConv).filter(([, v]) => v !== convId))
        if (gone?.localId) retired.add(gone.localId)
        const { [convId]: _d, ...drafts } = s.drafts
        const { [convId]: _a, ...lastActive } = s.lastActive
        void _d
        void _a
        return { convs, localToConv, drafts, lastActive }
      }),

    seedFromHistory: (convId, events) => patch(convId, (c) => reduceAll(c, events, Date.now())),

    bindLocalId: (convId, localId) => {
      set((s) => {
        const c = s.convs[convId]
        return {
          localToConv: { ...s.localToConv, [localId]: convId },
          convs: c ? { ...s.convs, [convId]: { ...c, localId } } : s.convs
        }
      })
      const buffered = orphans.get(localId)
      if (buffered) {
        orphans.delete(localId)
        // Keep ordering with anything already queued for this localId.
        queue = [...buffered.map((event) => ({ localId, event })), ...queue]
        flush()
      }
    },

    applyEvent: (localId, event) => {
      queue.push({ localId, event })
      if (isDelta(event)) schedule(flush)
      else flush() // flush queued deltas first so ordering is preserved
    },

    submit: async (convId, text) => {
      const c = get().convs[convId]
      if (!c) return
      if (!c.localId && Object.values(get().convs).filter(isLive).length >= MAX_LIVE_SESSIONS) {
        // At the cap: free a slot by suspending the least recently used idle conversation.
        const victim = Object.values(get().convs)
          .filter((x) => isLive(x) && isIdleConv(x) && (x.meta.sessionId ?? x.resumeSessionId))
          .sort((a, b) => (get().lastActive[a.convId] ?? 0) - (get().lastActive[b.convId] ?? 0))[0]
        if (!victim) {
          get().setDraft(convId, text)
          fail(convId, new Error(CAP_MESSAGE))
          return
        }
        await get().suspend(victim.convId)
      }
      set((s) => ({ lastActive: { ...s.lastActive, [convId]: Date.now() } }))
      patch(convId, (x) => addUserItem(x, text, Date.now()))
      try {
        if (c.localId) {
          await window.ccwrap.session.send({ localId: c.localId, text })
        } else {
          const mode = get().modes[convId]
          if (mode) startRequested.set(convId, mode)
          const model = get().draftModels[convId]
          const { localId } = await window.ccwrap.session.start({
            cwd: c.cwd,
            prompt: text,
            ...(c.resumeSessionId ? { resumeId: c.resumeSessionId } : {}),
            ...(mode ? { permissionMode: mode } : {}),
            ...(model && model !== 'default' ? { model } : {})
          })
          get().bindLocalId(convId, localId)
        }
      } catch (err) {
        startRequested.delete(convId)
        if (!c.localId && isBypass(get().modes[convId])) {
          set((s) => ({ modes: { ...s.modes, [convId]: 'default' } }))
          toast.error('Could not start in Bypass mode', { description: reasonOf(err) })
        }
        fail(convId, err)
      }
    },

    interrupt: async (convId) => {
      const localId = get().convs[convId]?.localId
      if (!localId) return
      patch(convId, markTasksStopping)
      try {
        await window.ccwrap.session.interrupt(localId)
      } catch (err) {
        fail(convId, err)
      }
    },

    stopTask: async (convId, taskId) => {
      const localId = get().convs[convId]?.localId
      if (!localId) return
      patch(convId, (c) => markTasksStopping(c, taskId))
      try {
        await window.ccwrap.session.stopTask(localId, taskId)
      } catch (err) {
        fail(convId, err)
      }
    },

    replyPermission: async (convId, reqId, decision, remember, updatedInput) => {
      const localId = get().convs[convId]?.localId
      if (!localId) return
      patch(convId, (x) => resolvePermission(x, reqId, decision, Date.now()))
      try {
        await window.ccwrap.session.permissionReply({
          localId,
          reqId,
          decision,
          ...(remember ? { remember } : {}),
          ...(updatedInput ? { updatedInput } : {})
        })
      } catch (err) {
        fail(convId, err)
      }
    },

    setPermissionMode: async (convId, mode) => {
      const prev = effectiveMode(get(), convId)
      const prevMeta = get().convs[convId]?.meta.permissionMode
      const prevModes = get().modes[convId]
      set((s) => ({ modes: { ...s.modes, [convId]: mode } }))
      patch(convId, (c) => ({ ...c, meta: { ...c.meta, permissionMode: mode } }))
      const localId = get().convs[convId]?.localId
      if (!localId) return
      try {
        await window.ccwrap.session.setPermissionMode(localId, mode)
      } catch (err) {
        // Refused: put the previous mode back. Never show a mode the engine is not in.
        set((s) => {
          const modes = { ...s.modes }
          if (prevModes) modes[convId] = prevModes
          else delete modes[convId]
          return { modes }
        })
        patch(convId, (c) => ({ ...c, meta: { ...c.meta, permissionMode: prevMeta ?? prev } }))
        toast.error(`Could not switch to ${modeLabel(mode)} mode`, { description: reasonOf(err) })
      }
    },

    seedMode: (convId, mode) => {
      if (isBypass(mode)) return
      set((s) => ({ modes: { ...s.modes, [convId]: mode } }))
    },

    setModel: async (convId, model) => {
      const localId = get().convs[convId]?.localId
      if (!localId) {
        set((s) => ({ draftModels: { ...s.draftModels, [convId]: model } }))
        patch(convId, (c) => ({ ...c, meta: { ...c.meta, model } }))
        return
      }
      try {
        await window.ccwrap.session.setModel(localId, model)
        patch(convId, (c) => ({ ...c, meta: { ...c.meta, model } }))
      } catch (err) {
        fail(convId, err)
      }
    },

    setNotice: (convId, notice) =>
      patch(convId, (c) => {
        const { notice: _drop, ...rest } = c
        void _drop
        return notice ? { ...rest, notice } : rest
      })
  }
})

/** Apply any queued (coalesced) events immediately; used by tests and before unmount. */
export function flushChatEvents(): void {
  flushNow()
}
