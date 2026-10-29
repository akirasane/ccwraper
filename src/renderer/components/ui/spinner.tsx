import * as React from 'react'
import { cn } from '@/lib/cn'

export interface SpinnerProps extends React.SVGAttributes<SVGSVGElement> {
  size?: number
  label?: string
}

/** Accessible when `label` is given (role=status); decorative otherwise. */
export function Spinner({ size = 14, label, className, ...props }: SpinnerProps): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      role={label ? 'status' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn('ccw-spin shrink-0 text-accent-text', className)}
      {...props}
    >
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
      <path d="M14 8a6 6 0 0 0-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}
