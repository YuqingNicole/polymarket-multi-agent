import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  normalizePolyMarket,
  normalizePolyTick,
  normalizeKalshiMarket,
  normalizeKalshiTick,
} from './normalize'
import { fetchPolyMarkets, fetchPolyTick, PolyWsClient } from './polymarket'
import {
  fetchKalshiMarkets,
  fetchKalshiTick,
  KalshiPoller,
} from './kalshi'
import type { MarketTick } from '@/lib/types'

import polyMarket from './__fixtures__/poly-market.json'
import kalshiCents from './__fixtures__/kalshi-market-cents.json'
import kalshiDollars from './__fixtures__/kalshi-market-dollars.json'

function fakeResponse(body: unknown, init?: { ok?: boolean; status?: number }) {
  return {
    ok: init?.ok ?? true,
    status: init?.status ?? 200,
    json: async () => body,
  } as Response
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('normalizePolyMarket', () => {
  it('parses stringified outcomes and clobTokenIds arrays', () => {
    const meta = normalizePolyMarket(polyMarket)
    expect(meta).toMatchObject({
      source: 'poly',
      marketId: '0xabc123condition',
      title: 'Will it rain in NYC on July 4, 2026?',
      category: 'Weather',
      endDate: '2026-07-04T23:59:59Z',
      outcomes: ['Yes', 'No'],
    })
    expect(meta.polyClobTokenIds).toEqual(['111111111', '222222222'])
  })

  it('defaults category to null and outcomes to Yes/No when missing', () => {
    const meta = normalizePolyMarket({ conditionId: 'c1', question: 'Q' })
    expect(meta.category).toBeNull()
    expect(meta.endDate).toBeNull()
    expect(meta.outcomes).toEqual(['Yes', 'No'])
    expect(meta.polyClobTokenIds).toBeUndefined()
  })
})

describe('normalizePolyTick', () => {
  it('uses outcomePrices[0] as yesProb and parses numeric strings', () => {
    const tick = normalizePolyTick(polyMarket)
    expect(tick.source).toBe('poly')
    expect(tick.marketId).toBe('0xabc123condition')
    expect(tick.yesProb).toBeCloseTo(0.62, 5)
    expect(tick.volume24h).toBeCloseTo(84000.25, 2)
    expect(tick.volumeTotal).toBeCloseTo(1500000.5, 2)
    expect(tick.yesProb).toBeGreaterThanOrEqual(0)
    expect(tick.yesProb).toBeLessThanOrEqual(1)
    expect(() => new Date(tick.ts).toISOString()).not.toThrow()
  })
})

describe('normalizeKalshiMarket', () => {
  it('maps ticker/title/event_ticker', () => {
    const meta = normalizeKalshiMarket(kalshiCents)
    expect(meta).toMatchObject({
      source: 'kalshi',
      marketId: 'RAINNYC-26JUL04',
      title: 'Will it rain in NYC on July 4, 2026?',
      category: 'Weather',
      endDate: '2026-07-04T23:59:59Z',
      outcomes: ['Yes', 'No'],
      kalshiEventTicker: 'RAINNYC',
    })
  })
})

describe('normalizeKalshiTick', () => {
  it('treats values > 1.5 as cents and divides by 100', () => {
    const tick = normalizeKalshiTick(kalshiCents)
    // (60 + 64) / 2 = 62 cents -> 0.62
    expect(tick.yesProb).toBeCloseTo(0.62, 5)
    expect(tick.yesProb).toBeGreaterThanOrEqual(0)
    expect(tick.yesProb).toBeLessThanOrEqual(1)
    expect(tick.volume24h).toBe(12000)
    expect(tick.volumeTotal).toBe(250000)
  })

  it('treats dollar fields as probabilities directly', () => {
    const tick = normalizeKalshiTick(kalshiDollars)
    // (0.41 + 0.45) / 2 = 0.43
    expect(tick.yesProb).toBeCloseTo(0.43, 5)
    expect(tick.yesProb).toBeLessThanOrEqual(1)
  })

  it('falls back to last_price when bid/ask absent', () => {
    const tick = normalizeKalshiTick({
      ticker: 'X',
      last_price: 77,
      volume: 1,
      volume_24h: 1,
    })
    expect(tick.yesProb).toBeCloseTo(0.77, 5)
  })

  it('yields 0 yesProb when no price data at all', () => {
    const tick = normalizeKalshiTick({ ticker: 'X' })
    expect(tick.yesProb).toBe(0)
  })
})

describe('fetchPolyMarkets', () => {
  it('GETs the gamma markets endpoint and normalizes the list', async () => {
    const fetchImpl = vi.fn(async (url: any) => {
      expect(String(url)).toContain('/markets?closed=false&limit=5')
      return fakeResponse([polyMarket])
    }) as unknown as typeof fetch

    const out = await fetchPolyMarkets({ limit: 5, fetchImpl })
    expect(out).toHaveLength(1)
    expect(out[0].marketId).toBe('0xabc123condition')
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it('throws on non-ok response', async () => {
    const fetchImpl = vi.fn(async () =>
      fakeResponse(null, { ok: false, status: 500 }),
    ) as unknown as typeof fetch
    await expect(fetchPolyMarkets({ fetchImpl })).rejects.toThrow(/500/)
  })
})

describe('fetchPolyTick', () => {
  it('derives a tick from a market object', async () => {
    const tick = await fetchPolyTick(polyMarket)
    expect(tick.yesProb).toBeCloseTo(0.62, 5)
    expect(tick.marketId).toBe('0xabc123condition')
  })
})

describe('fetchKalshiMarkets', () => {
  it('GETs the kalshi markets endpoint and normalizes', async () => {
    const fetchImpl = vi.fn(async (url: any) => {
      expect(String(url)).toContain('/markets?status=open&limit=3')
      return fakeResponse({ markets: [kalshiCents] })
    }) as unknown as typeof fetch

    const out = await fetchKalshiMarkets({ limit: 3, fetchImpl })
    expect(out).toHaveLength(1)
    expect(out[0].marketId).toBe('RAINNYC-26JUL04')
  })

  it('throws on non-ok response', async () => {
    const fetchImpl = vi.fn(async () =>
      fakeResponse(null, { ok: false, status: 403 }),
    ) as unknown as typeof fetch
    await expect(fetchKalshiMarkets({ fetchImpl })).rejects.toThrow(/403/)
  })
})

describe('fetchKalshiTick', () => {
  it('re-exports the normalizer behavior', () => {
    expect(fetchKalshiTick(kalshiCents).yesProb).toBeCloseTo(0.62, 5)
  })
})

// --- Fake socket for PolyWsClient -----------------------------------------

type Handler = (...args: any[]) => void

class FakeSocket {
  handlers: Record<string, Handler[]> = {}
  sent: string[] = []
  pongCount = 0
  closed = false

  on(event: string, cb: Handler) {
    ;(this.handlers[event] ??= []).push(cb)
  }
  emit(event: string, ...args: any[]) {
    for (const cb of this.handlers[event] ?? []) cb(...args)
  }
  send(data: string) {
    this.sent.push(data)
  }
  pong() {
    this.pongCount += 1
  }
  close() {
    this.closed = true
  }
}

describe('PolyWsClient', () => {
  it('subscribes with assets_ids on open and emits ticks for known tokens', () => {
    const sockets: FakeSocket[] = []
    const ticks: MarketTick[] = []
    const client = new PolyWsClient({
      tokenToMarketId: { 'tok-yes': 'mkt-1' },
      onTick: (t) => ticks.push(t),
      wsFactory: () => {
        const s = new FakeSocket()
        sockets.push(s)
        return s as any
      },
    })
    client.start()
    const s = sockets[0]
    s.emit('open')

    expect(s.sent).toHaveLength(1)
    const sub = JSON.parse(s.sent[0])
    expect(sub.type).toBe('market')
    expect(sub.assets_ids).toEqual(['tok-yes'])

    // last_trade_price event
    s.emit(
      'message',
      JSON.stringify({
        event_type: 'last_trade_price',
        asset_id: 'tok-yes',
        price: '0.71',
      }),
    )
    expect(ticks).toHaveLength(1)
    expect(ticks[0].marketId).toBe('mkt-1')
    expect(ticks[0].yesProb).toBeCloseTo(0.71, 5)

    // price_change with best bid/ask -> midpoint
    s.emit(
      'message',
      JSON.stringify({
        event_type: 'price_change',
        asset_id: 'tok-yes',
        best_bid: '0.60',
        best_ask: '0.64',
      }),
    )
    expect(ticks[1].yesProb).toBeCloseTo(0.62, 5)

    // book event -> midpoint of top of book
    s.emit(
      'message',
      JSON.stringify({
        event_type: 'book',
        asset_id: 'tok-yes',
        bids: [{ price: '0.50', size: '10' }, { price: '0.55', size: '5' }],
        asks: [{ price: '0.65', size: '3' }, { price: '0.70', size: '2' }],
      }),
    )
    // best bid 0.55, best ask 0.65 -> 0.60
    expect(ticks[2].yesProb).toBeCloseTo(0.6, 5)

    client.stop()
    expect(s.closed).toBe(true)
  })

  it('ignores events for unknown tokens', () => {
    const sockets: FakeSocket[] = []
    const ticks: MarketTick[] = []
    const client = new PolyWsClient({
      tokenToMarketId: { known: 'mkt-1' },
      onTick: (t) => ticks.push(t),
      wsFactory: () => {
        const s = new FakeSocket()
        sockets.push(s)
        return s as any
      },
    })
    client.start()
    sockets[0].emit('open')
    sockets[0].emit(
      'message',
      JSON.stringify({ event_type: 'last_trade_price', asset_id: 'other', price: '0.5' }),
    )
    expect(ticks).toHaveLength(0)
    client.stop()
  })

  it('replies pong to server PING', () => {
    const sockets: FakeSocket[] = []
    const client = new PolyWsClient({
      tokenToMarketId: {},
      onTick: () => {},
      wsFactory: () => {
        const s = new FakeSocket()
        sockets.push(s)
        return s as any
      },
    })
    client.start()
    sockets[0].emit('open')
    sockets[0].emit('message', 'PING')
    expect(sockets[0].pongCount).toBe(1)
    client.stop()
  })

  it('reconnects with backoff after close', () => {
    vi.useFakeTimers()
    const sockets: FakeSocket[] = []
    const client = new PolyWsClient({
      tokenToMarketId: {},
      onTick: () => {},
      wsFactory: () => {
        const s = new FakeSocket()
        sockets.push(s)
        return s as any
      },
    })
    client.start()
    expect(sockets).toHaveLength(1)
    sockets[0].emit('open')
    sockets[0].emit('close')
    // first backoff = 500ms
    vi.advanceTimersByTime(500)
    expect(sockets).toHaveLength(2)
    client.stop()
  })
})

describe('KalshiPoller', () => {
  it('emits markets and ticks on each poll', async () => {
    vi.useFakeTimers()
    const ticks: MarketTick[] = []
    const marketBatches: any[] = []
    const fetchImpl = vi.fn(async () =>
      fakeResponse({ markets: [kalshiCents] }),
    ) as unknown as typeof fetch

    const poller = new KalshiPoller({
      onTick: (t) => ticks.push(t),
      onMarkets: (m) => marketBatches.push(m),
      pollMs: 1000,
      fetchImpl,
    })
    poller.start()
    await vi.advanceTimersByTimeAsync(0) // flush immediate poll
    expect(ticks).toHaveLength(1)
    expect(marketBatches).toHaveLength(1)
    expect(ticks[0].marketId).toBe('RAINNYC-26JUL04')

    await vi.advanceTimersByTimeAsync(1000) // next poll
    expect(ticks).toHaveLength(2)
    poller.stop()
  })

  it('backs off on 429', async () => {
    vi.useFakeTimers()
    const fetchImpl = vi.fn(async () =>
      fakeResponse(null, { ok: false, status: 429 }),
    ) as unknown as typeof fetch

    const poller = new KalshiPoller({
      onTick: () => {},
      pollMs: 1000,
      fetchImpl,
    })
    poller.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchImpl).toHaveBeenCalledTimes(1)

    // backoff after first 429 = pollMs * 2 = 2000ms; not yet at 1000ms
    await vi.advanceTimersByTimeAsync(1000)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1000)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    poller.stop()
  })
})
