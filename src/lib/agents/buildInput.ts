import type { Source } from '@/lib/types'
import { getHistory, getMarket, getPairs } from '@/lib/store'
import { probDelta, volumeChangePct } from '@/lib/analysis/probTracker'
import type { AgentInput } from './input'

// Builds the merged cross-platform AgentInput for a market straight from the
// store. If the market is paired, both venues are merged; otherwise the single
// venue stands in for both sides (spread 0).
export async function buildAgentInput(source: Source, marketId: string): Promise<AgentInput | null> {
  const meta = await getMarket(source, marketId)
  if (!meta) return null

  const pairs = await getPairs()
  const pair = pairs.find((p) =>
    (source === 'poly' ? p.polyMarketId : p.kalshiMarketId) === marketId,
  )

  let polyId = source === 'poly' ? marketId : pair?.polyMarketId
  let kalshiId = source === 'kalshi' ? marketId : pair?.kalshiMarketId

  const polyHist = polyId ? await getHistory('poly', polyId) : []
  const kalshiHist = kalshiId ? await getHistory('kalshi', kalshiId) : []

  const polyLatest = polyHist.at(-1)
  const kalshiLatest = kalshiHist.at(-1)
  const ownLatest = source === 'poly' ? polyLatest : kalshiLatest
  if (!ownLatest) return null

  const poly = polyLatest?.yesProb ?? ownLatest.yesProb
  const kalshi = kalshiLatest?.yesProb ?? ownLatest.yesProb
  const yesAvg = (poly + kalshi) / 2
  const spread = Math.round(Math.abs(poly - kalshi) * 100)

  const refHist = source === 'poly' ? polyHist : kalshiHist
  const chg = probDelta(refHist, '24h')
  const volChg = Math.round(volumeChangePct(refHist))

  const vol24 = (polyLatest?.volume24h ?? 0) + (kalshiLatest?.volume24h ?? 0)
  const vol = (polyLatest?.volumeTotal ?? 0) + (kalshiLatest?.volumeTotal ?? 0)
  // Liquidity is not carried on ticks; approximate from 24h volume for the
  // descriptive text. (Live data can later persist book depth explicitly.)
  const liq = Math.round(vol24 * 0.5)

  return {
    marketId,
    source,
    q: meta.title,
    poly,
    kalshi,
    yesAvg,
    chg,
    spread,
    vol24,
    vol,
    liq,
    volChg,
  }
}
