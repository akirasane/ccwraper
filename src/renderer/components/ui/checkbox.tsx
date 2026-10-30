import { Check } from 'lucide-react'
import { Checkbox as RadixCheckbox } from 'radix-ui'
import * as React from 'react'
import { cn } from '@/lib/cn'

export type CheckboxProps = React.ComponentPropsWithoutRef<typeof RadixCheckbox.Root>

/** 16px token-styled checkbox. Radix gives role=checkbox, Space to toggle and aria-checked. */
export const Checkbox = React.forwardRef<React.ComponentRef<typeof RadixCheckbox.Root>, CheckboxProps>(function Checkbox(
  { className, ...props },
  ref
) {
  return (
    <RadixCheckbox.Root
      ref={ref}
      className={cn(
        'inline-flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-xs border border-border-strong bg-bg-1 text-fg ' +
          'transition-colors duration-fast ' +
          'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent-text ' +
          'data-[state=checked]:border-transparent data-[state=checked]:bg-accent-solid ' +
          'disabled:cursor-not-allowed disabled:opacity-[0.42]',
        className
      )}
      {...props}
    >
      <RadixCheckbox.Indicator>
        <Check size={12} strokeWidth={3} aria-hidden />
      </RadixCheckbox.Indicator>
    </RadixCheckbox.Root>
  )
})
