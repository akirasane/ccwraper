import { describe, expect, it } from 'vitest'
import { contrastRatio, over, parseColor, verdict } from './contrast'

describe('contrast helpers', () => {
  it('parses rgb, rgba and color(srgb)', () => {
    expect(parseColor('rgb(10, 20, 30)')).toEqual({ r: 10, g: 20, b: 30, a: 1 })
    expect(parseColor('rgba(10, 20, 30, 0.5)')?.a).toBe(0.5)
    expect(parseColor('color(srgb 1 0 0 / 50%)')).toEqual({ r: 255, g: 0, b: 0, a: 0.5 })
    expect(parseColor('nonsense')).toBeUndefined()
  })
  it('computes WCAG ratios', () => {
    const white = { r: 255, g: 255, b: 255, a: 1 }
    const black = { r: 0, g: 0, b: 0, a: 1 }
    expect(contrastRatio(white, black)).toBeCloseTo(21, 1)
    expect(contrastRatio(white, white)).toBeCloseTo(1, 5)
    expect(verdict(21)).toBe('AAA')
    expect(verdict(5)).toBe('AA')
    expect(verdict(3.2)).toBe('Large only')
    expect(verdict(2)).toBe('Fail')
  })
  it('composites alpha over a backdrop', () => {
    const c = over({ r: 255, g: 255, b: 255, a: 0.5 }, { r: 0, g: 0, b: 0, a: 1 })
    expect(Math.round(c.r)).toBe(128)
  })
})
