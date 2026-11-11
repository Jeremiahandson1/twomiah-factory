// CARRIER RATES AT CHECKOUT (parity tier 3, store — Shopify's "third-party calculated shipping rates"; feature
// store_carrier_rates, not ready). The live rates of the carrier account the store already buys its labels through (EasyPost,
// Settings › Shipping — the store's own account and key; nothing is bought here and nothing is charged to Twomiah), for the cart's
// weight to the shopper's ZIP:
//   · the parcel is the store's default box with the cart's weight (each option's weight × quantity; the box's own weight when
//     no option has one);
//   · the cheapest first; the shopper picks one, and the ORDER asks the carrier again and uses the matching price — a price the
//     browser sends is never trusted (placeOrder.ts);
//   · no carrier connected, no ZIP, or the carrier answers nothing: null, and the store's own flat or zone rate applies as before.
import type { StoreCore } from '../core.ts'
import type { RateQuote } from '../shipping/types.ts'

export const CARRIER_RATES = 'store_carrier_rates'
export interface CarrierOption { carrier: string; service: string; amountCents: number; estimatedDays: number | null }

/** The cart's weight in ounces: each line's option weight × quantity, or null when none has a weight. */
export function cartWeightOz(lines: Array<{ weightOz: number | null; quantity: number }>): number | null {
  const known = lines.filter((l) => l.weightOz != null && l.weightOz > 0)
  return known.length ? known.reduce((s, l) => s + (l.weightOz as number) * l.quantity, 0) : null
}

export async function carrierOptions(core: StoreCore, companyId: string, weightOz: number | null, to: { zip?: string; state?: string; country?: string }, log?: (m: string) => void): Promise<CarrierOption[] | null> {
  const zip = String(to.zip || '').trim()
  if (!/^[A-Za-z0-9 -]{3,10}$/.test(zip)) return null
  const active = await core.getActiveShipping(companyId).catch(() => null)
  if (!active?.fromAddress) return null
  try {
    const quotes: RateQuote[] = await active.provider.getRates({
      from: active.fromAddress,
      to: { line1: '', city: '', state: String(to.state || ''), postalCode: zip, country: String(to.country || 'US').toUpperCase() },
      parcel: { ...active.parcel, weightOz: weightOz && weightOz > 0 ? weightOz : active.parcel.weightOz },
    })
    const out = (quotes || []).filter((q) => Number.isFinite(q.amountCents) && q.amountCents >= 0)
      .map((q) => ({ carrier: q.carrier, service: q.service, amountCents: Math.round(q.amountCents), estimatedDays: q.estimatedDays ?? null }))
      .sort((a, b) => a.amountCents - b.amountCents || a.carrier.localeCompare(b.carrier) || a.service.localeCompare(b.service))
    return out.length ? out : null
  } catch (e: any) { log?.(`carrier rates: ${e?.message}`); return null }
}

/** The option the shopper chose (carrier and service), or the cheapest when they chose none or one no longer offered. */
export function chosenOption(options: CarrierOption[], wanted?: { carrier?: string; service?: string } | null): CarrierOption {
  const hit = wanted ? options.find((o) => o.carrier === wanted.carrier && o.service === wanted.service) : undefined
  return hit ?? options[0]
}
