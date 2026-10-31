import { ShieldAlert, ShieldCheck } from 'lucide-react'
import { chooseMode } from '@/features/chat/mode/choose-mode'
import { useAllowBypass } from '@/features/chat/mode/mode-prefs'
import { isBypass, visibleModes } from '@/features/chat/mode/modes'
import type { PaletteCommand } from '@/lib/commands/types'
import { useWorkspaceStore } from '@/stores/workspace-store'

/** "Mode: ..." commands for the active tab. Bypass appears only when the preference is on, and still goes through the confirm dialog. */
export function buildModeCommands(activeConvId: string | undefined, allowBypass: boolean): PaletteCommand[] {
  return visibleModes(allowBypass)
    .map((m) => ({
      id: `mode:${m.value}`,
      title: `Mode: ${m.label}`,
      subtitle: m.description,
      group: 'Actions' as const,
      keywords: ['permission', 'mode', m.value],
      icon: isBypass(m.value) ? ShieldAlert : ShieldCheck,
      disabled: !activeConvId,
      run: () => {
        if (activeConvId) chooseMode(activeConvId, m.value)
      }
    }))
}

export function useModeCommands(): PaletteCommand[] {
  const activeConvId = useWorkspaceStore((s) => s.activeConvId)
  const allowBypass = useAllowBypass()
  return buildModeCommands(activeConvId, allowBypass)
}
