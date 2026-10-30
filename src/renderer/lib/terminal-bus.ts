// Tiny emitter: chat asks for a command to be typed into a terminal; the terminal panel listens.
// Frozen contract (P2 plan 2.7): requestRunInTerminal / onRunInTerminal.

export interface RunInTerminalRequest {
  cwd: string
  command: string
}

type Listener = (req: RunInTerminalRequest) => void

const listeners = new Set<Listener>()
let pending: RunInTerminalRequest | undefined
let opener: (() => void) | undefined

/**
 * Chat -> terminal. The terminal panel types `command` WITHOUT pressing Enter. If the panel is not
 * mounted yet, the request is held and delivered to the first subscriber.
 */
export function requestRunInTerminal(req: RunInTerminalRequest): void {
  opener?.()
  if (listeners.size === 0) {
    pending = req
    return
  }
  for (const l of [...listeners]) l(req)
}

/** Terminal side. Delivers a request that arrived before the panel mounted. */
export function onRunInTerminal(cb: Listener): () => void {
  listeners.add(cb)
  if (pending) {
    const p = pending
    pending = undefined
    cb(p)
  }
  return () => {
    listeners.delete(cb)
  }
}

/** Shell-only hook (AppShell): called on every request so the panel can be opened. Not part of the feature API. */
export function setTerminalOpener(fn: (() => void) | undefined): void {
  opener = fn
}

/** Test hook. */
export function resetTerminalBus(): void {
  listeners.clear()
  pending = undefined
  opener = undefined
}
