import type { ScreenInput } from '@/lib/analysis/screener'
import type { Signal } from '@/lib/types'
import { detectAll } from '@/lib/analysis/anomaly'
import { getHistory, getMarkets, getPairs, replaceSignals, upsertPairs } from '@/lib/store'
import { bus } from './bus'

// Recomputes anomaly signals from the current store contents and refreshes each
// pair's merged YES probability. Emits the fresh signal set on the bus.
export async function recomputeSignals(): Promise<Signal[]> {
  const metas = await getMarkets()
  const pairs = await getPairs()

  const inputs: ScreenInput[] = []
  for (const meta of metas) {
    const history = await getHistory(meta.source, meta.marketId)
    const latest = history.at(-1)
    if (!latest) continue
    inputs.push({ meta, latest, history })
  }

  const signals = detectAll(inputs, pairs)
  await replaceSignals(signals)

  const latestProb = new Map(inputs.map((i) => [`${i.meta.source}:${i.meta.marketId}`, i.latest.yesProb]))
  const updatedPairs = pairs.map((p) => {
    const poly = latestProb.get(`poly:${p.polyMarketId}`)
    const kalshi = latestProb.get(`kalshi:${p.kalshiMarketId}`)
    const mergedYesProb = poly != null && kalshi != null ? (poly + kalshi) / 2 : p.mergedYesProb
    return { ...p, mergedYesProb }
  })
  await upsertPairs(updatedPairs)

  bus.emit('signals', signals)
  return signals
}
