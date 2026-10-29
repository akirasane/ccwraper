import * as React from 'react'
import { cn } from '@/lib/cn'

export function Kbd({ className, ...props }: React.HTMLAttributes<HTMLElement>): React.JSX.Element {
  return (
    <kbd
      className={cn(
        'inline-flex h-4 min-w-4 items-center justify-center rounded-xs border border-border-strong bg-bg-2 px-1 font-mono text-2xs text-fg-2',
        className
      )}
      {...props}
    />
  )
}
