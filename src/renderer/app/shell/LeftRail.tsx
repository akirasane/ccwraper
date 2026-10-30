import { Bot, FileText, MessagesSquare, Plug, Settings, Sparkles, Webhook } from 'lucide-react'
import { cn } from '@/lib/cn'
import type { AppView } from '@/stores/workspace-store'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { ProjectPicker } from './ProjectPicker'
import { SessionList } from './SessionList'

function NavRow({
  view,
  label,
  icon: Icon,
  disabled
}: {
  view: AppView
  label: string
  icon: typeof Settings
  disabled?: boolean
}): React.JSX.Element {
  const active = useWorkspaceStore((s) => s.view === view)
  const setView = useWorkspaceStore((s) => s.setView)
  return (
    <button
      type="button"
      disabled={disabled}
      aria-current={active ? 'page' : undefined}
      onClick={() => setView(view)}
      className={cn(
        'flex h-[30px] w-full items-center gap-2 rounded-sm px-2 text-base text-fg-2 transition-colors duration-fast hover:bg-bg-3 hover:text-fg disabled:opacity-45',
        active && 'bg-accent-tint text-fg'
      )}
    >
      <Icon size={14} aria-hidden />
      <span className="truncate">{label}</span>
    </button>
  )
}

export function LeftRail({ disabled }: { disabled?: boolean }): React.JSX.Element {
  return (
    <aside data-testid="left-rail" className="flex w-[232px] shrink-0 flex-col border-r border-border bg-bg-1">
      <ProjectPicker />
      <nav aria-label="Main" className="flex flex-col gap-0.5 px-2 pb-1">
        <NavRow view="chat" label="Sessions" icon={MessagesSquare} />
        <NavRow view="mcp" label="MCP" icon={Plug} />
        <NavRow view="memory" label="Memory" icon={FileText} />
        <NavRow view="skills" label="Skills" icon={Sparkles} />
        <NavRow view="agents" label="Agents" icon={Bot} />
        <NavRow view="hooks" label="Hooks" icon={Webhook} />
      </nav>
      <SessionList disabled={disabled} />
      <div className="border-t border-border p-2">
        <NavRow view="settings" label="Settings" icon={Settings} />
      </div>
    </aside>
  )
}
