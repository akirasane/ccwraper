import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react'
import * as React from 'react'
import { Toaster as Sonner, toast } from 'sonner'

export { toast }

/** Themed sonner: glass-strong, 340 wide, bottom-right 16/88 (clears status bar + footer), gap 8, max 3 visible, 4s auto-dismiss. */
export function Toaster(): React.JSX.Element {
  return (
    <Sonner
      theme="dark"
      position="bottom-right"
      offset={{ right: 16, bottom: 88 }}
      mobileOffset={{ right: 16, bottom: 88 }}
      gap={8}
      visibleToasts={3}
      duration={4000}
      icons={{
        success: <CheckCircle2 size={16} className="text-ok" />,
        warning: <AlertTriangle size={16} className="text-warn" />,
        error: <XCircle size={16} className="text-danger" />,
        info: <Info size={16} className="text-info" />
      }}
      style={{ '--width': '340px' } as React.CSSProperties}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast:
            'ccw-toast-in flex w-[340px] items-start gap-2.5 rounded-md border border-border-glass bg-glass-strong p-3 text-base text-fg shadow-lg backdrop-blur-[var(--blur-glass)]',
          title: 'font-medium text-fg',
          description: 'text-sm text-fg-2',
          icon: 'mt-px shrink-0',
          actionButton: 'rounded-sm bg-bg-3 px-2 py-1 text-sm text-fg',
          cancelButton: 'rounded-sm px-2 py-1 text-sm text-fg-2'
        }
      }}
    />
  )
}
