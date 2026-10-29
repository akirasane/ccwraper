import { ProjectPicker } from './ProjectPicker'
import { SessionList } from './SessionList'

export function LeftRail({ disabled }: { disabled?: boolean }): React.JSX.Element {
  return (
    <aside data-testid="left-rail" className="flex w-[232px] shrink-0 flex-col border-r border-border bg-bg-1">
      <ProjectPicker />
      <SessionList disabled={disabled} />
    </aside>
  )
}
