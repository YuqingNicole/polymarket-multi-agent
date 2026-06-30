// Scanner-specific types for the arbitrage opportunity detection system.

export type ArbitrageType =
  | 'cross_platform'  // Kalshi vs Polymarket spread
  | 'probability_drift' // Rapid probability change signal
  | 'volume_spike'    // Unusual volume surge
  | 'liquidity_mispricing' // Low liquidity + large spread

export interface ArbitrageOpportunity {
  marketId: string
  question: string
  source: string
  type: ArbitrageType
  score: number          // 0..100, higher = more attractive
  polyProb: number       // Polymarket YES prob, 0..1
  kalshiProb: number     // Kalshi YES prob, 0..1
  spreadCents: number    // |poly - kalshi| * 100
  vol24h: number         // 24h merged volume USD
  liq: number            // book liquidity USD
  probChg24h: number     // 24h probability change, pts
  volChg24h: number      // 24h volume change, %
  detectedAt: string     // ISO timestamp
  reasons: string[]      // human-readable signal reasons
}

export interface ScanResult {
  scannedAt: string
  totalMarkets: number
  opportunities: ArbitrageOpportunity[]
  topOpportunity: ArbitrageOpportunity | null
}

export interface ScannerConfig {
  // Minimum spread (cents) to flag as cross-platform arbitrage
  minSpreadCents: number
  // Minimum 24h volume (USD) for a market to be considered
  minVol24h: number
  // Minimum probability drift (pts) in 24h to flag
  minProbDrift: number
  // Minimum volume change (%) to flag volume spike
  minVolSpike: number
  // Minimum score threshold to include in results
  minScore: number
  // Max opportunities to return per scan
  maxResults: number
  // Whether to run LLM analysis on top opportunities
  runLlmAnalysis: boolean
  // How many top opportunities to run LLM on (costs tokens)
  llmAnalysisTopN: number
}

export const DEFAULT_SCANNER_CONFIG: ScannerConfig = {
  minSpreadCents: 3,
  minVol24h: 5_000,
  minProbDrift: 4,
  minVolSpike: 50,
  minScore: 30,
  maxResults: 20,
  runLlmAnalysis: true,
  llmAnalysisTopN: 3,
}
