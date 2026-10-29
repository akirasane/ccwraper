import * as React from 'react'
import { cn } from '@/lib/cn'
import { fieldClass } from './input'

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  mono?: boolean
  error?: boolean
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, mono, error, ...props },
  ref
) {
  return (
    <textarea
      ref={ref}
      aria-invalid={error ? true : props['aria-invalid']}
      className={cn(fieldClass, 'min-h-[60px] resize-y py-1.5 leading-normal', mono && 'font-mono text-sm', className)}
      {...props}
    />
  )
})
