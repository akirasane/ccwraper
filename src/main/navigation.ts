import { pathToFileURL } from 'node:url'

export interface AppUrls {
  /** `ELECTRON_RENDERER_URL` in dev; undefined when packaged. */
  devUrl?: string
  /** Absolute path of the packaged `renderer/index.html`. */
  indexHtmlPath: string
}

function tryUrl(s: string): URL | undefined {
  try {
    return new URL(s)
  } catch {
    return undefined
  }
}

/**
 * True only for the app's own page: the dev server origin, or exactly the packaged index.html file URL
 * (query and hash are ignored). Any other file:// URL, or any other scheme, is not app navigation.
 */
export function isAppNavigation(url: string, urls: AppUrls): boolean {
  const u = tryUrl(url)
  if (!u) return false
  if (urls.devUrl) {
    const dev = tryUrl(urls.devUrl)
    if (dev && u.origin !== 'null' && u.origin === dev.origin) return true
  }
  if (u.protocol !== 'file:') return false
  const own = pathToFileURL(urls.indexHtmlPath)
  return u.pathname.toLowerCase() === own.pathname.toLowerCase() && u.host === own.host
}
