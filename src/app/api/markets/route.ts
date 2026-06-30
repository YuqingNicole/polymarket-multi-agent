import { NextResponse } from 'next/server'
import { config } from '@/lib/config'
import { getMarketViews } from '@/lib/board'

export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json({ markets: await getMarketViews(), mode: config.DATA_SOURCE })
}
