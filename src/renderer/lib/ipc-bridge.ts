import { useChatStore } from '@/stores/chat-store'
import { useWorkspaceStore } from '@/stores/workspace-store'

let unsubscribe: (() => void) | undefined

/** Tell main which session the user is looking at (notification suppression and click routing, P4 D3). */
function startActiveSessionReport(): () => void {
  let last: string | null | undefined
  const report = (): void => {
    const convId = useWorkspaceStore.getState().activeConvId
    const localId = (convId ? useChatStore.getState().convs[convId]?.localId : undefined) ?? null
    if (localId === last) return
    last = localId
    try {
      window.ccwrap.app?.setActiveSession?.(localId)
    } catch {
      /* fire-and-forget */
    }
  }
  report()
  const offWs = useWorkspaceStore.subscribe((s, p) => {
    if (s.activeConvId !== p.activeConvId) report()
  })
  const offChat = useChatStore.subscribe((s, p) => {
    if (s.convs !== p.convs) report()
  })
  return () => {
    offWs()
    offChat()
  }
}

/** Subscribe to main-process session events once and route them into the chat store. Idempotent. */
export function initIpcBridge(): () => void {
  if (!unsubscribe) {
    const off = window.ccwrap.session.onEvent(({ localId, event }) => {
      useChatStore.getState().applyEvent(localId, event)
    })
    const offReport = startActiveSessionReport()
    // A notification click: show the tab whose session raised it.
    const offFocus = window.ccwrap.app?.onFocusSession?.(({ localId }) => {
      const convId = useChatStore.getState().localToConv[localId]
      if (convId) useWorkspaceStore.getState().activateTab(convId)
    })
    unsubscribe = () => {
      off()
      offReport()
      offFocus?.()
      unsubscribe = undefined
    }
  }
  return unsubscribe
}
