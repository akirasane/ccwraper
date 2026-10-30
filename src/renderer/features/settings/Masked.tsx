import { Eye, EyeOff } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui'

/** An env value shown as dots until the user reveals it (SPEC 10.1: no secrets echoed by default). */
export function MaskedValue({ value, label }: { value: string; label: string }): React.JSX.Element {
  const [shown, setShown] = useState(false)
  return (
    <span className="inline-flex min-w-0 items-center gap-1">
      <span className="min-w-0 truncate font-mono text-sm text-fg-2" data-testid="masked-value">
        {shown ? value : '•'.repeat(Math.min(Math.max(value.length, 6), 12))}
      </span>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={`${shown ? 'Hide' : 'Reveal'} value of ${label}`}
        aria-pressed={shown}
        onClick={() => setShown((s) => !s)}
      >
        {shown ? <EyeOff size={13} /> : <Eye size={13} />}
      </Button>
    </span>
  )
}
