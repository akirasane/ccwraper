import { describe, expect, it } from 'vitest'
import { limitTypeFromText, looksLikeUsageLimit, normalizeResetsAt, parseLimitReset } from './rate-limit'

const utc = (iso: string): number => Date.parse(iso)
// 15:00 in Asia/Bangkok (UTC+7), Friday 2026-10-30.
const NOW = utc('2026-10-30T08:00:00Z')

describe('normalizeResetsAt', () => {
  it('turns epoch seconds into ms and keeps ms', () => {
    expect(normalizeResetsAt(1_793_350_800)).toBe(1_793_350_800_000)
    expect(normalizeResetsAt(1_793_350_800_000)).toBe(1_793_350_800_000)
  })
  it('rejects junk', () => {
    expect(normalizeResetsAt(undefined)).toBeUndefined()
    expect(normalizeResetsAt(0)).toBeUndefined()
    expect(normalizeResetsAt(Number.NaN)).toBeUndefined()
    expect(normalizeResetsAt('5')).toBeUndefined()
  })
})

describe('parseLimitReset', () => {
  it('reads "resets 4:10pm (Asia/Bangkok)" as today when still ahead', () => {
    expect(parseLimitReset('5-hour limit reached ∙ resets 4:10pm (Asia/Bangkok)', NOW)).toBe(utc('2026-10-30T09:10:00Z'))
  })
  it('takes the next occurrence (tomorrow) when the clock time already passed', () => {
    expect(parseLimitReset("You've hit your limit · resets 2pm (Asia/Bangkok)", NOW)).toBe(utc('2026-10-31T07:00:00Z'))
  })
  it('handles 12am and 12pm', () => {
    expect(parseLimitReset('limit reached ∙ resets 12am (Asia/Bangkok)', NOW)).toBe(utc('2026-10-30T17:00:00Z'))
    expect(parseLimitReset('limit reached ∙ resets 12pm (Asia/Bangkok)', NOW)).toBe(utc('2026-10-31T05:00:00Z'))
  })
  it('reads 24-hour clocks and "will reset at"', () => {
    expect(parseLimitReset('Your limit will reset at 16:10 (Asia/Bangkok).', NOW)).toBe(utc('2026-10-30T09:10:00Z'))
  })
  it('uses the zone named in the text, not the machine zone', () => {
    // 4pm New York (EDT, UTC-4) = 20:00Z, still ahead of 08:00Z
    expect(parseLimitReset('resets 4pm (America/New_York)', NOW)).toBe(utc('2026-10-30T20:00:00Z'))
  })
  it('reads a dated reset across the DST change (EST after Nov 1)', () => {
    expect(parseLimitReset('Weekly limit reached ∙ resets Nov 2, 3pm (America/New_York)', NOW)).toBe(
      utc('2026-11-02T20:00:00Z')
    )
    expect(parseLimitReset('resets Nov 2 at 3pm (America/New_York)', NOW)).toBe(utc('2026-11-02T20:00:00Z'))
  })
  it('rolls a past date into next year', () => {
    const now = utc('2026-12-31T20:00:00Z')
    expect(parseLimitReset('resets Jan 2, 3pm (UTC)', now)).toBe(utc('2027-01-02T15:00:00Z'))
  })
  it('reads epoch seconds after a pipe (legacy CLI text)', () => {
    const at = utc('2026-10-30T09:00:00Z')
    expect(parseLimitReset(`Claude AI usage limit reached|${at / 1000}`, NOW)).toBe(at)
  })
  it('falls back to the supplied default zone when the text has none', () => {
    expect(parseLimitReset('resets 4:10pm', NOW, 'Asia/Bangkok')).toBe(utc('2026-10-30T09:10:00Z'))
  })
  it('fails safe: unparsable, ambiguous, bad zone, implausible', () => {
    expect(parseLimitReset(undefined, NOW)).toBeUndefined()
    expect(parseLimitReset('', NOW)).toBeUndefined()
    expect(parseLimitReset('429 Too Many Requests', NOW)).toBeUndefined()
    expect(parseLimitReset('limit reached ∙ resets soon', NOW)).toBeUndefined()
    expect(parseLimitReset('limit reached ∙ resets 4 (Asia/Bangkok)', NOW)).toBeUndefined()
    expect(parseLimitReset('resets 13pm (Asia/Bangkok)', NOW)).toBeUndefined()
    expect(parseLimitReset('resets 4pm (Not/AZone)', NOW)).toBeUndefined()
    expect(parseLimitReset(`limit|${utc('2026-01-01T00:00:00Z') / 1000}`, NOW)).toBeUndefined()
    expect(parseLimitReset('resets Dec 30, 3pm (UTC)', NOW)).toBeUndefined() // > 8 days ahead
  })
})

describe('looksLikeUsageLimit / limitTypeFromText', () => {
  it('recognises limit wording and ignores a bare 429', () => {
    expect(looksLikeUsageLimit('5-hour limit reached ∙ resets 4pm')).toBe(true)
    expect(looksLikeUsageLimit("You've hit your limit · resets 4pm (Asia/Bangkok)")).toBe(true)
    expect(looksLikeUsageLimit('Claude AI usage limit reached|1793350800')).toBe(true)
    expect(looksLikeUsageLimit('API Error: 429 rate limited, retry later')).toBe(false)
    expect(looksLikeUsageLimit(undefined)).toBe(false)
  })
  it('classifies the limit kind', () => {
    expect(limitTypeFromText('5-hour limit reached')).toBe('five_hour')
    expect(limitTypeFromText('Weekly limit reached')).toBe('seven_day')
    expect(limitTypeFromText('Opus weekly limit reached')).toBe('seven_day_opus')
    expect(limitTypeFromText('limit reached')).toBeUndefined()
  })
})
