import { ChevronDown, FolderOpen, FolderPlus } from 'lucide-react'
import { useState } from 'react'
import { Tooltip } from '@/components/ui'
import { useProjects } from '@/features/sessions/queries'
import { cn } from '@/lib/cn'
import { cwdKey, useWorkspaceStore } from '@/stores/workspace-store'
import type { ProjectInfo } from '@shared/events'

const baseName = (p: string): string =>
  p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p

/** History projects plus folders added in this run and the persisted last project (when history lacks them). */
export function useProjectList(): { projects: ProjectInfo[]; isLoading: boolean; error: unknown } {
  const { data, isLoading, error } = useProjects()
  const cwd = useWorkspaceStore((s) => s.cwd)
  const extra = useWorkspaceStore((s) => s.extraCwds)
  const projects = [...(data ?? [])]
  if (!isLoading) {
    for (const c of [...extra, ...(cwd ? [cwd] : [])]) {
      if (!projects.some((p) => cwdKey(p.cwd) === cwdKey(c))) {
        projects.push({ key: cwdKey(c), cwd: c, exists: true, sessionCount: 0, lastModified: 0 })
      }
    }
  }
  return { projects, isLoading, error }
}

export function ProjectPicker(): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const cwd = useWorkspaceStore((s) => s.cwd)
  const select = useWorkspaceStore((s) => s.selectProject)
  const addFolder = useWorkspaceStore((s) => s.addFolder)
  const { projects, isLoading, error } = useProjectList()

  return (
    <div className="border-b border-border p-2" data-testid="project-picker">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen((o) => !o)}
        className="flex h-9 w-full items-center gap-2 rounded-sm border border-border-strong bg-bg-2 px-2 text-left text-base text-fg transition-colors duration-fast hover:bg-bg-3"
      >
        <FolderOpen size={14} className="shrink-0 text-fg-3" aria-hidden />
        <span className="min-w-0 flex-1 truncate" title={cwd}>
          {cwd ? baseName(cwd) : 'Select a project'}
        </span>
        <ChevronDown
          size={14}
          aria-hidden
          className={cn('shrink-0 text-fg-3 transition-transform duration-fast', open && 'rotate-180')}
        />
      </button>
      {open && (
        <div role="listbox" aria-label="Projects" className="mt-1 flex max-h-72 flex-col gap-0.5 overflow-y-auto">
          {isLoading && <p className="px-2 py-1 text-sm text-fg-3">Loading projects...</p>}
          {!isLoading && error != null && <p className="px-2 py-1 text-sm text-danger">Could not load projects</p>}
          {projects.map((p) => {
            const missing = !p.exists
            const selected = !!cwd && cwdKey(p.cwd) === cwdKey(cwd)
            const row = (
              <button
                key={p.key}
                type="button"
                role="option"
                aria-selected={selected}
                aria-disabled={missing || undefined}
                onClick={() => {
                  if (missing) return
                  select(p.cwd)
                  setOpen(false)
                }}
                className={cn(
                  'flex w-full flex-col rounded-sm px-2 py-1 text-left transition-colors duration-fast',
                  missing ? 'cursor-not-allowed opacity-45' : 'hover:bg-bg-3',
                  selected && 'bg-accent-tint'
                )}
              >
                <span className="truncate text-base text-fg">{baseName(p.cwd)}</span>
                <span className="truncate font-mono text-2xs text-fg-3">{p.cwd}</span>
              </button>
            )
            return missing ? (
              <Tooltip key={p.key} content="Folder not found on disk" side="right">
                {row}
              </Tooltip>
            ) : (
              row
            )
          })}
          {!isLoading && projects.length === 0 && <p className="px-2 py-1 text-sm text-fg-3">No projects yet</p>}
          <button
            type="button"
            onClick={() => {
              setOpen(false)
              void addFolder()
            }}
            className="mt-1 flex h-8 items-center gap-2 rounded-sm px-2 text-base text-fg-2 transition-colors duration-fast hover:bg-bg-3 hover:text-fg"
          >
            <FolderPlus size={14} aria-hidden /> Open folder...
          </button>
        </div>
      )}
    </div>
  )
}
