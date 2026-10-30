import { History } from 'lucide-react'
import type { HistorySessionInfo } from '@shared/events'
import { useSessions } from '@/features/sessions/queries'
import type { PaletteCommand } from '@/lib/commands/types'
import { useWorkspaceStore } from '@/stores/workspace-store'

export const MAX_SESSIONS = 200

export function buildSessionCommands(sessions: HistorySessionInfo[] | undefined): PaletteCommand[] {
  return [...(sessions ?? [])]
    .sort((a, b) => b.lastModified - a.lastModified)
    .slice(0, MAX_SESSIONS)
    .map((s) => ({
      id: `session:${s.sessionId}`,
      title: s.title || s.firstPrompt || 'Untitled session',
      subtitle: s.gitBranch,
      group: 'Sessions' as const,
      keywords: s.firstPrompt ? [s.firstPrompt.slice(0, 120)] : undefined,
      icon: History,
      run: () => useWorkspaceStore.getState().openSession(s)
    }))
}

/** The current project's history from the React Query cache (fetched on open if missing). */
export function useSessionCommands(): PaletteCommand[] {
  const cwd = useWorkspaceStore((s) => s.cwd)
  const { data } = useSessions(cwd)
  return buildSessionCommands(data)
}
