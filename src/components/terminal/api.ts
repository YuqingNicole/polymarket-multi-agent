'use client'
import type { AgentVerdict, Source } from '@/lib/types'
import type { MarketView } from '@/lib/board'

// Client-side access to the product backend.

export async function fetchMarkets(): Promise<MarketView[]> {
  const r = await fetch('/api/markets', { cache: 'no-store' })
  if (!r.ok) throw new Error(`markets ${r.status}`)
  const j = (await r.json()) as { markets: MarketView[] }
  return j.markets
}

export async function runAgentApi(source: Source, marketId: string): Promise<AgentVerdict> {
  const r = await fetch(`/api/agent/${source}/${marketId}`, { method: 'POST' })
  if (!r.ok) throw new Error(`agent ${r.status}`)
  return (await r.json()) as AgentVerdict
}

// Subscribe to the SSE stream; `onChange` fires on tick/signals updates.
export function subscribeStream(onChange: () => void): () => void {
  const es = new EventSource('/api/stream')
  es.addEventListener('tick', onChange)
  es.addEventListener('signals', onChange)
  return () => es.close()
}
