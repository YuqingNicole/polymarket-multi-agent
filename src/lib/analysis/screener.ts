import type { MarketMeta, MarketTick, Source } from '@/lib/types'
import { probDelta } from './probTracker'

export interface ScreenInput {
  meta: MarketMeta
  latest: MarketTick
  history: MarketTick[]
}

export interface RankedMarket {
  marketId: string
  source: Source
  score: number
}

const DAY_MS = 24 * 60 * 60 * 1000

/** Diminishing-returns normalization: 0..1, hits ~0.5 around `scale`. */
function saturate(value: number, scale: number): number {
  if (value <= 0) return 0
  return value / (value + scale)
}

/**
 * Composite screening score in 0..1, weighting:
 *  - 24h volume (liquidity/interest)          0.35
 *  - total volume as liquidity proxy          0.25
 *  - time-to-settlement (sooner = higher)     0.20
 *  - recent activity (|probDelta 24h|)        0.20
 */
export function screenScore(input: ScreenInput): number {
  const { meta, latest, history } = input

  const volScore = saturate(latest.volume24h, 50_000)
  const liqScore = saturate(latest.volumeTotal, 500_000)

  let timeScore = 0.5
  if (meta.endDate) {
    const msLeft = new Date(meta.endDate).getTime() - new Date(latest.ts).getTime()
    if (msLeft <= 0) {
      timeScore = 0 // already settled / past end
    } else {
      // closer to settlement -> higher; 7d horizon maps to ~0.5
      const daysLeft = msLeft / DAY_MS
      timeScore = 1 - saturate(daysLeft, 7)
    }
  }

  const activityScore = saturate(Math.abs(probDelta(history, '24h')), 10)

  const score =
    0.35 * volScore + 0.25 * liqScore + 0.2 * timeScore + 0.2 * activityScore

  return Math.max(0, Math.min(1, score))
}

/** Rank markets by composite score, descending. */
export function rankMarkets(inputs: ScreenInput[]): RankedMarket[] {
  return inputs
    .map((input) => ({
      marketId: input.meta.marketId,
      source: input.meta.source,
      score: screenScore(input),
    }))
    .sort((a, b) => b.score - a.score)
}
