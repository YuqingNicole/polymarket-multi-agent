// Core arbitrage scanner.
// Fetches live Polymarket + Kalshi data in parallel, matches paired markets,
// scores every market for arbitrage signals, and returns top opportunities
// sorted by score. Optionally triggers the multi-agent LLM analysis pipeline
// on the highest-scoring events.

import { config } from '@/lib/config'
import { fetchKalshiTicks } from '@/lib/connectors/kalshi'
import { runPipeline } from '@/lib/agents/pipeline'
import { matchMarkets } from '@/lib/matching'
import { buildAgentInputFromGamma } from './builder'
import { scoreMarket } from './scorer'
import {
  DEFAULT_SCANNER_CONFIG,
  type ScannerConfig,
  type ScanResult,
  type ArbitrageOpportunity,
} from './types'
import type { MarketTick } from '@/lib/types'

export class ArbitrageScanner {
  private readonly cfg: ScannerConfig

  constructor(cfg: Partial<ScannerConfig> = {}) {
    this.cfg = { ...DEFAULT_SCANNER_CONFIG, ...cfg }
  }

  /**
   * Run one full scan cycle:
   * 1. Fetch raw Polymarket markets + Kalshi ticks in parallel
   * 2. Match paired markets to compute real cross-platform spreads
   * 3. Score each market for arbitrage signals
   * 4. (Optional) Run LLM multi-agent analysis on top N
   * Returns a ScanResult with ranked opportunities.
   */
  async scan(fetchImpl?: typeof fetch): Promise<ScanResult> {
    const scannedAt = new Date().toISOString()
    console.log(`[scanner] Starting scan at ${scannedAt}`)

    const f = fetchImpl ?? fetch

    // 1. Fetch Polymarket raw markets + Kalshi ticks in parallel
    const [rawMarkets, kalshiTicks] = await Promise.allSettled([
      this.fetchRawPolyMarkets(f, 200),
      fetchKalshiTicks({ fetchImpl: f }).catch((e) => {
        console.warn('[scanner] Kalshi fetch failed, skipping:', e.message)
        return [] as MarketTick[]
      }),
    ])

    const polyRaw: any[] =
      rawMarkets.status === 'fulfilled' ? rawMarkets.value : []
    const kalshi: MarketTick[] =
      kalshiTicks.status === 'fulfilled' ? kalshiTicks.value : []

    console.log(
      `[scanner] Fetched ${polyRaw.length} Polymarket markets, ${kalshi.length} Kalshi markets`,
    )

    // Build a map from Kalshi marketId → yesProb for O(1) lookup
    const kalshiProbMap = new Map<string, number>()
    for (const tick of kalshi) {
      kalshiProbMap.set(tick.marketId, tick.yesProb)
    }

    // 2. Build AgentInput from raw Poly data; fill Kalshi prob if matched
    const opportunities: ArbitrageOpportunity[] = []

    for (const raw of polyRaw) {
      const input = buildAgentInputFromGamma(raw)
      if (!input) continue

      // Try to find a matching Kalshi market by question similarity (slug match)
      const kalshiProb = findKalshiMatch(raw, kalshiProbMap)
      if (kalshiProb !== null) {
        input.kalshi = kalshiProb
        input.yesAvg = (input.poly + kalshiProb) / 2
        input.spread = Math.round(Math.abs(input.poly - kalshiProb) * 100)
      }

      const opp = scoreMarket(input, this.cfg)
      if (opp) opportunities.push(opp)
    }

    // 3. Sort by score descending, cap results
    opportunities.sort((a, b) => b.score - a.score)
    const top = opportunities.slice(0, this.cfg.maxResults)

    // Log how many had real Kalshi pairs
    const withPair = top.filter((o) => o.spreadCents > 0).length
    console.log(
      `[scanner] Found ${opportunities.length} opportunities (top ${top.length}, ${withPair} with Kalshi pair)`,
    )

    // 4. Optionally run LLM analysis on top N
    if (this.cfg.runLlmAnalysis && top.length > 0) {
      const toAnalyze = top.slice(0, this.cfg.llmAnalysisTopN)
      console.log(`[scanner] Running LLM analysis on top ${toAnalyze.length} opportunities`)
      await this.runLlmAnalysis(toAnalyze)
    }

    return {
      scannedAt,
      totalMarkets: polyRaw.length,
      opportunities: top,
      topOpportunity: top[0] ?? null,
    }
  }

  /**
   * Fetch raw market objects from the Gamma API.
   */
  private async fetchRawPolyMarkets(f: typeof fetch, limit: number): Promise<any[]> {
    const url =
      `${config.POLYMARKET_GAMMA_URL}/markets?closed=false&active=true` +
      `&order=volume24hr&ascending=false&limit=${limit}`
    const res = await f(url)
    if (!res.ok) {
      throw new Error(
        `Polymarket Gamma API fetch failed: ${res.status} ${res.statusText}`,
      )
    }
    const data = await res.json()
    return Array.isArray(data) ? data : (data?.data ?? [])
  }

  /**
   * Run the full multi-agent pipeline (Analyst → Debate → Trader/Risk) on
   * a set of opportunities. Results are attached to each opportunity as `llmAnalysis`.
   */
  private async runLlmAnalysis(opportunities: ArbitrageOpportunity[]): Promise<void> {
    const CONCURRENCY = 2
    for (let i = 0; i < opportunities.length; i += CONCURRENCY) {
      const batch = opportunities.slice(i, i + CONCURRENCY)
      await Promise.all(
        batch.map(async (opp) => {
          try {
            const agentInput = {
              marketId: opp.marketId,
              source: opp.source as 'poly',
              q: opp.question,
              poly: opp.polyProb,
              kalshi: opp.kalshiProb,
              yesAvg: (opp.polyProb + opp.kalshiProb) / 2,
              chg: opp.probChg24h,
              spread: opp.spreadCents,
              vol24: opp.vol24h,
              vol: opp.vol24h,
              liq: opp.liq,
              volChg: opp.volChg24h,
            }
            const result = await runMultiAgentPipeline(agentInput)
            ;(opp as any).llmAnalysis = result
            const sig = result.judge?.signal ?? 'N/A'
            const conviction = result.judge?.conviction ?? ''
            console.log(
              `[scanner] Multi-agent done for "${opp.question.slice(0, 50)}...": ${sig} (${conviction})`,
            )
          } catch (err) {
            console.warn(`[scanner] LLM analysis failed for ${opp.marketId}:`, err)
          }
        }),
      )
    }
  }
}

// ── Kalshi matching helper ──────────────────────────────────────────────────

/**
 * Simple slug-based matching: normalise both questions and check if Kalshi
 * has a market whose id contains key words from the Poly question.
 *
 * This is intentionally loose — a real implementation would use the
 * existing matchMarkets() from @/lib/matching with full NLP normalisation.
 * For now we do a fast keyword overlap check.
 */
function findKalshiMatch(
  rawPoly: any,
  kalshiProbMap: Map<string, number>,
): number | null {
  // Some Gamma objects have a kalshiId or crossId hint
  const hint: string | undefined =
    rawPoly?.kalshiId ??
    rawPoly?.externalId ??
    rawPoly?.crossPlatformId

  if (hint && kalshiProbMap.has(hint)) {
    return kalshiProbMap.get(hint)!
  }

  // Keyword overlap: normalise question to word tokens, scan Kalshi ids
  const question: string = rawPoly?.question ?? rawPoly?.title ?? ''
  if (!question) return null

  const words = normalise(question)
  for (const [id] of kalshiProbMap) {
    const idWords = normalise(id.replace(/-/g, ' '))
    if (overlapScore(words, idWords) >= 0.5) {
      return kalshiProbMap.get(id)!
    }
  }

  return null
}

function normalise(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, '')
      .split(/\s+/)
      .filter((w) => w.length > 3),
  )
}

function overlapScore(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let shared = 0
  for (const w of a) if (b.has(w)) shared++
  return shared / Math.min(a.size, b.size)
}

/**
 * Convenience: run a single scan with optional config overrides.
 */
export async function runScan(
  cfg?: Partial<ScannerConfig>,
  fetchImpl?: typeof fetch,
): Promise<ScanResult> {
  return new ArbitrageScanner(cfg).scan(fetchImpl)
}
