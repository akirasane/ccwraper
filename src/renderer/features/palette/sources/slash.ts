import { Slash } from 'lucide-react'
import { insertIntoComposer } from '@/lib/composer-bus'
import type { PaletteCommand } from '@/lib/commands/types'
import { useChatStore } from '@/stores/chat-store'
import { useWorkspaceStore } from '@/stores/workspace-store'

/** Inserts `/<name> ` into the mounted composer (never sends), then shows the chat view. */
export function buildSlashCommands(names: string[]): PaletteCommand[] {
  return names.map((name) => ({
    id: `slash:${name}`,
    title: `/${name}`,
    subtitle: 'Insert into the composer',
    group: 'Slash commands' as const,
    icon: Slash,
    run: () => {
      useWorkspaceStore.getState().setView('chat')
      insertIntoComposer(`/${name} `)
    }
  }))
}

/** The active conversation's `meta.slashCommands`. */
export function useSlashCommands(): PaletteCommand[] {
  const convId = useWorkspaceStore((s) => s.activeConvId)
  const names = useChatStore((s) => (convId ? s.convs[convId]?.meta.slashCommands : undefined))
  return buildSlashCommands(names ?? [])
}
