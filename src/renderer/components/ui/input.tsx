import * as React from 'react'
import { cn } from '@/lib/cn'

export const fieldClass =
  'w-full rounded-sm border border-border-strong bg-bg-2 px-2.5 text-base text-fg placeholder:text-fg-muted ' +
  'transition-[border-color,box-shadow,background-color] duration-fast ease-out ' +
  'hover:bg-bg-3 focus:bg-bg-2 focus:border-accent-from focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--accent-from)_18%,transparent)] ' +
  'aria-[invalid=true]:border-danger focus:aria-[invalid=true]:border-danger ' +
  'aria-[invalid=true]:focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--danger)_18%,transparent)] ' +
  'disabled:cursor-not-allowed disabled:opacity-[0.42]'

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  mono?: boolean
  error?: boolean
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, mono, error, type = 'text', ...props },
  ref
) {
  return (
    <input
      ref={ref}
      type={type}
      aria-invalid={error ? true : props['aria-invalid']}
      className={cn(fieldClass, 'h-[30px]', mono && 'font-mono text-sm', className)}
      {...props}
    />
  )
})
