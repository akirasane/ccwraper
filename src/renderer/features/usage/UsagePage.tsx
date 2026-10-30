// WP8 replaces this placeholder (usage dashboard, P4 D5). The export name and props are frozen.
export function UsagePage({ cwd }: { cwd?: string | undefined }): React.JSX.Element {
  return (
    <div data-testid="usage-page" data-cwd={cwd} className="m-auto max-w-sm px-6 text-center" role="status">
      <h2 className="text-lg font-medium text-fg">Usage</h2>
      <p className="mt-1 text-base text-fg-3">Coming soon.</p>
    </div>
  )
}
