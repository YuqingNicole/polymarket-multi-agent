import { describe, it, expect } from 'vitest'
import type { MarketMeta, MarketTick, MarketPair } from '@/lib/types'
import {
  detectProbJump,
  detectVolSpike,
  detectSpread,
  detectAll,
} from './anomaly'
import type { ScreenInput } from './screener'

const BASE = Date.parse('2026-06-29T00:00:00.000Z')
const HOUR = 60 * 60 * 1000

function meta(marketId = 'm1', source: 'poly' | 'kalshi' = 'poly'): MarketMeta {
  return {
    source,
    marketId,
    title: 't',
    category: null,
    endDate: new Date(BASE + 48 * HOUR).toISOString(),
    outcomes: ['Yes', 'No'],
  }
}

function tick(
  hoursFromBase: number,
  yesProb: number,
  volume24h = 1000,
  marketId = 'm1',
  source: 'poly' | 'kalshi' = 'poly',
): MarketTick {
  return {
    source,
    marketId,
    yesProb,
    volume24h,
    volumeTotal: 100_000,
    ts: new Date(BASE + hoursFromBase * HOUR).toISOString(),
  }
}

describe('detectProbJump', () => {
  it('fires exactly at the 5pt boundary', () => {
    const history = [tick(0, 0.5), tick(24, 0.55)] // Δ = 5pts
    const sig = detectProbJump(meta(), history)
    expect(sig).not.toBeNull()
    expect(sig!.kind).toBe('prob_jump')
    expect(sig!.severity).toBeCloseTo(5 / 15)
    expect(sig!.detail).toContain('抬升')
  })

  it('does not fire just below 5pts', () => {
    const history = [tick(0, 0.5), tick(24, 0.549)] // Δ = 4.9pts
    expect(detectProbJump(meta(), history)).toBeNull()
  })

  it('fires on a downward move and caps severity at 1', () => {
    const history = [tick(0, 0.9), tick(24, 0.5)] // Δ = -40pts
    const sig = detectProbJump(meta(), history)
    expect(sig).not.toBeNull()
    expect(sig!.severity).toBe(1)
    expect(sig!.detail).toContain('回落')
  })
})

describe('detectVolSpike', () => {
  it('fires exactly at 50%', () => {
    const history = [tick(0, 0.5, 1000), tick(24, 0.5, 1500)] // +50%
    const sig = detectVolSpike(meta(), history)
    expect(sig).not.toBeNull()
    expect(sig!.kind).toBe('vol_spike')
    expect(sig!.severity).toBeCloseTo(50 / 200)
  })

  it('does not fire below 50%', () => {
    const history = [tick(0, 0.5, 1000), tick(24, 0.5, 1499)] // +49.9%
    expect(detectVolSpike(meta(), history)).toBeNull()
  })
})

describe('detectSpread', () => {
  it('fires exactly at 4¢', () => {
    const sig = detectSpread(
      { marketId: 'poly1', yesProb: 0.54 },
      { marketId: 'k1', yesProb: 0.5 },
    )
    expect(sig).not.toBeNull()
    expect(sig!.kind).toBe('xplat_spread')
    expect(sig!.marketId).toBe('poly1') // taken from poly side
    expect(sig!.source).toBe('poly')
    expect(sig!.severity).toBeCloseTo(4 / 15)
    expect(sig!.detail).toContain('Polymarket 54%')
    expect(sig!.detail).toContain('Kalshi 50%')
  })

  it('does not fire at 3¢', () => {
    const sig = detectSpread(
      { marketId: 'poly1', yesProb: 0.53 },
      { marketId: 'k1', yesProb: 0.5 },
    )
    expect(sig).toBeNull()
  })
})

describe('detectAll', () => {
  it('aggregates per-market and pair signals', () => {
    const polyInput: ScreenInput = {
      meta: meta('poly1', 'poly'),
      latest: tick(24, 0.6, 1500, 'poly1', 'poly'),
      history: [
        tick(0, 0.5, 1000, 'poly1', 'poly'),
        tick(24, 0.6, 1500, 'poly1', 'poly'), // +10pts jump AND +50% vol
      ],
    }
    const kalshiInput: ScreenInput = {
      meta: meta('k1', 'kalshi'),
      latest: tick(24, 0.5, 1000, 'k1', 'kalshi'),
      history: [
        tick(0, 0.5, 1000, 'k1', 'kalshi'),
        tick(24, 0.5, 1000, 'k1', 'kalshi'),
      ],
    }
    const pairs: MarketPair[] = [
      {
        polyMarketId: 'poly1',
        kalshiMarketId: 'k1',
        confidence: 1,
        source: 'curated',
        mergedYesProb: null,
      },
    ]

    const signals = detectAll([polyInput, kalshiInput], pairs)
    const kinds = signals.map((s) => s.kind).sort()
    // poly1: prob_jump + vol_spike ; pair: xplat_spread (0.6 vs 0.5 = 10¢)
    expect(kinds).toEqual(['prob_jump', 'vol_spike', 'xplat_spread'])
  })

  it('runs without pairs', () => {
    const input: ScreenInput = {
      meta: meta('poly1', 'poly'),
      latest: tick(24, 0.5, 1000, 'poly1', 'poly'),
      history: [
        tick(0, 0.5, 1000, 'poly1', 'poly'),
        tick(24, 0.5, 1000, 'poly1', 'poly'),
      ],
    }
    expect(detectAll([input])).toEqual([])
  })
})
