import type { MarketTick } from '@/lib/types'

export type Window = '1h' | '24h'

const WINDOW_MS: Record<Window, number> = {
  '1h': 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

/**
 * Change in yesProb over the given window, expressed in pts (percentage points):
 * (last - first) * 100, rounded to 1 decimal.
 *
 * `history` is assumed sorted ascending by ts. We anchor on the latest tick and
 * take the earliest tick that still falls within the window.
 */
export function probDelta(history: MarketTick[], window: Window): number {
  if (history.length < 2) return 0

  const last = history[history.length - 1]
  const cutoff = new Date(last.ts).getTime() - WINDOW_MS[window]

  // first tick at or after the cutoff (history is ascending by ts)
  const first = history.find((t) => new Date(t.ts).getTime() >= cutoff)
  if (!first || first === last) return 0

  return round1((last.yesProb - first.yesProb) * 100)
}

/**
 * Percentage change of volume24h: latest vs the tick ~24h earlier.
 * If the 24h-prior baseline is 0, returns 0 to avoid divide-by-zero noise.
 */
export function volumeChangePct(history: MarketTick[]): number {
  if (history.length < 2) return 0

  const last = history[history.length - 1]
  const cutoff = new Date(last.ts).getTime() - WINDOW_MS['24h']

  const baseline = history.find((t) => new Date(t.ts).getTime() >= cutoff)
  if (!baseline || baseline === last) return 0
  if (baseline.volume24h === 0) return 0

  return round1(((last.volume24h - baseline.volume24h) / baseline.volume24h) * 100)
}
