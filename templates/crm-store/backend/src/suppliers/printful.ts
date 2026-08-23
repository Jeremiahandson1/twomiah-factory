// Printful adapter. Auth: private API token (Bearer). Order refs are Printful
// SYNC VARIANT ids — the merchant sets products up once in their Printful
// store, then links each of our variants to the Printful sync variant.
//
// Orders are created with confirm:false (draft) in test mode so nothing is
// charged or produced until the merchant flips live mode, where we confirm.
// Webhooks: Printful signs nothing — verification is a random token we embed
// in the registered URL (?t=...), standard practice for their API.
import type {
  SupplierProvider, SupplierCredentials, PlaceOrderInput, PlaceOrderResult,
  SupplierWebhookInput, SupplierWebhookResult,
} from './types.ts'

const BASE = 'https://api.printful.com'

function dollarsToCents(v: unknown): number | null {
  const n = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : NaN
  return Number.isFinite(n) ? Math.round(n * 100) : null
}

export class PrintfulProvider implements SupplierProvider {
  readonly name = 'printful' as const
  constructor(private creds: SupplierCredentials) {}

  // Store-scoped tokens address "the" store implicitly; ACCOUNT-level tokens
  // must name one via X-PF-Store-Id or every store endpoint 400s. Discover
  // the account's store lazily and cache it. null = store-scoped token.
  private storeId: string | null | undefined = undefined

  private async resolveStoreId(): Promise<string | null> {
    if (this.storeId !== undefined) return this.storeId
    const res = await fetch(BASE + '/stores', {
      headers: { 'Authorization': `Bearer ${this.creds.apiKey}` },
    })
    const data: any = await res.json().catch(() => ({}))
    if (!res.ok) {
      // Store-scoped tokens are forbidden from /stores — no header needed.
      this.storeId = null
      return null
    }
    const stores = Array.isArray(data?.result) ? data.result : []
    if (stores.length === 0) {
      throw new Error('Your Printful account has no store yet — create one (Manual order platform / API) in the Printful dashboard first')
    }
    this.storeId = String(stores[0].id)
    return this.storeId
  }

  private async call(method: string, path: string, body?: unknown): Promise<any> {
    const storeId = await this.resolveStoreId()
    const res = await fetch(BASE + path, {
      method,
      headers: {
        'Authorization': `Bearer ${this.creds.apiKey}`,
        'Content-Type': 'application/json',
        ...(storeId ? { 'X-PF-Store-Id': storeId } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const data: any = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data?.result || data?.error?.message || `Printful ${res.status}`)
    return data?.result
  }

  async verifyCredentials(): Promise<void> {
    await this.call('GET', '/store')
  }

  async validateVariantRef(ref: string): Promise<{ name: string }> {
    if (!/^\d+$/.test(ref.trim())) throw new Error('Printful sync variant id must be a number')
    // No @ prefix: '@' addresses Printful's EXTERNAL-id namespace; the ref we
    // store IS the numeric sync variant id.
    const result = await this.call('GET', '/store/variants/' + ref.trim())
    const name = result?.sync_variant?.name || result?.name
    if (!name) throw new Error('Printful did not recognize that sync variant')
    return { name }
  }

  async placeOrder(input: PlaceOrderInput): Promise<PlaceOrderResult> {
    const a = input.address as any
    const order = await this.call('POST', '/orders', {
      // Printful caps external_id at 32 chars; a hyphenless UUID is exactly 32.
      external_id: input.externalId.replace(/-/g, '').slice(0, 32),
      // Draft in test mode; confirmed (charged + sent to production) in live.
      confirm: this.creds.mode === 'live',
      recipient: {
        name: input.recipientName,
        address1: a?.line1 || a?.address1 || '',
        address2: a?.line2 || a?.address2 || undefined,
        city: a?.city || '',
        state_code: a?.state || a?.stateCode || undefined,
        country_code: a?.country || a?.countryCode || 'US',
        zip: a?.postalCode || a?.zip || '',
        email: input.email || undefined,
        phone: input.phone || undefined,
      },
      items: input.items.map(it => ({ sync_variant_id: Number(it.supplierVariantRef), quantity: it.quantity })),
    })
    if (!order?.id) throw new Error('Printful did not return an order id')
    return { supplierOrderId: String(order.id), costCents: dollarsToCents(order?.costs?.total) }
  }

  async setupWebhook(url: string): Promise<{ ok: true } | null> {
    // Single webhook config per store — setting it replaces any previous one,
    // so reconnects are naturally idempotent.
    await this.call('POST', '/webhooks', { url, types: ['package_shipped'] })
    return { ok: true }
  }

  async verifyAndParseWebhook(input: SupplierWebhookInput): Promise<SupplierWebhookResult> {
    if (!this.creds.webhookToken || input.urlToken !== this.creds.webhookToken) {
      throw new Error('Invalid webhook token')
    }
    let event: any
    try { event = JSON.parse(input.rawBody) } catch { return { type: 'ignored' } }
    if (event?.type !== 'package_shipped') return { type: 'ignored' }
    const shipment = event?.data?.shipment || {}
    const order = event?.data?.order || {}
    return {
      type: 'shipped',
      supplierOrderId: order?.id != null ? String(order.id) : undefined,
      externalId: order?.external_id || undefined,
      trackingCarrier: shipment?.carrier || null,
      trackingNumber: shipment?.tracking_number || null,
    }
  }

  async getTracking(supplierOrderId: string): Promise<{ shipped: boolean; trackingCarrier: string | null; trackingNumber: string | null }> {
    const order = await this.call('GET', '/orders/' + supplierOrderId)
    const shipment = (order?.shipments || [])[0]
    return {
      shipped: order?.status === 'fulfilled' || !!shipment?.tracking_number,
      trackingCarrier: shipment?.carrier || null,
      trackingNumber: shipment?.tracking_number || null,
    }
  }
}
