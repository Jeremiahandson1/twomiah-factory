/**
 * Domain pricing — AT COST PLUS THE STRIPE FEE. (Decided by the owner, 10/14.)
 *
 * A customer pays exactly what Namecheap charges us, plus what Stripe takes to collect it, so we neither mark a
 * domain up nor lose money on it. The first year, every renewal, and every extra year bought up front are priced the
 * same way, from Namecheap's LIVE price at the moment of charging (registrar.getCostCents) — never from a table:
 * a .site is $2.99 to register and about $30 to renew, and a price list cannot keep up with either.
 *
 * The list below is which TLDs we sell. A TLD not on it is refused with a clear message — we would rather miss a sale
 * than register something we have not looked at. The cents beside each are a 2026-06 reference for staff only;
 * nothing is charged from them.
 */

/** TLDs we sell, with Namecheap's 2026-06 first-year price for reference (NOT used to charge anyone). */
export const SUPPORTED_TLDS: Record<string, { referenceCostCents: number }> = {
  com: { referenceCostCents: 929 }, net: { referenceCostCents: 1199 }, org: { referenceCostCents: 1099 },
  biz: { referenceCostCents: 1599 }, us: { referenceCostCents: 799 }, co: { referenceCostCents: 2999 },
  io: { referenceCostCents: 3499 }, app: { referenceCostCents: 1499 }, me: { referenceCostCents: 1799 },
  site: { referenceCostCents: 299 }, tech: { referenceCostCents: 549 }, pro: { referenceCostCents: 1599 },
  shop: { referenceCostCents: 599 }, info: { referenceCostCents: 299 }, club: { referenceCostCents: 699 },
}

/** Stripe's standard US card fee: 2.9% + 30¢ per charge. */
export const STRIPE_FEE = { percent: 0.029, fixedCents: 30 } as const

export type TldCheck = { ok: true; tld: string } | { ok: false; reason: 'unsupported_tld' | 'malformed_domain'; tld?: string; supportedTlds: string[] }

/** Is this a domain we sell? Its TLD, or why not. */
export function checkTld(domain: string): TldCheck {
  const supportedTlds = Object.keys(SUPPORTED_TLDS).sort()
  const m = domain.trim().toLowerCase().match(/^([^.]+)\.(.+)$/)
  if (!m) return { ok: false, reason: 'malformed_domain', supportedTlds }
  if (!SUPPORTED_TLDS[m[2]]) return { ok: false, reason: 'unsupported_tld', tld: m[2], supportedTlds }
  return { ok: true, tld: m[2] }
}

/**
 * What to charge so that, after Stripe's fee, exactly `costCents` is left: (cost + 30¢) / (1 − 2.9%), rounded UP to
 * the cent so the fee is always covered. $15.00 → $15.76; $9.29 → $9.88.
 */
export function withStripeFee(costCents: number): number {
  return Math.ceil((costCents + STRIPE_FEE.fixedCents) / (1 - STRIPE_FEE.percent))
}

/**
 * A domain bought now for `years`: Namecheap's first-year price plus its renewal price for each further year — one
 * Stripe charge, so the fee is added once. Each price is Namecheap's live one; without it there is no price.
 */
export function purchaseChargeCents(liveRegisterCostCents: number | null, liveRenewCostCents: number | null, years: number): { ok: true; cents: number; costCents: number } | { ok: false; reason: 'price_unavailable' } {
  const n = Math.max(1, Math.min(10, Math.floor(years) || 1))
  if (!(liveRegisterCostCents! > 0)) return { ok: false, reason: 'price_unavailable' }
  if (n > 1 && !(liveRenewCostCents! > 0)) return { ok: false, reason: 'price_unavailable' }
  const costCents = liveRegisterCostCents! + (n - 1) * (n > 1 ? liveRenewCostCents! : 0)
  return { ok: true, cents: withStripeFee(costCents), costCents }
}

/** One year of renewal: Namecheap's live renewal price plus the Stripe fee. null without a live price. */
export function renewalChargeCents(liveRenewCostCents: number | null): number | null {
  return liveRenewCostCents! > 0 ? withStripeFee(liveRenewCostCents!) : null
}

/** The line a customer sees on the Stripe page. */
export function domainChargeDescription(domain: string, years: number): string {
  return domain + ' — ' + years + ' year' + (years === 1 ? '' : 's') + ' (registration + WHOIS privacy), at cost plus card processing'
}
