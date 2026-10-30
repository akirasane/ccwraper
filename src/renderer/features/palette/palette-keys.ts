import { useEffect } from 'react'
import { usePaletteStore } from './palette-store'

/** True when the event comes from inside the terminal, where Ctrl+K belongs to the shell. */
export function inTerminal(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('.xterm') !== null
}

/** Which palette shortcut (if any) this keydown is. Pure, for tests. */
export function isPaletteShortcut(e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'metaKey' | 'target'>): boolean {
  if (!e.ctrlKey || e.altKey || e.metaKey) return false
  const k = e.key.toLowerCase()
  if (k === 'p' && e.shiftKey) return true // Ctrl+Shift+P always works
  if (k === 'k' && !e.shiftKey) return !inTerminal(e.target) // Ctrl+K is the shell's inside .xterm
  return false
}

/** Window keydown listener in the capture phase. Mount in always-loaded code (PaletteTrigger). */
export function usePaletteShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!isPaletteShortcut(e)) return
      e.preventDefault()
      e.stopPropagation()
      usePaletteStore.getState().toggle()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])
}
