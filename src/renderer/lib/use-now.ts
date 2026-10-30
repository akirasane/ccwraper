import * as React from 'react'

// One interval for the whole app. It runs only while at least one component is subscribed, and it never
// writes to a store. A timer is information, not motion, so it ticks under prefers-reduced-motion too.

const TICK_MS = 1000
const listeners = new Set<() => void>()
let current = Date.now()
let timer: ReturnType<typeof setInterval> | undefined

function tick(): void {
  current = Date.now()
  for (const l of listeners) l()
}

function subscribe(cb: () => void): () => void {
  if (listeners.size === 0) {
    current = Date.now()
    timer = setInterval(tick, TICK_MS)
  }
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
    if (listeners.size === 0 && timer !== undefined) {
      clearInterval(timer)
      timer = undefined
    }
  }
}

function getSnapshot(): number {
  // Nobody ticks the value while unsubscribed: refresh a stale one (stable within the same second).
  if (listeners.size === 0) {
    const n = Date.now()
    if (n - current >= TICK_MS) current = n
  }
  return current
}

const noopSubscribe = (): (() => void) => () => {}

/** `Date.now()` refreshed once per second while `active`; a frozen value otherwise (and no subscription). */
export function useNow(active = true): number {
  return React.useSyncExternalStore(active ? subscribe : noopSubscribe, getSnapshot, getSnapshot)
}

/** Test seam: number of live subscribers. */
export const nowSubscriberCount = (): number => listeners.size
