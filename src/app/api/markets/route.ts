import { NextResponse } from 'next/server'
import { getBoard } from '@/lib/board'

export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json(await getBoard())
}
