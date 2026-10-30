// Builds Electron accelerator strings (e.g. "Control+Alt+Space") from a KeyboardEvent.

export type AcceleratorResult =
  | { kind: 'ok'; accelerator: string }
  | { kind: 'pending' } // only modifiers so far
  | { kind: 'error'; message: string }

type KeyLike = Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'>

const NAMED: Record<string, string> = {
  ' ': 'Space',
  Enter: 'Return',
  Escape: 'Esc',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Insert: 'Insert',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  Tab: 'Tab'
}

const MODIFIER_KEYS = new Set(['Control', 'Alt', 'Shift', 'Meta', 'AltGraph', 'OS'])

function mainKey(e: KeyLike): string | undefined {
  if (/^Key[A-Z]$/.test(e.code)) return e.code.slice(3)
  if (/^Digit[0-9]$/.test(e.code)) return e.code.slice(5)
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(e.key)) return e.key
  const named = NAMED[e.key]
  if (named) return named
  if (e.key.length === 1 && /[A-Za-z0-9]/.test(e.key)) return e.key.toUpperCase()
  return undefined
}

/** Turns a keydown into an accelerator. A chord needs Ctrl, Alt or Win (Shift alone is not enough). */
export function acceleratorFromEvent(e: KeyLike): AcceleratorResult {
  if (MODIFIER_KEYS.has(e.key)) return { kind: 'pending' }
  const key = mainKey(e)
  if (!key) return { kind: 'error', message: 'That key cannot be used in a shortcut.' }
  if (!e.ctrlKey && !e.altKey && !e.metaKey) {
    return { kind: 'error', message: 'Include Ctrl, Alt or Win in the shortcut.' }
  }
  const parts: string[] = []
  if (e.ctrlKey) parts.push('Control')
  if (e.altKey) parts.push('Alt')
  if (e.shiftKey) parts.push('Shift')
  if (e.metaKey) parts.push('Super')
  parts.push(key)
  return { kind: 'ok', accelerator: parts.join('+') }
}
