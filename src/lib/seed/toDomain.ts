import type { MarketMeta, MarketPair, MarketTick } from '@/lib/types'
import { buildPrototypeMarkets, genHist, hash, type PrototypeMarket } from './prototype'

// Converts the prototype dataset into the normalized domain model: for each
// cross-platform event we emit a Polymarket market and a Kalshi market (each
// with its own probability history) plus the curated pair linking them.

const N = 80
const STEP_MS = 18 * 60 * 1000 // 80 points * 18min ≈ 24h of history

export interface SeedBundle {
  markets: MarketMeta[]
  ticks: MarketTick[]
  pairs: MarketPair[]
}

function metaFor(source: 'poly' | 'kalshi', m: PrototypeMarket): MarketMeta {
  return {
    source,
    marketId: `${source}-${m.id}`,
    title: m.q,
    category: m.cat,
    endDate: null,
    outcomes: ['Yes', 'No'],
    ...(source === 'poly'
      ? { polyClobTokenIds: [`${m.id}-yes`, `${m.id}-no`] as [string, string] }
      : { kalshiEventTicker: `KX${m.id.toUpperCase().replace(/[^A-Z0-9]/g, '')}` }),
  }
}

// Build a probability history that lands exactly on `target` and a volume
// series consistent with the prototype's 24h / cumulative figures.
function ticksFor(source: 'poly' | 'kalshi', m: PrototypeMarket, now: number): MarketTick[] {
  const target = source === 'poly' ? m.poly : m.kalshi
  const seed = hash(`${source}-${m.id}`)
  const probs = genHist(seed, target, 0.018, N)
  const out: MarketTick[] = []
  for (let i = 0; i < N; i++) {
    const ts = new Date(now - (N - 1 - i) * STEP_MS).toISOString()
    const frac = i / (N - 1)
    out.push({
      source,
      marketId: `${source}-${m.id}`,
      yesProb: probs[i],
      volume24h: Math.round(m.vol24 * (0.85 + 0.3 * frac)),
      volumeTotal: Math.round(m.vol - m.vol24 * (1 - frac)),
      ts,
    })
  }
  return out
}

export function buildSeedBundle(now: number = Date.now()): SeedBundle {
  const protos = buildPrototypeMarkets()
  const markets: MarketMeta[] = []
  const ticks: MarketTick[] = []
  const pairs: MarketPair[] = []
  for (const m of protos) {
    markets.push(metaFor('poly', m), metaFor('kalshi', m))
    ticks.push(...ticksFor('poly', m, now), ...ticksFor('kalshi', m, now))
    pairs.push({
      polyMarketId: `poly-${m.id}`,
      kalshiMarketId: `kalshi-${m.id}`,
      confidence: 1,
      source: 'curated',
      mergedYesProb: m.yesAvg,
    })
  }
  return { markets, ticks, pairs }
}
