import type { MarketMeta, MarketTick, Signal, Source } from '@/lib/types'
import { config } from '@/lib/config'
import { getHistory, getLatestTicks, getMarket, getMarkets, getPairs, getSignals, saveAgentRun } from '@/lib/store'
import { probDelta, volumeChangePct } from '@/lib/analysis/probTracker'
import { buildAgentInput } from '@/lib/agents/buildInput'
import { runPipeline } from '@/lib/agents/pipeline'
import { buildPrototypeMarkets, type PrototypeMarket } from '@/lib/seed/prototype'

// Aggregated dashboard view assembled from the store: one row per cross-platform
// event, plus signals and KPIs. Shared by /api/markets and the SSE stream.

export interface BoardRow {
  id: string // poly marketId (primary key for the event row)
  polyMarketId: string
  kalshiMarketId: string
  q: string
  cat: string | null
  poly: number
  kalshi: number
  yesAvg: number
  spread: number
  chg: number
  vol24: number
  vol: number
  liq: number
  volChg: number
  flags: string[] // signal kinds present for this event
}

export interface Board {
  markets: BoardRow[]
  signals: Signal[]
  kpis: {
    marketCount: number
    vol24Total: number
    arbCount: number
    jumpCount: number
  }
}

const KIND_TO_FLAG: Record<string, string> = {
  xplat_spread: 'spread',
  prob_jump: 'jump',
  vol_spike: 'volume',
}

export async function getBoard(): Promise<Board> {
  const pairs = await getPairs()
  const signals = await getSignals(100)

  // group signal kinds by the markets they touch (either venue of a pair)
  const flagsByMarket = new Map<string, Set<string>>()
  for (const s of signals) {
    const set = flagsByMarket.get(s.marketId) ?? new Set<string>()
    if (KIND_TO_FLAG[s.kind]) set.add(KIND_TO_FLAG[s.kind])
    flagsByMarket.set(s.marketId, set)
  }

  const rows: BoardRow[] = []
  for (const p of pairs) {
    const input = await buildAgentInput('poly', p.polyMarketId)
    if (!input) continue
    const meta = await getMarket('poly', p.polyMarketId)
    const flags = new Set<string>([
      ...(flagsByMarket.get(p.polyMarketId) ?? []),
      ...(flagsByMarket.get(p.kalshiMarketId) ?? []),
    ])
    rows.push({
      id: p.polyMarketId,
      polyMarketId: p.polyMarketId,
      kalshiMarketId: p.kalshiMarketId,
      q: input.q,
      cat: meta?.category ?? null,
      poly: input.poly,
      kalshi: input.kalshi,
      yesAvg: input.yesAvg,
      spread: input.spread,
      chg: input.chg,
      vol24: input.vol24,
      vol: input.vol,
      liq: input.liq,
      volChg: input.volChg,
      flags: [...flags],
    })
  }

  const arbCount = signals.filter((s) => s.kind === 'xplat_spread').length
  const jumpCount = signals.filter((s) => s.kind === 'prob_jump').length
  return {
    markets: rows,
    signals,
    kpis: {
      marketCount: rows.length,
      vol24Total: rows.reduce((a, r) => a + r.vol24, 0),
      arbCount,
      jumpCount,
    },
  }
}

// A market shaped exactly like the prototype dataset (so the terminal UI
// renders it unchanged) plus `polyMarketId` for issuing agent API calls.
export type MarketView = PrototypeMarket & { polyMarketId: string; source: Source }

const FLAG_ORDER = ['spread', 'jump', 'volume', 'new']

// Drives the terminal UI. In seed mode it returns the prototype dataset
// verbatim (pixel-identical); in live mode it computes the same shape from the
// store (merged history, cross-platform spread, signal-derived flags).
export async function getMarketViews(): Promise<MarketView[]> {
  if (config.DATA_SOURCE === 'seed') {
    return buildPrototypeMarkets().map((m) => ({ ...m, polyMarketId: `poly-${m.id}`, source: 'poly' as Source }))
  }

  // live: rank the most-liquid Polymarket markets and build a row for each.
  // Merge a Kalshi counterpart when a cross-platform pair exists; otherwise show
  // the single venue (spread 0). Real probabilities/volumes; history grows as
  // ticks arrive.
  const [polyMarkets, latestTicks, pairs, signals] = await Promise.all([
    getMarkets('poly'),
    getLatestTicks(),
    getPairs(),
    getSignals(300),
  ])
  const latest = new Map(latestTicks.map((t) => [`${t.source}:${t.marketId}`, t]))
  const polyToKalshi = new Map(pairs.map((p) => [p.polyMarketId, p.kalshiMarketId]))

  const flagsByMarket = new Map<string, Set<string>>()
  for (const s of signals) {
    const flag = KIND_TO_FLAG[s.kind]
    if (!flag) continue
    const set = flagsByMarket.get(s.marketId) ?? new Set<string>()
    set.add(flag)
    flagsByMarket.set(s.marketId, set)
  }

  const ranked = polyMarkets
    .map((m) => ({ m, tick: latest.get(`poly:${m.marketId}`) }))
    .filter((x): x is { m: MarketMeta; tick: MarketTick } => !!x.tick)
    .sort((a, b) => (b.tick.volume24h || b.tick.volumeTotal) - (a.tick.volume24h || a.tick.volumeTotal))
    .slice(0, 18)

  const views: MarketView[] = []
  for (const { m, tick } of ranked) {
    const history = await getHistory('poly', m.marketId)
    const poly = tick.yesProb
    const kalshiId = polyToKalshi.get(m.marketId)
    const kTick = kalshiId ? latest.get(`kalshi:${kalshiId}`) : undefined
    const kalshi = kTick ? kTick.yesProb : poly
    const vol24 = tick.volume24h + (kTick?.volume24h ?? 0)
    const flags = FLAG_ORDER.filter(
      (f) => flagsByMarket.get(m.marketId)?.has(f) || (!!kalshiId && !!flagsByMarket.get(kalshiId)?.has(f)),
    )
    views.push({
      id: m.marketId,
      polyMarketId: m.marketId,
      source: 'poly',
      q: m.title,
      cat: m.category ?? '',
      poly,
      kalshi,
      yesAvg: (poly + kalshi) / 2,
      spread: Math.round(Math.abs(poly - kalshi) * 100),
      chg: probDelta(history, '24h'),
      vol24,
      vol: tick.volumeTotal + (kTick?.volumeTotal ?? 0),
      liq: Math.round(vol24 * 0.5),
      volChg: Math.round(volumeChangePct(history)),
      flags,
      hist: history.map((t) => t.yesProb),
    })
  }
  return views
}

export async function runAndStoreAgent(source: Source, marketId: string) {
  const input = await buildAgentInput(source, marketId)
  if (!input) return null
  const verdict = await runPipeline(input)
  await saveAgentRun(verdict)
  return verdict
}
