// Provider-agnostic dropship-supplier adapter interface.
//
// Mirrors src/payments/types.ts: every supplier (Printful now; CJ Dropshipping
// written, pending live verification) implements this shape so the forwarding
// hook and webhook receiver never branch on provider. The store forwards a paid
// order to the supplier with the buyer's shipping address; the supplier ships
// and tracking flows back (webhook where supported, sweep-poll otherwise).
import type { Address } from '../../db/schema.ts'

export type SupplierCredentials = {
  // printful: apiKey = private token. cj: apiKey = CJ API key, accountEmail = CJ account email.
  apiKey: string
  accountEmail?: string
  mode?: 'test' | 'live'
  // URL-embedded shared secret for providers without signed webhooks (Printful).
  webhookToken?: string
}

export type SupplierOrderItem = {
  supplierVariantRef: string // provider-side variant id the merchant linked
  quantity: number
  name: string
  sku: string
}

export type PlaceOrderInput = {
  // Our order id — sent as the supplier-side external reference so webhooks
  // and dashboards correlate.
  externalId: string
  recipientName: string
  email: string | null
  phone: string | null
  address: Address
  items: SupplierOrderItem[]
}

export type PlaceOrderResult = {
  supplierOrderId: string
  // Supplier's charge for the order when the API reports it (margin display).
  costCents: number | null
}

export type SupplierWebhookInput = {
  rawBody: string
  headers: Record<string, string>
  // Query-string token for URL-secret verification (Printful).
  urlToken?: string
}

export type SupplierWebhookResult =
  | { type: 'shipped'; supplierOrderId?: string; externalId?: string; trackingCarrier: string | null; trackingNumber: string | null }
  | { type: 'ignored' }

export interface SupplierProvider {
  readonly name: 'printful' | 'cj'
  /** Cheap authenticated read — throws with a human message on bad credentials. */
  verifyCredentials(): Promise<void>
  /** Confirms a supplier variant ref exists; returns its display name. */
  validateVariantRef(ref: string): Promise<{ name: string }>
  placeOrder(input: PlaceOrderInput): Promise<PlaceOrderResult>
  /**
   * Auto-configure the supplier→store webhook at connect time (same philosophy
   * as payment webhooks: the merchant never sets one up by hand). Returns null
   * when the provider has no webhook support (tracking then comes from the
   * sweep poll).
   */
  setupWebhook(url: string): Promise<{ ok: true } | null>
  verifyAndParseWebhook(input: SupplierWebhookInput): Promise<SupplierWebhookResult>
  /** Poll fallback for providers without webhooks: current tracking for a supplier order. */
  getTracking(supplierOrderId: string): Promise<{ shipped: boolean; trackingCarrier: string | null; trackingNumber: string | null }>
}
