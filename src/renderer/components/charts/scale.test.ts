import { describe, expect, it } from 'vitest'
import { bandScale, niceTicks, scaleY } from './scale'

describe('niceTicks', () => {
  it('handles 0', () => expect(niceTicks(0)).toEqual({ ticks: [0, 1], max: 1 }))
  it('handles 1', () => {
    const t = niceTicks(1)
    expect(t.max).toBe(1)
    expect(t.ticks[0]).toBe(0)
    expect(t.ticks.at(-1)).toBe(1)
  })
  it('handles 999', () => {
    const t = niceTicks(999)
    expect(t.max).toBe(1000)
    expect(t.ticks).toEqual([0, 500, 1000])
  })
  it('handles 1.2M with round steps', () => {
    const t = niceTicks(1_200_000)
    expect(t.max).toBeGreaterThanOrEqual(1_200_000)
    expect(t.max).toBe(1_500_000)
    expect(t.ticks).toEqual([0, 500_000, 1_000_000, 1_500_000])
  })
})

describe('bandScale', () => {
  it('lays 30 days into equal bands', () => {
    const s = bandScale(30, 300, 0.2)
    expect(s.step).toBe(10)
    expect(s.bandwidth).toBe(8)
    expect(s.x(0)).toBe(1)
    expect(s.x(29)).toBe(291)
    expect(s.center(0)).toBe(5)
  })
})

describe('scaleY', () => {
  it('maps and clamps', () => {
    expect(scaleY(50, 100, 200)).toBe(100)
    expect(scaleY(0, 100, 200)).toBe(0)
    expect(scaleY(5, 0, 200)).toBe(0)
  })
})
