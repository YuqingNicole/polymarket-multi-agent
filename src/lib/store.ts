import type { AgentVerdict, MarketMeta, MarketPair, MarketTick, Signal, Source } from '@/lib/types'
import { prisma } from '@/lib/db'

// Persistence bridge between Prisma rows and domain types. All reads/writes go
// through here so connectors, analysis, and the API share one surface.

function rowToMeta(r: {
  source: string
  marketId: string
  title: string
  category: string | null
  endDate: Date | null
  outcomes: string[]
  polyClobTokenIds: string[]
  kalshiEventTicker: string | null
}): MarketMeta {
  return {
    source: r.source as Source,
    marketId: r.marketId,
    title: r.title,
    category: r.category,
    endDate: r.endDate ? r.endDate.toISOString() : null,
    outcomes: r.outcomes,
    ...(r.polyClobTokenIds.length === 2
      ? { polyClobTokenIds: [r.polyClobTokenIds[0], r.polyClobTokenIds[1]] as [string, string] }
      : {}),
    ...(r.kalshiEventTicker ? { kalshiEventTicker: r.kalshiEventTicker } : {}),
  }
}

export async function upsertMarkets(metas: MarketMeta[]): Promise<void> {
  for (const m of metas) {
    const data = {
      title: m.title,
      category: m.category ?? null,
      endDate: m.endDate ? new Date(m.endDate) : null,
      outcomes: m.outcomes,
      polyClobTokenIds: m.polyClobTokenIds ?? [],
      kalshiEventTicker: m.kalshiEventTicker ?? null,
    }
    await prisma.market.upsert({
      where: { source_marketId: { source: m.source, marketId: m.marketId } },
      create: { source: m.source, marketId: m.marketId, ...data },
      update: data,
    })
  }
}

export async function insertTicks(ticks: MarketTick[]): Promise<void> {
  if (ticks.length === 0) return
  await prisma.tick.createMany({
    data: ticks.map((t) => ({
      source: t.source,
      marketId: t.marketId,
      yesProb: t.yesProb,
      volume24h: t.volume24h,
      volumeTotal: t.volumeTotal,
      ts: new Date(t.ts),
    })),
  })
}

export async function upsertPairs(pairs: MarketPair[]): Promise<void> {
  for (const p of pairs) {
    const data = { confidence: p.confidence, source: p.source, mergedYesProb: p.mergedYesProb }
    await prisma.marketPair.upsert({
      where: { polyMarketId_kalshiMarketId: { polyMarketId: p.polyMarketId, kalshiMarketId: p.kalshiMarketId } },
      create: { polyMarketId: p.polyMarketId, kalshiMarketId: p.kalshiMarketId, ...data },
      update: data,
    })
  }
}

export async function replaceSignals(signals: Signal[]): Promise<void> {
  await prisma.$transaction([
    prisma.signal.deleteMany({}),
    prisma.signal.createMany({
      data: signals.map((s) => ({
        source: s.source,
        marketId: s.marketId,
        kind: s.kind,
        severity: s.severity,
        detail: s.detail,
        ts: new Date(s.ts),
      })),
    }),
  ])
}

export async function getMarkets(source?: Source): Promise<MarketMeta[]> {
  const rows = await prisma.market.findMany({ where: source ? { source } : undefined })
  return rows.map(rowToMeta)
}

export async function getMarket(source: Source, marketId: string): Promise<MarketMeta | null> {
  const row = await prisma.market.findUnique({ where: { source_marketId: { source, marketId } } })
  return row ? rowToMeta(row) : null
}

export async function getHistory(source: Source, marketId: string, limit = 200): Promise<MarketTick[]> {
  const rows = await prisma.tick.findMany({
    where: { source, marketId },
    orderBy: { ts: 'asc' },
    take: limit,
  })
  return rows.map((t) => ({
    source: t.source as Source,
    marketId: t.marketId,
    yesProb: t.yesProb,
    volume24h: t.volume24h,
    volumeTotal: t.volumeTotal,
    ts: t.ts.toISOString(),
  }))
}

// Latest tick per (source, marketId).
export async function getLatestTicks(): Promise<MarketTick[]> {
  const rows = await prisma.$queryRaw<
    { source: string; marketId: string; yesProb: number; volume24h: number; volumeTotal: number; ts: Date }[]
  >`
    SELECT DISTINCT ON (source, "marketId") source, "marketId", "yesProb", "volume24h", "volumeTotal", ts
    FROM ticks ORDER BY source, "marketId", ts DESC
  `
  return rows.map((t) => ({
    source: t.source as Source,
    marketId: t.marketId,
    yesProb: t.yesProb,
    volume24h: t.volume24h,
    volumeTotal: t.volumeTotal,
    ts: t.ts.toISOString(),
  }))
}

export async function getPairs(): Promise<MarketPair[]> {
  const rows = await prisma.marketPair.findMany()
  return rows.map((p) => ({
    polyMarketId: p.polyMarketId,
    kalshiMarketId: p.kalshiMarketId,
    confidence: p.confidence,
    source: p.source as 'curated' | 'llm',
    mergedYesProb: p.mergedYesProb,
  }))
}

export async function getSignals(limit = 50): Promise<Signal[]> {
  const rows = await prisma.signal.findMany({ orderBy: { ts: 'desc' }, take: limit })
  return rows.map((s) => ({
    source: s.source as Source,
    marketId: s.marketId,
    kind: s.kind as Signal['kind'],
    severity: s.severity,
    detail: s.detail,
    ts: s.ts.toISOString(),
  }))
}

export async function saveAgentRun(v: AgentVerdict): Promise<void> {
  await prisma.agentRun.create({
    data: {
      source: v.source,
      marketId: v.marketId,
      engine: v.engine,
      direction: v.direction,
      sizePct: v.sizePct,
      confidence: v.confidence,
      rationale: v.rationale,
      bullCase: v.bullCase,
      bearCase: v.bearCase,
      riskNotes: v.riskNotes,
      raw: v as unknown as object,
    },
  })
}

export async function countMarkets(): Promise<number> {
  return prisma.market.count()
}
