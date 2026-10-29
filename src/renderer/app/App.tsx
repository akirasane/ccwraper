import { useEffect, useState } from 'react'
import { RawLogPage } from '../features/debug/RawLogPage'
import { AppShell } from './shell/AppShell'
import { DesignPage } from './design/DesignPage'

export type Route = 'design' | 'debug' | 'app'

/** Hash router: #/design, #/debug, anything else is the app shell. */
export function parseRoute(hash: string): Route {
  if (hash.startsWith('#/design')) return 'design'
  if (hash.startsWith('#/debug')) return 'debug'
  return 'app'
}

export function App(): React.JSX.Element {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash))
  useEffect(() => {
    const h = (): void => setRoute(parseRoute(window.location.hash))
    window.addEventListener('hashchange', h)
    return () => window.removeEventListener('hashchange', h)
  }, [])
  if (route === 'design') return <DesignPage />
  if (route === 'debug') return <RawLogPage />
  return <AppShell />
}
