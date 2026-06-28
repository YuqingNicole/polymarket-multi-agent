import { NextResponse } from 'next/server'
import { getMarketViews } from '@/lib/board'

export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json({ markets: await getMarketViews() })
}
