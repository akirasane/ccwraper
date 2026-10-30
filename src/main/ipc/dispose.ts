import { ipcMain } from 'electron'

export type Disposer = () => void

/** Remove the given invoke-handler channels. */
export function removeHandlers(...channels: string[]): Disposer {
  return () => {
    for (const c of channels) ipcMain.removeHandler(c)
  }
}

/** Combine disposers; one throwing never stops the others. */
export function combineDisposers(...ds: Disposer[]): Disposer {
  return () => {
    for (const d of ds) {
      try {
        d()
      } catch (err) {
        console.warn('[ccwrap] dispose failed', err instanceof Error ? err.message : err)
      }
    }
  }
}
