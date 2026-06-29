// Pure normalization functions: map raw Polymarket/Kalshi API JSON onto the
// shared domain types in src/lib/types.ts. No I/O here.

import type { MarketMeta, MarketTick } from '@/lib/types'

// --- helpers ---------------------------------------------------------------

// Polymarket frequently returns arrays as stringified JSON (e.g. "[\"Yes\",\"No\"]").
// Accept both already-parsed arrays and the stringified form.
function parseMaybeJsonArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v))
  if (typeof value === 'string' && value.trim() !== '') {
    try {
      const parsed = JSON.parse(value)
      if (Array.isArray(parsed)) return parsed.map((v) => String(v))
    } catch {
      // not JSON; ignore
    }
  }
  return []
}

function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value)
    if (Number.isFinite(n)) return n
  }
  return fallback
}

function clampProb(p: number): number {
  if (!Number.isFinite(p)) return 0
  if (p < 0) return 0
  if (p > 1) return 1
  return p
}

// Kalshi prices may be quoted in cents (0..100) or dollars (0..1). Anything
// above 1.5 is treated as cents and divided by 100.
function kalshiPriceToProb(value: unknown): number | null {
  const n = toNumber(value, NaN)
  if (!Number.isFinite(n) || n <= 0) return null
  return n > 1.5 ? n / 100 : n
}

// --- Polymarket ------------------------------------------------------------

export function normalizePolyMarket(raw: any): MarketMeta {
  const outcomes = parseMaybeJsonArray(raw?.outcomes)
  const clobTokenIds = parseMaybeJsonArray(raw?.clobTokenIds)

  const meta: MarketMeta = {
    source: 'poly',
    marketId: String(raw?.conditionId ?? ''),
    title: String(raw?.question ?? ''),
    category: raw?.category != null ? String(raw.category) : null,
    endDate: raw?.endDate != null ? String(raw.endDate) : null,
    outcomes: outcomes.length > 0 ? outcomes : ['Yes', 'No'],
  }

  if (clobTokenIds.length >= 2) {
    meta.polyClobTokenIds = [clobTokenIds[0], clobTokenIds[1]]
  }

  return meta
}

export function normalizePolyTick(raw: any): MarketTick {
  const outcomePrices = parseMaybeJsonArray(raw?.outcomePrices)
  const yesProb = clampProb(toNumber(outcomePrices[0], 0))

  return {
    source: 'poly',
    marketId: String(raw?.conditionId ?? ''),
    yesProb,
    volume24h: toNumber(raw?.volume24hr),
    volumeTotal: toNumber(raw?.volume),
    ts: new Date().toISOString(),
  }
}

// --- Kalshi ----------------------------------------------------------------

export function normalizeKalshiMarket(raw: any): MarketMeta {
  const meta: MarketMeta = {
    source: 'kalshi',
    marketId: String(raw?.ticker ?? ''),
    title: String(raw?.title ?? raw?.yes_sub_title ?? ''),
    category: raw?.category != null ? String(raw.category) : null,
    endDate: raw?.close_time != null ? String(raw.close_time) : null,
    outcomes: ['Yes', 'No'],
  }

  if (raw?.event_ticker != null) {
    meta.kalshiEventTicker = String(raw.event_ticker)
  }

  return meta
}

export function normalizeKalshiTick(raw: any): MarketTick {
  // Prefer the dollar-denominated fields when present, else cents.
  const bid =
    raw?.yes_bid_dollars != null
      ? kalshiPriceToProb(raw.yes_bid_dollars)
      : kalshiPriceToProb(raw?.yes_bid)
  const ask =
    raw?.yes_ask_dollars != null
      ? kalshiPriceToProb(raw.yes_ask_dollars)
      : kalshiPriceToProb(raw?.yes_ask)

  let yesProb: number
  if (bid != null && ask != null) {
    yesProb = (bid + ask) / 2
  } else if (bid != null) {
    yesProb = bid
  } else if (ask != null) {
    yesProb = ask
  } else {
    // fallback to last traded price
    const last =
      raw?.last_price_dollars != null
        ? kalshiPriceToProb(raw.last_price_dollars)
        : kalshiPriceToProb(raw?.last_price)
    yesProb = last ?? 0
  }

  return {
    source: 'kalshi',
    marketId: String(raw?.ticker ?? ''),
    yesProb: clampProb(yesProb),
    // Current API uses *_fp (float) names; fall back to legacy cent fields.
    volume24h: toNumber(raw?.volume_24h_fp ?? raw?.volume_24h),
    volumeTotal: toNumber(raw?.volume_fp ?? raw?.volume),
    ts: new Date().toISOString(),
  }
}
