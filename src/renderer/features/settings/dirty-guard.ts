import { useDirtyRegistry, setDirty } from '@/stores/dirty-registry'

// "Settings buffer has unsaved changes" flag, kept in the shared dirty registry so the shell can
// ask before a view or project change. The page itself also guards scope switches and unload.
const KEY = 'settings'

export function isSettingsDirty(): boolean {
  return !!useDirtyRegistry.getState().dirty[KEY]
}

export function setSettingsDirty(next: boolean): void {
  setDirty(KEY, next)
}

export function subscribeSettingsDirty(cb: () => void): () => void {
  let prev = isSettingsDirty()
  return useDirtyRegistry.subscribe(() => {
    const now = isSettingsDirty()
    if (now !== prev) {
      prev = now
      cb()
    }
  })
}
