// Arbitrage opportunity scorer.
// Takes raw AgentInput data and produces a numeric score (0..100) plus
// a list of human-readable signal reasons.

import type { AgentInput } from '@/lib/agents/input'
import type { ArbitrageOpportunity, ArbitrageType, ScannerConfig } from './types'

interface ScoreBreakdown {
  spreadScore: number
  driftScore: number
  volumeScore: number
  liquidityScore: number
  totalScore: number
  reasons: string[]
  types: ArbitrageType[]
}

/**
 * Score a single market for arbitrage attractiveness.
 * Returns null if below minVol24h threshold (not worth analyzing).
 */
export function scoreMarket(
  input: AgentInput,
  cfg: ScannerConfig,
): ArbitrageOpportunity | null {
  // Skip illiquid / inactive markets
  if (input.vol24 < cfg.minVol24h) return null

  const breakdown = computeBreakdown(input, cfg)

  if (breakdown.totalScore < cfg.minScore) return null

  return {
    marketId: input.marketId,
    question: input.q,
    source: input.source,
    type: breakdown.types[0] ?? 'probability_drift',
    score: breakdown.totalScore,
    polyProb: input.poly,
    kalshiProb: input.kalshi,
    spreadCents: input.spread,
    vol24h: input.vol24,
    liq: input.liq,
    probChg24h: input.chg,
    volChg24h: input.volChg,
    detectedAt: new Date().toISOString(),
    reasons: breakdown.reasons,
  }
}

function computeBreakdown(input: AgentInput, cfg: ScannerConfig): ScoreBreakdown {
  const reasons: string[] = []
  const types: ArbitrageType[] = []

  // --- Spread score (cross-platform arbitrage) ---
  // 3c spread → 20pts, 10c → 60pts, 20c+ → 100pts
  let spreadScore = 0
  if (input.spread >= cfg.minSpreadCents) {
    spreadScore = Math.min(100, (input.spread / 20) * 100)
    types.push('cross_platform')
    reasons.push(
      `Cross-platform spread: ${input.spread}c (Poly ${pct(input.poly)} vs Kalshi ${pct(input.kalshi)})`,
    )
  }

  // --- Probability drift score ---
  // 4pt drift → 20pts, 15pt → 75pts, 25pt+ → 100pts
  let driftScore = 0
  const absDrift = Math.abs(input.chg)
  if (absDrift >= cfg.minProbDrift) {
    driftScore = Math.min(100, (absDrift / 25) * 100)
    const dir = input.chg > 0 ? '↑' : '↓'
    types.push('probability_drift')
    reasons.push(
      `Probability drift: ${dir}${absDrift.toFixed(1)}pts in 24h (now ${pct(input.yesAvg)})`,
    )
  }

  // --- Volume spike score ---
  // 50% surge → 25pts, 200% → 75pts, 400%+ → 100pts
  let volumeScore = 0
  if (input.volChg >= cfg.minVolSpike) {
    volumeScore = Math.min(100, (input.volChg / 400) * 100)
    types.push('volume_spike')
    reasons.push(
      `Volume spike: +${input.volChg.toFixed(0)}% in 24h ($${fmtUsd(input.vol24)})`,
    )
  }

  // --- Liquidity mispricing score ---
  // Low liquidity + large spread = harder to capture but bigger nominal edge
  let liquidityScore = 0
  if (input.spread >= cfg.minSpreadCents && input.liq < 10_000) {
    // Inverse of liquidity normalized: illiquid + large spread = opportunity
    liquidityScore = Math.min(100, (cfg.minSpreadCents / Math.max(1, input.liq / input.spread)) * 10)
    if (liquidityScore > 20) {
      types.push('liquidity_mispricing')
      reasons.push(
        `Thin book ($${fmtUsd(input.liq)} liquidity) with ${input.spread}c spread — mispricing risk`,
      )
    }
  }

  // Weighted composite:
  // spread 40% + drift 30% + volume 20% + liquidity 10%
  const totalScore = Math.round(
    spreadScore * 0.4 +
    driftScore * 0.3 +
    volumeScore * 0.2 +
    liquidityScore * 0.1,
  )

  return { spreadScore, driftScore, volumeScore, liquidityScore, totalScore, reasons, types }
}

function pct(p: number): string {
  return (p * 100).toFixed(1) + '%'
}

function fmtUsd(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(0) + 'K'
  return n.toFixed(0)
}
