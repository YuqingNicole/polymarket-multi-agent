import { z } from 'zod'
import type { MarketMeta, MarketPair } from '@/lib/types'
import { chatJSON } from '@/lib/agents/llm'

// Hybrid cross-platform matcher: cheap title-similarity prescreen generates
// candidate pairs, then an LLM judges whether each candidate refers to the same
// real-world event. Curated pairs (see curated.ts) take precedence.

function tokens(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 1),
  )
}

// Jaccard overlap of title tokens, 0..1.
export function titleSimilarity(a: string, b: string): number {
  const ta = tokens(a)
  const tb = tokens(b)
  if (ta.size === 0 || tb.size === 0) return 0
  let inter = 0
  for (const t of ta) if (tb.has(t)) inter++
  return inter / (ta.size + tb.size - inter)
}

export interface Candidate {
  poly: MarketMeta
  kalshi: MarketMeta
  similarity: number
}

export function candidatePairs(
  polyMarkets: MarketMeta[],
  kalshiMarkets: MarketMeta[],
  minSimilarity = 0.18,
): Candidate[] {
  const out: Candidate[] = []
  for (const poly of polyMarkets) {
    for (const kalshi of kalshiMarkets) {
      const similarity = titleSimilarity(poly.title, kalshi.title)
      if (similarity >= minSimilarity) out.push({ poly, kalshi, similarity })
    }
  }
  return out.sort((a, b) => b.similarity - a.similarity)
}

const judgeSchema = z.object({
  same: z.boolean(),
  confidence: z.number().min(0).max(1),
})

// LLM judgement on whether two market titles describe the same event.
export async function judgePair(poly: MarketMeta, kalshi: MarketMeta): Promise<{ same: boolean; confidence: number }> {
  return chatJSON(
    judgeSchema,
    [
      {
        role: 'system',
        content:
          '你判断两个预测市场标题是否指向同一个现实世界事件（同一结果口径）。只输出 JSON。',
      },
      {
        role: 'user',
        content:
          `Polymarket: ${poly.title}\nKalshi: ${kalshi.title}\n\n` +
          '输出 JSON：{"same": true/false, "confidence": 0到1之间的小数}。',
      },
    ],
    { maxTokens: 500 },
  )
}

// Match markets across platforms. Each kalshi market is matched to at most one
// poly market. Candidates above `acceptThreshold` confidence become pairs.
export async function matchMarkets(
  polyMarkets: MarketMeta[],
  kalshiMarkets: MarketMeta[],
  opts: { acceptThreshold?: number; useLlm?: boolean; minSimilarity?: number; maxJudgements?: number } = {},
): Promise<MarketPair[]> {
  const acceptThreshold = opts.acceptThreshold ?? 0.6
  const useLlm = opts.useLlm ?? true
  // Lenient prescreen so semantically-equal but differently-worded titles
  // (e.g. "Bitcoin $150,000" vs "BTC $150k") still reach the LLM judge, which
  // makes the real decision. Cap judgements to bound LLM cost.
  const candidates = candidatePairs(polyMarkets, kalshiMarkets, opts.minSimilarity ?? 0.04)
  const maxJudgements = opts.maxJudgements ?? 60
  const pairs: MarketPair[] = []
  const usedPoly = new Set<string>()
  const usedKalshi = new Set<string>()
  let judged = 0

  for (const c of candidates) {
    if (usedPoly.has(c.poly.marketId) || usedKalshi.has(c.kalshi.marketId)) continue
    if (useLlm && judged >= maxJudgements) break
    let confidence = c.similarity
    if (useLlm) {
      judged++
      try {
        const verdict = await judgePair(c.poly, c.kalshi)
        if (!verdict.same) continue
        confidence = verdict.confidence
      } catch {
        // LLM unavailable: fall back to similarity-only acceptance
      }
    }
    if (confidence < acceptThreshold) continue
    usedPoly.add(c.poly.marketId)
    usedKalshi.add(c.kalshi.marketId)
    pairs.push({
      polyMarketId: c.poly.marketId,
      kalshiMarketId: c.kalshi.marketId,
      confidence,
      source: 'llm',
      mergedYesProb: null,
    })
  }
  return pairs
}
