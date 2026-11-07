/**
 * The arithmetic and the words of checkout at the chair on the phone (salon parity row 26, app/(details)/salon-pay.tsx) — pure, so it is
 * tested without a phone (tests/mobile/salon-chair-pay.test.ts).
 */

/** "45.5" → 4550; anything that is not an amount → NaN. Money is cents on the wire. */
export function centsOf(typed: string): number {
  const t = String(typed ?? '').replace(/[$,\s]/g, '')
  if (!/^\d+(\.\d{0,2})?$/.test(t)) return NaN
  return Math.round(Number(t) * 100)
}

/** 4550 → "$45.50". */
export const dollars = (cents: number) => `$${((Number(cents) || 0) / 100).toFixed(2)}`

/** The salon's tip choices for this amount (tip-info's suggestions, worked on the services, never retail); a zero choice is left out. */
export function tipChoices(info: any): Array<{ percent: number; cents: number }> {
  const list = Array.isArray(info?.suggestions) ? info.suggestions : []
  return list.map((s: any) => ({ percent: Number(s.percent), cents: Math.round(Number(s.cents)) })).filter((s: { percent: number; cents: number }) => s.percent > 0 && s.cents > 0)
}

/** One key per charge attempt: the same key asks the server for the same PaymentIntent, never a second. */
export const newKey = () => `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`

/** What a charge that did not go through says: the server's words for it (declined, timed out, cancelled), else what the phone saw. */
export function chargeWords(charge: { status?: string; failure?: string | null } | null, phoneSaw?: string): string {
  if (charge?.failure) return charge.failure
  if (charge?.status === 'timed_out') return 'The phone waited too long for a card. Nothing was taken.'
  if (charge?.status === 'canceled') return 'The payment was cancelled. Nothing was taken.'
  return phoneSaw || 'The card was not taken.'
}
