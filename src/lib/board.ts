import type { Signal, Source } from '@/lib/types'
import { getMarket, getPairs, getSignals, saveAgentRun } from '@/lib/store'
import { buildAgentInput } from '@/lib/agents/buildInput'
import { runPipeline } from '@/lib/agents/pipeline'

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

export async function runAndStoreAgent(source: Source, marketId: string) {
  const input = await buildAgentInput(source, marketId)
  if (!input) return null
  const verdict = await runPipeline(input)
  await saveAgentRun(verdict)
  return verdict
}
