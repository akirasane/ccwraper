import { useState } from 'react'
import { ChartTable, formatInt, HBars } from '@/components/charts'
import { formatTokens } from '@/features/chat/activity/format'
import type { UsageSummary } from '@shared/usage'
import { totalTokens } from './queries'

function projectName(cwd: string): string {
  const parts = cwd.replaceAll('\\', '/').split('/').filter(Boolean)
  return parts[parts.length - 1] ?? cwd
}

export function ProjectsChart({ summary }: { summary: UsageSummary }): React.JSX.Element {
  const [table, setTable] = useState(false)
  const top = summary.projects.slice(0, 8)
  return (
    <section aria-labelledby="usage-projects-h" className="rounded-lg border border-border bg-bg-1 p-4">
      <div className="mb-3 flex items-center gap-3">
        <h3 id="usage-projects-h" className="text-md font-medium text-fg">
          Top projects by tokens
        </h3>
        <button
          type="button"
          aria-pressed={table}
          onClick={() => setTable((v) => !v)}
          className="ml-auto rounded-md border border-border-strong px-2 py-0.5 text-sm text-fg-2 hover:bg-bg-3 aria-pressed:bg-bg-3 aria-pressed:text-fg"
        >
          Table
        </button>
      </div>
      {top.length === 0 ? (
        <p className="text-sm text-fg-3">No projects in this range.</p>
      ) : table ? (
        <ChartTable
          caption="Tokens per project"
          columns={['Project', 'Tokens', 'Sessions']}
          rows={top.map((p) => ({
            key: p.key,
            cells: [p.cwd, formatInt(totalTokens(p.tokens)), formatInt(p.sessions)]
          }))}
        />
      ) : (
        <HBars
          ariaLabel="Top projects by tokens"
          items={top.map((p) => ({
            key: p.key,
            label: projectName(p.cwd),
            title: p.cwd,
            value: totalTokens(p.tokens),
            display: `${formatTokens(totalTokens(p.tokens))} - ${p.sessions} ${p.sessions === 1 ? 'session' : 'sessions'}`,
            bar: 'bg-chart-1'
          }))}
        />
      )}
    </section>
  )
}
