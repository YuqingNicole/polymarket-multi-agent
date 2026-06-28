import { describe, it, expect } from 'vitest'
import type { MarketTick } from '@/lib/types'
import { probDelta, volumeChangePct } from './probTracker'

const BASE = Date.parse('2026-06-29T00:00:00.000Z')
const HOUR = 60 * 60 * 1000

/** Build a tick `hoursAgo` before the anchor (anchor = BASE + 24h). */
function tick(
  hoursFromBase: number,
  yesProb: number,
  volume24h = 1000,
): MarketTick {
  return {
    source: 'poly',
    marketId: 'm1',
    yesProb,
    volume24h,
    volumeTotal: 100_000,
    ts: new Date(BASE + hoursFromBase * HOUR).toISOString(),
  }
}

describe('probDelta', () => {
  it('returns 0 with insufficient history', () => {
    expect(probDelta([], '24h')).toBe(0)
    expect(probDelta([tick(0, 0.5)], '24h')).toBe(0)
  })

  it('computes positive delta in pts over 24h', () => {
    const history = [tick(0, 0.5), tick(12, 0.55), tick(24, 0.6)]
    expect(probDelta(history, '24h')).toBe(10) // (0.6-0.5)*100
  })

  it('computes negative delta in pts', () => {
    const history = [tick(0, 0.6), tick(24, 0.5)]
    expect(probDelta(history, '24h')).toBe(-10)
  })

  it('respects the 1h window (ignores older ticks)', () => {
    // ticks at 22h, 23.5h, 24h relative to base; anchor is the 24h tick.
    const history = [tick(0, 0.4), tick(23.5, 0.51), tick(24, 0.55)]
    // 1h window cutoff = 23h; first tick >= 23h is the 23.5h one (0.51)
    expect(probDelta(history, '1h')).toBe(4) // (0.55-0.51)*100
  })

  it('rounds to 1 decimal', () => {
    const history = [tick(0, 0.501), tick(24, 0.512)]
    expect(probDelta(history, '24h')).toBe(1.1)
  })
})

describe('volumeChangePct', () => {
  it('returns 0 with insufficient history', () => {
    expect(volumeChangePct([tick(0, 0.5, 1000)])).toBe(0)
  })

  it('computes percentage growth vs ~24h-prior baseline', () => {
    const history = [tick(0, 0.5, 1000), tick(24, 0.5, 1600)]
    expect(volumeChangePct(history)).toBe(60) // (1600-1000)/1000*100
  })

  it('handles decline', () => {
    const history = [tick(0, 0.5, 1000), tick(24, 0.5, 700)]
    expect(volumeChangePct(history)).toBe(-30)
  })

  it('returns 0 when baseline volume is 0', () => {
    const history = [tick(0, 0.5, 0), tick(24, 0.5, 500)]
    expect(volumeChangePct(history)).toBe(0)
  })
})
