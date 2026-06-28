// Polymarket data access: REST fetch over the Gamma API and a realtime
// WebSocket client over the CLOB market channel.

import WebSocket from 'ws'
import { config } from '@/lib/config'
import type { MarketMeta, MarketTick } from '@/lib/types'
import { normalizePolyMarket } from './normalize'

export interface FetchPolyMarketsOpts {
  limit?: number
  fetchImpl?: typeof fetch
}

export async function fetchPolyMarkets(
  opts: FetchPolyMarketsOpts = {},
): Promise<MarketMeta[]> {
  const limit = opts.limit ?? 100
  const f = opts.fetchImpl ?? fetch
  const url = `${config.POLYMARKET_GAMMA_URL}/markets?closed=false&limit=${limit}`

  const res = await f(url)
  if (!res.ok) {
    throw new Error(`Polymarket markets fetch failed: ${res.status}`)
  }
  const data = await res.json()
  const list: any[] = Array.isArray(data) ? data : (data?.data ?? [])
  return list.map(normalizePolyMarket)
}

// fetchPolyTick derives yesProb from outcomePrices[0] on the market object.
// Polymarket's Gamma market carries the latest prices, so a tick can be read
// straight off the market meta JSON without a separate endpoint.
export async function fetchPolyTick(market: any): Promise<MarketTick> {
  const outcomePrices = parseStringArray(market?.outcomePrices)
  const yesProb = clamp01(Number(outcomePrices[0] ?? 0))

  return {
    source: 'poly',
    marketId: String(market?.conditionId ?? ''),
    yesProb: Number.isFinite(yesProb) ? yesProb : 0,
    volume24h: numberOr(market?.volume24hr, 0),
    volumeTotal: numberOr(market?.volume, 0),
    ts: new Date().toISOString(),
  }
}

function parseStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String)
  if (typeof value === 'string' && value.trim() !== '') {
    try {
      const p = JSON.parse(value)
      if (Array.isArray(p)) return p.map(String)
    } catch {
      /* ignore */
    }
  }
  return []
}

function numberOr(v: unknown, fallback: number): number {
  const n = typeof v === 'string' ? Number(v) : (v as number)
  return Number.isFinite(n) ? n : fallback
}

function clamp01(p: number): number {
  if (!Number.isFinite(p)) return 0
  return p < 0 ? 0 : p > 1 ? 1 : p
}

// --- WebSocket client ------------------------------------------------------

export interface PolyWsClientOpts {
  // Maps a CLOB token id (asset_id) back to our normalized marketId.
  tokenToMarketId: Record<string, string>
  onTick: (tick: MarketTick) => void
  url?: string
  // Injectable socket factory for testing.
  wsFactory?: (url: string) => MinimalSocket
}

// Minimal surface of a ws WebSocket that we depend on, so tests can inject a
// fake socket without a real network connection.
export interface MinimalSocket {
  on(event: 'open', cb: () => void): void
  on(event: 'message', cb: (data: any) => void): void
  on(event: 'close', cb: () => void): void
  on(event: 'error', cb: (err: any) => void): void
  send(data: string): void
  ping?(): void
  pong(): void
  close(): void
}

export class PolyWsClient {
  private readonly tokenToMarketId: Record<string, string>
  private readonly onTick: (tick: MarketTick) => void
  private readonly url: string
  private readonly wsFactory: (url: string) => MinimalSocket

  private socket: MinimalSocket | null = null
  private reconnectAttempts = 0
  private heartbeatTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private stopped = false

  // Server pings every ~5s; we must reply with pong within 10s. If no ping
  // is seen within this window we assume the connection is dead and reconnect.
  private readonly heartbeatWindowMs = 10_000

  constructor(opts: PolyWsClientOpts) {
    this.tokenToMarketId = opts.tokenToMarketId
    this.onTick = opts.onTick
    this.url = opts.url ?? config.POLYMARKET_WS_URL
    this.wsFactory =
      opts.wsFactory ?? ((u) => new WebSocket(u) as unknown as MinimalSocket)
  }

  start(): void {
    this.stopped = false
    this.connect()
  }

  stop(): void {
    this.stopped = true
    this.clearHeartbeat()
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.socket) {
      try {
        this.socket.close()
      } catch {
        /* ignore */
      }
      this.socket = null
    }
  }

  private connect(): void {
    const socket = this.wsFactory(this.url)
    this.socket = socket

    socket.on('open', () => {
      this.reconnectAttempts = 0
      this.subscribe()
      this.armHeartbeat()
    })

    socket.on('message', (data: any) => this.handleMessage(data))

    socket.on('close', () => this.scheduleReconnect())
    socket.on('error', () => {
      // error is typically followed by close; ensure reconnect happens.
      this.scheduleReconnect()
    })
  }

  private subscribe(): void {
    const assets_ids = Object.keys(this.tokenToMarketId)
    this.socket?.send(JSON.stringify({ assets_ids, type: 'market' }))
  }

  private handleMessage(raw: any): void {
    // Any inbound traffic counts as liveness; re-arm the heartbeat window.
    this.armHeartbeat()

    const text = typeof raw === 'string' ? raw : raw?.toString?.() ?? ''
    if (text === '' ) return

    // Server-level ping comes through as the literal "PING"; reply pong.
    if (text === 'PING' || text === 'ping') {
      this.socket?.pong()
      return
    }

    let parsed: any
    try {
      parsed = JSON.parse(text)
    } catch {
      return
    }

    // Messages can arrive as a single event or an array of events.
    const events: any[] = Array.isArray(parsed) ? parsed : [parsed]
    for (const ev of events) this.handleEvent(ev)
  }

  private handleEvent(ev: any): void {
    const type = ev?.event_type
    const assetId = ev?.asset_id
    if (!assetId) return
    const marketId = this.tokenToMarketId[assetId]
    if (!marketId) return

    let price: number | null = null

    if (type === 'book') {
      // Derive a midpoint from best bid/ask in the order book.
      const bestBid = topOfBook(ev?.bids, 'max')
      const bestAsk = topOfBook(ev?.asks, 'min')
      if (bestBid != null && bestAsk != null) price = (bestBid + bestAsk) / 2
      else price = bestBid ?? bestAsk
    } else if (type === 'price_change') {
      const bid = numOrNull(ev?.best_bid)
      const ask = numOrNull(ev?.best_ask)
      if (bid != null && ask != null) price = (bid + ask) / 2
      else price = numOrNull(ev?.price) ?? bid ?? ask
    } else if (type === 'last_trade_price') {
      price = numOrNull(ev?.price)
    } else {
      return
    }

    if (price == null) return

    this.onTick({
      source: 'poly',
      marketId,
      yesProb: clamp01(price),
      // Per-tick stream does not carry volume; leave 0, callers merge with meta.
      volume24h: 0,
      volumeTotal: 0,
      ts: new Date().toISOString(),
    })
  }

  private armHeartbeat(): void {
    this.clearHeartbeat()
    this.heartbeatTimer = setTimeout(() => {
      // No ping/message within the window: connection presumed dead.
      if (this.socket) {
        try {
          this.socket.close()
        } catch {
          /* ignore */
        }
      }
      this.scheduleReconnect()
    }, this.heartbeatWindowMs)
  }

  private clearHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearTimeout(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  private scheduleReconnect(): void {
    this.clearHeartbeat()
    this.socket = null
    if (this.stopped) return
    if (this.reconnectTimer) return

    // Exponential backoff capped at 30s.
    const delay = Math.min(30_000, 500 * 2 ** this.reconnectAttempts)
    this.reconnectAttempts += 1
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      if (!this.stopped) this.connect()
    }, delay)
  }
}

function numOrNull(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v) : (v as number)
  return Number.isFinite(n) ? n : null
}

// Order book levels look like [{ price, size }, ...]. Pick best bid (max) or
// best ask (min) price.
function topOfBook(levels: any, side: 'max' | 'min'): number | null {
  if (!Array.isArray(levels) || levels.length === 0) return null
  let best: number | null = null
  for (const lvl of levels) {
    const p = numOrNull(lvl?.price)
    if (p == null) continue
    if (best == null) best = p
    else if (side === 'max') best = Math.max(best, p)
    else best = Math.min(best, p)
  }
  return best
}
