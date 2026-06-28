// Shared domain types. The normalization layer maps both platforms onto these.

export type Source = 'poly' | 'kalshi'

export interface MarketMeta {
  source: Source
  marketId: string // poly: conditionId ; kalshi: ticker
  title: string
  category: string | null
  endDate: string | null // ISO
  outcomes: string[] // usually ['Yes','No']
  polyClobTokenIds?: [string, string] // [YES, NO]
  kalshiEventTicker?: string
}

export interface MarketTick {
  source: Source
  marketId: string
  yesProb: number // 0..1
  volume24h: number
  volumeTotal: number
  ts: string // ISO
}

export type SignalKind = 'prob_jump' | 'vol_spike' | 'xplat_spread'

export interface Signal {
  source: Source
  marketId: string
  kind: SignalKind
  severity: number // 0..1
  detail: string
  ts: string // ISO
}

export interface MarketPair {
  polyMarketId: string
  kalshiMarketId: string
  confidence: number // 0..1
  source: 'curated' | 'llm'
  mergedYesProb: number | null
}

export type Direction = 'YES' | 'NO' | 'HOLD'

export interface DebateTurn {
  side: 'bull' | 'bear'
  text: string
}

export interface AgentVerdict {
  marketId: string
  source: Source
  engine: 'deterministic' | 'llm'
  direction: Direction
  sizePct: number // 0..100
  confidence: number // 0..1
  rationale: string
  bullCase: string
  bearCase: string
  riskNotes: string
  debate: DebateTurn[]
}
