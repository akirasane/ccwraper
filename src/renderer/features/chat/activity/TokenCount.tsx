import * as React from 'react'
import { Tooltip } from '@/components/ui'
import { cn } from '@/lib/cn'
import { formatTokens, TOKEN_ESTIMATE_TIP } from './format'

const TICK_MS = 600

function reducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** Ticks up (or down, when an estimate snaps to the exact value) to `value` in at most 600 ms; reduced motion snaps. */
function useTicked(value: number): number {
  const [shown, setShown] = React.useState(value)
  const ref = React.useRef(shown)
  ref.current = shown
  React.useEffect(() => {
    const from = ref.current
    if (value === from) return
    if (reducedMotion() || typeof requestAnimationFrame !== 'function') {
      setShown(value)
      return
    }
    const start = performance.now()
    let raf = 0
    const step = (now: number): void => {
      const p = Math.min(1, (now - start) / TICK_MS)
      const eased = 1 - Math.pow(1 - p, 3)
      setShown(p >= 1 ? value : from + (value - from) * eased)
      if (p < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [value])
  return shown
}

export interface TokenCountProps {
  value: number
  /** false while the number is an estimate: `~` prefix, dotted underline, tooltip. */
  exact: boolean
  className?: string
  'data-testid'?: string
}

export function TokenCount({ value, exact, className, 'data-testid': testId }: TokenCountProps): React.JSX.Element {
  const shown = useTicked(value)
  const text = `${exact ? '' : '~'}${formatTokens(shown)}`
  const el = (
    <span
      data-testid={testId}
      data-value={value}
      data-exact={exact}
      className={cn('tabular-nums', !exact && 'cursor-help underline decoration-dotted underline-offset-2', className)}
    >
      {text}
    </span>
  )
  return exact ? el : <Tooltip content={TOKEN_ESTIMATE_TIP}>{el}</Tooltip>
}
