import { Switch } from 'radix-ui'
import * as React from 'react'
import { cn } from '@/lib/cn'

export type ToggleProps = React.ComponentPropsWithoutRef<typeof Switch.Root>

/** 30x18 switch, 12px knob with spring easing. Radix Switch gives role=switch and Space/Enter. */
export const Toggle = React.forwardRef<React.ComponentRef<typeof Switch.Root>, ToggleProps>(function Toggle(
  { className, ...props },
  ref
) {
  return (
    <Switch.Root
      ref={ref}
      className={cn(
        'relative inline-flex h-[18px] w-[30px] shrink-0 cursor-pointer items-center rounded-full border border-border-strong bg-bg-3 ' +
          'transition-[background-color,border-color] duration-base ease-out ' +
          'data-[state=checked]:border-transparent data-[state=checked]:bg-accent-solid ' +
          'disabled:cursor-not-allowed disabled:opacity-[0.42]',
        className
      )}
      {...props}
    >
      <Switch.Thumb
        className={
          'pointer-events-none block size-3 translate-x-[2px] rounded-full bg-fg shadow-sm ' +
          'transition-transform duration-base ease-spring data-[state=checked]:translate-x-[14px]'
        }
      />
    </Switch.Root>
  )
})
