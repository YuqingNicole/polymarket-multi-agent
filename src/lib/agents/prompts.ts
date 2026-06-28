import { fmtVol, pct } from '@/lib/seed/prototype'
import type { AgentInput } from './input'

// Prompt builders for the LLM multi-agent pipeline. Output is Chinese to match
// the terminal UI. The market snapshot block is shared by every stage.

export function snapshot(m: AgentInput): string {
  return [
    `标的：${m.q}`,
    `Polymarket YES：${pct(m.poly)}`,
    `Kalshi YES：${pct(m.kalshi)}`,
    `合并 YES 隐含概率：${Math.round(m.yesAvg * 100)}%`,
    `24h 概率变化：${m.chg >= 0 ? '+' : ''}${m.chg} pts`,
    `跨平台价差：${m.spread}¢`,
    `24h 成交：${fmtVol(m.vol24)}`,
    `累计成交：${fmtVol(m.vol)}`,
    `簿内流动性：${fmtVol(m.liq)}`,
    `24h 成交变化：${m.volChg >= 0 ? '+' : ''}${m.volChg}%`,
  ].join('\n')
}

export const ANALYST_SYSTEM =
  '你是预测市场的量化分析师，隶属一个模仿 TradingAgents 的多智能体系统。' +
  '基于给定的跨平台行情数据做结构化分析。只输出 JSON，不要多余文字。所有文本用简体中文。'

export function analystUser(m: AgentInput): string {
  return (
    `${snapshot(m)}\n\n` +
    '请输出 JSON：{"analyst": "一句话综述（覆盖合并概率、24h 变化方向与幅度、合并成交、两平台价差及是否存在套利空间）", ' +
    '"bull": ["看多论据1（动量/资金流）", "看多论据2（成交结构）", "看多论据3（估值或跨市场）"], ' +
    '"bear": ["看空论据1（估值约束）", "看空论据2（流动性/滑点）", "看空论据3（价差性质或反转风险）"]}'
  )
}

export const TRADER_SYSTEM =
  '你是该多智能体系统的交易员兼风控官。综合分析师综述与多空辩论，给出结构化的可执行判断。' +
  '只输出 JSON，所有文本用简体中文。'

export function traderUser(m: AgentInput, analyst: string, bull: string[], bear: string[]): string {
  return (
    `${snapshot(m)}\n\n` +
    `分析师综述：${analyst}\n` +
    `看多论据：${bull.map((b, i) => `(${i + 1}) ${b}`).join(' ')}\n` +
    `看空论据：${bear.map((b, i) => `(${i + 1}) ${b}`).join(' ')}\n\n` +
    '请给出最终判断，输出 JSON：' +
    '{"signalEn": "BUY YES|BUY NO|ARBITRAGE|HOLD", ' +
    '"signal": "对应中文标签：买入 YES|买入 NO|套利|观望", ' +
    '"side": "建议方向文本（如 YES / NO / 不建仓 / Kalshi 买 YES,Poly 卖 YES）", ' +
    '"sizeLabel": "建议仓位文本（如 轻仓试探 / 中性对冲 / 0）", ' +
    '"sizePct": 0到100的数字, ' +
    '"confidence": 0到1之间的小数, ' +
    '"reasons": ["核心理由1", "核心理由2", "核心理由3"], ' +
    '"risks": ["风控提示1", "风控提示2"]}。' +
    '判断原则：价差≥4¢ 优先套利对冲；24h 上行≥5pts 且概率<70% 倾向买入 YES；下行≥5pts 倾向买入 NO；' +
    '概率≥78% 或无明确边际信息时观望。'
  )
}
