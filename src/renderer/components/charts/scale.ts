/** Pure scale helpers for the hand-rolled SVG charts. */

export interface NiceTicks {
  ticks: number[]
  max: number
}

/** "Nice" tick values from 0 up to a rounded max that covers `maxValue` (about `count` intervals). */
export function niceTicks(maxValue: number, count = 4): NiceTicks {
  if (!Number.isFinite(maxValue) || maxValue <= 0) return { ticks: [0, 1], max: 1 }
  const rough = maxValue / count
  const pow = 10 ** Math.floor(Math.log10(rough))
  const frac = rough / pow
  const step = (frac <= 1 ? 1 : frac <= 2 ? 2 : frac <= 5 ? 5 : 10) * pow
  const max = Math.ceil(maxValue / step - 1e-9) * step
  const ticks: number[] = []
  for (let v = 0; v <= max + step / 2; v += step) ticks.push(Math.round(v * 1e6) / 1e6)
  return { ticks, max: Math.round(max * 1e6) / 1e6 }
}

export interface BandScale {
  step: number
  bandwidth: number
  /** left edge of band i */
  x(i: number): number
  center(i: number): number
}

/** `n` equal bands across `width`; `padding` (0..1) is the gap fraction of each step. */
export function bandScale(n: number, width: number, padding = 0.2): BandScale {
  const step = n > 0 ? width / n : width
  const bandwidth = step * (1 - padding)
  const offset = (step - bandwidth) / 2
  return { step, bandwidth, x: (i) => i * step + offset, center: (i) => i * step + step / 2 }
}

/** Value to pixel height (0 for non-positive). */
export function scaleY(value: number, max: number, height: number): number {
  if (!(max > 0) || !(value > 0)) return 0
  return (value / max) * height
}

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 })
export function formatUsd(n: number): string {
  return usd.format(n)
}

export function formatInt(n: number): string {
  return Math.round(n).toLocaleString('en-US')
}
