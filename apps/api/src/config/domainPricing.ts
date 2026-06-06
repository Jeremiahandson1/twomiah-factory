/**
 * Hardcoded per-TLD pricing for the "buy a domain" flow.
 *
 * Two numbers per TLD:
 *  - costCents: what Namecheap charges us per year (registration + ICANN fee)
 *  - retailCents: what we charge the customer per year (includes markup,
 *    WHOIS Privacy, support overhead, renewal cushion)
 *
 * Markup runs ~$8-15/yr depending on TLD. We keep the markup
 * non-aggressive at first to win trust on the buy flow; can tune up
 * once we have data. Most customers buy a domain once and renew
 * forever, so the LTV math is fine even at modest markup.
 *
 * Renewal pricing is the same as initial registration in this V1 —
 * Namecheap typically renews at the registration rate for the TLDs
 * we list. If a customer's renewal cost jumps (TLD price changes
 * at Namecheap), we eat the loss on the difference until we update
 * this file.
 *
 * Unknown TLDs are rejected with a clear message — we'd rather miss
 * a sale than register a domain we lose money on. Add new TLDs as
 * customers ask for them.
 */

export interface TldPricing {
  costCents: number   // What we pay Namecheap (informational)
  retailCents: number // What we charge the customer (one year)
}

// Cost numbers are 2026-06 reality. Spot-check yearly.
export const TLD_PRICING: Record<string, TldPricing> = {
  // Tier 1 — most-common business TLDs, modest markup
  'com':   { costCents:  929, retailCents: 1900 },
  'net':   { costCents: 1199, retailCents: 2200 },
  'org':   { costCents: 1099, retailCents: 2000 },
  'biz':   { costCents: 1599, retailCents: 2500 },
  'us':    { costCents:  799, retailCents: 1800 },
  // Tier 2 — modern startup TLDs, higher cost so similar absolute markup
  'co':    { costCents: 2999, retailCents: 4500 },
  'io':    { costCents: 3499, retailCents: 5500 },
  'app':   { costCents: 1499, retailCents: 2900 },
  'me':    { costCents: 1799, retailCents: 3000 },
  'site':  { costCents:  299, retailCents: 1500 },  // year 1 promo; renews ~$30
  'tech':  { costCents:  549, retailCents: 2000 },
  // Service-business friendly
  'pro':   { costCents: 1599, retailCents: 2700 },
  'shop':  { costCents:  599, retailCents: 2200 },
  // Catch-all generics
  'info':  { costCents:  299, retailCents: 1800 },
  'club':  { costCents:  699, retailCents: 2000 },
}

export interface PriceLookup {
  ok: true
  tld: string
  costCents: number
  retailCents: number
  /** Customer-facing description for the Stripe Checkout line item. */
  description: string
}

export interface PriceLookupError {
  ok: false
  reason: 'unsupported_tld' | 'malformed_domain'
  tld?: string
  supportedTlds: string[]
}

export function lookupDomainPrice(domain: string, years = 1): PriceLookup | PriceLookupError {
  const supportedTlds = Object.keys(TLD_PRICING).sort()
  const m = domain.trim().toLowerCase().match(/^([^.]+)\.(.+)$/)
  if (!m) return { ok: false, reason: 'malformed_domain', supportedTlds }
  const tld = m[2]
  const p = TLD_PRICING[tld]
  if (!p) return { ok: false, reason: 'unsupported_tld', tld, supportedTlds }
  const safeYears = Math.max(1, Math.min(10, Math.floor(years) || 1))
  return {
    ok: true,
    tld,
    costCents: p.costCents * safeYears,
    retailCents: p.retailCents * safeYears,
    description: domain + ' — ' + safeYears + ' year' + (safeYears === 1 ? '' : 's') + ' (registration + WHOIS Privacy + auto-renew)',
  }
}
