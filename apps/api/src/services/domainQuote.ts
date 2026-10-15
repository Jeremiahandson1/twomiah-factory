/**
 * WHAT A DOMAIN COSTS — the first year AND every year after, shown before anyone pays. (Owner, 10/15)
 *
 * The E2E Run 2 .site cost $1.53 for the first year and renews at $31.40. The buy page showed no price at all and the
 * Stripe page only the $1.53, so the jump would have arrived as a surprise invoice a year later. Owner: "close to first
 * year, but we can just make it real transparent too, let them know in bold the next year cost."
 *
 * Both prices are what the customer is charged — Namecheap's live price plus the Stripe fee (config/domainPricing.ts),
 * never a table. Namecheap's price list is read at most once an hour per ending: every availability check would
 * otherwise cost two more API calls, and the price does not move that fast.
 */
import { checkTld, withStripeFee } from '../config/domainPricing'

type PriceSource = { getCostCents(tld: string, action: 'REGISTER' | 'RENEW'): Promise<number | null> }

export type DomainQuote = {
  /** Charged now, for the first year. */
  firstYearCents: number
  /** Charged each year after. */
  renewalCents: number
  /** The renewal is well above the first year — say so plainly (renewsClose). */
  renewsHigher: boolean
}

const TTL_MS = 60 * 60 * 1000
const cache = new Map<string, { at: number; cents: number }>()

async function cost(source: PriceSource, tld: string, action: 'REGISTER' | 'RENEW'): Promise<number | null> {
  const key = action + ':' + tld
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.cents
  const cents = await source.getCostCents(tld, action)
  // Only a real price is kept: a failed read is asked again next time, not remembered as "no price".
  if (cents != null && cents > 0) cache.set(key, { at: Date.now(), cents })
  return cents != null && cents > 0 ? cents : null
}

/** For tests: forget the cached prices. */
export function forgetDomainPrices(): void { cache.clear() }

/**
 * Does the renewal stay close to the first year? Within double, or within $10.00 — a .com charged $12.14 renewing at
 * $19.55 (live, 10/15) is an ordinary renewal; a .site at $1.53 renewing at $31.40 is not.
 */
export function renewsClose(firstYearCents: number, renewalCents: number): boolean {
  return renewalCents <= Math.max(firstYearCents * 2, firstYearCents + 1000)
}

/** The quote for one domain we sell, or null — a TLD we do not sell, or Namecheap could not say. */
export async function quoteDomain(source: PriceSource, domain: string): Promise<DomainQuote | null> {
  const tld = checkTld(domain)
  if (!tld.ok) return null
  const [register, renew] = await Promise.all([cost(source, tld.tld, 'REGISTER'), cost(source, tld.tld, 'RENEW')])
  if (register == null || renew == null) return null
  const firstYearCents = withStripeFee(register), renewalCents = withStripeFee(renew)
  return { firstYearCents, renewalCents, renewsHigher: !renewsClose(firstYearCents, renewalCents) }
}

/**
 * Suggestions, the endings that renew close to their first year first, then the cheapest renewal; ones we cannot price
 * (or do not sell) are left out — a customer is never offered a name whose price we cannot show.
 */
export async function pricedSuggestions<T extends { domain: string }>(source: PriceSource, list: T[], max = 8): Promise<(T & { quote: DomainQuote })[]> {
  const priced: (T & { quote: DomainQuote })[] = []
  for (const [i, quote] of (await Promise.all(list.map((s) => quoteDomain(source, s.domain)))).entries()) {
    if (quote) priced.push({ ...list[i], quote })
  }
  return priced
    .sort((a, b) => Number(a.quote.renewsHigher) - Number(b.quote.renewsHigher) || a.quote.renewalCents - b.quote.renewalCents)
    .slice(0, max)
}

/** "$1.53 for the first year, then $31.40 a year" — the words the Stripe page and the emails use. */
export function quoteWords(q: Pick<DomainQuote, 'firstYearCents' | 'renewalCents'>): string {
  const $ = (c: number) => '$' + (c / 100).toFixed(2)
  return $(q.firstYearCents) + ' for the first year, then ' + $(q.renewalCents) + ' a year'
}
