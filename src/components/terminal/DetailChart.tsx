'use client'
import React, { useEffect, useRef, useState } from 'react'

// Polished probability chart for the detail screen: smooth dual-venue lines,
// labeled Y-axis (%) + X-axis (time), end markers, and a hover crosshair with
// a value tooltip. Size-aware (no aspect-ratio distortion) and theme-aware via
// CSS variables.

interface Props {
  poly: number[] // 0..1 series (Polymarket)
  kalshi: number[] // 0..1 series (Kalshi)
  range: string // '1H' | '6H' | '1D' | '1W' | 'ALL'
}

const PAD = { l: 10, r: 46, t: 14, b: 24 }
const RANGE_LABEL: Record<string, string> = { '1H': '−1h', '6H': '−6h', '1D': '−1d', '1W': '−1w', ALL: '更早' }

// Catmull-Rom → cubic-bezier smoothing (no overshoot tuning needed for prob lines).
function smooth(pts: [number, number][]): string {
  if (pts.length < 2) return pts.length ? `M${pts[0][0]},${pts[0][1]}` : ''
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[i + 2] || p2
    const c1x = p1[0] + (p2[0] - p0[0]) / 6
    const c1y = p1[1] + (p2[1] - p0[1]) / 6
    const c2x = p2[0] - (p3[0] - p1[0]) / 6
    const c2y = p2[1] - (p3[1] - p1[1]) / 6
    d += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`
  }
  return d
}

// "nice" gridline values within [min,max].
function ticks(min: number, max: number, count = 4): number[] {
  const span = max - min || 1
  const raw = span / count
  const mag = Math.pow(10, Math.floor(Math.log10(raw)))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? mag
  const start = Math.ceil(min / step) * step
  const out: number[] = []
  for (let v = start; v <= max + 1e-9; v += step) out.push(v)
  return out
}

export function DetailChart({ poly, kalshi, range }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 760, h: 250 })
  const [hover, setHover] = useState<number | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver((es) => {
      const r = es[0].contentRect
      if (r.width > 0 && r.height > 0) setSize({ w: r.width, h: r.height })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const { w, h } = size
  const n = Math.max(poly.length, kalshi.length)
  const all = [...poly, ...kalshi]
  const dmin = Math.max(0, Math.min(...all) - 0.04)
  const dmax = Math.min(1, Math.max(...all) + 0.04)
  const plotW = w - PAD.l - PAD.r
  const plotH = h - PAD.t - PAD.b
  const X = (i: number) => PAD.l + (n <= 1 ? 0 : (i / (n - 1)) * plotW)
  const Y = (v: number) => PAD.t + (1 - (v - dmin) / (dmax - dmin || 1)) * plotH

  const polyPts = poly.map((v, i) => [X(i), Y(v)] as [number, number])
  const kalshiPts = kalshi.map((v, i) => [X(i), Y(v)] as [number, number])
  const polyLine = smooth(polyPts)
  const kalshiLine = smooth(kalshiPts)
  const polyArea = `${polyLine} L${X(poly.length - 1).toFixed(1)},${(PAD.t + plotH).toFixed(1)} L${PAD.l},${(PAD.t + plotH).toFixed(1)} Z`

  const gy = ticks(dmin, dmax)
  const polyLast = poly[poly.length - 1] ?? 0
  const kalshiLast = kalshi[kalshi.length - 1] ?? 0

  const onMove = (e: React.MouseEvent<SVGRectElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const mx = ((e.clientX - rect.left) / rect.width) * w
    const i = Math.max(0, Math.min(n - 1, Math.round(((mx - PAD.l) / plotW) * (n - 1))))
    setHover(i)
  }

  const pct = (v: number) => Math.round(v * 100) + '%'
  const hi = hover != null
  const hx = hi ? X(hover!) : 0
  const tipRight = hx > w - 130
  const tipX = tipRight ? hx - 120 : hx + 12

  return (
    <div ref={ref} style={{ width: '100%', height: '100%', minHeight: 200 }}>
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: 'block', fontFamily: "'IBM Plex Mono', monospace" }}>
        <defs>
          <linearGradient id="dc-poly" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--poly)" stopOpacity="0.20" />
            <stop offset="100%" stopColor="var(--poly)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Y gridlines + labels */}
        {gy.map((v) => (
          <g key={v}>
            <line x1={PAD.l} x2={PAD.l + plotW} y1={Y(v)} y2={Y(v)} stroke="var(--border)" strokeWidth="1" strokeDasharray="3 4" />
            <text x={PAD.l + plotW + 6} y={Y(v) + 3} fontSize="9.5" fill="var(--text-low)">{pct(v)}</text>
          </g>
        ))}

        {/* X time labels */}
        <text x={PAD.l} y={h - 7} fontSize="9.5" fill="var(--text-low)">{RANGE_LABEL[range] ?? ''}</text>
        <text x={PAD.l + plotW} y={h - 7} fontSize="9.5" fill="var(--text-low)" textAnchor="end">现在</text>

        {/* series */}
        <path d={polyArea} fill="url(#dc-poly)" />
        <path d={kalshiLine} fill="none" stroke="var(--kalshi)" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" opacity="0.9" />
        <path d={polyLine} fill="none" stroke="var(--poly)" strokeWidth="2.1" strokeLinejoin="round" strokeLinecap="round" />

        {/* end markers + value chips */}
        <circle cx={X(poly.length - 1)} cy={Y(polyLast)} r="3.4" fill="var(--poly)" />
        <circle cx={X(kalshi.length - 1)} cy={Y(kalshiLast)} r="3" fill="var(--kalshi)" />

        {/* hover crosshair + tooltip */}
        {hi && (
          <g>
            <line x1={hx} x2={hx} y1={PAD.t} y2={PAD.t + plotH} stroke="var(--text-low)" strokeWidth="1" strokeDasharray="2 3" opacity="0.7" />
            <circle cx={hx} cy={Y(poly[hover!])} r="3.2" fill="var(--poly)" stroke="var(--bg2)" strokeWidth="1.5" />
            <circle cx={hx} cy={Y(kalshi[hover!])} r="3.2" fill="var(--kalshi)" stroke="var(--bg2)" strokeWidth="1.5" />
            <g transform={`translate(${tipX},${PAD.t + 4})`}>
              <rect width="108" height="40" rx="6" fill="var(--bg2)" stroke="var(--border)" strokeWidth="1" />
              <circle cx="11" cy="14" r="3" fill="var(--poly)" />
              <text x="20" y="17" fontSize="10" fill="var(--text-2)">Poly {pct(poly[hover!])}</text>
              <circle cx="11" cy="29" r="3" fill="var(--kalshi)" />
              <text x="20" y="32" fontSize="10" fill="var(--text-2)">Kalshi {pct(kalshi[hover!])}</text>
            </g>
          </g>
        )}

        {/* interaction overlay */}
        <rect x={PAD.l} y={PAD.t} width={plotW} height={plotH} fill="transparent" onMouseMove={onMove} onMouseLeave={() => setHover(null)} style={{ cursor: 'crosshair' }} />
      </svg>
    </div>
  )
}
