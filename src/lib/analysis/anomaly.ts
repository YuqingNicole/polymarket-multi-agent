import type { MarketMeta, MarketTick, Signal, MarketPair } from '@/lib/types'
import { probDelta, volumeChangePct } from './probTracker'
import type { ScreenInput } from './screener'

// Thresholds aligned with the prototype (see CLAUDE.md / design notes).
const PROB_JUMP_PTS = 5 // |Δ| >= 5 pts
const VOL_SPIKE_PCT = 50 // volChg >= 50%
const SPREAD_CENTS = 4 // |Δ|*100 >= 4¢

/**
 * Prob jump: rapid YES probability move. The prototype measures over ~2h; we
 * approximate using the 24h window (the tightest defined window) as the recent
 * trajectory. severity = min(1, |Δ|/15).
 */
export function detectProbJump(
  meta: MarketMeta,
  history: MarketTick[],
): Signal | null {
  const delta = probDelta(history, '24h')
  if (Math.abs(delta) < PROB_JUMP_PTS) return null

  const last = history[history.length - 1]
  const magnitude = Math.abs(delta)
  const direction = delta > 0 ? '抬升' : '回落'
  const detail = `2 小时内 YES 概率快速${direction} ${magnitude} 个百分点,偏离近期均值。`

  return {
    source: meta.source,
    marketId: meta.marketId,
    kind: 'prob_jump',
    severity: Math.min(1, magnitude / 15),
    detail,
    ts: last.ts,
  }
}

/**
 * Volume spike: 24h volume surged vs ~24h ago. severity = min(1, pct/200).
 */
export function detectVolSpike(
  meta: MarketMeta,
  history: MarketTick[],
): Signal | null {
  const pct = volumeChangePct(history)
  if (pct < VOL_SPIKE_PCT) return null

  const last = history[history.length - 1]
  const detail = `24 小时成交量较前值放大 ${pct}%,资金异动明显。`

  return {
    source: meta.source,
    marketId: meta.marketId,
    kind: 'vol_spike',
    severity: Math.min(1, pct / 200),
    detail,
    ts: last.ts,
  }
}

/**
 * Cross-platform spread: |poly - kalshi| in cents >= 4. severity = min(1, cents/15).
 * marketId is taken from the poly side.
 */
export function detectSpread(
  poly: { marketId: string; yesProb: number },
  kalshi: { marketId: string; yesProb: number },
): Signal | null {
  const spreadCents = Math.round(Math.abs(poly.yesProb - kalshi.yesProb) * 100)
  if (spreadCents < SPREAD_CENTS) return null

  const polyPct = Math.round(poly.yesProb * 100)
  const kalshiPct = Math.round(kalshi.yesProb * 100)
  const detail = `Polymarket ${polyPct}% 对 Kalshi ${kalshiPct}%,价差超阈值,存在跨平台套利机会。`

  return {
    source: 'poly',
    marketId: poly.marketId,
    kind: 'xplat_spread',
    severity: Math.min(1, spreadCents / 15),
    detail,
    ts: new Date().toISOString(),
  }
}

/**
 * Run all detectors. Per-market detectors run over each input's history; spread
 * detection runs over provided pairs, matching latest ticks by marketId.
 */
export function detectAll(inputs: ScreenInput[], pairs?: MarketPair[]): Signal[] {
  const signals: Signal[] = []

  for (const input of inputs) {
    const jump = detectProbJump(input.meta, input.history)
    if (jump) signals.push(jump)

    const spike = detectVolSpike(input.meta, input.history)
    if (spike) signals.push(spike)
  }

  if (pairs && pairs.length > 0) {
    const latestById = new Map<string, MarketTick>()
    for (const input of inputs) latestById.set(input.meta.marketId, input.latest)

    for (const pair of pairs) {
      const poly = latestById.get(pair.polyMarketId)
      const kalshi = latestById.get(pair.kalshiMarketId)
      if (!poly || !kalshi) continue

      const spread = detectSpread(
        { marketId: pair.polyMarketId, yesProb: poly.yesProb },
        { marketId: pair.kalshiMarketId, yesProb: kalshi.yesProb },
      )
      if (spread) signals.push(spread)
    }
  }

  return signals
}
