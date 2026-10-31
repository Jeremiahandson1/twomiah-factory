/**
 * Invoice scanning on the phone (restaurant-bar parity #7), pure TypeScript, tested by tests/mobile/bar-invoice-scan.test.ts.
 *
 * The phone takes or picks a PHOTO and sends it to the server at once. A photo is NOT kept for later (the offline queue is JSON only,
 * src/offline/README.md "Known limits"), so with no signal the screen says so plainly and keeps nothing: it never says "saved" for a
 * photo it has not sent. Reading, checking and receiving are the server's; the phone shows what was read and lets a manager fix a
 * match, a quantity or a price, skip a line, receive it, or throw it away. Nothing changes a count or a price until Receive.
 */
import { money, join, type Row } from './kit'

/** What the screen says when there is no signal: honest that the photo is not waiting anywhere. */
export const NEEDS_SIGNAL = 'No signal. Reading an invoice needs a connection, and the photo is not saved for later. Try again when you have signal.'
/** …and for any save that needs the server (a fix, Receive): not queued, not done. */
export const WRITE_NEEDS_SIGNAL = 'No signal. This needs a connection and was not saved. Try again when you have signal.'

/** The sentence to show for a failed upload: no answer at all is the signal; anything else is the server's own words. */
export function scanFailure(status: number, error?: string | null): string {
  if (status === 0 || /network request failed|failed to fetch|no api url/i.test(String(error ?? ''))) return NEEDS_SIGNAL
  return error || 'The invoice could not be read. Try again.'
}

/** A typed price in dollars → whole cents. '' → undefined (leave it as it is); not a price → null. */
export function centsOf(typed: unknown): number | null | undefined {
  const s = String(typed ?? '').replace(/[$,\s]/g, '')
  if (!s) return undefined
  const n = Number(s)
  return Number.isFinite(n) && n >= 0 && n <= 100000 ? Math.round(n * 100) : null
}
/** A typed quantity. '' → undefined; not above nothing → null. */
export function qtyOf(typed: unknown): number | null | undefined {
  const s = String(typed ?? '').replace(/[,\s]/g, '')
  if (!s) return undefined
  const n = Number(s)
  return Number.isFinite(n) && n > 0 && n <= 100000 ? n : null
}

/** The body of a correction to one line, or the sentence to show when what was typed is not usable. */
export function fixBody(v: { line?: string; qty?: string; price?: string }): { body: { lines: Array<Record<string, unknown>> } } | { error: string } {
  const n = Number(v.line)
  if (v.line === undefined || v.line === '' || !Number.isInteger(n) || n < 0) return { error: 'Which line?' }
  const qty = qtyOf(v.qty), cost = centsOf(v.price)
  if (qty === null) return { error: 'How many came is a number above nothing.' }
  if (cost === null) return { error: 'The price is a number like 28.99.' }
  if (qty === undefined && cost === undefined) return { error: 'Fill in how many, the price, or both.' }
  return { body: { lines: [{ n, ...(qty !== undefined ? { qty } : {}), ...(cost !== undefined ? { packCostCents: cost } : {}) }] } }
}

export interface ScanLine { n: number; text: string; size: string | null; qty: number | null; packCostCents: number | null; stockName: string | null; packName: string | null; skip: boolean; sure: boolean; matchedBy: string | null; warnings: string[] }

export const lineSubtitle = (l: ScanLine): string | undefined =>
  l.skip ? 'Skipped' : l.stockName ? join(`Goes to ${l.stockName}${l.packName ? ` (${l.packName})` : ''}`, l.warnings[0]) : join('Not matched to a stock item yet', l.warnings.find((w) => !/^Not matched/.test(w)))
export const lineMeta = (l: ScanLine): string | undefined =>
  l.skip ? undefined : join(l.qty === null ? 'How many?' : `${l.qty} ×`, l.packCostCents === null ? 'no price' : money(l.packCostCents / 100))

export function lineRows(d: { lines?: ScanLine[] }): Row[] {
  return (d.lines || []).map((l): Row => ({
    key: String(l.n), title: l.text, subtitle: lineSubtitle(l), meta: lineMeta(l),
    badge: l.skip ? 'Skipped' : l.warnings.length ? 'Check' : undefined, tone: l.skip ? 'neutral' : l.warnings.length ? 'warning' : 'success',
  }))
}

/** A line in the list the sheet offers ("2. Chicken Wings"): the number keeps two lines of one name apart. */
export const lineChoice = (l: ScanLine): string => `${l.n + 1}. ${l.text}`.slice(0, 60)
