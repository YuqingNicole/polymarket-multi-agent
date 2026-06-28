import type { AgentVerdict, DebateTurn, Direction } from '@/lib/types'
import { fmtVol, pct } from '@/lib/seed/prototype'
import type { AgentInput } from './input'

// Deterministic multi-agent analysis: a faithful port of the prototype's
// `makeAnalysis` decision tree. No network, fully reproducible — the offline
// engine and the baseline the LLM engine is compared against.

interface RawAnalysis {
  analyst: string
  debate: DebateTurn[]
  signal: string
  signalEn: string
  colorVar: string
  confidence: number // 0..100
  side: string
  size: string
  reasons: string[]
  risks: string[]
}

function analyze(m: AgentInput): RawAnalysis {
  const yp = Math.round(m.yesAvg * 100)
  const chg = Math.round(m.chg)
  const absChg = Math.abs(chg)
  const dir = chg >= 0 ? '上行' : '下行'

  const analyst = `综合 Polymarket（${pct(m.poly)}）与 Kalshi（${pct(m.kalshi)}），合并 YES 隐含概率 ${yp}%，24h ${dir} ${absChg} pts，合并成交 ${fmtVol(m.vol24)}。两平台价差 ${m.spread}¢${m.spread >= 4 ? '，存在跨市场套利空间。' : '，定价基本一致。'}`

  const bull = [
    `动量信号：概率 24h ${dir} ${absChg} pts，资金持续流入 ${chg >= 0 ? 'YES' : 'NO'} 侧，趋势尚未衰竭。`,
    `成交结构：24h 成交较前日 ${m.volChg >= 0 ? '+' : ''}${m.volChg}%，新增流动性集中放大，确认了价格方向。`,
    m.spread >= 4 ? `跨市场：Kalshi 较 Polymarket 低估 ${m.spread}¢，临近结算存在收敛动力。` : `估值：当前 ${yp}% 仍低于基本面情景隐含的概率，赔率具吸引力。`,
  ]
  const bear = [
    `估值约束：YES 已计价 ${yp}%，${yp > 65 ? '继续上行空间有限，赔率不佳。' : '事件不确定性仍高，单边持有风险大。'}`,
    `流动性：簿深 ${fmtVol(m.liq)}，大额成交滑点显著，难以按现价规模建仓。`,
    m.spread >= 4 ? `价差可能源于两平台费用与结算口径差异，并非无风险套利。` : `近期 ${absChg} pts 的跳动缺乏新增信息支撑，存在情绪反转风险。`,
  ]
  const debate: DebateTurn[] = [
    { side: 'bull', text: bull[0] },
    { side: 'bear', text: bear[0] },
    { side: 'bull', text: bull[1] },
    { side: 'bear', text: bear[1] },
    { side: 'bull', text: bull[2] },
    { side: 'bear', text: bear[2] },
  ]

  // decision tree (verbatim thresholds from the prototype)
  let signal: string, signalEn: string, colorVar: string, confidence: number
  let side: string, size: string, reasons: string[], risks: string[]
  if (m.spread >= 4) {
    signal = '套利'; signalEn = 'ARBITRAGE'; colorVar = 'var(--accent)'; confidence = 78
    side = `Kalshi 买 YES / Poly 卖 YES`; size = '中性对冲'
    reasons = [`两平台价差 ${m.spread}¢ 显著高于历史均值，临近事件窗口具收敛预期。`, `双边建仓后净敞口接近零，主要赚取价差收敛。`, `成交活跃（${fmtVol(m.vol24)}），可分批建立对冲头寸。`]
    risks = [`结算口径或费用差异可能侵蚀部分价差收益。`, `单边流动性不足时对冲腿可能无法同时成交。`]
  } else if (chg >= 5 && yp < 70) {
    signal = '买入 YES'; signalEn = 'BUY YES'; colorVar = 'var(--up)'; confidence = 64
    side = 'YES'; size = '轻仓试探'
    reasons = [`概率 24h 上行 ${absChg} pts 且成交放大 ${m.volChg}%，动量与量能共振。`, `当前 ${yp}% 距离完全计价仍有空间，赔率合理。`, `多空辩论中看多论据未被有效反驳。`]
    risks = [`动量交易回撤风险高，需设概率止损（如回落至 ${Math.max(0, yp - 8)}%）。`, `簿深较薄，建议分批且控制单笔规模。`]
  } else if (chg <= -5) {
    signal = '买入 NO'; signalEn = 'BUY NO'; colorVar = 'var(--down)'; confidence = 60
    side = 'NO'; size = '轻仓试探'
    reasons = [`概率 24h 下行 ${absChg} pts，资金流出 YES 侧，趋势走弱。`, `当前 ${yp}% 仍高于看空情景隐含概率，存在下修空间。`]
    risks = [`事件型标的易受突发消息反转，需控制仓位。`, `临近结算时间价值衰减加速。`]
  } else if (yp >= 78) {
    signal = '观望'; signalEn = 'HOLD'; colorVar = 'var(--amber)'; confidence = 52
    side = '不建仓'; size = '0'
    reasons = [`YES 已高度计价（${yp}%），剩余赔率不足以覆盖尾部风险。`, `近期波动 ${absChg} pts 在噪声区间，无明确边际信息。`]
    risks = [`高概率标的的反转虽小概率但损失幅度大。`]
  } else {
    signal = '观望'; signalEn = 'HOLD'; colorVar = 'var(--amber)'; confidence = 48
    side = '不建仓'; size = '0'
    reasons = [`多空论据强度相当，无显著定价错位。`, `价差 ${m.spread}¢ 与成交变化 ${m.volChg}% 均在正常区间。`]
    risks = [`等待概率突破或成交异常再行介入。`]
  }

  return { analyst, debate, signal, signalEn, colorVar, confidence, side, size, reasons, risks }
}

const SIZE_PCT: Record<string, number> = {
  '轻仓试探': 15,
  '中性对冲': 25,
  '0': 0,
  '不建仓': 0,
}

function toDirection(signalEn: string): Direction {
  if (signalEn === 'BUY YES') return 'YES'
  if (signalEn === 'BUY NO') return 'NO'
  return 'HOLD' // ARBITRAGE / HOLD
}

export function deterministicVerdict(input: AgentInput): AgentVerdict {
  const a = analyze(input)
  const bullCase = a.debate.filter((d) => d.side === 'bull').map((d) => d.text).join(' ')
  const bearCase = a.debate.filter((d) => d.side === 'bear').map((d) => d.text).join(' ')
  return {
    marketId: input.marketId,
    source: input.source,
    engine: 'deterministic',
    direction: toDirection(a.signalEn),
    sizePct: SIZE_PCT[a.size] ?? 0,
    confidence: a.confidence / 100,
    rationale: a.analyst,
    bullCase,
    bearCase,
    riskNotes: a.risks.join(' '),
    debate: a.debate,
    signal: a.signal,
    signalEn: a.signalEn,
    side: a.side,
    sizeLabel: a.size,
    analyst: a.analyst,
    reasons: a.reasons,
    risks: a.risks,
    colorVar: a.colorVar,
  }
}
