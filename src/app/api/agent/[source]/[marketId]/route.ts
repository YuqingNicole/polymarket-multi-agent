import { NextResponse } from 'next/server'
import type { Source } from '@/lib/types'
import { runAndStoreAgent } from '@/lib/board'

export const dynamic = 'force-dynamic'

// POST runs the agent pipeline for a market and persists the verdict.
export async function POST(_req: Request, { params }: { params: Promise<{ source: string; marketId: string }> }) {
  const { source, marketId } = await params
  if (source !== 'poly' && source !== 'kalshi') {
    return NextResponse.json({ error: 'invalid source' }, { status: 400 })
  }
  const verdict = await runAndStoreAgent(source as Source, marketId)
  if (!verdict) return NextResponse.json({ error: 'market not found' }, { status: 404 })
  return NextResponse.json(verdict)
}
