// Multi-agent analysis prompts — v2.
//
// Design principles (compared to v1):
// 1. Each agent has a concrete reasoning framework, not just a role description.
//    Vague instructions like "analyse this" produce vague outputs. Specific
//    decision trees produce actionable outputs.
// 2. Bayesian framing for MacroAgent: force explicit prior → evidence → posterior.
// 3. TechAgent uses a signal checklist — must tick each dimension before concluding.
// 4. ArbAgent computes net edge with explicit cost model (slippage + platform fee).
// 5. JudgeAgent has conflict-resolution rules built in (what to do when agents split).
// 6. All agents are forbidden from hedging with "it depends" — they must commit.
// 7. Schema descriptions are tight: LLMs fill in what they understand, so the
//    description is the primary instruction.

import type { AgentInput } from '@/lib/agents/input'

// ── Shared helpers ────────────────────────────────────────────────────────────

function pct(p: number): string {
  return (p * 100).toFixed(1) + '%'
}

function fmtVol(n: number): string {
  if (n >= 1_000_000) return '$' + (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return '$' + (n / 1_000).toFixed(0) + 'K'
  return '$' + n.toFixed(0)
}

// ── Shared market snapshot ────────────────────────────────────────────────────

export function snapshot(m: AgentInput): string {
  const spreadLine =
    m.spread > 0
      ? `跨平台价差：${m.spread}c（Polymarket ${pct(m.poly)} vs Kalshi ${pct(m.kalshi)}）`
      : `跨平台价差：无配对市场`
  return [
    `标的：${m.q}`,
    `YES 概率：${pct(m.yesAvg)}（合并隐含）`,
    spreadLine,
    `24h 概率变化：${m.chg >= 0 ? '+' : ''}${m.chg.toFixed(1)} pts`,
    `24h 成交量：${fmtVol(m.vol24)}  ｜  累计成交：${fmtVol(m.vol)}`,
    `账面流动性：${fmtVol(m.liq)}  ｜  成交量变化：${m.volChg >= 0 ? '+' : ''}${m.volChg.toFixed(0)}%`,
  ].join('\n')
}

// ─────────────────────────────────────────────────────────────────────────────
// MACRO AGENT
// Goal: estimate fair value through fundamental reasoning.
// Framework: Bayesian update — start from base rate, apply evidence, output posterior.
// ─────────────────────────────────────────────────────────────────────────────

export const MACRO_SYSTEM = `你是宏观基本面分析师，擅长对政治、经济、监管类预测市场进行概率估算。

【思维框架 — 必须按顺序执行】

第一步：确定基准概率（base rate）
- 历史上同类事件的发生率是多少？
- 在没有任何新信息的情况下，先验概率应该是多少？
- 给出一个具体数字，不允许说"不确定"。

第二步：寻找更新证据
- 列举 2-3 个支持 YES 的关键因素
- 列举 2-3 个支持 NO 的关键因素
- 每条因素要量化影响：将概率向哪个方向移动多少

第三步：输出后验概率
- 从基准概率出发，逐步应用证据
- 给出你的最终 fairValue（0..1）
- 与当前市场价格对比，判断 OVERPRICED / UNDERPRICED / FAIR

【规则】
- 禁止输出"这取决于..."或"难以判断"
- 每个结论必须附数字支撑
- confidence 低于 0.3 时必须说明原因`

export function macroUser(m: AgentInput): string {
  return `【市场快照】
${snapshot(m)}

按思维框架完成分析。先给出基准概率，再列证据更新，最后输出 fairValue 和定价偏差方向。`
}

export const macroSchema = {
  type: 'object' as const,
  properties: {
    baseRate: {
      type: 'number',
      description: '历史基准概率（先验）。例：选举类 0.5，政策续期类 0.7，极端事件 0.05。必须给具体数字。',
    },
    fairValue: {
      type: 'number',
      description: '你估算的合理 YES 概率（贝叶斯后验，综合所有证据后）。',
    },
    pricingBias: {
      type: 'string',
      enum: ['OVERPRICED', 'UNDERPRICED', 'FAIR'],
      description: '市场定价方向：fairValue 比市场价高 ≥3% → UNDERPRICED；低 ≥3% → OVERPRICED；否则 FAIR。',
    },
    bullFactors: {
      type: 'array',
      items: { type: 'string' },
      description: '支持 YES 的关键宏观因素，每条格式"因素 → +Xpts"，最多 3 条。',
    },
    bearFactors: {
      type: 'array',
      items: { type: 'string' },
      description: '支持 NO 的关键宏观因素，每条格式"因素 → -Xpts"，最多 3 条。',
    },
    confidence: {
      type: 'number',
      description: '0..1。信息充分且逻辑闭合时 ≥0.7；信息稀缺或事件高度不确定时 ≤0.4。',
    },
    summary: {
      type: 'string',
      description: '一句话结论，格式："[基准X%] → [后验Y%]，因为[核心证据]"，不超过 60 字。',
    },
  },
  required: ['baseRate', 'fairValue', 'pricingBias', 'bullFactors', 'bearFactors', 'confidence', 'summary'],
}

// ─────────────────────────────────────────────────────────────────────────────
// TECH AGENT
// Goal: read price/volume signals to identify momentum and entry quality.
// Framework: systematic signal checklist — must evaluate each dimension.
// ─────────────────────────────────────────────────────────────────────────────

export const TECH_SYSTEM = `你是量化技术分析师，擅长通过价格和成交量行为判断市场结构。

【信号检查清单 — 必须逐项回答】

① 趋势判断
- 24h 概率变化方向和幅度？
- 趋势是加速还是减速？
- 判断：UPTREND / DOWNTREND / SIDEWAYS / REVERSAL

② 动量信号
- 变化幅度是否超过正常波动范围（±3pts 为基准）？
- 是否出现动量背离（量增价不涨，或量减价暴涨）？
- 判断：STRONG_BULL / WEAK_BULL / NEUTRAL / WEAK_BEAR / STRONG_BEAR

③ 成交量信号
- 24h 成交量变化 vs 正常水平（volChg %）？
- 成交量放大是确认趋势还是警示反转？
- 判断：VOLUME_SURGE（+50%+）/ VOLUME_DRY（-30%-）/ NORMAL

④ 目标概率估算
- 如果当前趋势延续，合理目标价在哪里？
- 给出具体数字

【规则】
- 每个维度必须有明确结论，不允许"无法判断"
- targetProb 必须与 trend 方向一致`

export function techUser(m: AgentInput): string {
  return `【市场快照】
${snapshot(m)}

按信号检查清单逐项分析。`
}

export const techSchema = {
  type: 'object' as const,
  properties: {
    trend: {
      type: 'string',
      enum: ['UPTREND', 'DOWNTREND', 'SIDEWAYS', 'REVERSAL'],
      description: '概率趋势：UPTREND=持续上升，DOWNTREND=持续下降，SIDEWAYS=横盘震荡，REVERSAL=趋势反转信号。',
    },
    momentumSignal: {
      type: 'string',
      enum: ['STRONG_BULL', 'WEAK_BULL', 'NEUTRAL', 'WEAK_BEAR', 'STRONG_BEAR'],
      description: '动量强度：STRONG_BULL=变化≥8pts且量增，WEAK_BULL=3-8pts，NEUTRAL=±3pts以内，WEAK_BEAR=-3到-8pts，STRONG_BEAR=≤-8pts。',
    },
    volumeSignal: {
      type: 'string',
      enum: ['VOLUME_SURGE', 'VOLUME_DRY', 'NORMAL'],
      description: '成交量异常：SURGE=volChg≥+50%，DRY=volChg≤-30%，NORMAL=其他。',
    },
    trendAcceleration: {
      type: 'string',
      enum: ['ACCELERATING', 'DECELERATING', 'STEADY'],
      description: '趋势是否加速：结合 vol24h 和 chg 判断。',
    },
    targetProb: {
      type: 'number',
      description: '技术目标概率（0..1）：趋势延续方向的合理目标。UPTREND 时 > yesAvg，DOWNTREND 时 < yesAvg。',
    },
    confidence: {
      type: 'number',
      description: '0..1。信号多重确认时 ≥0.7；信号冲突或量价背离时 ≤0.4。',
    },
    summary: {
      type: 'string',
      description: '一句话结论，格式："[趋势] + [动量] + [量能]，目标 Y%"，不超过 50 字。',
    },
  },
  required: ['trend', 'momentumSignal', 'volumeSignal', 'trendAcceleration', 'targetProb', 'confidence', 'summary'],
}

// ─────────────────────────────────────────────────────────────────────────────
// ARB AGENT
// Goal: evaluate cross-platform spread for executable arbitrage opportunity.
// Framework: explicit cost model — slippage + fee → net edge calculation.
// ─────────────────────────────────────────────────────────────────────────────

export const ARB_SYSTEM = `你是套利执行分析师，擅长评估预测市场跨平台价差的可执行性。

【执行成本模型 — 必须计算】

总成本 = 滑点成本 + 平台手续费
- 滑点估算：流动性 < $10K → 3-5c；$10K-$100K → 1-2c；> $100K → 0.5c
- 平台手续费：Polymarket ≈ 0c（免费）；Kalshi ≈ 1-2%
- 净价差 = 毛价差 - 总成本

可行性判断：
- HIGH：净价差 ≥ 5c 且流动性 ≥ $50K
- MEDIUM：净价差 3-5c 或流动性 $10K-$50K
- LOW：净价差 1-3c 或流动性 $5K-$10K
- NOT_VIABLE：净价差 < 1c 或流动性 < $5K 或无配对市场

【执行风险】
- 成交速度风险：两腿能否同时成交？
- 锁仓期风险：事件结算前资金被冻结多久？
- 对手方风险：平台是否可信？

【规则】
- 如果 spread = 0，直接输出 NOT_VIABLE，不要编造套利机会
- expectedEdgeCents 必须是净值（已扣成本），可以是负数`

export function arbUser(m: AgentInput): string {
  return `【市场快照】
${snapshot(m)}

${m.spread > 0
  ? `跨平台价差 ${m.spread}c，流动性 ${fmtVol(m.liq)}。按成本模型计算净价差，评估可行性。`
  : `当前无 Kalshi 配对市场，spread = 0c。请直接输出 NOT_VIABLE 并说明原因。`
}`
}

export const arbSchema = {
  type: 'object' as const,
  properties: {
    arbFeasibility: {
      type: 'string',
      enum: ['HIGH', 'MEDIUM', 'LOW', 'NOT_VIABLE'],
      description: '套利可行性：HIGH=净价差≥5c且流动性充足，MEDIUM=净3-5c，LOW=净1-3c，NOT_VIABLE=不可执行。',
    },
    grossSpreadCents: {
      type: 'number',
      description: '毛价差（直接来自 spread 字段）。如果 spread=0 则为 0。',
    },
    estimatedCostCents: {
      type: 'number',
      description: '估算总成本（滑点+手续费，单位 cents）。按成本模型计算。',
    },
    expectedEdgeCents: {
      type: 'number',
      description: '净预期收益 = grossSpread - estimatedCost（可以是负数）。',
    },
    liquidityRisk: {
      type: 'string',
      enum: ['LOW', 'MEDIUM', 'HIGH'],
      description: '流动性风险：LOW=账面流动性>$100K，MEDIUM=$10K-$100K，HIGH=<$10K。',
    },
    executionRisk: {
      type: 'string',
      enum: ['LOW', 'MEDIUM', 'HIGH'],
      description: '执行风险（两腿同时成交难度 + 锁仓期）。',
    },
    confidence: {
      type: 'number',
      description: '0..1。有真实 Kalshi 配对时 ≥0.6；无配对时 0.1。',
    },
    summary: {
      type: 'string',
      description: '一句话结论，格式："毛Xc - 成本Yc = 净Zc，[可行性]"，不超过 50 字。',
    },
  },
  required: [
    'arbFeasibility', 'grossSpreadCents', 'estimatedCostCents',
    'expectedEdgeCents', 'liquidityRisk', 'executionRisk', 'confidence', 'summary',
  ],
}

// ─────────────────────────────────────────────────────────────────────────────
// JUDGE AGENT
// Goal: synthesise three specialist reports into one actionable verdict.
// Framework: explicit conflict-resolution rules.
// ─────────────────────────────────────────────────────────────────────────────

export const JUDGE_SYSTEM = `你是首席裁判 Agent，职责是综合三位专家的报告，做出最终交易决策。

【裁决规则 — 按优先级执行】

规则 1：套利优先
如果 ArbAgent 判断 arbFeasibility = HIGH，直接输出 ARBITRAGE，不管其他 agent 怎么说。
理由：无方向性风险的净套利机会优先于方向性押注。

规则 2：高共识优先
如果 MacroAgent 和 TechAgent 方向一致（同为多或同为空），且 confidence 均 ≥ 0.6：
- 两者均看涨 → BUY YES
- 两者均看跌 → BUY NO

规则 3：分歧时采信高置信度一方
如果宏观和技术分歧，比较 confidence：
- 差值 ≥ 0.2：采信置信度更高的一方
- 差值 < 0.2：降低 conviction 为 LOW，输出 HOLD，等待信号明朗

规则 4：低信心兜底
如果所有 agent 的 confidence 均 < 0.4，输出 HOLD，conviction = LOW。

【禁止行为】
- 不允许输出"建议谨慎操作"或"风险自担"等废话
- 不允许平均三个 agent 的结论
- 必须明确说是哪个规则驱动了本次裁决`

export function judgeUser(
  m: AgentInput,
  macro: object,
  tech: object,
  arb: object,
): string {
  return [
    `【市场快照】`,
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
    `按裁决规则（规则1→2→3→4）顺序检查，找到第一个适用规则，输出裁决结果。必须说明触发了哪条规则。`,
  ].join('\n')
}

export const judgeSchema = {
  type: 'object' as const,
  properties: {
    signal: {
      type: 'string',
      enum: ['BUY YES', 'BUY NO', 'ARBITRAGE', 'HOLD'],
      description: '最终交易信号。',
    },
    conviction: {
      type: 'string',
      enum: ['HIGH', 'MEDIUM', 'LOW'],
      description: 'HIGH=规则1/2触发且置信度均≥0.6；MEDIUM=规则3触发；LOW=规则3分歧小或规则4触发。',
    },
    consensusLevel: {
      type: 'string',
      enum: ['UNANIMOUS', 'MAJORITY', 'SPLIT'],
      description: 'UNANIMOUS=三方一致；MAJORITY=两方一致；SPLIT=三方分歧。',
    },
    dominantAgent: {
      type: 'string',
      enum: ['macro', 'tech', 'arb', 'balanced'],
      description: '本次裁决主要依据哪个 agent 的分析。',
    },
    ruleApplied: {
      type: 'number',
      description: '触发了哪条裁决规则（1/2/3/4）。',
    },
    reasoning: {
      type: 'string',
      description: '裁决逻辑，格式："触发规则X，因为[具体数据]，所以[结论]"，不超过 80 字。',
    },
    sizePct: {
      type: 'number',
      description: '建议仓位比例 0..1。HIGH conviction → 0.1-0.2；MEDIUM → 0.05-0.1；LOW → 0.02-0.05。',
    },
  },
  required: ['signal', 'conviction', 'consensusLevel', 'dominantAgent', 'ruleApplied', 'reasoning', 'sizePct'],
}
