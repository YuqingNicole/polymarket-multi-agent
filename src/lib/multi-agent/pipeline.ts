// Multi-agent pipeline: three specialist agents run in parallel, then a
// judge agent synthesises their reports into a final verdict.
//
// Flow:
//   AgentInput
//       ├──► MacroAgent    (macroeconomic / fundamental view)
//       ├──► TechAgent     (price/volume technical view)
//       └──► ArbAgent      (cross-platform spread / execution view)
//                │
//                ▼
//          JudgeAgent  →  MultiAgentVerdict

import { chatJSON } from '@/lib/agents/llm'
import { config } from '@/lib/config'
import type { AgentInput } from '@/lib/agents/input'
import {
  MACRO_SYSTEM, macroUser, macroSchema,
  TECH_SYSTEM, techUser, techSchema,
  ARB_SYSTEM, arbUser, arbSchema,
  JUDGE_SYSTEM, judgeUser, judgeSchema,
} from './prompts'

export type TradeSignal = 'BUY YES' | 'BUY NO' | 'ARBITRAGE' | 'HOLD'

export interface MacroReport {
  baseRate: number
  fairValue: number
  pricingBias: 'OVERPRICED' | 'UNDERPRICED' | 'FAIR'
  bullFactors: string[]
  bearFactors: string[]
  confidence: number
  summary: string
}

export interface TechReport {
  trend: 'UPTREND' | 'DOWNTREND' | 'SIDEWAYS' | 'REVERSAL'
  momentumSignal: 'STRONG_BULL' | 'WEAK_BULL' | 'NEUTRAL' | 'WEAK_BEAR' | 'STRONG_BEAR'
  volumeSignal: 'VOLUME_SURGE' | 'VOLUME_DRY' | 'NORMAL'
  trendAcceleration: 'ACCELERATING' | 'DECELERATING' | 'STEADY'
  targetProb: number
  confidence: number
  summary: string
}

export interface ArbReport {
  arbFeasibility: 'HIGH' | 'MEDIUM' | 'LOW' | 'NOT_VIABLE'
  grossSpreadCents: number
  estimatedCostCents: number
  expectedEdgeCents: number
  liquidityRisk: 'LOW' | 'MEDIUM' | 'HIGH'
  executionRisk: 'LOW' | 'MEDIUM' | 'HIGH'
  confidence: number
  summary: string
}

export interface JudgeVerdict {
  signal: TradeSignal
  conviction: 'HIGH' | 'MEDIUM' | 'LOW'
  consensusLevel: 'UNANIMOUS' | 'MAJORITY' | 'SPLIT'
  dominantAgent: 'macro' | 'tech' | 'arb' | 'balanced'
  ruleApplied: number
  reasoning: string
  sizePct: number
}

export interface MultiAgentVerdict {
  marketId: string
  question: string
  macro: MacroReport
  tech: TechReport
  arb: ArbReport
  judge: JudgeVerdict
  // Deterministic fallback if LLM calls fail
  fallbackSignal?: TradeSignal
  durationMs: number
}

// ── Deterministic fallback ───────────────────────────────────────────────────

function deterministicSignal(input: AgentInput): TradeSignal {
  if (input.spread >= 5) return 'ARBITRAGE'
  if (Math.abs(input.chg) >= 10) return input.chg > 0 ? 'BUY YES' : 'BUY NO'
  return 'HOLD'
}

// ── Main pipeline ─────────────────────────────────────────────────────────────

/**
 * Run the full multi-agent analysis pipeline on a single market.
 * Three specialist agents run in parallel (MacroAgent, TechAgent, ArbAgent),
 * then a JudgeAgent synthesises their reports into a final verdict.
 *
 * Falls back to deterministic signal if LLM calls fail.
 */
export async function runMultiAgentPipeline(
  input: AgentInput,
): Promise<MultiAgentVerdict> {
  const t0 = Date.now()
  const model = config.OPENROUTER_MODEL

  console.log(
    `[multi-agent] Starting parallel analysis for "${input.q.slice(0, 60)}..."`,
  )

  // ── Phase 1: three specialist agents in parallel ──────────────────────────
  const [macroResult, techResult, arbResult] = await Promise.allSettled([
    chatJSON<MacroReport>(MACRO_SYSTEM, macroUser(input), macroSchema, model),
    chatJSON<TechReport>(TECH_SYSTEM, techUser(input), techSchema, model),
    chatJSON<ArbReport>(ARB_SYSTEM, arbUser(input), arbSchema, model),
  ])

  const macro = macroResult.status === 'fulfilled'
    ? macroResult.value
    : defaultMacro(input)
  const tech = techResult.status === 'fulfilled'
    ? techResult.value
    : defaultTech(input)
  const arb = arbResult.status === 'fulfilled'
    ? arbResult.value
    : defaultArb(input)

  if (macroResult.status === 'rejected') {
    console.warn('[multi-agent] MacroAgent failed:', macroResult.reason)
  }
  if (techResult.status === 'rejected') {
    console.warn('[multi-agent] TechAgent failed:', techResult.reason)
  }
  if (arbResult.status === 'rejected') {
    console.warn('[multi-agent] ArbAgent failed:', arbResult.reason)
  }

  console.log(
    `[multi-agent] Phase 1 done — macro:${macro.pricingBias} tech:${tech.trend} arb:${arb.arbFeasibility}`,
  )

  // ── Phase 2: JudgeAgent synthesises all three reports ────────────────────
  let judge: JudgeVerdict
  try {
    judge = await chatJSON<JudgeVerdict>(
      JUDGE_SYSTEM,
      judgeUser(input, macro, tech, arb),
      judgeSchema,
      model,
    )
    console.log(
      `[multi-agent] JudgeAgent verdict: ${judge.signal} (${judge.conviction}, ${judge.consensusLevel})`,
    )
  } catch (err) {
    console.warn('[multi-agent] JudgeAgent failed, using deterministic fallback:', err)
    const fallback = deterministicSignal(input)
    judge = {
      signal: fallback,
      conviction: 'LOW',
      consensusLevel: 'SPLIT',
      dominantAgent: 'balanced',
      reasoning: '裁判 Agent 调用失败，使用确定性规则兜底',
      sizePct: 0.05,
    }
  }

  return {
    marketId: input.marketId,
    question: input.q,
    macro,
    tech,
    arb,
    judge,
    durationMs: Date.now() - t0,
  }
}

// ── Deterministic fallback reports ───────────────────────────────────────────

function defaultMacro(input: AgentInput): MacroReport {
  return {
    baseRate: 0.5,
    fairValue: input.yesAvg,
    pricingBias: 'FAIR',
    bullFactors: ['LLM 调用失败，无法分析'],
    bearFactors: ['LLM 调用失败，无法分析'],
    confidence: 0,
    summary: 'MacroAgent 调用失败，使用默认值',
  }
}

function defaultTech(input: AgentInput): TechReport {
  return {
    trend: input.chg > 3 ? 'UPTREND' : input.chg < -3 ? 'DOWNTREND' : 'SIDEWAYS',
    momentumSignal: input.chg > 5 ? 'WEAK_BULL' : input.chg < -5 ? 'WEAK_BEAR' : 'NEUTRAL',
    volumeSignal: input.volChg > 50 ? 'VOLUME_SURGE' : 'NORMAL',
    trendAcceleration: 'STEADY',
    targetProb: input.yesAvg,
    confidence: 0,
    summary: 'TechAgent 调用失败，使用规则推断',
  }
}

function defaultArb(input: AgentInput): ArbReport {
  return {
    arbFeasibility: input.spread >= 5 ? 'MEDIUM' : 'NOT_VIABLE',
    grossSpreadCents: input.spread,
    estimatedCostCents: 2,
    expectedEdgeCents: Math.max(-99, input.spread - 2),
    liquidityRisk: input.liq < 10_000 ? 'HIGH' : input.liq < 100_000 ? 'MEDIUM' : 'LOW',
    executionRisk: 'MEDIUM',
    confidence: 0,
    summary: 'ArbAgent 调用失败，使用规则推断',
  }
}
