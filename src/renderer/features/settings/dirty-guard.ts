// Module-level "settings buffer has unsaved changes" flag. The shell can consult isSettingsDirty()
// before switching views; the page itself also guards scope switches and window unload.
let dirty = false
const listeners = new Set<() => void>()

export function isSettingsDirty(): boolean {
  return dirty
}

export function setSettingsDirty(next: boolean): void {
  if (dirty === next) return
  dirty = next
  for (const l of listeners) l()
}

export function subscribeSettingsDirty(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}
