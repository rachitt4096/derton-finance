import type { BrokerStatusSnapshot, BrokerTick } from '../lib/contracts.js'

export interface BrokerAdapter {
  connect(): Promise<void>
  disconnect(): Promise<void>
  subscribe(symbols: string[]): Promise<void>
  unsubscribe(symbols: string[]): Promise<void>
  getStatus(): BrokerStatusSnapshot
  onTick(handler: (tick: BrokerTick) => void): void
  onStatusChange(handler: (status: BrokerStatusSnapshot) => void): void
}
