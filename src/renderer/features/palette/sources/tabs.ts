import { MessageSquare } from 'lucide-react'
import type { PaletteCommand } from '@/lib/commands/types'
import { useWorkspaceStore } from '@/stores/workspace-store'
import type { TabRef } from '@/stores/workspace-store'

const baseName = (p: string): string => p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p

export function buildTabCommands(tabs: TabRef[], activeConvId: string | undefined): PaletteCommand[] {
  return tabs.map((t) => ({
    id: `tab:${t.convId}`,
    title: t.title || 'New session',
    subtitle: `${t.convId === activeConvId ? 'Current tab - ' : ''}${baseName(t.cwd)}`,
    group: 'Tabs' as const,
    keywords: [t.cwd, 'tab'],
    icon: MessageSquare,
    run: () => useWorkspaceStore.getState().activateTab(t.convId)
  }))
}

export function useTabCommands(): PaletteCommand[] {
  const tabs = useWorkspaceStore((s) => s.tabs)
  const active = useWorkspaceStore((s) => s.activeConvId)
  return buildTabCommands(tabs, active)
}
