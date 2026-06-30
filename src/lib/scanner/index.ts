// Core arbitrage scanner.
// Fetches live Polymarket Gamma API data directly (raw), scores every market,
// and returns top opportunities sorted by score. Optionally triggers the
// multi-agent LLM analysis pipeline on the highest-scoring events.

import { config } from '@/lib/config'
import { runPipeline } from '@/lib/agents/pipeline'
import { buildAgentInputFromGamma } from './builder'
import { scoreMarket } from './scorer'
import {
  DEFAULT_SCANNER_CONFIG,
  type ScannerConfig,
  type ScanResult,
  type ArbitrageOpportunity,
} from './types'

export class ArbitrageScanner {
  private readonly cfg: ScannerConfig

  constructor(cfg: Partial<ScannerConfig> = {}) {
    this.cfg = { ...DEFAULT_SCANNER_CONFIG, ...cfg }
  }

  /**
   * Run one full scan cycle:
   * 1. Fetch raw markets from Polymarket Gamma API
   * 2. Score each market for arbitrage signals
   * 3. (Optional) Run LLM multi-agent analysis on top N
   * Returns a ScanResult with ranked opportunities.
   */
  async scan(fetchImpl?: typeof fetch): Promise<ScanResult> {
    const scannedAt = new Date().toISOString()
    console.log(`[scanner] Starting scan at ${scannedAt}`)

    const f = fetchImpl ?? fetch

    // 1. Fetch raw gamma markets (200 most-active by 24h volume)
    const rawMarkets = await this.fetchRawMarkets(f, 200)
    console.log(`[scanner] Fetched ${rawMarkets.length} markets from Polymarket`)

    // 2. Build AgentInput and score each market
    const opportunities: ArbitrageOpportunity[] = []
    for (const raw of rawMarkets) {
      const input = buildAgentInputFromGamma(raw)
      if (!input) continue
      const opp = scoreMarket(input, this.cfg)
      if (opp) opportunities.push(opp)
    }

    // 3. Sort by score descending, cap results
    opportunities.sort((a, b) => b.score - a.score)
    const top = opportunities.slice(0, this.cfg.maxResults)

    console.log(
      `[scanner] Found ${opportunities.length} opportunities above threshold (showing top ${top.length})`,
    )

    // 4. Optionally run LLM analysis on top N
    if (this.cfg.runLlmAnalysis && top.length > 0) {
      const toAnalyze = top.slice(0, this.cfg.llmAnalysisTopN)
      console.log(`[scanner] Running LLM analysis on top ${toAnalyze.length} opportunities`)
      await this.runLlmAnalysis(toAnalyze)
    }

    return {
      scannedAt,
      totalMarkets: rawMarkets.length,
      opportunities: top,
      topOpportunity: top[0] ?? null,
    }
  }

  /**
   * Fetch raw market objects from the Gamma API.
   */
  private async fetchRawMarkets(f: typeof fetch, limit: number): Promise<any[]> {
    const url = `${config.POLYMARKET_GAMMA_URL}/markets?closed=false&active=true&order=volume24hr&ascending=false&limit=${limit}`
    const res = await f(url)
    if (!res.ok) {
      throw new Error(`Polymarket Gamma API fetch failed: ${res.status} ${res.statusText}`)
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
            const result = await runPipeline(agentInput)
            ;(opp as any).llmAnalysis = result
            console.log(
              `[scanner] LLM done for "${opp.question.slice(0, 60)}": decision=${(result as any)?.decision ?? 'N/A'}`,
            )
          } catch (err) {
            console.warn(`[scanner] LLM analysis failed for ${opp.marketId}:`, err)
          }
        }),
      )
    }
  }
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
