import { X } from 'lucide-react'
import { Dialog as DialogPrimitive } from 'radix-ui'
import * as React from 'react'
import { cn } from '@/lib/cn'

export const Dialog = DialogPrimitive.Root
export const DialogTrigger = DialogPrimitive.Trigger
export const DialogClose = DialogPrimitive.Close

export interface DialogContentProps extends React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> {
  /** Show the corner close button. Default true. */
  showClose?: boolean
}

/** Glass panel, 520 wide, 20 padding, 55% scrim, scale 0.96 + 6px blur entry. Include a DialogTitle. */
export const DialogContent = React.forwardRef<React.ComponentRef<typeof DialogPrimitive.Content>, DialogContentProps>(
  function DialogContent({ className, children, showClose = true, ...props }, ref) {
    return (
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="ccw-fade-in fixed inset-0 z-50 bg-scrim" />
        <DialogPrimitive.Content
          ref={ref}
          className={cn(
            'ccw-dialog-in fixed left-1/2 top-1/2 z-50 w-[520px] max-w-[calc(100vw-32px)] ' +
              'rounded-lg border border-border-glass bg-glass p-5 text-fg shadow-lg backdrop-blur-[var(--blur-glass)] backdrop-saturate-[1.4]',
            className
          )}
          {...props}
        >
          {children}
          {showClose && (
            <DialogPrimitive.Close
              aria-label="Close"
              className="absolute right-3 top-3 inline-flex size-6 items-center justify-center rounded-sm text-fg-3 transition-colors duration-fast hover:bg-bg-3 hover:text-fg"
            >
              <X size={14} />
            </DialogPrimitive.Close>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    )
  }
)

export function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  return <div className={cn('mb-3 flex flex-col gap-1', className)} {...props} />
}

export function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  return <div className={cn('mt-4 flex items-center justify-end gap-2', className)} {...props} />
}

export const DialogTitle = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(function DialogTitle({ className, ...props }, ref) {
  return (
    <DialogPrimitive.Title
      ref={ref}
      className={cn('text-lg font-semibold tracking-[var(--tracking-tight)] text-fg', className)}
      {...props}
    />
  )
})

export const DialogDescription = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(function DialogDescription({ className, ...props }, ref) {
  return <DialogPrimitive.Description ref={ref} className={cn('text-base text-fg-2', className)} {...props} />
})
