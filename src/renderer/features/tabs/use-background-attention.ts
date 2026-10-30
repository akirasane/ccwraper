import { useEffect } from 'react'
import { toast } from '@/components/ui/toaster'
import { useChatStore } from '@/stores/chat-store'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { tabTitle } from './tab-status'

/**
 * While the window is focused, a background tab that starts waiting for approval raises a toast with a Show action.
 * (Finished background turns only get the unread dot; OS notifications are main's job and need an unfocused window.)
 */
export function useBackgroundAttention(): void {
  useEffect(() => {
    const seen = new Set<string>()
    const check = (convs: ReturnType<typeof useChatStore.getState>['convs']): void => {
      const ws = useWorkspaceStore.getState()
      for (const tab of ws.tabs) {
        const c = convs[tab.convId]
        if (!c || tab.convId === ws.activeConvId) continue
        for (const p of c.pending) {
          if (seen.has(p.reqId)) continue
          seen.add(p.reqId)
          if (typeof document !== 'undefined' && !document.hasFocus()) continue
          toast(`${tabTitle(tab, c)} needs approval`, {
            id: `perm-${p.reqId}`,
            action: { label: 'Show', onClick: () => useWorkspaceStore.getState().activateTab(tab.convId) }
          })
        }
      }
    }
    // Requests already pending at mount are not news.
    for (const c of Object.values(useChatStore.getState().convs)) for (const p of c.pending) seen.add(p.reqId)
    return useChatStore.subscribe((s, prev) => {
      if (s.convs !== prev.convs) check(s.convs)
    })
  }, [])
}
