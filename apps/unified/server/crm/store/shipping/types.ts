// Moved from templates/crm-store/backend/src/shipping/types.ts (docs/UNIFIED_STORE_PLAN.md).
// Shipping-carrier provider contract. Mirrors payments/types.ts and
// suppliers/types.ts: credentials are decrypted just-in-time and never leave
// the server.
import type { StoreAddress as Address } from '../../../db/schema/store.ts'

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
  /**
   * Void a label bought on this shipment: the carrier is asked to refund the postage. A label the carrier has scanned
   * cannot be voided — that is the carrier's refusal, passed on as it is said.
   */
  voidLabel(shipmentId: string): Promise<VoidedLabel>
}

/** The carrier's answer to a void: submitted (USPS takes some weeks to pay it back), refunded, or rejected. */
export type VoidedLabel = { refundStatus: 'submitted' | 'refunded' | 'rejected' | string }
