import type { Source } from '@/lib/types'

// The signal bundle the agent pipeline reasons over. In seed mode it comes
// straight from the prototype dataset; in live mode it is computed from
// normalized ticks + the cross-platform pair (see buildAgentInput).
export interface AgentInput {
  marketId: string
  source: Source
  q: string // market question / title
  poly: number // YES implied probability on Polymarket, 0..1
  kalshi: number // YES implied probability on Kalshi, 0..1
  yesAvg: number // merged YES probability, 0..1
  chg: number // 24h probability change, points
  spread: number // cross-platform spread, cents = round(|poly-kalshi|*100)
  vol24: number // 24h merged volume, USD
  vol: number // cumulative volume, USD
  liq: number // book liquidity, USD
  volChg: number // 24h volume change, percent
}
