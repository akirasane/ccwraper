import type { PermissionMode } from '@shared/ipc'

export interface ModeInfo {
  value: PermissionMode
  label: string
  /** One line shown under the label in the menu. */
  description: string
}

/** Menu order. Bypass is last and only offered when the preference is on. */
export const MODES: readonly ModeInfo[] = [
  { value: 'default', label: 'Default', description: 'Ask before edits and shell commands.' },
  { value: 'acceptEdits', label: 'Accept edits', description: 'Apply file edits without asking; still ask for commands.' },
  { value: 'plan', label: 'Plan', description: 'Read-only: Claude plans and does not change anything.' },
  { value: 'auto', label: 'Auto', description: 'A classifier approves or denies each call. May use extra subscription usage.' },
  { value: 'dontAsk', label: "Don't ask", description: 'Never prompt; deny anything not already allowed.' },
  { value: 'bypassPermissions', label: 'Bypass all', description: 'Run every tool call without asking. Dangerous.' }
]

export const BYPASS: PermissionMode = 'bypassPermissions'

export function modeLabel(mode: string | undefined): string {
  const hit = MODES.find((m) => m.value === mode)
  return hit ? (hit.value === BYPASS ? 'Bypass' : hit.label) : (mode ?? 'Default')
}

/** Modes the menu may list: Bypass only when the preference allows it. */
export function visibleModes(allowBypass: boolean): readonly ModeInfo[] {
  return MODES.filter((m) => m.value !== BYPASS || allowBypass)
}

export const isBypass = (mode: string | undefined): boolean => mode === BYPASS
