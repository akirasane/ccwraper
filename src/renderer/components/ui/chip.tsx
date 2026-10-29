import { cva, type VariantProps } from 'class-variance-authority'
import * as React from 'react'
import { cn } from '@/lib/cn'
import { Spinner } from './spinner'

export const chipVariants = cva(
  'inline-flex h-6 shrink-0 select-none items-center gap-1.5 whitespace-nowrap rounded-sm border px-2 text-sm ' +
    'transition-[background-color,border-color,color,translate,scale] duration-fast ease-out ' +
    'active:scale-[var(--press-scale)] disabled:cursor-not-allowed disabled:opacity-[0.42]',
  {
    variants: {
      variant: {
        neutral: 'border-border-strong bg-bg-2 text-fg-2 hover:bg-bg-3 hover:text-fg',
        selected: 'border-accent-from/50 bg-accent-tint text-accent-text hover:bg-accent-from/20',
        ok: 'border-ok-border bg-ok-bg text-ok',
        warn: 'border-warn-border bg-warn-bg text-warn',
        danger: 'border-danger-border bg-danger-bg text-danger',
        running: 'border-info-border bg-info-bg text-info'
      }
    },
    defaultVariants: { variant: 'neutral' }
  }
)

export interface ChipProps
  extends Omit<React.HTMLAttributes<HTMLElement>, 'onClick'>,
    VariantProps<typeof chipVariants> {
  /** When given, the chip renders as a button (interactive). Default is a static span. */
  onClick?: React.MouseEventHandler<HTMLElement>
  disabled?: boolean
}

export function Chip({ className, variant, children, onClick, disabled, ...props }: ChipProps): React.JSX.Element {
  const content = (
    <>
      {variant === 'running' && <Spinner size={11} className="text-info" />}
      {children}
    </>
  )
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-pressed={variant === 'selected' ? true : undefined}
        className={cn(chipVariants({ variant }), 'cursor-pointer hover:-translate-y-px', className)}
        {...(props as React.ButtonHTMLAttributes<HTMLButtonElement>)}
      >
        {content}
      </button>
    )
  }
  return (
    <span className={cn(chipVariants({ variant }), className)} {...props}>
      {content}
    </span>
  )
}
