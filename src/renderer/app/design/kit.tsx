// Small layout kit used by the /design sections. No color literals: everything reads CSS variables.
import * as React from 'react'
import { cn } from '@/lib/cn'
import { contrastRatio, over, resolveVar, verdict, type Rgb } from './contrast'

export function Section({
  id,
  title,
  note,
  children
}: {
  id: string
  title: string
  note?: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <section id={id} data-testid={`section-${id}`} className="scroll-mt-6 border-t border-border py-8">
      <h2 className="m-0 text-xl font-semibold tracking-[var(--tracking-tighter)] text-fg">{title}</h2>
      {note && <p className="m-0 mt-1 max-w-[70ch] text-base text-fg-2">{note}</p>}
      <div className="mt-5 flex flex-col gap-6">{children}</div>
    </section>
  )
}

export function Sub({ title, children }: { title: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div>
      <h3 className="m-0 mb-2.5 text-xs font-medium uppercase tracking-[var(--tracking-caps)] text-fg-3">{title}</h3>
      {children}
    </div>
  )
}

export function Frame({ children, className }: { children: React.ReactNode; className?: string }): React.JSX.Element {
  return <div className={cn('rounded-md border border-border bg-bg-1 p-4', className)}>{children}</div>
}

export function Labeled({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex flex-col items-start gap-1.5">
      <div>{children}</div>
      <span className="text-2xs text-fg-3">{label}</span>
    </div>
  )
}

/** Reads a CSS custom property after mount so values are never duplicated in code. */
export function useCssVar(name: string): { raw: string; rgb?: Rgb } {
  const [v, setV] = React.useState<{ raw: string; rgb?: Rgb }>({ raw: '' })
  React.useLayoutEffect(() => {
    setV(resolveVar(name))
  }, [name])
  return v
}

export function Swatch({ name, label }: { name: string; label?: string }): React.JSX.Element {
  const { raw } = useCssVar(name)
  return (
    <div className="flex min-w-0 items-center gap-2.5" data-testid="swatch">
      <span
        aria-hidden
        className="size-9 shrink-0 rounded-sm ring-1 ring-inset ring-[var(--border-strong)]"
        style={{ background: `var(${name})` }}
      />
      <span className="min-w-0 leading-tight">
        <span className="block truncate font-mono text-sm text-fg">{label ?? name}</span>
        <span className="block truncate font-mono text-2xs text-fg-3">{raw || ' '}</span>
      </span>
    </div>
  )
}

/** Live contrast of `fg` over `bg` (both CSS variable names). Translucent foregrounds are composited first. */
export function useRatio(fg: string, bg: string): number | undefined {
  const [r, setR] = React.useState<number>()
  React.useLayoutEffect(() => {
    const f = resolveVar(fg).rgb
    const b = resolveVar(bg).rgb
    setR(f && b ? contrastRatio(over(f, b), b) : undefined)
  }, [fg, bg])
  return r
}

export function Ratio({ fg, bg }: { fg: string; bg: string }): React.JSX.Element {
  const r = useRatio(fg, bg)
  if (r === undefined) return <span className="text-fg-muted">n/a</span>
  const tone = r >= 4.5 ? 'text-ok' : r >= 3 ? 'text-warn' : 'text-danger'
  return (
    <span className="tabular-nums" title={verdict(r)}>
      {r.toFixed(2)} <span className={cn('text-2xs', tone)}>{verdict(r)}</span>
    </span>
  )
}

export function Table({ head, rows }: { head: string[]; rows: React.ReactNode[][] }): React.JSX.Element {
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="bg-bg-1 text-left text-fg-3">
            {head.map((h) => (
              <th key={h} className="px-3 py-2 text-xs font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-border">
              {r.map((c, j) => (
                <td key={j} className="px-3 py-2 align-middle text-fg-2">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
