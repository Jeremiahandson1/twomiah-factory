// What a no-show or late-cancel fee comes to (salon parity row 4; Fresha, Square). Pure, in whole cents, so the rules are tested without a
// server. The order, most specific first:
//   1. a SERVICE's own fee (Service Menu › that service), flat or a percent of its price — for the services that have one;
//   2. else the SALON's fee for the kind — the new-client fee when the client is new and the salon set one, else the regular fee;
//   3. all of it only when the booking is worth at least the salon's minimum booking value (when it set one).
// A visit of several services is judged service by service: a service with its own fee pays it; the salon's flat fee is counted once for the
// services without one, and the salon's percent is taken of their prices together.

export interface FeeSetting { cents: number | null; percent: number | null }
export const NO_FEE: FeeSetting = { cents: null, percent: null }
export const hasFee = (f: FeeSetting | null | undefined): f is FeeSetting => !!f && (f.cents != null || f.percent != null)

/** One service of the visit: what it costs and the fee it carries of its own, if any. */
export interface FeeLine { priceCents: number; own: FeeSetting | null }

export interface FeeInput {
  /** The salon's fee for this kind, for returning clients (and for everyone when no new-client fee is set). */
  salon: FeeSetting
  /** The salon's fee for this kind, for a client who has never completed a visit; empty = the regular fee. */
  salonNew: FeeSetting
  isNewClient: boolean
  /** The salon's minimum booking value in cents: a booking worth less owes no fee. Null = no minimum. */
  minValueCents: number | null
  lines: FeeLine[]
}

export interface FeeResult { cents: number | null; why?: string; /** Which rule decided: the service's own, the new-client fee, or the salon's. */ basis?: 'service' | 'new_client' | 'salon' | 'mixed' }

const usd = (cents: number) => '$' + (cents % 100 ? (cents / 100).toFixed(2) : String(cents / 100))
const ofPrice = (priceCents: number, percent: number) => Math.round((priceCents * percent) / 100)

export function resolveFee(i: FeeInput, kindWords: 'no-show' | 'late-cancel'): FeeResult {
  const value = i.lines.reduce((n, l) => n + Math.max(0, l.priceCents), 0)
  const anyOwn = i.lines.some((l) => hasFee(l.own))
  const base = i.isNewClient && hasFee(i.salonNew) ? i.salonNew : i.salon
  if (!anyOwn && !hasFee(base)) return { cents: null, why: `No ${kindWords} fee is set. Set it under Settings › Card on file.` }
  if (i.minValueCents != null && value < i.minValueCents) return { cents: null, why: `This booking is worth ${usd(value)}, under the ${usd(i.minValueCents)} minimum, so no ${kindWords} fee applies.` }

  let total = 0, restPrice = 0, restCount = 0, usedOwn = false
  for (const l of i.lines) {
    if (hasFee(l.own)) { usedOwn = true; total += l.own.cents != null ? l.own.cents : ofPrice(l.priceCents, l.own.percent!) }
    else { restPrice += Math.max(0, l.priceCents); restCount++ }
  }
  let usedBase = false
  if (restCount > 0 && hasFee(base)) {
    if (base.cents != null) { total += base.cents; usedBase = true }
    else if (restPrice > 0) { total += ofPrice(restPrice, base.percent!); usedBase = true }
    else if (!usedOwn) return { cents: null, why: 'This appointment has no price to take a percent of.' }
  }
  if (!(total > 0)) return { cents: null, why: `No ${kindWords} fee comes to anything for this appointment.` }
  const basis = usedOwn && usedBase ? 'mixed' : usedOwn ? 'service' : i.isNewClient && hasFee(i.salonNew) ? 'new_client' : 'salon'
  return { cents: total, basis }
}

const empty = (v: unknown) => v === null || v === undefined || v === ''
const MIN_FEE_CENTS = 50, MAX_FEE_CENTS = 1_000_000

/** A fee in a request: whole cents (50 to 1,000,000) or a whole percent (1 to 100), never both. Empty = none. */
export function parseFee(cents: unknown, percent: unknown, label: string, amountKey: string): { value: FeeSetting } | { fields: Record<string, string> } {
  const fields: Record<string, string> = {}
  let c: number | null = null, p: number | null = null
  if (!empty(cents)) { c = Number(cents); if (!Number.isInteger(c) || c < MIN_FEE_CENTS || c > MAX_FEE_CENTS) { fields[amountKey] = `${label} must be between $0.50 and $10,000.`; c = null } }
  if (!empty(percent)) { p = Number(percent); if (!Number.isInteger(p) || p < 1 || p > 100) { fields[amountKey] = `${label} must be a whole percent from 1 to 100.`; p = null } }
  if (c != null && p != null) fields[amountKey] = `Set ${label.toLowerCase()} as an amount or a percent, not both.`
  return Object.keys(fields).length ? { fields } : { value: { cents: c, percent: p } }
}

/** The four fee boxes on a Service Menu item that a request touched: the columns to write, or the wrong boxes. Untouched kinds are left alone. */
export function parseServiceFees(body: any): { values: Record<string, number | null>; touched: boolean } | { fields: Record<string, string> } {
  const values: Record<string, number | null> = {}
  const fields: Record<string, string> = {}
  for (const [kind, label, centsKey, percentKey] of [
    ['no_show', 'The no-show fee', 'noShowFeeCents', 'noShowFeePercent'],
    ['late_cancel', 'The late-cancel fee', 'lateCancelFeeCents', 'lateCancelFeePercent'],
  ] as const) {
    if (!(centsKey in body) && !(percentKey in body)) continue
    const got = parseFee(body[centsKey], body[percentKey], label, centsKey)
    if ('fields' in got) Object.assign(fields, got.fields)
    else { values[centsKey] = got.value.cents; values[percentKey] = got.value.percent }
  }
  return Object.keys(fields).length ? { fields } : { values, touched: Object.keys(values).length > 0 }
}
