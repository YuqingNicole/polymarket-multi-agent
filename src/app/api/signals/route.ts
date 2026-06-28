import { NextResponse } from 'next/server'
import { getSignals } from '@/lib/store'

export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json(await getSignals(100))
}
