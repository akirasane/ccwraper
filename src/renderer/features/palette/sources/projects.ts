import { Folder } from 'lucide-react'
import type { ProjectInfo } from '@shared/events'
import { useProjectList } from '@/app/shell/ProjectPicker'
import type { PaletteCommand } from '@/lib/commands/types'
import { useWorkspaceStore } from '@/stores/workspace-store'

const baseName = (p: string): string => p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p

export function buildProjectCommands(projects: ProjectInfo[]): PaletteCommand[] {
  return projects
    .filter((p) => p.exists)
    .map((p) => ({
      id: `project:${p.key}`,
      title: baseName(p.cwd),
      subtitle: p.cwd,
      group: 'Projects' as const,
      icon: Folder,
      run: () => useWorkspaceStore.getState().selectProject(p.cwd)
    }))
}

export function useProjectCommands(): PaletteCommand[] {
  return buildProjectCommands(useProjectList().projects)
}
