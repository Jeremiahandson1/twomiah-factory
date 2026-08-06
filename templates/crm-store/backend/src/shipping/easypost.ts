// EasyPost. One REST call creates a shipment with rates; a second buys the
// label. Errors surface verbatim — a carrier refusing an address is something
// the merchant needs to read, not a generic failure.
import type { Address } from '../../db/schema.ts'
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

  async buyLabel(input: { from: Address; to: Address; parcel: Parcel; rateId?: string }): Promise<BoughtLabel> {
    const shipment = await this.call('/shipments', this.shipmentBody(input.from, input.to, input.parcel))
    const rates: any[] = shipment.rates || []
    if (!rates.length) throw new Error('No carrier rates available for that address and parcel')

    const chosen = input.rateId
      ? rates.find((r) => r.id === input.rateId)
      : rates.reduce((best, r) => (Number(r.rate) < Number(best.rate) ? r : best), rates[0])
    if (!chosen) throw new Error('That shipping rate is no longer available')

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
