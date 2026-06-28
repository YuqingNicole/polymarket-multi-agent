import { describe, it, expect } from 'vitest'
import { deterministicVerdict } from './deterministic'
import type { AgentInput } from './input'

function base(over: Partial<AgentInput> = {}): AgentInput {
  return {
    marketId: 'poly-x',
    source: 'poly',
    q: '某事件？',
    poly: 0.5,
    kalshi: 0.5,
    yesAvg: 0.5,
    chg: 0,
    spread: 0,
    vol24: 1_000_000,
    vol: 10_000_000,
    liq: 500_000,
    volChg: 0,
    ...over,
  }
}

describe('deterministicVerdict decision tree', () => {
  it('flags arbitrage when spread >= 4¢', () => {
    const v = deterministicVerdict(base({ poly: 0.68, kalshi: 0.63, spread: 5, yesAvg: 0.655 }))
    expect(v.signalEn).toBe('ARBITRAGE')
    expect(v.direction).toBe('HOLD')
    expect(v.sizeLabel).toBe('中性对冲')
    expect(v.colorVar).toBe('var(--accent)')
    expect(v.confidence).toBeCloseTo(0.78)
  })

  it('buys YES on strong up momentum below 70%', () => {
    const v = deterministicVerdict(base({ chg: 8, yesAvg: 0.55, spread: 1, volChg: 60 }))
    expect(v.signalEn).toBe('BUY YES')
    expect(v.direction).toBe('YES')
    expect(v.sizePct).toBe(15)
  })

  it('buys NO on down momentum', () => {
    const v = deterministicVerdict(base({ chg: -6, yesAvg: 0.4, spread: 1 }))
    expect(v.signalEn).toBe('BUY NO')
    expect(v.direction).toBe('NO')
  })

  it('holds when richly priced (>=78%)', () => {
    const v = deterministicVerdict(base({ yesAvg: 0.82, chg: 1, spread: 1 }))
    expect(v.signalEn).toBe('HOLD')
    expect(v.sizePct).toBe(0)
  })

  it('holds by default with no edge', () => {
    const v = deterministicVerdict(base({ yesAvg: 0.5, chg: 1, spread: 1 }))
    expect(v.signalEn).toBe('HOLD')
    expect(v.confidence).toBeCloseTo(0.48)
  })

  it('produces a 6-turn bull/bear debate and presentation fields', () => {
    const v = deterministicVerdict(base({ chg: 8, yesAvg: 0.55, spread: 1 }))
    expect(v.debate).toHaveLength(6)
    expect(v.debate[0].side).toBe('bull')
    expect(v.reasons.length).toBeGreaterThan(0)
    expect(v.risks.length).toBeGreaterThan(0)
    expect(v.analyst).toContain('合并 YES 隐含概率')
  })
})
