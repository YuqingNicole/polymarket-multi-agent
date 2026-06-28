import { z } from 'zod'
import type { AgentVerdict, DebateTurn, Direction } from '@/lib/types'
import { config } from '@/lib/config'
import type { AgentInput } from './input'
import { deterministicVerdict } from './deterministic'
import { chatJSON } from './llm'
import { ANALYST_SYSTEM, TRADER_SYSTEM, analystUser, traderUser } from './prompts'

// Orchestrates the agent pipeline. `deterministic` ports the prototype decision
// tree; `llm` runs a real analyst -> debate -> trader/risk chain via OpenRouter,
// falling back to the deterministic verdict if the model calls fail.

const analystSchema = z.object({
  analyst: z.string().min(1),
  bull: z.array(z.string().min(1)).min(1),
  bear: z.array(z.string().min(1)).min(1),
})

const traderSchema = z.object({
  signalEn: z.enum(['BUY YES', 'BUY NO', 'ARBITRAGE', 'HOLD']),
  signal: z.string().min(1),
  side: z.string().min(1),
  sizeLabel: z.string().min(1),
  sizePct: z.number().min(0).max(100),
  confidence: z.number().min(0).max(1),
  reasons: z.array(z.string().min(1)).min(1),
  risks: z.array(z.string().min(1)).min(1),
})

const COLOR_VAR: Record<string, string> = {
  'BUY YES': 'var(--up)',
  'BUY NO': 'var(--down)',
  ARBITRAGE: 'var(--accent)',
  HOLD: 'var(--amber)',
}

function toDirection(signalEn: string): Direction {
  if (signalEn === 'BUY YES') return 'YES'
  if (signalEn === 'BUY NO') return 'NO'
  return 'HOLD'
}

function interleave(bull: string[], bear: string[]): DebateTurn[] {
  const out: DebateTurn[] = []
  const n = Math.max(bull.length, bear.length)
  for (let i = 0; i < n; i++) {
    if (bull[i]) out.push({ side: 'bull', text: bull[i] })
    if (bear[i]) out.push({ side: 'bear', text: bear[i] })
  }
  return out
}

async function llmVerdict(input: AgentInput): Promise<AgentVerdict> {
  const analysis = await chatJSON(analystSchema, [
    { role: 'system', content: ANALYST_SYSTEM },
    { role: 'user', content: analystUser(input) },
  ])

  const trade = await chatJSON(traderSchema, [
    { role: 'system', content: TRADER_SYSTEM },
    { role: 'user', content: traderUser(input, analysis.analyst, analysis.bull, analysis.bear) },
  ])

  const debate = interleave(analysis.bull, analysis.bear)
  return {
    marketId: input.marketId,
    source: input.source,
    engine: 'llm',
    direction: toDirection(trade.signalEn),
    sizePct: trade.sizePct,
    confidence: trade.confidence,
    rationale: analysis.analyst,
    bullCase: analysis.bull.join(' '),
    bearCase: analysis.bear.join(' '),
    riskNotes: trade.risks.join(' '),
    debate,
    signal: trade.signal,
    signalEn: trade.signalEn,
    side: trade.side,
    sizeLabel: trade.sizeLabel,
    analyst: analysis.analyst,
    reasons: trade.reasons,
    risks: trade.risks,
    colorVar: COLOR_VAR[trade.signalEn] ?? 'var(--amber)',
  }
}

export type AgentEngine = 'deterministic' | 'llm'

// Run the pipeline. Defaults to the configured engine; `llm` degrades to the
// deterministic verdict on any model failure so the product never hard-fails.
export async function runPipeline(
  input: AgentInput,
  engine: AgentEngine = config.AGENT_ENGINE,
): Promise<AgentVerdict> {
  if (engine === 'llm') {
    try {
      return await llmVerdict(input)
    } catch {
      const fallback = deterministicVerdict(input)
      return { ...fallback, engine: 'llm' }
    }
  }
  return deterministicVerdict(input)
}
