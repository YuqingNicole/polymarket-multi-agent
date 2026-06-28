import type { MarketPair } from '@/lib/types'
import { PROTOTYPE_BASE } from '@/lib/seed/prototype'

// Curated cross-platform event mapping. This is the hand-maintained seed of
// known Polymarket<->Kalshi event pairs. In seed mode the ids are synthetic
// (`poly-<id>` / `kalshi-<id>`); for live data, add real conditionId<->ticker
// rows here and the matcher fills the rest.

export interface CuratedPair {
  key: string // shared event key
  title: string
  polyMarketId: string
  kalshiMarketId: string
}

export const CURATED_PAIRS: CuratedPair[] = PROTOTYPE_BASE.map((m) => ({
  key: m.id,
  title: m.q,
  polyMarketId: `poly-${m.id}`,
  kalshiMarketId: `kalshi-${m.id}`,
}))

export function curatedPairs(): MarketPair[] {
  return CURATED_PAIRS.map((p) => ({
    polyMarketId: p.polyMarketId,
    kalshiMarketId: p.kalshiMarketId,
    confidence: 1,
    source: 'curated' as const,
    mergedYesProb: null,
  }))
}
