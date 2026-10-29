// WCAG 2.1 contrast helpers. Colors are resolved at runtime from CSS variables (no literals here).

export type Rgb = { r: number; g: number; b: number; a: number }

/** Parses the computed-style forms browsers return: rgb()/rgba() and color(srgb r g b / a). */
export function parseColor(input: string): Rgb | undefined {
  const s = input.trim()
  let m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/i.exec(s)
  if (m) return { r: +m[1]!, g: +m[2]!, b: +m[3]!, a: alpha(m[4]) }
  m = /^color\(\s*srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+%?))?\s*\)$/i.exec(s)
  if (m) return { r: +m[1]! * 255, g: +m[2]! * 255, b: +m[3]! * 255, a: alpha(m[4]) }
  return undefined
}

function alpha(v: string | undefined): number {
  if (v === undefined) return 1
  return v.endsWith('%') ? parseFloat(v) / 100 : parseFloat(v)
}

const lin = (c: number): number => {
  const v = c / 255
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
}

export function luminance(c: Rgb): number {
  return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b)
}

export function contrastRatio(fg: Rgb, bg: Rgb): number {
  const a = luminance(fg)
  const b = luminance(bg)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

/** Composites a translucent color over an opaque backdrop. */
export function over(fg: Rgb, bg: Rgb): Rgb {
  return {
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1
  }
}

export function verdict(ratio: number): string {
  if (ratio >= 7) return 'AAA'
  if (ratio >= 4.5) return 'AA'
  if (ratio >= 3) return 'Large only'
  return 'Fail'
}

/** Resolves a CSS custom property to an Rgb by letting the browser compute it through a probe element. */
export function resolveVar(name: string, root: HTMLElement = document.documentElement): { raw: string; rgb?: Rgb } {
  const raw = getComputedStyle(root).getPropertyValue(name).trim()
  const probe = document.createElement('span')
  probe.style.color = `var(${name})`
  probe.style.display = 'none'
  root.appendChild(probe)
  const computed = getComputedStyle(probe).color
  root.removeChild(probe)
  const rgb = parseColor(computed)
  return rgb ? { raw, rgb } : { raw }
}
