import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui'
import { useWorkspaceStore } from '@/stores/workspace-store'

/** Confirms closing a tab whose conversation is running, waiting for approval, or has a live task. */
export function CloseTabDialog(): React.JSX.Element {
  const open = useWorkspaceStore((s) => s.pendingClose !== undefined)
  const confirm = useWorkspaceStore((s) => s.confirmClose)
  const cancel = useWorkspaceStore((s) => s.cancelClose)
  return (
    <Dialog open={open} onOpenChange={(o) => !o && cancel()}>
      <DialogContent data-testid="close-tab-dialog">
        <DialogHeader>
          <DialogTitle>Close this tab?</DialogTitle>
          <DialogDescription>Stop the running turn and close this tab?</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={cancel}>
            Keep open
          </Button>
          <Button variant="danger" onClick={() => void confirm()}>
            Stop and close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
