'use client'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  buildPrototypeMarkets,
  fmtVol,
  pct,
  type PrototypeMarket,
} from '@/lib/seed/prototype'
import { deterministicVerdict, prototypeAnalysis, type RawAnalysis } from '@/lib/agents/deterministic'
import type { AgentInput } from '@/lib/agents/input'
import type { AgentVerdict } from '@/lib/types'
import type { MarketView } from '@/lib/board'
import type { Scope } from './Dc'
import { fetchMarkets, runAgentApi, subscribeStream } from './api'

// Faithful React port of the prototype's Component (renderVals + state +
// charts + handlers). Produces the scope the Dc renderer binds the original
// markup against.

interface TermState {
  screen: 'dashboard' | 'detail' | 'agent' | 'signals'
  layout: 'A' | 'B'
  filter: string
  sigFilter: string
  selectedId: string
  range: string
  theme: 'dark' | 'light'
  agentStep: number
  agentRunning: boolean
  revealed: number
}

function protoToInput(m: PrototypeMarket): AgentInput {
  return {
    marketId: m.id,
    source: 'poly',
    q: m.q,
    poly: m.poly,
    kalshi: m.kalshi,
    yesAvg: m.yesAvg,
    chg: m.chg,
    spread: m.spread,
    vol24: m.vol24,
    vol: m.vol,
    liq: m.liq,
    volChg: m.volChg,
  }
}

// Map a backend AgentVerdict onto the prototype-shaped analysis the UI renders.
function verdictToAnalysis(v: AgentVerdict): RawAnalysis {
  return {
    analyst: v.analyst,
    debate: v.debate,
    signal: v.signal,
    signalEn: v.signalEn,
    colorVar: v.colorVar,
    confidence: Math.round(v.confidence * 100),
    side: v.side,
    size: v.sizeLabel,
    reasons: v.reasons,
    risks: v.risks,
  }
}

// ---- charts (ported, return JSX elements) ----
function sparkline(hist: number[], color: string, w: number, h: number) {
  const slice = hist.slice(-28)
  const min = Math.min(...slice)
  const max = Math.max(...slice)
  const rng = max - min || 1
  const pts = slice
    .map((v, i) => `${((i / (slice.length - 1)) * w).toFixed(1)},${(h - ((v - min) / rng) * (h - 3) - 1.5).toFixed(1)}`)
    .join(' ')
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: 'block', overflow: 'visible' }}>
      <polyline points={pts} strokeWidth={1.4} strokeLinejoin="round" strokeLinecap="round" style={{ fill: 'none', stroke: color }} />
    </svg>
  )
}

function areaChart(hist: number[], w: number, h: number) {
  const slice = hist
  const min = Math.min(...slice) - 0.03
  const max = Math.max(...slice) + 0.03
  const rng = max - min || 1
  const X = (i: number) => (i / (slice.length - 1)) * w
  const Y = (v: number) => h - ((v - min) / rng) * h
  const line = slice.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(' ')
  const area = `M0,${h} L` + slice.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(' L') + ` L${w},${h} Z`
  const k = slice.map((v) => v - 0.025)
  const lineK = k.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(' ')
  const grid = [0.25, 0.5, 0.75].map((g) => (
    <line key={g} x1={0} x2={w} y1={g * h} y2={g * h} strokeWidth={1} strokeDasharray="3 4" style={{ stroke: 'var(--bg4)' }} />
  ))
  const last = slice[slice.length - 1]
  return (
    <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ display: 'block', overflow: 'visible' }}>
      <defs>
        <linearGradient id="ag" x1={0} y1={0} x2={0} y2={1}>
          <stop offset="0%" stopOpacity={0.22} style={{ stopColor: 'var(--poly)' }} />
          <stop offset="100%" stopOpacity={0} style={{ stopColor: 'var(--poly)' }} />
        </linearGradient>
      </defs>
      {grid}
      <path d={area} fill="url(#ag)" />
      <polyline points={lineK} strokeWidth={1.4} strokeLinejoin="round" style={{ fill: 'none', stroke: 'var(--kalshi)', strokeOpacity: 0.7 }} />
      <polyline points={line} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" style={{ fill: 'none', stroke: 'var(--poly)' }} />
      <circle cx={X(slice.length - 1)} cy={Y(last)} r={3.5} style={{ fill: 'var(--poly)' }} />
    </svg>
  )
}

// ---- style helpers (ported verbatim) ----
function navStyle(active: boolean) {
  return `display: flex; align-items: center; gap: 11px; padding: 9px 10px; border-radius: 9px; border: none; cursor: pointer; font-size: 13px; font-family: 'IBM Plex Sans', sans-serif; width: 100%; ${active ? 'background: var(--bg4); color: var(--text-hi); font-weight: 600;' : 'background: transparent; color: var(--text-3); font-weight: 500;'}`
}
function chipStyle(active: boolean) {
  return `font-family: 'IBM Plex Mono', monospace; font-size: 11px; padding: 6px 12px; border-radius: 8px; cursor: pointer; background: ${active ? 'var(--accent)' : 'var(--bg2)'}; color: ${active ? 'var(--bg2)' : 'var(--text-3)'}; border: 1px solid ${active ? 'var(--accent)' : 'var(--border)'}; font-weight: ${active ? 600 : 400};`
}
function segStyle(active: boolean) {
  return `font-family: 'IBM Plex Mono', monospace; font-size: 11px; padding: 5px 11px; border-radius: 6px; cursor: pointer; border: none; background: ${active ? 'var(--border2)' : 'transparent'}; color: ${active ? 'var(--text-hi)' : 'var(--text-mid)'}; font-weight: ${active ? 600 : 400};`
}
function rangeStyle(active: boolean) {
  return `font-family: 'IBM Plex Mono', monospace; font-size: 10px; padding: 4px 9px; border-radius: 5px; cursor: pointer; border: none; background: ${active ? 'var(--border2)' : 'transparent'}; color: ${active ? 'var(--text-hi)' : 'var(--text-low)'};`
}

const THEME_KEY = 'augur-theme'

// Read the persisted theme (client only); defaults to dark.
function initialTheme(): TermState['theme'] {
  if (typeof window === 'undefined') return 'dark'
  try {
    const t = localStorage.getItem(THEME_KEY)
    return t === 'light' || t === 'dark' ? t : 'dark'
  } catch {
    return 'dark'
  }
}

const INITIAL: TermState = {
  screen: 'dashboard',
  layout: 'A',
  filter: 'all',
  sigFilter: 'all',
  selectedId: 'fed-jul',
  range: '1D',
  theme: 'dark',
  agentStep: 6,
  agentRunning: false,
  revealed: 99,
}

export function useTerminal(): Scope {
  const [st, setSt] = useState<TermState>(() => ({ ...INITIAL, theme: initialTheme() }))
  // First-paint fallback so the UI renders before the API responds (and if the
  // backend is unreachable). Once /api/markets resolves, the live data wins.
  const fallbackRef = useRef<MarketView[]>(
    buildPrototypeMarkets().map((m) => ({ ...m, polyMarketId: `poly-${m.id}`, source: 'poly' as const })),
  )
  const [apiMarkets, setApiMarkets] = useState<MarketView[] | null>(null)
  const [verdict, setVerdict] = useState<{ id: string; v: AgentVerdict } | null>(null)
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([])
  const data = { markets: apiMarkets && apiMarkets.length ? apiMarkets : fallbackRef.current }

  const set = useCallback((patch: Partial<TermState> | ((s: TermState) => Partial<TermState>)) => {
    setSt((s) => ({ ...s, ...(typeof patch === 'function' ? patch(s) : patch) }))
  }, [])

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', st.theme)
    try {
      localStorage.setItem(THEME_KEY, st.theme)
    } catch {
      /* ignore (private mode) */
    }
  }, [st.theme])
  useEffect(() => () => timersRef.current.forEach(clearTimeout), [])

  // Pull live data from the backend and refresh on SSE tick/signal events.
  useEffect(() => {
    let alive = true
    const load = () => fetchMarkets().then((m) => { if (alive) setApiMarkets(m) }).catch(() => {})
    load()
    const unsub = subscribeStream(load)
    return () => { alive = false; unsub() }
  }, [])

  // ---- handlers ----
  const go = useCallback((screen: TermState['screen']) => set({ screen }), [set])
  const selectMarket = useCallback(
    (id: string) => set({ screen: 'detail', selectedId: id, agentStep: 6, agentRunning: false, revealed: 99 }),
    [set],
  )
  const openAgent = useCallback((id: string) => set({ screen: 'agent', selectedId: id }), [set])

  const runAgent = async () => {
    if (st.agentRunning) return
    timersRef.current.forEach(clearTimeout)
    timersRef.current = []
    const m = data.markets.find((x) => x.id === st.selectedId) ?? data.markets[0]
    if (!m) return
    set({ agentRunning: true, agentStep: 1, revealed: 0 })
    // Call the real backend pipeline (respects AGENT_ENGINE); fall back to the
    // deterministic verdict if the network call fails.
    let v: AgentVerdict
    try {
      v = await runAgentApi('poly', m.polyMarketId)
    } catch {
      v = deterministicVerdict(protoToInput(m))
    }
    setVerdict({ id: m.id, v })
    const total = v.debate.length
    ;[2, 3].forEach((s, i) => timersRef.current.push(setTimeout(() => set({ agentStep: s }), 350 * (i + 1))))
    for (let k = 1; k <= total; k++) {
      timersRef.current.push(setTimeout(() => set({ revealed: k, agentStep: 3 }), 700 + k * 620))
    }
    timersRef.current.push(setTimeout(() => set({ agentStep: 4 }), 700 + total * 620 + 200))
    timersRef.current.push(setTimeout(() => set({ agentStep: 5 }), 700 + total * 620 + 500))
    timersRef.current.push(setTimeout(() => set({ agentRunning: false, agentStep: 6 }), 700 + total * 620 + 900))
  }

  // ---- derived: market view ----
  const marketView = (m: PrototypeMarket) => {
    const chgColor = m.chg > 0 ? 'var(--up)' : m.chg < 0 ? 'var(--down)' : 'var(--text-3)'
    const chgText = (m.chg > 0 ? '+' : '') + m.chg + ' pts'
    const spreadColor = m.spread >= 4 ? 'var(--accent)' : 'var(--text-mid)'
    const badgeMap: Record<string, { label: string; full: string; bg: string; fg: string }> = {
      spread: { label: 'ARB', full: '套利价差', bg: 'var(--tint-clay)', fg: 'var(--accent)' },
      jump: { label: 'JMP', full: '概率跳动', bg: 'var(--tint-amber)', fg: 'var(--amber)' },
      volume: { label: 'VOL', full: '成交放量', bg: 'var(--tint-teal)', fg: 'var(--kalshi)' },
      new: { label: 'NEW', full: '新市场', bg: 'var(--tint-purple)', fg: 'var(--purple)' },
    }
    return {
      ...m,
      yesPct: pct(m.yesAvg),
      polyPct: pct(m.poly),
      kalshiPct: pct(m.kalshi),
      chgColor,
      chgText,
      spreadColor,
      spreadText: m.spread + '¢',
      volText: fmtVol(m.vol24),
      badges: m.flags.map((f) => badgeMap[f]),
      spark: sparkline(m.hist, chgColor, 52, 18),
      sparkBig: sparkline(m.hist, chgColor, 96, 32),
      onOpen: () => selectMarket(m.id),
    }
  }

  const buildSignals = () => {
    const out: Record<string, unknown>[] = []
    const times = ['1分钟前', '4分钟前', '8分钟前', '12分钟前', '19分钟前', '26分钟前', '38分钟前']
    const conf: Record<string, { type: string; ico: string; fg: string; bg: string }> = {
      spread: { type: 'ARBITRAGE 套利', ico: '⇄', fg: 'var(--accent)', bg: 'var(--tint-clay)' },
      jump: { type: 'PROB JUMP 跳动', ico: '↗', fg: 'var(--amber)', bg: 'var(--tint-amber)' },
      volume: { type: 'VOLUME 放量', ico: '◆', fg: 'var(--kalshi)', bg: 'var(--tint-teal)' },
      new: { type: 'NEW MARKET 新市场', ico: '＋', fg: 'var(--purple)', bg: 'var(--tint-purple)' },
    }
    let t = 0
    data.markets.forEach((m) => {
      m.flags.forEach((f) => {
        const c = conf[f]
        let metric: string, detail: string
        if (f === 'spread') {
          metric = m.spread + '¢'
          detail = `Polymarket ${pct(m.poly)} 对 Kalshi ${pct(m.kalshi)}，价差超阈值，存在跨平台套利机会。`
        } else if (f === 'jump') {
          metric = (m.chg >= 0 ? '+' : '') + m.chg + 'pts'
          detail = `2 小时内 YES 概率${m.chg >= 0 ? '快速抬升' : '快速回落'} ${Math.abs(m.chg)} 个百分点，偏离近期均值。`
        } else if (f === 'volume') {
          metric = (m.volChg >= 0 ? '+' : '') + m.volChg + '%'
          detail = `24h 成交较前日放大 ${m.volChg}%，资金异动，关注方向确认。`
        } else {
          metric = 'NEW'
          detail = `新挂牌市场，初期流动性 ${fmtVol(m.liq)}，定价尚未充分。`
        }
        out.push({
          ...c,
          id: m.id,
          q: m.q,
          cat: m.cat,
          metric,
          detail,
          time: times[t % times.length],
          spark: sparkline(m.hist, c.fg, 64, 22),
          onOpen: () => openAgent(m.id),
        })
        t++
      })
    })
    return out
  }

  // ---- renderVals (ported) ----
  const clock = '14:32:0' + (Math.floor(Date.now() / 1000) % 6)
  const allMarkets = data.markets.map((m) => marketView(m))
  const catMap: Record<string, string[]> = {
    macro: ['宏观利率', '宏观'],
    crypto: ['加密资产'],
    politics: ['政治'],
    tech: ['科技', '股票'],
  }
  let markets = allMarkets
  if (st.filter !== 'all') {
    const cats = catMap[st.filter] || []
    markets = allMarkets.filter((m) => cats.includes(m.cat))
  }

  const selBase = data.markets.find((m) => m.id === st.selectedId) ?? data.markets[0]
  const sel = marketView(selBase) as ReturnType<typeof marketView> & Record<string, unknown>
  sel.polyW = pct(sel.poly)
  sel.kalshiW = pct(sel.kalshi)
  sel.spreadBoxBg = sel.spread >= 4 ? 'var(--tint-clay)' : 'var(--bg1)'
  sel.spreadNote = sel.spread >= 4 ? '价差超过 4¢ 触发套利信号，建议双边对冲建仓。' : '两平台定价基本一致，无显著套利空间。'
  sel.stats = [
    { label: '合并 24h 成交', value: fmtVol(sel.vol24), color: 'var(--text-hi)' },
    { label: '累计成交额', value: fmtVol(sel.vol), color: 'var(--text-hi)' },
    { label: '簿内流动性', value: fmtVol(sel.liq), color: 'var(--text-hi)' },
    { label: '24h 成交变化', value: (sel.volChg >= 0 ? '+' : '') + sel.volChg + '%', color: sel.volChg >= 0 ? 'var(--up)' : 'var(--down)' },
    { label: '24h 概率变化', value: sel.chgText, color: sel.chgColor },
  ]

  const rmap: Record<string, number> = { '1H': 8, '6H': 20, '1D': 40, '1W': 64, ALL: 80 }
  const dh = sel.hist.slice(-(rmap[st.range] || 80))
  const detailChart = areaChart(dh, 640, 240)

  const an: RawAnalysis =
    verdict && verdict.id === st.selectedId
      ? verdictToAnalysis(verdict.v)
      : prototypeAnalysis(protoToInput(selBase))
  const debateAll = an.debate
  const revealedDebate = debateAll.slice(0, Math.min(st.revealed, debateAll.length))
  const roleSummaries = {
    analyst: an.analyst,
    bull: an.debate.filter((d) => d.side === 'bull')[0].text,
    bear: an.debate.filter((d) => d.side === 'bear')[0].text,
    trader: `综合多空论证，给出结构化判断：${an.signal}（置信度 ${an.confidence}%）。详见右侧决策卡。`,
  }
  const roles = [
    { name: '分析师', role: 'ANALYST', ico: 'A', bg: 'var(--tint-blue)', fg: 'var(--poly)', border: 'var(--border)', tag: '数据', summary: roleSummaries.analyst },
    { name: '看多研究员', role: 'BULL', ico: '▲', bg: 'var(--tint-green)', fg: 'var(--up)', border: 'var(--border)', tag: 'LONG', summary: roleSummaries.bull },
    { name: '看空研究员', role: 'BEAR', ico: '▼', bg: 'var(--tint-red)', fg: 'var(--down)', border: 'var(--border)', tag: 'SHORT', summary: roleSummaries.bear },
    { name: '交易员', role: 'TRADER', ico: '◆', bg: 'var(--tint-clay)', fg: 'var(--accent)', border: 'var(--tint-clay)', tag: '决策', summary: roleSummaries.trader },
  ]
  const debate = revealedDebate.map((d) => {
    const bull = d.side === 'bull'
    return {
      ...d,
      dir: 'row',
      name: bull ? '看多研究员' : '看空研究员',
      ico: bull ? '▲' : '▼',
      bg: bull ? 'var(--tint-green)' : 'var(--tint-red)',
      fg: bull ? 'var(--up)' : 'var(--down)',
      bubbleBg: bull ? 'var(--bubble-bull)' : 'var(--bubble-bear)',
      bubbleBorder: bull ? 'var(--bubble-bull-bd)' : 'var(--bubble-bear-bd)',
    }
  })
  const pipeLabels = ['数据采集', '分析师', '多空辩论', '交易员', '风控', '决策']
  const pipeline = pipeLabels.map((label, i) => {
    const n = i + 1
    const done = st.agentStep > n
    const active = st.agentStep === n
    return {
      label,
      n: done ? '✓' : String(n),
      bg: done ? 'var(--tint-green)' : active ? 'var(--tint-clay)' : 'var(--bg4)',
      fg: done ? 'var(--up)' : active ? 'var(--accent)' : 'var(--text-low)',
      txt: active ? 'var(--text-hi)' : done ? 'var(--text-3)' : 'var(--text-low)',
      weight: active ? 600 : 400,
      line: done ? 'var(--pipe-done-line)' : 'var(--border)',
      arrow: i < pipeLabels.length - 1,
    }
  })
  const v = { signal: an.signal, signalEn: an.signalEn, color: an.colorVar, confidence: an.confidence, side: an.side, size: an.size, reasons: an.reasons, risks: an.risks }
  const verdictView = { ...v, confidence: v.confidence + '%', confW: v.confidence + '%', border: v.color, headBg: 'var(--bg1)' }

  const railSignals = buildSignals().slice(0, 6)
  let feedSignals = buildSignals()
  const sfMap: Record<string, string> = { spread: 'ARBITRAGE 套利', jump: 'PROB JUMP 跳动', volume: 'VOLUME 放量', new: 'NEW MARKET 新市场' }
  if (st.sigFilter !== 'all') feedSignals = feedSignals.filter((s) => s.type === sfMap[st.sigFilter])

  const headerMap: Record<string, [string, string]> = {
    dashboard: ['市场总览', `${allMarkets.length} 个活跃标的 · Polymarket × Kalshi 聚合`],
    detail: ['标的详情', sel.q],
    agent: ['Agent 分析', 'TradingAgents 架构 · 多智能体协作判断'],
    signals: ['异常信号', '实时监控 · 套利 / 跳动 / 放量 / 新市场'],
  }
  const navItems = [
    { key: 'dashboard', label: '市场总览', ico: '▦' },
    { key: 'detail', label: '标的详情', ico: '◷' },
    { key: 'agent', label: 'Agent 分析', ico: '◆', badge: 'AI' },
    { key: 'signals', label: '异常信号', ico: '⚡', badge: String(buildSignals().length) },
  ]

  return {
    theme: st.theme,
    toggleTheme: () => set((s) => ({ theme: s.theme === 'dark' ? 'light' : 'dark' })),
    themeIcon: st.theme === 'dark' ? '☀' : '☾',
    themeLabel: st.theme === 'dark' ? '浅色' : '深色',
    clock,
    marketCount: allMarkets.length,
    signalCount: buildSignals().length,
    headerTitle: headerMap[st.screen][0],
    headerSub: headerMap[st.screen][1],

    nav: navItems.map((n) => ({
      label: n.label,
      ico: n.ico,
      badge: n.badge || '',
      style: navStyle(st.screen === n.key),
      icoColor: st.screen === n.key ? 'var(--accent)' : 'var(--text-low)',
      go: () => go(n.key as TermState['screen']),
    })),

    isDashboard: st.screen === 'dashboard',
    isDetail: st.screen === 'detail',
    isAgent: st.screen === 'agent',
    isSignals: st.screen === 'signals',

    kpis: [
      { label: '聚合标的', value: String(allMarkets.length), delta: '2 个新挂牌', deltaColor: 'var(--purple)' },
      { label: '24h 总成交', value: '$83.5M', delta: '+18.4% vs 昨日', deltaColor: 'var(--up)' },
      { label: '活跃套利信号', value: '4', delta: '价差 ≥ 4¢', deltaColor: 'var(--accent)' },
      { label: '概率异动', value: '5', delta: '|Δ| ≥ 5 pts / 2h', deltaColor: 'var(--amber)' },
    ],

    filters: [
      { key: 'all', label: '全部' },
      { key: 'macro', label: '宏观' },
      { key: 'crypto', label: '加密' },
      { key: 'politics', label: '政治' },
      { key: 'tech', label: '科技股' },
    ].map((f) => ({ label: f.label, style: chipStyle(st.filter === f.key), go: () => set({ filter: f.key }) })),

    setLayoutA: () => set({ layout: 'A' }),
    setLayoutB: () => set({ layout: 'B' }),
    layoutAStyle: segStyle(st.layout === 'A'),
    layoutBStyle: segStyle(st.layout === 'B'),
    isLayoutA: st.layout === 'A',
    isLayoutB: st.layout === 'B',

    markets,
    railSignals,

    goDashboard: () => go('dashboard'),
    goDetail: () => go('detail'),
    // "运行 Agent 分析" on the detail screen: open the agent screen AND kick off
    // the real backend pipeline.
    goAgentFromDetail: () => {
      openAgent(st.selectedId)
      void runAgent()
    },
    sel,
    ranges: ['1H', '6H', '1D', '1W', 'ALL'].map((r) => ({ label: r, style: rangeStyle(st.range === r), go: () => set({ range: r }) })),
    detailChart,

    runAgent,
    runBtnLabel: st.agentRunning ? '运行中…' : '↻ 重新运行',
    runBtnStyle: `background: ${st.agentRunning ? 'var(--border2)' : 'var(--accent)'}; border: none; color: ${st.agentRunning ? 'var(--text-3)' : 'var(--bg2)'}; font-weight: 600; font-size: 12px; padding: 9px 16px; border-radius: 8px; cursor: ${st.agentRunning ? 'default' : 'pointer'}; font-family: 'IBM Plex Sans', sans-serif; flex-shrink: 0;`,
    agentRunning: st.agentRunning,
    pipeline,
    roles,
    debate,
    debateRounds: 3,
    verdict: verdictView,

    sigFilters: [
      { key: 'all', label: '全部信号' },
      { key: 'spread', label: '套利价差' },
      { key: 'jump', label: '概率跳动' },
      { key: 'volume', label: '成交放量' },
      { key: 'new', label: '新市场' },
    ].map((f) => ({ label: f.label, style: chipStyle(st.sigFilter === f.key), go: () => set({ sigFilter: f.key }) })),
    feedSignals,
  }
}
