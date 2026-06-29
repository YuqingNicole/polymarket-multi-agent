// Kalshi data access: REST fetch over the public trade-api and a polling
// client that emits ticks/markets on an interval with 429 backoff.

import { config } from '@/lib/config'
import type { MarketMeta, MarketTick } from '@/lib/types'
import { normalizeKalshiMarket, normalizeKalshiTick } from './normalize'

export interface FetchKalshiMarketsOpts {
  limit?: number
  fetchImpl?: typeof fetch
}

// The public feed is dominated by multivariate (KXMVE*) collection markets that
// have no single YES price — useless for our binary yes/no model. Keep only
// tradeable binary markets and rank by volume.
function isTradeableBinary(m: any): boolean {
  const ticker = String(m?.ticker ?? '')
  if (ticker === '' || /^KXMVE/.test(ticker)) return false
  return (
    m?.yes_bid_dollars != null ||
    m?.yes_ask_dollars != null ||
    m?.last_price_dollars != null ||
    m?.yes_bid != null ||
    m?.last_price != null
  )
}

function volScore(m: any): number {
  return Number(m?.volume_fp ?? m?.volume ?? 0) || 0
}

// Returns both normalized meta and the raw rows, since the poller needs the
// raw rows to derive ticks (prices live on the same market objects).
async function fetchKalshiRaw(
  opts: FetchKalshiMarketsOpts = {},
): Promise<{ raw: any[]; status: number; ok: boolean }> {
  const want = opts.limit ?? 100
  const f = opts.fetchImpl ?? fetch
  // Over-fetch, then filter to liquid binary markets and keep the top `want`.
  const fetchLimit = Math.min(1000, Math.max(want * 8, 200))
  const url = `${config.KALSHI_API_URL}/markets?status=open&limit=${fetchLimit}`

  const res = await f(url)
  if (!res.ok) {
    return { raw: [], status: res.status, ok: false }
  }
  const data = await res.json()
  const list: any[] = Array.isArray(data?.markets)
    ? data.markets
    : Array.isArray(data)
      ? data
      : []
  const filtered = list
    .filter(isTradeableBinary)
    .sort((a, b) => volScore(b) - volScore(a))
    .slice(0, want)
  return { raw: filtered, status: res.status, ok: true }
}

export async function fetchKalshiMarkets(
  opts: FetchKalshiMarketsOpts = {},
): Promise<MarketMeta[]> {
  const { raw, ok, status } = await fetchKalshiRaw(opts)
  if (!ok) throw new Error(`Kalshi markets fetch failed: ${status}`)
  return raw.map(normalizeKalshiMarket)
}

// Pure tick derivation from a raw Kalshi market row (re-exported from
// normalize for convenience / spec parity).
export function fetchKalshiTick(raw: any): MarketTick {
  return normalizeKalshiTick(raw)
}

// --- Poller ----------------------------------------------------------------

export interface KalshiPollerOpts {
  onTick: (tick: MarketTick) => void
  onMarkets?: (markets: MarketMeta[]) => void
  limit?: number
  pollMs?: number
  fetchImpl?: typeof fetch
}

export class KalshiPoller {
  private readonly onTick: (tick: MarketTick) => void
  private readonly onMarkets?: (markets: MarketMeta[]) => void
  private readonly limit: number
  private readonly pollMs: number
  private readonly fetchImpl?: typeof fetch

  private timer: ReturnType<typeof setTimeout> | null = null
  private running = false
  private backoffAttempts = 0

  constructor(opts: KalshiPollerOpts) {
    this.onTick = opts.onTick
    this.onMarkets = opts.onMarkets
    this.limit = opts.limit ?? 100
    this.pollMs = opts.pollMs ?? config.KALSHI_POLL_MS
    this.fetchImpl = opts.fetchImpl
  }

  start(): void {
    if (this.running) return
    this.running = true
    // Fire immediately, then schedule subsequent polls.
    void this.tick()
  }

  stop(): void {
    this.running = false
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  private async tick(): Promise<void> {
    if (!this.running) return

    let nextDelay = this.pollMs
    try {
      const { raw, ok, status } = await fetchKalshiRaw({
        limit: this.limit,
        fetchImpl: this.fetchImpl,
      })

      if (!ok) {
        if (status === 429) {
          // Exponential backoff on rate limit, capped at 60s.
          this.backoffAttempts += 1
          nextDelay = Math.min(60_000, this.pollMs * 2 ** this.backoffAttempts)
        }
      } else {
        this.backoffAttempts = 0
        const metas = raw.map(normalizeKalshiMarket)
        this.onMarkets?.(metas)
        for (const row of raw) this.onTick(normalizeKalshiTick(row))
      }
    } catch {
      // Network/parse failure: keep the loop alive on the normal cadence.
    }

    if (this.running) {
      this.timer = setTimeout(() => void this.tick(), nextDelay)
    }
  }
}
