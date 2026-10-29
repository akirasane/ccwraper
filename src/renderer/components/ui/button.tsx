import { cva, type VariantProps } from 'class-variance-authority'
import { Slot } from 'radix-ui'
import * as React from 'react'
import { cn } from '@/lib/cn'

export const buttonVariants = cva(
  'inline-flex shrink-0 select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-sm border font-medium ' +
    'transition-[background-color,border-color,color,box-shadow,translate,scale,opacity] duration-fast ease-out ' +
    'hover:translate-y-[var(--hover-lift)] active:translate-y-0 active:scale-[var(--press-scale)] ' +
    'disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-[0.42] aria-disabled:cursor-not-allowed aria-disabled:opacity-[0.42] ' +
    '[&_svg]:shrink-0',
  {
    variants: {
      variant: {
        primary: 'border-transparent bg-accent-solid text-on-accent shadow-glow hover:brightness-110',
        secondary: 'border-border-strong bg-bg-2 text-fg hover:bg-bg-3',
        ghost: 'border-transparent bg-transparent text-fg-2 hover:bg-bg-3 hover:text-fg',
        danger: 'border-danger-border bg-danger-bg text-danger hover:bg-danger/20'
      },
      size: {
        md: 'h-[30px] px-3 text-base',
        sm: 'h-6 px-2 text-sm',
        'icon-md': 'size-7 p-0',
        'icon-sm': 'size-6 p-0'
      }
    },
    defaultVariants: { variant: 'secondary', size: 'md' }
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, asChild = false, type, ...props },
  ref
) {
  const Comp = asChild ? Slot.Root : 'button'
  return (
    <Comp
      ref={ref}
      type={asChild ? undefined : (type ?? 'button')}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  )
})
