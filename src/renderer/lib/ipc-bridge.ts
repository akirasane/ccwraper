import { useChatStore } from '@/stores/chat-store'

let unsubscribe: (() => void) | undefined

/** Subscribe to main-process session events once and route them into the chat store. Idempotent. */
export function initIpcBridge(): () => void {
  if (!unsubscribe) {
    const off = window.ccwrap.session.onEvent(({ localId, event }) => {
      useChatStore.getState().applyEvent(localId, event)
    })
    unsubscribe = () => {
      off()
      unsubscribe = undefined
    }
  }
  return unsubscribe
}
