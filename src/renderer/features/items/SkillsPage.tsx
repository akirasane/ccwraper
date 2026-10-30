// WP0 PLACEHOLDER. WP9 replaces the body (tabs: Skills | Commands). Props are frozen: { cwd }.
export function SkillsPage({ cwd }: { cwd?: string }): React.JSX.Element {
  return (
    <section className="flex min-h-0 flex-1 flex-col" data-testid="skills-page" aria-label="Skills and commands">
      <header className="border-b border-border px-6 py-3">
        <h2 className="text-lg font-semibold tracking-[var(--tracking-tight)] text-fg">Skills</h2>
        <p className="truncate font-mono text-sm text-fg-3">{cwd ?? 'No project selected (user scope only)'}</p>
      </header>
      <p className="px-6 py-4 text-base text-fg-3">Skills and commands editor coming soon.</p>
    </section>
  )
}
