import { config } from '@/lib/config'
import type { MarketTick } from '@/lib/types'
import { buildSeedBundle } from '@/lib/seed/toDomain'
import { countMarkets, insertTicks, upsertMarkets, upsertPairs } from '@/lib/store'
import { fetchPolyMarkets, PolyWsClient } from '@/lib/connectors/polymarket'
import { fetchKalshiMarkets, KalshiPoller } from '@/lib/connectors/kalshi'
import { matchMarkets } from '@/lib/matching/matcher'
import type { MarketMeta } from '@/lib/types'
import { recomputeSignals } from './recompute'
import { bus } from './bus'

// Orchestrates data ingestion. Seed mode loads the bundled dataset; live mode
// connects to Polymarket (WS) + Kalshi (REST polling). Idempotent: safe to call
// once per process (guarded by a module flag).

let started = false
const RECOMPUTE_MS = 30_000

async function ensureSeeded(): Promise<void> {
  if ((await countMarkets()) > 0) return
  const bundle = buildSeedBundle()
  await upsertMarkets(bundle.markets)
  await insertTicks(bundle.ticks)
  await upsertPairs(bundle.pairs)
}

// Cross-platform matching: find same-event Poly<->Kalshi pairs and persist them
// so the board can merge probabilities / compute spreads. Uses the LLM judge
// when an OpenRouter key is configured, otherwise title-similarity only.
async function runMatching(poly: MarketMeta[], kalshi: MarketMeta[]): Promise<void> {
  if (poly.length === 0 || kalshi.length === 0) return
  const useLlm = config.OPENROUTER_API_KEY !== ''
  const pairs = await matchMarkets(poly, kalshi, { useLlm, acceptThreshold: 0.6 }).catch(() => [])
  if (pairs.length) await upsertPairs(pairs)
  console.log(`[ingest] matching: ${pairs.length} cross-platform pairs (${poly.length} poly × ${kalshi.length} kalshi)`)
}

async function startLive(): Promise<void> {
  const [poly, kalshi] = await Promise.all([
    fetchPolyMarkets({ limit: 40 }).catch(() => []),
    fetchKalshiMarkets({ limit: 40 }).catch(() => []),
  ])
  await upsertMarkets([...poly, ...kalshi])
  await runMatching(poly, kalshi).catch(() => {})

  // Polymarket WS: map YES token -> marketId so ticks can be attributed.
  const tokenToMarketId: Record<string, string> = {}
  for (const m of poly) if (m.polyClobTokenIds?.[0]) tokenToMarketId[m.polyClobTokenIds[0]] = m.marketId

  const onTick = (t: MarketTick) => {
    void insertTicks([t]).catch(() => {})
    bus.emit('tick', t)
  }

  if (Object.keys(tokenToMarketId).length > 0) {
    new PolyWsClient({ tokenToMarketId, onTick }).start()
  }

  new KalshiPoller({ onTick, onMarkets: (metas) => void upsertMarkets(metas).catch(() => {}) }).start()

  await recomputeSignals().catch(() => {})
  setInterval(() => recomputeSignals().catch(() => {}), RECOMPUTE_MS)
}

export async function startIngest(): Promise<void> {
  if (started) return
  started = true
  if (config.DATA_SOURCE === 'seed') {
    await ensureSeeded()
    await recomputeSignals()
    setInterval(() => recomputeSignals().catch(() => {}), RECOMPUTE_MS)
  } else {
    await startLive()
  }
}
