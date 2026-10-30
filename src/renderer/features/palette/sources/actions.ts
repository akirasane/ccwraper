import { useQueryClient } from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'
import {
  ChevronLeft,
  ChevronRight,
  FolderOpen,
  GitBranch,
  KeyRound,
  Plus,
  Settings,
  Square,
  SquareTerminal,
  X
} from 'lucide-react'
import { selectIsRunning } from '@/features/chat/model/selectors'
import type { PaletteCommand } from '@/lib/commands/types'
import { useChatStore } from '@/stores/chat-store'
import { useWorkspaceStore } from '@/stores/workspace-store'

const ws = (): ReturnType<typeof useWorkspaceStore.getState> => useWorkspaceStore.getState()

/**
 * App actions. None of them performs a destructive operation by itself: closing a tab and the other
 * state changes go through the same store actions (and confirm flows) as the buttons and shortcuts.
 */
export function buildActionCommands(qc: QueryClient, ctx: { activeConvId?: string; running: boolean }): PaletteCommand[] {
  const { activeConvId, running } = ctx
  return [
    { id: 'action:new-session', title: 'New session', group: 'Actions', keywords: ['tab', 'chat', 'conversation'], icon: Plus, run: () => ws().newTab() },
    {
      id: 'action:close-tab',
      title: 'Close tab',
      group: 'Actions',
      keywords: ['tab'],
      icon: X,
      disabled: !activeConvId,
      run: () => {
        if (activeConvId) void ws().closeTab(activeConvId)
      }
    },
    { id: 'action:next-tab', title: 'Next tab', group: 'Actions', keywords: ['tab', 'switch'], icon: ChevronRight, run: () => ws().cycleTab(1) },
    { id: 'action:prev-tab', title: 'Previous tab', group: 'Actions', keywords: ['tab', 'switch'], icon: ChevronLeft, run: () => ws().cycleTab(-1) },
    {
      id: 'action:toggle-terminal',
      title: 'Toggle terminal',
      group: 'Actions',
      keywords: ['shell', 'console', 'pty'],
      shortcut: ['Ctrl', '`'],
      icon: SquareTerminal,
      run: () => ws().toggleTerminal()
    },
    {
      id: 'action:interrupt',
      title: 'Interrupt',
      subtitle: 'Stop the running turn',
      group: 'Actions',
      keywords: ['stop', 'cancel', 'abort'],
      icon: Square,
      disabled: !running,
      run: () => {
        if (activeConvId) void useChatStore.getState().interrupt(activeConvId)
      }
    },
    {
      id: 'action:open-folder',
      title: 'Open folder...',
      group: 'Actions',
      keywords: ['project', 'directory', 'add'],
      icon: FolderOpen,
      run: () => void ws().addFolder()
    },
    {
      id: 'action:refresh-git',
      title: 'Refresh git',
      group: 'Actions',
      keywords: ['status', 'branch'],
      icon: GitBranch,
      run: () => void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'git' })
    },
    {
      id: 'action:check-signin',
      title: 'Check sign-in',
      subtitle: 'Re-read the Claude login status',
      group: 'Actions',
      keywords: ['auth', 'login', 'account'],
      icon: KeyRound,
      run: () => {
        void window.ccwrap?.app
          ?.authStatus({ refresh: true })
          .then(() => qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).toLowerCase().includes('auth') }))
          .catch(() => {})
      }
    },
    {
      id: 'action:preferences',
      title: 'Preferences',
      group: 'Actions',
      keywords: ['prefs', 'options'],
      icon: Settings,
      run: () => ws().setView('preferences')
    }
  ]
}

export function useActionCommands(): PaletteCommand[] {
  const qc = useQueryClient()
  const activeConvId = useWorkspaceStore((s) => s.activeConvId)
  const running = useChatStore((s) => {
    const c = activeConvId ? s.convs[activeConvId] : undefined
    return c ? selectIsRunning(c) : false
  })
  return buildActionCommands(qc, { activeConvId, running })
}
