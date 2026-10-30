import { Bot, ChartColumn, FileText, GitBranch, MessagesSquare, Plug, Settings, SlidersHorizontal, Sparkles, Webhook } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { PaletteCommand } from '@/lib/commands/types'
import { APP_VIEWS, useWorkspaceStore } from '@/stores/workspace-store'
import type { AppView } from '@/stores/workspace-store'

// Record<AppView, ...> makes a new view a compile error until it is reachable from the palette.
const VIEW_META: Record<AppView, { title: string; icon: LucideIcon; keywords: string[] }> = {
  chat: { title: 'Go to Chat', icon: MessagesSquare, keywords: ['conversation', 'session'] },
  settings: { title: 'Go to Settings', icon: Settings, keywords: ['config', 'settings.json'] },
  mcp: { title: 'Go to MCP servers', icon: Plug, keywords: ['mcp', 'servers', 'tools'] },
  memory: { title: 'Go to Memory', icon: FileText, keywords: ['claude.md', 'instructions'] },
  skills: { title: 'Go to Skills and commands', icon: Sparkles, keywords: ['skills', 'slash', 'commands'] },
  agents: { title: 'Go to Agents', icon: Bot, keywords: ['subagents'] },
  hooks: { title: 'Go to Hooks', icon: Webhook, keywords: ['automation'] },
  usage: { title: 'Go to Usage', icon: ChartColumn, keywords: ['cost', 'tokens', 'spend'] },
  git: { title: 'Go to Git', icon: GitBranch, keywords: ['status', 'diff', 'log', 'branch'] },
  preferences: { title: 'Go to Preferences', icon: SlidersHorizontal, keywords: ['prefs', 'options', 'about'] }
}

/** One Navigation command per AppView. Running it calls setView (which asks before discarding edits). */
export function buildNavigationCommands(): PaletteCommand[] {
  return APP_VIEWS.map((view) => {
    const m = VIEW_META[view]
    return {
      id: `nav:${view}`,
      title: m.title,
      group: 'Navigation' as const,
      keywords: m.keywords,
      icon: m.icon,
      run: () => useWorkspaceStore.getState().setView(view)
    }
  })
}

export function useNavigationCommands(): PaletteCommand[] {
  return buildNavigationCommands()
}
