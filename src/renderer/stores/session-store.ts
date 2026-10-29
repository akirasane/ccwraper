import { create } from 'zustand'
import type { SessionEvent, SessionStatus } from '@shared/events'

export interface LoggedEvent {
  n: number
  at: number
  event: SessionEvent
}

interface PendingPermission {
  reqId: string
  toolName: string
  input: unknown
  title?: string
}

interface SessionState {
  localId: string | null
  status: SessionStatus
  events: LoggedEvent[]
  pending: PendingPermission[]
  streamText: string
  push: (localId: string, e: SessionEvent) => void
  setLocalId: (id: string | null) => void
  clear: () => void
}

let counter = 0

export const useSessionStore = create<SessionState>((set) => ({
  localId: null,
  status: 'idle',
  events: [],
  pending: [],
  streamText: '',
  setLocalId: (localId) => set({ localId }),
  clear: () => set({ events: [], pending: [], streamText: '', status: 'idle' }),
  push: (_localId, event) =>
    set((s) => {
      const next: Partial<SessionState> = {}
      // Coalesce consecutive deltas in the log so it stays readable.
      const last = s.events[s.events.length - 1]
      if (
        (event.t === 'text_delta' || event.t === 'thinking_delta') &&
        last &&
        last.event.t === event.t &&
        last.event.msgId === event.msgId
      ) {
        const merged: LoggedEvent = { ...last, event: { ...event, text: last.event.text + event.text } }
        next.events = [...s.events.slice(0, -1), merged]
      } else {
        next.events = [...s.events, { n: ++counter, at: Date.now(), event }]
      }
      if (event.t === 'status') next.status = event.state
      if (event.t === 'text_delta') next.streamText = s.streamText + event.text
      if (event.t === 'assistant_message') next.streamText = ''
      if (event.t === 'permission_request')
        next.pending = [
          ...s.pending,
          {
            reqId: event.reqId,
            toolName: event.toolName,
            input: event.input,
            ...(event.title ? { title: event.title } : {})
          }
        ]
      return next
    })
}))

export function removePending(reqId: string): void {
  useSessionStore.setState((s) => ({ pending: s.pending.filter((p) => p.reqId !== reqId) }))
}
