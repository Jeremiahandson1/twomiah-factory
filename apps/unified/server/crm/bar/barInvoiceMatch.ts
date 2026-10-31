// Matching the lines read from a supplier invoice to the venue's stock items (restaurant-bar parity #7). Pure and tested
// (tests/bar-invoice-scan.test.ts): no database, no network.
//
// The rule, in the words the screen uses: a line matches a stock item when it is the same name once the pack words are taken
// out ("Miller Lite 24/12oz Btl" is "Miller Lite"); else when it shares most of its words; else it is left for a person. A line
// a person matched by hand last time is matched the same way next time ("saved"). Every match is only a suggestion until the
// person confirms the whole invoice, and the ones the rule is not sure of are marked for a second look.

export interface StockLite { id: string; name: string; packName: string; packSize: number; vendorId: string | null; packCostCents: number | null }

export interface ReviewLine {
  /** Position on the invoice, from 0. */
  n: number
  /** The description as printed. */
  text: string
  /** The size or pack as printed ("24/12oz", "case of 6"). */
  size: string | null
  /** How many of the invoiced unit came (cases, kegs, each). null: not readable — a person fills it in. */
  qty: number | null
  /** The price of ONE of that unit, in cents. null: not readable (the item's price is then left as it was). */
  packCostCents: number | null
  /** The line's own total as printed, in cents, for the check against qty × price. */
  lineTotalCents: number | null
  stockItemId: string | null
  matchedBy: 'saved' | 'name' | 'manual' | null
  /** The rule is sure of the match (exact name or a saved one, or a clear best). A false one is shown "check this". */
  sure: boolean
  skip: boolean
  /** Added by the person, not read from the invoice. */
  added?: boolean
}

// Words that name the pack or the unit, not the product.
const PACK_WORDS = new Set(['case', 'cs', 'cse', 'ct', 'pk', 'pack', 'pkg', 'of', 'the', 'and', 'ea', 'each', 'bottle', 'bottles', 'btl', 'btls', 'bt', 'can', 'cans', 'keg', 'kegs', 'bbl', 'bag', 'box', 'carton', 'ctn', 'lb', 'lbs', 'oz', 'ml', 'l', 'ltr', 'liter', 'gal', 'gallon', 'x', 'per', 'unit', 'units', 'nr', 'btls', 'loose'])
const SIZE = /^\d+(\.\d+)?(oz|ml|l|lb|lbs|gal|pk|ct|cs|z)?$/
const FRACTION = /^\d+\/\d+$/

/** Lowercase words with the punctuation taken out; a trailing s dropped so "wings" is "wing". */
export function wordsOf(text: string): string[] {
  return String(text ?? '').toLowerCase().replace(/&/g, ' and ').replace(/['’]/g, '').split(/[^a-z0-9/.]+/).map((w) => w.replace(/^[./]+|[./]+$/g, '')).filter(Boolean)
}

/** The product words (no pack words, no sizes), and the size words, of a printed description. */
export function splitWords(text: string): { name: string[]; size: string[] } {
  const name: string[] = [], size: string[] = []
  for (const w of wordsOf(text)) {
    if (SIZE.test(w) || FRACTION.test(w)) { size.push(w); continue }
    // "24/12oz" and "6pk": a number run into a unit.
    if (/^\d/.test(w) && /\d/.test(w)) { size.push(w); continue }
    if (PACK_WORDS.has(w)) continue
    name.push(w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w)
  }
  return { name, size }
}

/** The key a saved match is kept under: the product words, in order of the alphabet, so word order does not matter. */
export const aliasKey = (text: string): string => [...new Set(splitWords(text).name)].sort().join(' ')

const jaccard = (a: string[], b: string[]): number => {
  const A = new Set(a), B = new Set(b)
  if (!A.size || !B.size) return 0
  let inter = 0
  for (const x of A) if (B.has(x)) inter++
  return inter / (A.size + B.size - inter)
}

export interface Suggestion { stockItemId: string; matchedBy: 'saved' | 'name'; sure: boolean }

/**
 * The stock item a printed line most likely is, or null. `aliases` is what people matched by hand before (aliasKey → stock item id).
 * An item of the invoice's own vendor wins a tie, and one with the same pack count is a little better than one without.
 */
export function suggestItem(text: string, size: string | null, stock: StockLite[], aliases: Record<string, string>, vendorId: string | null): Suggestion | null {
  const key = aliasKey(text)
  if (!key) return null
  const saved = aliases[key]
  if (saved && stock.some((s) => s.id === saved)) return { stockItemId: saved, matchedBy: 'saved', sure: true }
  const line = splitWords(text)
  const sizeWords = [...line.size, ...splitWords(size ?? '').size]
  const scored = stock.map((s) => {
    const item = splitWords(s.name)
    let score = jaccard(line.name, item.name)
    if (score > 0 && sizeWords.some((w) => w.replace(/\D/g, '') === String(s.packSize))) score += 0.03
    if (score > 0 && vendorId && s.vendorId === vendorId) score += 0.05
    return { s, score, exact: item.name.length > 0 && aliasKey(s.name) === key }
  }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score)
  const best = scored[0]
  if (!best) return null
  if (best.exact) return { stockItemId: best.s.id, matchedBy: 'name', sure: scored[1]?.exact ? false : true }
  if (best.score < 0.5) return null
  const margin = best.score - (scored[1]?.score ?? 0)
  return { stockItemId: best.s.id, matchedBy: 'name', sure: best.score >= 0.8 && margin >= 0.15 }
}

/** The review lines for what was read: each matched if the rule can, nothing skipped yet. */
export function reviewLines(read: Array<{ text: string; size: string | null; qty: number | null; packCostCents: number | null; lineTotalCents: number | null }>, stock: StockLite[], aliases: Record<string, string>, vendorId: string | null): ReviewLine[] {
  return read.map((l, n) => {
    const m = suggestItem(l.text, l.size, stock, aliases, vendorId)
    return { n, text: l.text, size: l.size, qty: l.qty, packCostCents: l.packCostCents, lineTotalCents: l.lineTotalCents, stockItemId: m?.stockItemId ?? null, matchedBy: m?.matchedBy ?? null, sure: m?.sure ?? false, skip: false }
  })
}

/** The vendor a supplier name on an invoice is, by the same word rule; null when none is close. */
export function suggestVendor(supplier: string | null, vendors: Array<{ id: string; name: string }>): string | null {
  if (!supplier) return null
  const a = splitWords(supplier).name
  let best: { id: string; score: number } | null = null
  for (const v of vendors) {
    const score = jaccard(a, splitWords(v.name).name)
    if (score >= 0.5 && (!best || score > best.score)) best = { id: v.id, score }
  }
  return best?.id ?? null
}

/** Things worth a second look on a line, in words. quantity × price against the line's own total is checked to the cent. */
export function lineWarnings(l: ReviewLine, item: { packCostCents: number | null } | null): string[] {
  const out: string[] = []
  if (l.skip) return out
  if (!l.stockItemId) out.push('Not matched to a stock item yet.')
  else if (!l.sure && l.matchedBy === 'name') out.push('Matched by a guess. Check it is the right item.')
  if (l.qty === null || !(l.qty > 0)) out.push('How many came?')
  if (l.packCostCents === null) out.push('No price read. The item keeps its old price.')
  if (l.qty !== null && l.packCostCents !== null && l.lineTotalCents !== null && Math.abs(Math.round(l.qty * l.packCostCents) - l.lineTotalCents) > Math.max(2, Math.round(l.lineTotalCents * 0.005))) out.push('Quantity times price does not equal the line total on the invoice.')
  if (item && item.packCostCents && l.packCostCents !== null && l.packCostCents > 0) {
    const change = (l.packCostCents - item.packCostCents) / item.packCostCents
    if (Math.abs(change) >= 0.5) out.push(`The price is ${Math.round(Math.abs(change) * 100)}% ${change > 0 ? 'higher' : 'lower'} than last time. Check the size or the quantity.`)
  }
  return out
}
