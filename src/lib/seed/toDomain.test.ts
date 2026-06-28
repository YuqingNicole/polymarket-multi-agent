import { describe, it, expect } from 'vitest'
import { buildSeedBundle } from './toDomain'
import { PROTOTYPE_BASE } from './prototype'

describe('buildSeedBundle', () => {
  const bundle = buildSeedBundle(Date.UTC(2026, 5, 29, 12, 0, 0))

  it('emits a poly and kalshi market per prototype event', () => {
    expect(bundle.markets).toHaveLength(PROTOTYPE_BASE.length * 2)
    expect(bundle.pairs).toHaveLength(PROTOTYPE_BASE.length)
  })

  it('history lands exactly on the per-venue target probability', () => {
    const fed = PROTOTYPE_BASE.find((m) => m.id === 'fed-jul')!
    const polyTicks = bundle.ticks
      .filter((t) => t.marketId === 'poly-fed-jul')
      .sort((a, b) => a.ts.localeCompare(b.ts))
    expect(polyTicks).toHaveLength(80)
    expect(polyTicks[polyTicks.length - 1].yesProb).toBeCloseTo(fed.poly, 6)
  })

  it('every tick prob is within 0..1', () => {
    for (const t of bundle.ticks) {
      expect(t.yesProb).toBeGreaterThanOrEqual(0)
      expect(t.yesProb).toBeLessThanOrEqual(1)
    }
  })

  it('curated pairs carry merged probability', () => {
    const p = bundle.pairs.find((x) => x.polyMarketId === 'poly-fed-jul')!
    expect(p.kalshiMarketId).toBe('kalshi-fed-jul')
    expect(p.source).toBe('curated')
    expect(p.mergedYesProb).toBeCloseTo((0.68 + 0.63) / 2, 6)
  })
})
