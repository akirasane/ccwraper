import { useEffect } from 'react'
import { useWorkspaceStore } from '@/stores/workspace-store'

/** Ctrl+T / W / Tab / Shift+Tab / 1..9. Ignored inside the terminal (`.xterm`), where bash owns these keys. */
export function useTabShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!e.ctrlKey || e.altKey || e.metaKey) return
      const target = e.target
      if (target instanceof Element && target.closest('.xterm')) return
      const ws = useWorkspaceStore.getState()
      const key = e.key.toLowerCase()
      if (key === 't' && !e.shiftKey) {
        e.preventDefault()
        if (!e.repeat) ws.newTab()
      } else if (key === 'w' && !e.shiftKey) {
        e.preventDefault()
        if (!e.repeat && ws.activeConvId) void ws.closeTab(ws.activeConvId)
      } else if (e.key === 'Tab') {
        e.preventDefault()
        ws.cycleTab(e.shiftKey ? -1 : 1)
      } else if (!e.shiftKey && /^[1-9]$/.test(e.key)) {
        e.preventDefault()
        const n = Number(e.key)
        const tab = n === 9 ? ws.tabs[ws.tabs.length - 1] : ws.tabs[n - 1]
        if (tab) ws.activateTab(tab.convId)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
