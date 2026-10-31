// Split billing — one visit billed to several parties, the AxisCare / WellSky way the owner chose (10/30): the client's
// payers in priority order, each paying a percent of each visit or a fixed amount per hour of it, and the family paying
// what is left. Each payer takes its share of what the payers before it left, never more — so no part is negative and
// the parts of a visit always add up to exactly the visit, to the cent. Applied by core/invoiceEngine.ts
// createInvoiceWithLines when the agency has care_split_billing on; the rules are client_billing_splits (schema).

export type SplitKind = 'percent' | 'per_hour'
export interface SplitRule { payerId: string; priority: number; kind: SplitKind; value: number }
export const MAX_SPLIT_PAYERS = 4

/** Why these rules cannot be kept — or null. `payers` are the agency's active payers' ids. */
export function splitRulesProblem(rules: Array<{ payerId?: unknown; kind?: unknown; value?: unknown }>, payers: ReadonlySet<string>): string | null {
  if (!Array.isArray(rules)) return 'Send the payers as a list.'
  if (rules.length > MAX_SPLIT_PAYERS) return `At most ${MAX_SPLIT_PAYERS} payers share a client's visits.`
  const seen = new Set<string>()
  let percent = 0
  for (const r of rules) {
    if (typeof r?.payerId !== 'string' || !payers.has(r.payerId)) return 'Choose a payer from your active payers.'
    if (seen.has(r.payerId)) return 'Each payer appears once.'
    seen.add(r.payerId)
    const v = Number(r.value)
    if (r.kind === 'percent') {
      if (!(v > 0) || v > 100) return 'A percent share is more than 0 and at most 100.'
      percent += v
    } else if (r.kind === 'per_hour') {
      if (!(v > 0) || v > 1000) return 'An hourly share is more than $0 and at most $1,000 an hour.'
    } else return "Each payer pays a percent ('percent') or an amount per hour ('per_hour')."
  }
  if (percent > 100) return 'The percent shares add up to more than 100%.'
  return null
}

const cents = (n: number) => Math.round(n * 100)

export interface PartLine { hours: number; amount: number; rate: number; rateType: 'hourly' }
export interface SplitParts<L> {
  /** One entry per payer with something to bill, in priority order, then the family's (when anything is left). */
  parts: Array<{ billTo: 'payer' | 'family'; payerId: string | null; lines: Array<L & PartLine>; total: number }>
}

/**
 * Divide visit lines between the payers (in priority order) and the family. Each line's amount is split; a party's line
 * keeps the visit's hours and states its share as an hourly rate (the share ÷ the hours). A party whose share of every
 * line is nothing gets no part.
 */
export function splitLines<L extends { hours: number | string; amount: number | string }>(lines: L[], rules: SplitRule[]): SplitParts<L> {
  const ordered = [...rules].sort((a, b) => a.priority - b.priority)
  const shares: number[][] = ordered.map(() => [])
  const family: number[] = []
  lines.forEach((line, i) => {
    const whole = cents(Number(line.amount) || 0)
    let left = whole
    const hours = Number(line.hours) || 0
    ordered.forEach((r, k) => {
      // A percent is of the whole visit; an hourly share is per hour of it. Either is capped at what is left.
      const want = r.kind === 'percent' ? Math.round(whole * r.value / 100) : cents(hours * r.value)
      const take = Math.max(0, Math.min(want, left))
      shares[k][i] = take
      left -= take
    })
    family[i] = left
  })
  const partOf = (billTo: 'payer' | 'family', payerId: string | null, amounts: number[]) => {
    const out: Array<L & PartLine> = []
    lines.forEach((line, i) => {
      const c = amounts[i] || 0
      if (c <= 0) return
      const hours = Number(line.hours) || 0
      out.push({ ...line, hours, amount: c / 100, rate: hours > 0 ? Math.round(c / hours) / 100 : c / 100, rateType: 'hourly' })
    })
    return out.length ? { billTo, payerId, lines: out, total: out.reduce((s, l) => s + cents(l.amount), 0) / 100 } : null
  }
  const parts = [
    ...ordered.map((r, k) => partOf('payer', r.payerId, shares[k])),
    partOf('family', null, family),
  ].filter((p): p is NonNullable<typeof p> => !!p)
  return { parts }
}
