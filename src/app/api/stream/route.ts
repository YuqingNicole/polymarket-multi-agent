import type { MarketTick, Signal } from '@/lib/types'
import { bus } from '@/lib/ingest/bus'

export const dynamic = 'force-dynamic'

// Server-Sent Events: pushes tick + signal updates from the ingestion bus to
// the terminal UI for live refresh.
export async function GET() {
  const encoder = new TextEncoder()
  let onTick: (t: MarketTick) => void
  let onSignals: (s: Signal[]) => void
  let heartbeat: ReturnType<typeof setInterval>

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data: unknown) =>
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))

      send('hello', { ok: true })
      onTick = (t) => send('tick', t)
      onSignals = (s) => send('signals', s)
      bus.on('tick', onTick)
      bus.on('signals', onSignals)
      heartbeat = setInterval(() => controller.enqueue(encoder.encode(': ping\n\n')), 15_000)
    },
    cancel() {
      bus.off('tick', onTick)
      bus.off('signals', onSignals)
      clearInterval(heartbeat)
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  })
}
