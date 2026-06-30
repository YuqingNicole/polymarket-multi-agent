// Multi-agent analysis prompts.
// Three specialist agents run in parallel; a judge agent synthesises their reports.

import type { AgentInput } from '@/lib/agents/input'

// ── Shared market snapshot ───────────────────────────────────────────────────

function pct(p: number): string {
  return (p * 100).toFixed(1) + '%'
}

function fmtVol(n: number): string {
  if (n >= 1_000_000) return '$' + (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return '$' + (n / 1_000).toFixed(0) + 'K'
  return '$' + n.toFixed(0)
}

export function snapshot(m: AgentInput): string {
  return [
    `标的：${m.q}`,
    `Polymarket YES：${pct(m.poly)}`,
    `Kalshi YES：${pct(m.kalshi)}`,
    `合并 YES 隐含概率：${Math.round(m.yesAvg * 100)}%`,
    `跨平台价差：${m.spread}c`,
    `24h 概率变化：${m.chg >= 0 ? '+' : ''}${m.chg.toFixed(1)} pts`,
    `24h 成交量：${fmtVol(m.vol24)}`,
    `流动性：${fmtVol(m.liq)}`,
    `成交量变化：${m.volChg >= 0 ? '+' : ''}${m.volChg.toFixed(0)}%`,
  ].join('\n')
}

// ── Macro Agent ──────────────────────────────────────────────────────────────

export const MACRO_SYSTEM = `你是宏观分析师 Agent，专注于预测市场的基本面和背景分析。
你的职责：
1. 评估事件的历史基准概率（base rate）
2. 分析相关宏观政策、监管、地缘政治因素
3. 判断当前市场定价是否合理，偏高或偏低
4. 输出你对 YES 概率的独立估算

保持客观，给出明确的概率判断，用数据和逻辑支撑结论。`

export function macroUser(m: AgentInput): string {
  return `【市场数据】\n${snapshot(m)}\n\n从宏观和基本面角度分析这个预测市场，给出你的评估。`
}

export const macroSchema = {
  type: 'object' as const,
  properties: {
    baseRate: { type: 'number', description: '历史基准概率估算 0..1' },
    fairValue: { type: 'number', description: '你认为合理的 YES 概率 0..1' },
    pricingBias: {
      type: 'string',
      enum: ['OVERPRICED', 'UNDERPRICED', 'FAIR'],
      description: '市场定价偏差方向',
    },
    keyFactors: {
      type: 'array',
      items: { type: 'string' },
      description: '影响概率的关键宏观因素（最多 3 条）',
    },
    confidence: { type: 'number', description: '0..1 对本分析的置信度' },
    summary: { type: 'string', description: '50 字以内的核心结论' },
  },
  required: ['baseRate', 'fairValue', 'pricingBias', 'keyFactors', 'confidence', 'summary'],
}

// ── Tech Agent ───────────────────────────────────────────────────────────────

export const TECH_SYSTEM = `你是技术分析师 Agent，专注于预测市场的价格走势和量价形态分析。
你的职责：
1. 分析概率趋势（上升/下降/震荡）
2. 解读成交量信号（放量/缩量/异常）
3. 识别动量特征和反转信号
4. 评估当前趋势的持续性

用量化视角看待市场，关注价格行为本身。`

export function techUser(m: AgentInput): string {
  return `【市场数据】\n${snapshot(m)}\n\n从技术面和量价形态角度分析这个市场，给出你的评估。`
}

export const techSchema = {
  type: 'object' as const,
  properties: {
    trend: {
      type: 'string',
      enum: ['UPTREND', 'DOWNTREND', 'SIDEWAYS', 'REVERSAL'],
      description: '当前概率趋势',
    },
    momentumSignal: {
      type: 'string',
      enum: ['STRONG_BULL', 'WEAK_BULL', 'NEUTRAL', 'WEAK_BEAR', 'STRONG_BEAR'],
      description: '动量信号',
    },
    volumeSignal: {
      type: 'string',
      enum: ['VOLUME_SURGE', 'VOLUME_DRY', 'NORMAL'],
      description: '成交量信号',
    },
    targetProb: { type: 'number', description: '基于趋势的目标概率估算 0..1' },
    confidence: { type: 'number', description: '0..1 对本分析的置信度' },
    summary: { type: 'string', description: '50 字以内的核心结论' },
  },
  required: ['trend', 'momentumSignal', 'volumeSignal', 'targetProb', 'confidence', 'summary'],
}

// ── Arb Agent ────────────────────────────────────────────────────────────────

export const ARB_SYSTEM = `你是套利分析师 Agent，专注于识别和评估预测市场的套利机会。
你的职责：
1. 评估跨平台价差的可执行性（是否值得套利）
2. 分析流动性风险（能否足量成交）
3. 估算套利的预期收益和风险
4. 给出明确的套利可行性评级

用风险收益比思考，不要被表面价差迷惑。`

export function arbUser(m: AgentInput): string {
  return `【市场数据】\n${snapshot(m)}\n\n从套利角度分析这个市场机会，评估套利可行性。`
}

export const arbSchema = {
  type: 'object' as const,
  properties: {
    arbFeasibility: {
      type: 'string',
      enum: ['HIGH', 'MEDIUM', 'LOW', 'NOT_VIABLE'],
      description: '套利可行性评级',
    },
    expectedEdgeCents: { type: 'number', description: '扣除滑点后的预期净价差（cents）' },
    liquidityRisk: {
      type: 'string',
      enum: ['LOW', 'MEDIUM', 'HIGH'],
      description: '流动性风险',
    },
    executionNotes: { type: 'string', description: '执行注意事项（50 字以内）' },
    confidence: { type: 'number', description: '0..1 对本分析的置信度' },
    summary: { type: 'string', description: '50 字以内的核心结论' },
  },
  required: [
    'arbFeasibility',
    'expectedEdgeCents',
    'liquidityRisk',
    'executionNotes',
    'confidence',
    'summary',
  ],
}

// ── Judge Agent ───────────────────────────────────────────────────────────────

export const JUDGE_SYSTEM = `你是裁判 Agent，综合多位专家的分析报告，做出最终投资决策。
你会收到宏观分析师、技术分析师、套利分析师三份独立报告。
你的职责：
1. 评估三份报告的一致性和分歧点
2. 识别哪个 agent 的分析最可信（基于置信度和逻辑）
3. 综合判断，给出最终交易信号
4. 说明你的裁决理由

不要平均化，要有主见。如果三个 agent 分歧大，要明确说为什么采信哪方。`

export function judgeUser(
  m: AgentInput,
  macro: object,
  tech: object,
  arb: object,
): string {
  return [
    `【市场数据】`,
    snapshot(m),
    ``,
    `【宏观分析师报告】`,
    JSON.stringify(macro, null, 2),
    ``,
    `【技术分析师报告】`,
    JSON.stringify(tech, null, 2),
    ``,
    `【套利分析师报告】`,
    JSON.stringify(arb, null, 2),
    ``,
    `请综合以上三份报告，做出最终裁决。`,
  ].join('\n')
}

export const judgeSchema = {
  type: 'object' as const,
  properties: {
    signal: {
      type: 'string',
      enum: ['BUY YES', 'BUY NO', 'ARBITRAGE', 'HOLD'],
      description: '最终交易信号',
    },
    conviction: {
      type: 'string',
      enum: ['HIGH', 'MEDIUM', 'LOW'],
      description: '决策置信度',
    },
    consensusLevel: {
      type: 'string',
      enum: ['UNANIMOUS', 'MAJORITY', 'SPLIT'],
      description: '三个 agent 的一致程度',
    },
    dominantAgent: {
      type: 'string',
      enum: ['macro', 'tech', 'arb', 'balanced'],
      description: '本次裁决主要采信哪个 agent',
    },
    reasoning: { type: 'string', description: '裁决理由（100 字以内）' },
    sizePct: { type: 'number', description: '建议仓位比例 0..1' },
  },
  required: ['signal', 'conviction', 'consensusLevel', 'dominantAgent', 'reasoning', 'sizePct'],
}
