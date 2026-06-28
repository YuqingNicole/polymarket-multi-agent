// Next.js instrumentation hook: starts the ingestion worker once when the
// server boots (Node runtime only, not Edge).
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startIngest } = await import('@/lib/ingest/worker')
    await startIngest().catch((e) => console.error('[ingest] failed to start:', e))
  }
}
