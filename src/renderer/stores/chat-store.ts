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
import type { ChatTarget, ConvState } from '@/features/chat/model/types'

interface ChatState {
  convs: Record<string, ConvState>
  /** main-process session handle -> conversation id */
  localToConv: Record<string, string>
  /** Permission mode to use when the session starts / was last chosen. */
  modes: Record<string, PermissionMode>
  /** Model chosen on a draft (no live session yet); sent with session:start. */
  draftModels: Record<string, string>
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
    remember?: 'once' | 'session' | 'always' | 'user'
  ) => Promise<void>
  setPermissionMode: (convId: string, mode: PermissionMode) => Promise<void>
  setModel: (convId: string, model: string) => Promise<void>
  setNotice: (convId: string, notice: string | undefined) => void
}

// Events that arrive before start() resolves have no binding yet; replayed on bind.
const orphans = new Map<string, SessionEvent[]>()
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
        const convId = s.localToConv[localId]
        const c = convId ? convs[convId] : undefined
        if (!convId || !c) {
          const buf = orphans.get(localId) ?? []
          buf.push(event)
          orphans.set(localId, buf)
          continue
        }
        if (event.t === 'result' && event.contextWindow) cacheCtxWindow(c.meta.model, event.contextWindow)
        convs[convId] = reduce(c, event, now)
      }
      return { convs }
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
        void gone
        return { convs, localToConv }
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
      patch(convId, (x) => addUserItem(x, text, Date.now()))
      try {
        if (c.localId) {
          await window.ccwrap.session.send({ localId: c.localId, text })
        } else {
          const mode = get().modes[convId]
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

    replyPermission: async (convId, reqId, decision, remember) => {
      const localId = get().convs[convId]?.localId
      if (!localId) return
      patch(convId, (x) => resolvePermission(x, reqId, decision, Date.now()))
      try {
        await window.ccwrap.session.permissionReply({
          localId,
          reqId,
          decision,
          ...(remember ? { remember } : {})
        })
      } catch (err) {
        fail(convId, err)
      }
    },

    setPermissionMode: async (convId, mode) => {
      set((s) => ({ modes: { ...s.modes, [convId]: mode } }))
      patch(convId, (c) => ({ ...c, meta: { ...c.meta, permissionMode: mode } }))
      const localId = get().convs[convId]?.localId
      if (!localId) return
      try {
        await window.ccwrap.session.setPermissionMode(localId, mode)
      } catch (err) {
        fail(convId, err)
      }
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
