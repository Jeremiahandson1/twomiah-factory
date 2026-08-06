// Shipping-carrier provider contract. Mirrors payments/types.ts and
// suppliers/types.ts: credentials are decrypted just-in-time and never leave
// the server.
import type { Address } from '../../db/schema.ts'

export type ShippingCredentials = {
  apiKey: string
  mode: 'test' | 'live'
}

export type Parcel = {
  lengthIn: number
  widthIn: number
  heightIn: number
  weightOz: number
}

export type RateQuote = {
  id: string
  carrier: string
  service: string
  amountCents: number
  currency: string
  estimatedDays?: number | null
}

export type BoughtLabel = {
  carrier: string
  service?: string
  trackingCode: string
  labelUrl: string
  costCents: number
  shipmentId?: string
}

export interface ShippingProvider {
  readonly name: 'easypost'
  /** Quotes for a parcel going from -> to. */
  getRates(input: { from: Address; to: Address; parcel: Parcel }): Promise<RateQuote[]>
  /** Buy one of those rates (or the cheapest, when rateId is omitted). */
  buyLabel(input: { from: Address; to: Address; parcel: Parcel; rateId?: string }): Promise<BoughtLabel>
}
