// PLACEHOLDER (WP0). WP8 replaces the body; the props are frozen.
export function MemoryPage({ cwd }: { cwd?: string }): React.JSX.Element {
  return (
    <section className="m-auto max-w-sm px-6 text-center" data-testid="memory-page" aria-label="Memory">
      <h2 className="text-lg font-medium text-fg">Memory (CLAUDE.md)</h2>
      <p className="mt-1 text-base text-fg-3">{cwd ?? 'No project selected'}</p>
    </section>
  )
}
