// Converts raw Polymarket Gamma API market objects into AgentInput for scoring/analysis.
// In this scanner mode we only have Polymarket data (no Kalshi pair), so kalshi is
// estimated as yesProb (same source) — spread will be 0 unless a Kalshi pair is found.

import type { AgentInput } from '@/lib/agents/input'

/**
 * Build an AgentInput from a raw Polymarket Gamma API market object.
 * Fields follow the same normalization as arti-challenge's connectors/normalize.ts.
 */
export function buildAgentInputFromGamma(market: any): AgentInput | null {
  const conditionId = String(market?.conditionId ?? market?.condition_id ?? '')
  if (!conditionId) return null

  const outcomePrices = parseStringArray(market?.outcomePrices ?? market?.outcome_prices)
  const yesProb = clamp01(Number(outcomePrices[0] ?? 0))

  const vol24 = numberOr(market?.volume24hr ?? market?.volume24h, 0)
  const vol = numberOr(market?.volume, 0)
  const liq = numberOr(market?.liquidity, 0)

  // Derive 24h probability change from bestBid/bestAsk change fields if available,
  // otherwise use oneDayPriceChange field.
  const chg = numberOr(market?.oneDayPriceChange ?? market?.change24h, 0) * 100

  // Volume change: some Gamma endpoints expose volumeChange24hr as a ratio
  const rawVolChg = market?.volumeChange24hr ?? market?.volumeChange
  const volChg = rawVolChg != null ? numberOr(rawVolChg, 0) * 100 : 0

  const q = String(market?.question ?? market?.title ?? conditionId)

  return {
    marketId: conditionId,
    source: 'poly',
    q,
    poly: yesProb,
    kalshi: yesProb, // no Kalshi pair in scanner mode; spread will be 0
    yesAvg: yesProb,
    chg,
    spread: 0,       // overridden if a Kalshi pair is matched
    vol24,
    vol,
    liq,
    volChg,
  }
}

// --- helpers ----------------------------------------------------------------

function parseStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String)
  if (typeof value === 'string' && value.trim() !== '') {
    try {
      const p = JSON.parse(value)
      if (Array.isArray(p)) return p.map(String)
    } catch {
      /* ignore */
    }
  }
  return []
}

function numberOr(v: unknown, fallback: number): number {
  const n = typeof v === 'string' ? Number(v) : (v as number)
  return Number.isFinite(n) ? n : fallback
}

function clamp01(p: number): number {
  if (!Number.isFinite(p)) return 0
  return p < 0 ? 0 : p > 1 ? 1 : p
}
