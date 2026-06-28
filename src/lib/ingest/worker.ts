import { config } from '@/lib/config'
import type { MarketTick } from '@/lib/types'
import { buildSeedBundle } from '@/lib/seed/toDomain'
import { countMarkets, insertTicks, upsertMarkets, upsertPairs } from '@/lib/store'
import { fetchPolyMarkets, PolyWsClient } from '@/lib/connectors/polymarket'
import { fetchKalshiMarkets, KalshiPoller } from '@/lib/connectors/kalshi'
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

async function startLive(): Promise<void> {
  const [poly, kalshi] = await Promise.all([
    fetchPolyMarkets({ limit: 40 }).catch(() => []),
    fetchKalshiMarkets({ limit: 40 }).catch(() => []),
  ])
  await upsertMarkets([...poly, ...kalshi])

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
