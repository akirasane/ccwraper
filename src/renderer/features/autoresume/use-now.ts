import { useEffect, useState } from 'react'

/** Wall clock that re-renders every `ms` while `active`. */
export function useNow(active: boolean, ms = 1000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const h = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(h)
  }, [active, ms])
  return now
}
