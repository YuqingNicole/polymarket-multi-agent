// Verbatim port of the prototype's seed dataset and helpers
// (docs/prototype/extracted/template.html, class Component).
// Used by: seed-mode ingestion, the deterministic agent engine, and the UI.
// Each entry is a cross-platform view: `poly` and `kalshi` are the YES implied
// probabilities on each venue for the SAME real-world event.

export interface PrototypeBase {
  id: string
  q: string
  cat: string
  poly: number
  kalshi: number
  chg: number // 24h probability change, in points
  vol24: number
  vol: number
  liq: number
  volChg: number // 24h volume change, percent
  flags: string[] // 'spread' | 'jump' | 'volume' | 'new'
}

export interface PrototypeMarket extends PrototypeBase {
  yesAvg: number
  spread: number // cents, round(|poly-kalshi|*100)
  hist: number[] // 80-point merged YES probability history
}

export const PROTOTYPE_BASE: PrototypeBase[] = [
  { id: 'fed-jul', q: '美联储 7 月降息 25bp？', cat: '宏观利率', poly: 0.68, kalshi: 0.63, chg: 6, vol24: 2800000, vol: 41000000, liq: 2100000, volChg: 64, flags: ['spread', 'jump'] },
  { id: 'gpt6', q: 'OpenAI 2026 年内发布 GPT-6？', cat: '科技', poly: 0.57, kalshi: 0.49, chg: 12, vol24: 1300000, vol: 9000000, liq: 520000, volChg: 218, flags: ['spread', 'jump', 'volume', 'new'] },
  { id: 'btc-150', q: '比特币 2026 年底突破 $150K？', cat: '加密资产', poly: 0.44, kalshi: 0.41, chg: 9, vol24: 3600000, vol: 28000000, liq: 1400000, volChg: 141, flags: ['jump', 'volume'] },
  { id: 'shutdown', q: '美国政府 9 月前关门？', cat: '政治', poly: 0.38, kalshi: 0.33, chg: 14, vol24: 900000, vol: 6000000, liq: 350000, volChg: 186, flags: ['jump', 'spread', 'volume'] },
  { id: 'house-26', q: '民主党赢得 2026 众议院多数？', cat: '政治', poly: 0.52, kalshi: 0.51, chg: 2, vol24: 3500000, vol: 33000000, liq: 1800000, volChg: 12, flags: [] },
  { id: 'nvda-4t', q: '英伟达年底市值超 $4 万亿？', cat: '股票', poly: 0.61, kalshi: 0.58, chg: 3, vol24: 1150000, vol: 7000000, liq: 400000, volChg: 21, flags: ['spread'] },
  { id: 'recession-26', q: '美国 2026 年陷入衰退？', cat: '宏观', poly: 0.31, kalshi: 0.29, chg: -4, vol24: 900000, vol: 12000000, liq: 800000, volChg: -8, flags: [] },
  { id: 'temp-26', q: '2026 成为有记录以来最热年份？', cat: '气候', poly: 0.73, kalshi: 0.71, chg: 1, vol24: 650000, vol: 5000000, liq: 300000, volChg: 4, flags: [] },
]

// ---- deterministic RNG (verbatim from prototype) ----
export function rng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

export function hash(str: string): number {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export function genHist(seed: number, target: number, vol: number, n: number): number[] {
  const r = rng(seed)
  const arr: number[] = []
  let v = target - (r() - 0.5) * vol * 2.5
  for (let i = 0; i < n; i++) {
    const pull = (target - v) * 0.12
    v += pull + (r() - 0.5) * vol
    v = Math.max(0.03, Math.min(0.97, v))
    arr.push(v)
  }
  arr[n - 1] = target
  return arr
}

export function buildPrototypeMarkets(): PrototypeMarket[] {
  return PROTOTYPE_BASE.map((m) => {
    const yesAvg = (m.poly + m.kalshi) / 2
    const spread = Math.round(Math.abs(m.poly - m.kalshi) * 100)
    const seed = hash(m.id)
    const hist = genHist(seed, yesAvg, 0.018, 80)
    return { ...m, yesAvg, spread, hist }
  })
}

// ---- formatting (verbatim) ----
export function fmtVol(v: number): string {
  if (v >= 1000000) return '$' + (v / 1000000).toFixed(1) + 'M'
  if (v >= 1000) return '$' + Math.round(v / 1000) + 'K'
  return '$' + v
}

export function pct(v: number): string {
  return (v * 100).toFixed(0) + '%'
}
