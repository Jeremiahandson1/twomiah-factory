// Moved from templates/crm-store/backend/src/shipping/easypost.ts (docs/UNIFIED_STORE_PLAN.md).
// EasyPost. One REST call creates a shipment with rates; a second buys the
// label. Errors surface verbatim — a carrier refusing an address is something
// the merchant needs to read, not a generic failure.
import type { StoreAddress as Address } from '../../../db/schema/store.ts'
import type { BoughtLabel, Parcel, RateQuote, ShippingCredentials, ShippingProvider } from './types.ts'

const API = 'https://api.easypost.com/v2'

function toEasyPostAddress(a: Address, fallbackName = '') {
  return {
    name: (a as any).name || fallbackName,
    street1: (a as any).line1 || (a as any).street1 || '',
    street2: (a as any).line2 || (a as any).street2 || undefined,
    city: (a as any).city || '',
    state: (a as any).state || '',
    zip: (a as any).postalCode || (a as any).zip || '',
    country: (a as any).country || 'US',
    phone: (a as any).phone || undefined,
  }
}

export class EasyPostProvider implements ShippingProvider {
  readonly name = 'easypost' as const
  constructor(private creds: ShippingCredentials) {}

  private async call(path: string, body?: unknown, method = 'POST'): Promise<any> {
    const res = await fetch(API + path, {
      method,
      headers: {
        Authorization: 'Basic ' + Buffer.from(this.creds.apiKey + ':').toString('base64'),
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) {
      const message = json?.error?.message || json?.message || `EasyPost ${res.status}`
      throw new Error(typeof message === 'string' ? message : JSON.stringify(message))
    }
    return json
  }

  private shipmentBody(from: Address, to: Address, parcel: Parcel) {
    return {
      shipment: {
        to_address: toEasyPostAddress(to),
        from_address: toEasyPostAddress(from),
        parcel: {
          length: parcel.lengthIn,
          width: parcel.widthIn,
          height: parcel.heightIn,
          weight: parcel.weightOz,
        },
      },
    }
  }

  async getRates(input: { from: Address; to: Address; parcel: Parcel }): Promise<RateQuote[]> {
    const shipment = await this.call('/shipments', this.shipmentBody(input.from, input.to, input.parcel))
    return (shipment.rates || []).map((r: any) => ({
      id: r.id,
      carrier: r.carrier,
      service: r.service,
      amountCents: Math.round(Number(r.rate) * 100),
      currency: (r.currency || 'USD').toLowerCase(),
      estimatedDays: r.delivery_days ?? null,
    }))
  }

  /**
   * THE RATE THE PERSON PICKED IS THE SERVICE THEY GET. (Live, EasyPost test mode, 10/12: every Buy answered "That
   * shipping rate is no longer available".) Get rates creates one shipment and shows ITS rate ids; buying created a
   * second shipment — new ids — and looked for the picked id among them, so a chosen rate could never be found and only
   * "cheapest, no choice" ever worked. The picked rate is now read back for its carrier and service, and that same
   * service is bought on a fresh shipment for THIS order — whose address is the order's, whatever id was sent.
   */
  async buyLabel(input: { from: Address; to: Address; parcel: Parcel; rateId?: string }): Promise<BoughtLabel> {
    const picked = input.rateId ? await this.call(`/rates/${encodeURIComponent(input.rateId)}`, undefined, 'GET').catch(() => null) : null
    if (input.rateId && !picked?.carrier) throw new Error('That shipping rate could not be found — get rates again')
    const shipment = await this.call('/shipments', this.shipmentBody(input.from, input.to, input.parcel))
    const rates: any[] = shipment.rates || []
    if (!rates.length) throw new Error('No carrier rates available for that address and parcel')

    const chosen = picked
      ? rates.find((r) => r.carrier === picked.carrier && r.service === picked.service)
      : rates.reduce((best, r) => (Number(r.rate) < Number(best.rate) ? r : best), rates[0])
    if (!chosen) throw new Error(`${picked?.carrier ?? 'That carrier'} ${picked?.service ?? ''} is no longer offered for this address — get rates again`.replace(/\s+/g, ' '))

    const bought = await this.call(`/shipments/${shipment.id}/buy`, { rate: { id: chosen.id } })
    const label = bought.postage_label || {}
    return {
      carrier: bought.selected_rate?.carrier || chosen.carrier,
      service: bought.selected_rate?.service || chosen.service,
      trackingCode: bought.tracking_code,
      labelUrl: label.label_url,
      costCents: Math.round(Number(bought.selected_rate?.rate ?? chosen.rate) * 100),
      shipmentId: bought.id,
    }
  }
}
