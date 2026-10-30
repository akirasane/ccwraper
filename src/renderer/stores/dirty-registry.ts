import { create } from 'zustand'

/**
 * Shared "unsaved edits" registry. Pages with a buffer (settings, memory) report their dirty state
 * under a key; the workspace store consults it before a view or project change and, when something
 * is dirty, parks the navigation here until the user chooses Discard or Keep editing.
 */
interface DirtyState {
  dirty: Record<string, boolean>
  /** A navigation waiting for the user's decision. */
  pending: (() => void) | null
  setDirty: (key: string, value: boolean) => void
  /** Run `go` now, or park it behind the confirmation dialog when any page is dirty. */
  guard: (go: () => void) => void
  confirm: () => void
  cancel: () => void
}

export const useDirtyRegistry = create<DirtyState>((set, get) => ({
  dirty: {},
  pending: null,
  setDirty: (key, value) =>
    set((s) => {
      if (!!s.dirty[key] === value) return s
      const next = { ...s.dirty }
      if (value) next[key] = true
      else delete next[key]
      return { dirty: next }
    }),
  guard: (go) => {
    if (isAnyDirty()) set({ pending: go })
    else go()
  },
  confirm: () => {
    const go = get().pending
    // The pages reset their own flag when they unmount; clear here too so a no-unmount nav proceeds.
    set({ pending: null, dirty: {} })
    go?.()
  },
  cancel: () => set({ pending: null })
}))

export function isAnyDirty(): boolean {
  return Object.keys(useDirtyRegistry.getState().dirty).length > 0
}

export function setDirty(key: string, value: boolean): void {
  useDirtyRegistry.getState().setDirty(key, value)
}
