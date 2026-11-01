// Plugin and marketplace management (P5 D). Shapes mirror `claude plugin ... --json` output.

export type PluginScope = 'user' | 'project' | 'local'

export interface InstalledPlugin {
  /** `name@marketplace` */
  id: string
  version: string
  scope: PluginScope
  enabled: boolean
  installedAt?: string
  lastUpdated?: string
}

export interface AvailablePlugin {
  pluginId: string
  name: string
  description: string
  marketplaceName: string
  installCount: number
  installed: boolean
}

export interface MarketplaceInfo {
  name: string
  /** `github`, `git`, `url`, `directory`, ... as reported by the CLI. */
  source: string
  /** Human-readable origin: repo, URL or path. */
  origin: string
}

export interface PluginsListResult {
  installed: InstalledPlugin[]
  marketplaces: MarketplaceInfo[]
  /** Set when the CLI call failed; lists are then empty. */
  error?: string
}

export interface PluginsBrowseResult {
  items: AvailablePlugin[]
  /** Matches before the limit was applied. */
  total: number
  error?: string
}

export type PluginsMutationResult = { ok: true; output: string } | { ok: false; message: string; output?: string }
