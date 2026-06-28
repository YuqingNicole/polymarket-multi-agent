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
  // normalized fields (persisted to agent_runs)
  direction: Direction
  sizePct: number // 0..100
  confidence: number // 0..1
  rationale: string
  bullCase: string
  bearCase: string
  riskNotes: string
  debate: DebateTurn[]
  // presentation fields (terminal UI renders these verbatim, prototype-shaped)
  signal: string // 中文标签: '买入 YES' / '套利' / '观望' ...
  signalEn: string // 'BUY YES' / 'ARBITRAGE' / 'HOLD' ...
  side: string // 建议方向文本
  sizeLabel: string // 建议仓位文本
  analyst: string // 分析师综述
  reasons: string[] // 核心理由
  risks: string[] // 风控提示
  colorVar: string // CSS 变量 token, e.g. 'var(--up)'
}
