// A supplier's prices on a material order, and the lock (docs/parity/roof-material-list.md #10). Roofr creates an order "locked
// to that supplier": the prices are the supplier's, they cannot be typed over, and changing the supplier clears them. This is
// the pure half — matching a line to a price-list item, pricing, re-locking an edited order, clearing — with money in integer
// cents; the routes (field/materialSupplyRoutes.ts, field/materials.ts) do the reading and writing.

/** Words a supplier goes by, so "ABC Supply", "abc_supply" and "ABC" are one supplier (and so are Beacon and QXO, which bought it). */
const ALIASES: Array<[string, string[]]> = [
  ['abc', ['abc', 'abcsupply', 'abcsupplyco', 'abcsupplycoinc']],
  ['qxo', ['qxo', 'beacon', 'beaconroofingsupply', 'beaconbuildingproducts', 'beaconpro']],
  ['srs', ['srs', 'srsdistribution', 'srsbuildingproducts']],
]
const norm = (v: unknown) => String(v ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '')
/** One key for one supplier, whichever way its name was typed. */
export const supplierKey = (name: unknown): string => {
  const n = norm(name)
  return ALIASES.find(([, names]) => names.includes(n))?.[0] ?? n
}
export const sameSupplier = (a: unknown, b: unknown) => supplierKey(a) !== '' && supplierKey(a) === supplierKey(b)

export interface PriceItem { id: string; code: string | null; sku: string | null; description: string; unit: string; unitPriceCents: number }
export interface OrderLine {
  code?: string; sku?: string; description: string; qty: number; unit: string; unitPrice?: number; total?: number
  /** Set on a line priced from a supplier list: the price cannot be typed over. */
  priceLocked?: boolean; priceSource?: { listId: string; itemId: string; sku: string | null }
}

/** The item a line is the price of: its kind of line (code), else its SKU, else its words. */
export function matchItem(line: Pick<OrderLine, 'code' | 'sku' | 'description'>, items: PriceItem[]): PriceItem | null {
  if (line.code) { const hit = items.find((i) => i.code && i.code === line.code); if (hit) return hit }
  if (line.sku) { const hit = items.find((i) => i.sku && norm(i.sku) === norm(line.sku)); if (hit) return hit }
  const words = norm(line.description)
  return words ? items.find((i) => norm(i.description) === words) ?? null : null
}

const cents = (qty: number, priceCents: number) => Math.round(qty * priceCents)
const dollars = (c: number) => c / 100

function lock(line: OrderLine, item: PriceItem, listId: string): OrderLine {
  return {
    ...line, unitPrice: dollars(item.unitPriceCents), total: dollars(cents(line.qty, item.unitPriceCents)),
    priceLocked: true, priceSource: { listId, itemId: item.id, sku: item.sku },
  }
}
/** A line with its price taken off. */
export function unpriced(line: OrderLine): OrderLine {
  const { priceLocked: _l, priceSource: _s, ...rest } = line
  return { ...rest, unitPrice: 0, total: 0 }
}

export const totalOf = (lines: OrderLine[]) => dollars(lines.reduce((s, l) => s + Math.round(Number(l.total ?? 0) * 100), 0))

/** Every line priced from the list; a line the list does not have comes back unpriced and is named in `unmatched`. */
export function priceLines(lines: OrderLine[], items: PriceItem[], listId: string): { lines: OrderLine[]; unmatched: string[]; total: number } {
  const unmatched: string[] = []
  const out = lines.map((l) => {
    const item = matchItem(l, items)
    if (!item) { unmatched.push(l.description); return unpriced(l) }
    return lock(l, item, listId)
  })
  return { lines: out, unmatched, total: totalOf(out) }
}

/** Every price off the order (the supplier changed, or the roofer took the supplier's pricing away). */
export const clearPricing = (lines: OrderLine[]): OrderLine[] => lines.map(unpriced)

/**
 * An edited order whose prices are locked. A line that was priced keeps the supplier's price whatever was typed over it (its
 * quantity is the roofer's); a line the roofer added is priced from the list if the list has it, else keeps what was typed.
 */
export function relock(edited: OrderLine[], before: OrderLine[], items: PriceItem[], listId: string): OrderLine[] {
  const was = (l: OrderLine) => before.find((b) => b.priceLocked && b.priceSource && ((l.code && b.code === l.code) || norm(b.description) === norm(l.description)))
  return edited.map((l) => {
    const prior = was(l)
    if (prior?.priceSource) {
      const item = items.find((i) => i.id === prior.priceSource!.itemId)
      // The price at the time it was locked (the list may have changed since; the order keeps the price it was given).
      const unitCents = Math.round(Number(prior.unitPrice ?? 0) * 100)
      return { ...l, unitPrice: dollars(unitCents), total: dollars(cents(l.qty, unitCents)), priceLocked: true, priceSource: item ? { listId, itemId: item.id, sku: item.sku } : prior.priceSource }
    }
    const item = matchItem(l, items)
    return item ? lock(l, item, listId) : l
  })
}

// ── a price list typed or pasted in ──────────────────────────────────────────────────────────────────────────────────────

export interface ParsedItem { code: string | null; sku: string | null; description: string; unit: string; unitPriceCents: number }

/** "$1,234.50" → 123450. Null when it is not a price (negative, blank, words). */
export function dollarsToCents(v: unknown): number | null {
  const text = String(v ?? '').trim().replace(/^\$/, '').replace(/,/g, '')
  if (!/^\d+(\.\d{1,4})?$/.test(text)) return null
  return Math.round(Number(text) * 100)
}

function csvRows(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = [], cell = '', quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++ } else if (ch === '"') quoted = false; else cell += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',' || ch === '\t') { row.push(cell); cell = '' }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = '' }
    else cell += ch
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row) }
  return rows.filter((r) => r.some((c) => c.trim() !== ''))
}

const HEADERS: Record<string, string[]> = {
  sku: ['sku', 'item', 'itemnumber', 'itemno', 'part', 'partnumber', 'productcode'],
  description: ['description', 'itemdescription', 'name', 'product', 'material'],
  unit: ['unit', 'uom', 'unitofmeasure'],
  price: ['price', 'unitprice', 'cost', 'netprice', 'yourprice'],
  code: ['code', 'listcode', 'kind'],
}

/** A price list pasted from a spreadsheet: a header row naming description and price (and optionally sku, unit, code), one item a row. */
export function parsePriceCsv(text: string): { items: ParsedItem[]; errors: string[] } {
  const rows = csvRows(String(text ?? ''))
  if (rows.length < 2) return { items: [], errors: ['Paste the list with a header row (description, price, and optionally sku, unit, code) and at least one item.'] }
  const head = rows[0].map(norm)
  const at = (k: keyof typeof HEADERS) => head.findIndex((h) => HEADERS[k].includes(h))
  const col = { sku: at('sku'), description: at('description'), unit: at('unit'), price: at('price'), code: at('code') }
  if (col.description < 0 || col.price < 0) return { items: [], errors: ['The header row needs a "description" column and a "price" column.'] }
  const items: ParsedItem[] = [], errors: string[] = []
  rows.slice(1).forEach((r, i) => {
    const line = i + 2
    const description = (r[col.description] ?? '').trim()
    const price = dollarsToCents(r[col.price])
    if (!description) { errors.push(`Row ${line}: the description is empty.`); return }
    if (price === null) { errors.push(`Row ${line}: "${(r[col.price] ?? '').trim()}" is not a price.`); return }
    items.push({
      description, unitPriceCents: price, unit: (col.unit >= 0 && (r[col.unit] ?? '').trim()) || 'ea',
      sku: col.sku >= 0 ? (r[col.sku] ?? '').trim() || null : null, code: col.code >= 0 ? (r[col.code] ?? '').trim() || null : null,
    })
  })
  return { items, errors }
}
