// PLACEHOLDER (WP0). WP6 replaces the body; the props are frozen.
export function SettingsPage({ cwd }: { cwd?: string }): React.JSX.Element {
  return (
    <section className="m-auto max-w-sm px-6 text-center" data-testid="settings-page" aria-label="Settings">
      <h2 className="text-lg font-medium text-fg">Settings</h2>
      <p className="mt-1 text-base text-fg-3">{cwd ?? 'No project selected'}</p>
    </section>
  )
}
