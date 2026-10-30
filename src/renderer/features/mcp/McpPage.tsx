// PLACEHOLDER (WP0). WP7 replaces the body; the props are frozen.
export function McpPage({ cwd }: { cwd?: string }): React.JSX.Element {
  return (
    <section className="m-auto max-w-sm px-6 text-center" data-testid="mcp-page" aria-label="MCP servers">
      <h2 className="text-lg font-medium text-fg">MCP servers</h2>
      <p className="mt-1 text-base text-fg-3">{cwd ?? 'No project selected'}</p>
    </section>
  )
}
