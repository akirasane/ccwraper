import { ShieldAlert } from 'lucide-react'
import * as React from 'react'
import { create } from 'zustand'
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui'
import { useChatStore } from '@/stores/chat-store'
import type { PermissionMode } from '@shared/ipc'
import { isBypass } from './modes'
import { useModePrefs } from './mode-prefs'

interface ConfirmState {
  convId: string | undefined
  open: (convId: string) => void
  close: () => void
}

export const useBypassConfirm = create<ConfirmState>((set) => ({
  convId: undefined,
  open: (convId) => set({ convId }),
  close: () => set({ convId: undefined })
}))

/**
 * The one entry point for changing the mode from the menu or the palette.
 * Bypass is only ever reached through the confirm dialog, and only while the preference is on.
 */
export function chooseMode(convId: string, mode: PermissionMode): void {
  if (isBypass(mode)) {
    if (!useModePrefs.getState().allowBypass) return
    useBypassConfirm.getState().open(convId)
    return
  }
  void useChatStore.getState().setPermissionMode(convId, mode)
}

/** Asks every time Bypass is chosen. Cancel is focused so Enter does not confirm by accident. */
export function BypassConfirmDialog(): React.JSX.Element {
  const convId = useBypassConfirm((s) => s.convId)
  const close = useBypassConfirm((s) => s.close)
  const cancelRef = React.useRef<HTMLButtonElement>(null)
  return (
    <Dialog open={convId !== undefined} onOpenChange={(o) => !o && close()}>
      <DialogContent
        showClose={false}
        data-testid="bypass-confirm"
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          cancelRef.current?.focus()
        }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-danger">
            <ShieldAlert size={18} aria-hidden />
            Run without asking?
          </DialogTitle>
          <DialogDescription>
            In Bypass mode every tool call runs without asking, including shell commands and file deletes. Nothing is
            checked before it happens. Use it only in a disposable project you can throw away.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button ref={cancelRef} variant="ghost" onClick={close} data-testid="bypass-cancel">
            Cancel
          </Button>
          <Button
            variant="danger"
            data-testid="bypass-confirm-go"
            onClick={() => {
              const id = convId
              close()
              if (id) void useChatStore.getState().setPermissionMode(id, 'bypassPermissions')
            }}
          >
            Enable Bypass
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
