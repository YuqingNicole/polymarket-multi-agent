import { EventEmitter } from 'node:events'
import type { MarketTick, Signal } from '@/lib/types'

// In-memory pub/sub bridging the ingestion worker to SSE subscribers.
export interface BusEvents {
  tick: (t: MarketTick) => void
  signals: (s: Signal[]) => void
}

class Bus extends EventEmitter {}

const globalForBus = globalThis as unknown as { augurBus?: Bus }
export const bus = globalForBus.augurBus ?? new Bus()
bus.setMaxListeners(100)
if (process.env.NODE_ENV !== 'production') globalForBus.augurBus = bus
