// WP9 replaces this placeholder (read-only git panel, P4 D6). The export name and props are frozen.
export function GitPage({ cwd }: { cwd?: string | undefined }): React.JSX.Element {
  return (
    <div data-testid="git-page" data-cwd={cwd} className="m-auto max-w-sm px-6 text-center" role="status">
      <h2 className="text-lg font-medium text-fg">Git</h2>
      <p className="mt-1 text-base text-fg-3">Coming soon.</p>
    </div>
  )
}
