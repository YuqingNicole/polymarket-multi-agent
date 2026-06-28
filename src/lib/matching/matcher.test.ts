import { describe, it, expect } from 'vitest'
import { titleSimilarity, candidatePairs } from './matcher'
import type { MarketMeta } from '@/lib/types'

function m(source: 'poly' | 'kalshi', id: string, title: string): MarketMeta {
  return { source, marketId: id, title, category: null, endDate: null, outcomes: ['Yes', 'No'] }
}

describe('titleSimilarity', () => {
  it('is 1 for identical titles', () => {
    expect(titleSimilarity('Fed cuts rates in July', 'Fed cuts rates in July')).toBe(1)
  })
  it('is 0 for disjoint titles', () => {
    expect(titleSimilarity('bitcoin price', 'house election')).toBe(0)
  })
  it('is between 0 and 1 for partial overlap', () => {
    const s = titleSimilarity('Fed cuts rates July', 'Will the Fed cut rates')
    expect(s).toBeGreaterThan(0)
    expect(s).toBeLessThan(1)
  })
})

describe('candidatePairs', () => {
  it('keeps pairs above the similarity floor and sorts desc', () => {
    const poly = [m('poly', 'p1', 'Fed cuts rates in July 2026')]
    const kalshi = [
      m('kalshi', 'k1', 'Fed rate cut July 2026'),
      m('kalshi', 'k2', 'Bitcoin above 150k'),
    ]
    const cands = candidatePairs(poly, kalshi, 0.18)
    expect(cands.length).toBe(1)
    expect(cands[0].kalshi.marketId).toBe('k1')
    expect(cands[0].similarity).toBeGreaterThan(0.18)
  })
})
