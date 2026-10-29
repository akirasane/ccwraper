import * as React from 'react'
import { ChatSection, PrimitivesSection } from './ComponentSections'
import { seedDemoConvs } from './demo-data'
import { AnsiSection, ColorSection, MotionSection, SurfaceSection, TypeSection } from './TokenSections'

const NAV = [
  ['colors', 'Colors'],
  ['type', 'Type'],
  ['surfaces', 'Radii, shadows, glass'],
  ['ansi', 'ANSI'],
  ['motion', 'Motion'],
  ['primitives', 'Primitives'],
  ['chat', 'Chat components']
] as const

/** Storybook-lite at #/design. Static and fixture-driven: no IPC, no model calls. */
export function DesignPage(): React.JSX.Element {
  // Seed before the first render of children so ToolCard/Composer find their conversations.
  const [ready] = React.useState(() => {
    seedDemoConvs()
    return true
  })
  const go = (id: string): void => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  return (
    <div data-testid="design-page" className="h-full overflow-y-auto bg-bg-0 text-fg">
      <div className="mx-auto flex max-w-[1180px] gap-8 px-6 pb-24">
        <nav aria-label="Design sections" className="sticky top-0 hidden h-screen w-44 shrink-0 flex-col gap-0.5 py-8 lg:flex">
          <div className="mb-3 text-xs font-medium uppercase tracking-[var(--tracking-caps)] text-fg-3">ccwraper</div>
          {NAV.map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => go(id)}
              className="h-7 rounded-sm px-2 text-left text-base text-fg-2 transition-colors duration-fast ease-out hover:bg-bg-3 hover:text-fg"
            >
              {label}
            </button>
          ))}
        </nav>
        <main className="min-w-0 flex-1">
          <header className="pb-6 pt-10">
            <h1 className="m-0 text-2xl font-semibold tracking-[var(--tracking-tighter)]">Design system</h1>
            <p className="m-0 mt-2 max-w-[62ch] text-md text-fg-2">
              Tokens and components for ccwraper, rendered live from the CSS variables and fixtures. Dark, Geist, one accent gradient.
            </p>
          </header>
          {ready && (
            <>
              <ColorSection />
              <TypeSection />
              <SurfaceSection />
              <AnsiSection />
              <MotionSection />
              <PrimitivesSection />
              <ChatSection />
            </>
          )}
        </main>
      </div>
    </div>
  )
}
