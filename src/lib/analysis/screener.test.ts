import { describe, it, expect } from 'vitest'
import type { MarketMeta, MarketTick } from '@/lib/types'
import { screenScore, rankMarkets, type ScreenInput } from './screener'

const BASE = Date.parse('2026-06-29T00:00:00.000Z')
const HOUR = 60 * 60 * 1000

function makeInput(
  marketId: string,
  opts: {
    volume24h: number
    volumeTotal: number
    endHours: number | null
    probStart: number
    probEnd: number
  },
): ScreenInput {
  const meta: MarketMeta = {
    source: 'poly',
    marketId,
    title: marketId,
    category: null,
    endDate: opts.endHours === null ? null : new Date(BASE + opts.endHours * HOUR).toISOString(),
    outcomes: ['Yes', 'No'],
  }
  const mk = (h: number, prob: number): MarketTick => ({
    source: 'poly',
    marketId,
    yesProb: prob,
    volume24h: opts.volume24h,
    volumeTotal: opts.volumeTotal,
    ts: new Date(BASE + h * HOUR).toISOString(),
  })
  const history = [mk(0, opts.probStart), mk(24, opts.probEnd)]
  return { meta, latest: history[history.length - 1], history }
}

describe('screenScore', () => {
  it('returns a value in [0,1]', () => {
    const input = makeInput('m1', {
      volume24h: 50_000,
      volumeTotal: 500_000,
      endHours: 48,
      probStart: 0.5,
      probEnd: 0.6,
    })
    const score = screenScore(input)
    expect(score).toBeGreaterThanOrEqual(0)
    expect(score).toBeLessThanOrEqual(1)
  })

  it('scores a hot market above a cold one', () => {
    const hot = makeInput('hot', {
      volume24h: 200_000,
      volumeTotal: 2_000_000,
      endHours: 24, // settling soon
      probStart: 0.5,
      probEnd: 0.7, // big move
    })
    const cold = makeInput('cold', {
      volume24h: 100,
      volumeTotal: 1000,
      endHours: 24 + 365 * 24, // far away
      probStart: 0.5,
      probEnd: 0.5, // flat
    })
    expect(screenScore(hot)).toBeGreaterThan(screenScore(cold))
  })

  it('handles null endDate gracefully', () => {
    const input = makeInput('m1', {
      volume24h: 10_000,
      volumeTotal: 100_000,
      endHours: null,
      probStart: 0.5,
      probEnd: 0.5,
    })
    expect(() => screenScore(input)).not.toThrow()
  })
})

describe('rankMarkets', () => {
  it('orders markets by descending score', () => {
    const hot = makeInput('hot', {
      volume24h: 200_000,
      volumeTotal: 2_000_000,
      endHours: 24,
      probStart: 0.5,
      probEnd: 0.7,
    })
    const mid = makeInput('mid', {
      volume24h: 20_000,
      volumeTotal: 200_000,
      endHours: 24 * 30,
      probStart: 0.5,
      probEnd: 0.52,
    })
    const cold = makeInput('cold', {
      volume24h: 100,
      volumeTotal: 1000,
      endHours: 24 * 365,
      probStart: 0.5,
      probEnd: 0.5,
    })
    const ranked = rankMarkets([cold, hot, mid])
    expect(ranked.map((r) => r.marketId)).toEqual(['hot', 'mid', 'cold'])
    expect(ranked[0].score).toBeGreaterThanOrEqual(ranked[1].score)
    expect(ranked[1].score).toBeGreaterThanOrEqual(ranked[2].score)
  })
})
