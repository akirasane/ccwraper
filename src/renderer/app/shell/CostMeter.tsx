import { useEffect, useRef, useState } from 'react'

const TICK_MS = 600

function reducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** Shows the latest cost value (never a sum). Ticks up to a new value in at most 600ms. */
export function CostMeter({ value }: { value: number | undefined }): React.JSX.Element {
  const [shown, setShown] = useState(value ?? 0)
  const shownRef = useRef(shown)
  shownRef.current = shown

  useEffect(() => {
    if (value === undefined) return
    const from = shownRef.current
    if (reducedMotion() || typeof requestAnimationFrame !== 'function' || value === from) {
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

  return (
    <span
      data-testid="cost-meter"
      data-value={value ?? ''}
      className="tabular-nums text-fg-2"
      title="Session cost (latest reported total)"
    >
      {value === undefined ? '$--' : `$${shown.toFixed(4)}`}
    </span>
  )
}
