export interface PluginInfo {
  name: string
  path: string
  version?: string
}

/**
 * Plugins reported by session `init` messages: a union over all inits in this app run.
 * Empty until a session has started (the UI says so). A later init replaces the entry of the same name.
 */
export class PluginRegistry {
  private readonly byName = new Map<string, PluginInfo>()

  private seen = false

  update(plugins: readonly PluginInfo[] | undefined): void {
    if (plugins) this.seen = true
    for (const p of plugins ?? []) {
      if (!p?.name || !p.path) continue
      this.byName.set(p.name, { name: p.name, path: p.path, ...(p.version ? { version: p.version } : {}) })
    }
  }

  list(): PluginInfo[] {
    return [...this.byName.values()]
  }

  get(name: string): PluginInfo | undefined {
    return this.byName.get(name)
  }

  /** True once an init has reported a plugin list (even an empty one). Drives `pluginsKnown`. */
  get known(): boolean {
    return this.seen
  }
}
