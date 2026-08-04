// CJ Dropshipping adapter — the AliExpress-style general-goods supplier.
//
// WRITTEN TO CJ'S DOCUMENTED v2 API BUT NOT LIVE-VERIFIED: no CJ account
// credentials on file (same policy as the Square/PayPal payment-webhook legs).
// Auth: account email + API key exchanged for a bearer accessToken (valid ~15
// days; we re-auth per process and on 401). Variant refs are CJ "vid" values.
// CJ has no push webhooks in this integration — tracking comes from the sweep
// poll (getTracking) which the forwarding sweep calls for placed orders.
import type {
  SupplierProvider, SupplierCredentials, PlaceOrderInput, PlaceOrderResult,
  SupplierWebhookInput, SupplierWebhookResult,
} from './types.ts'

const BASE = 'https://developers.cjdropshipping.com/api2.0/v1'

export class CjProvider implements SupplierProvider {
  readonly name = 'cj' as const
  private accessToken: string | null = null
  constructor(private creds: SupplierCredentials) {}

  private async auth(): Promise<string> {
    if (this.accessToken) return this.accessToken
    const res = await fetch(BASE + '/authentication/getAccessToken', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: this.creds.accountEmail, password: this.creds.apiKey }),
    })
    const data: any = await res.json().catch(() => ({}))
    const token = data?.data?.accessToken
    if (!token) throw new Error(data?.message || 'CJ rejected the credentials')
    this.accessToken = token
    return token
  }

  private async call(method: string, path: string, body?: unknown): Promise<any> {
    const token = await this.auth()
    const res = await fetch(BASE + path, {
      method,
      headers: { 'CJ-Access-Token': token, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const data: any = await res.json().catch(() => ({}))
    if (res.status === 401) { this.accessToken = null; throw new Error('CJ token expired — retry') }
    if (!res.ok || data?.result === false) throw new Error(data?.message || `CJ ${res.status}`)
    return data?.data
  }

  async verifyCredentials(): Promise<void> {
    await this.auth()
  }

  async validateVariantRef(ref: string): Promise<{ name: string }> {
    const data = await this.call('GET', '/product/variant/queryByVid?vid=' + encodeURIComponent(ref.trim()))
    const name = data?.variantNameEn || data?.variantName || data?.variantSku
    if (!name) throw new Error('CJ did not recognize that variant id (vid)')
    return { name }
  }

  async placeOrder(input: PlaceOrderInput): Promise<PlaceOrderResult> {
    const a = input.address as any
    const data = await this.call('POST', '/shopping/order/createOrderV2', {
      orderNumber: input.externalId,
      shippingCountryCode: a?.country || a?.countryCode || 'US',
      shippingProvince: a?.state || a?.stateCode || '',
      shippingCity: a?.city || '',
      shippingAddress: [a?.line1 || a?.address1 || '', a?.line2 || a?.address2 || ''].filter(Boolean).join(', '),
      shippingZip: a?.postalCode || a?.zip || '',
      shippingCustomerName: input.recipientName,
      shippingPhone: input.phone || '',
      remark: 'Twomiah store order ' + input.externalId,
      products: input.items.map(it => ({ vid: it.supplierVariantRef, quantity: it.quantity })),
    })
    const id = data?.orderId || data
    if (!id) throw new Error('CJ did not return an order id')
    const cost = typeof data?.orderAmount === 'number' ? Math.round(data.orderAmount * 100) : null
    return { supplierOrderId: String(id), costCents: cost }
  }

  async setupWebhook(_url: string): Promise<null> {
    return null // no push webhooks — tracking comes from the sweep poll
  }

  async verifyAndParseWebhook(_input: SupplierWebhookInput): Promise<SupplierWebhookResult> {
    return { type: 'ignored' }
  }

  async getTracking(supplierOrderId: string): Promise<{ shipped: boolean; trackingCarrier: string | null; trackingNumber: string | null }> {
    const data = await this.call('GET', '/logistic/getTrackInfo?orderId=' + encodeURIComponent(supplierOrderId))
    const row = Array.isArray(data) ? data[0] : data
    const trackingNumber = row?.trackNumber || row?.trackingNumber || null
    return {
      shipped: !!trackingNumber,
      trackingCarrier: row?.logisticName || null,
      trackingNumber,
    }
  }
}
