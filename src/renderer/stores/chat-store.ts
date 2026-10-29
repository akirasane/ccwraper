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
  createConv: (target: ChatTarget) => void
  removeConv: (convId: string) => void
  seedFromHistory: (convId: string, events: SessionEvent[]) => void
  bindLocalId: (convId: string, localId: string) => void
  applyEvent: (localId: string, e: SessionEvent) => void
  submit: (convId: string, text: string) => Promise<void>
  interrupt: (convId: string) => Promise<void>
  replyPermission: (
    convId: string,
    reqId: string,
    decision: 'allow' | 'deny',
    remember?: 'once' | 'session' | 'always'
  ) => Promise<void>
  setPermissionMode: (convId: string, mode: PermissionMode) => Promise<void>
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

const isDelta = (e: SessionEvent): boolean => e.t === 'text_delta' || e.t === 'thinking_delta'

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
      patch(convId, (x) => addUserItem(x, text))
      try {
        if (c.localId) {
          await window.ccwrap.session.send({ localId: c.localId, text })
        } else {
          const mode = get().modes[convId]
          const { localId } = await window.ccwrap.session.start({
            cwd: c.cwd,
            prompt: text,
            ...(c.resumeSessionId ? { resumeId: c.resumeSessionId } : {}),
            ...(mode ? { permissionMode: mode } : {})
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
      try {
        await window.ccwrap.session.interrupt(localId)
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
    }
  }
})

/** Apply any queued (coalesced) events immediately; used by tests and before unmount. */
export function flushChatEvents(): void {
  flushNow()
}
