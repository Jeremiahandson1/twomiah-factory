// Estimating depth on a quote's lines: phases (sections) with subtotals, a markup on our cost, allowances, cost codes.
// Pure functions, no database — quotes.ts, the PDF and the tests share them. Only a table that has the columns
// (quote_line_item.section …, the unified app's migration 0041) ever sees any of it; the old CRM templates' quotes
// are untouched.
import { round2 } from './money'

/** The price a markup on cost makes: cost × (1 + markup%), to the cent. */
export function priceFromMarkup(unitCost: number, markupPct: number): number {
  return round2(unitCost * (1 + markupPct / 100))
}

/**
 * Lines that carry a markup get their unit price from it. A markup needs the cost it is a markup on: refused in words
 * (with the line's place) rather than guessed. Lines without a markup are left exactly as they were.
 */
export function applyMarkups<T extends { unitCost?: number; markupPct?: number; unitPrice: number; description?: string }>(lines: T[]): { lines: T[] } | { error: string } {
  const out: T[] = []
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    if (l.markupPct === undefined || l.markupPct === null) { out.push(l); continue }
    if (l.unitCost === undefined || l.unitCost === null) {
      return { error: `Line ${i + 1}${l.description ? ` (${String(l.description).split('\n')[0].slice(0, 40)})` : ''} has a markup but no cost to mark up — enter what it costs you, or take the markup off.` }
    }
    out.push({ ...l, unitPrice: priceFromMarkup(l.unitCost, l.markupPct) })
  }
  return { lines: out }
}

export interface SectionGroup<T> {
  /** '' = lines with no section. */
  name: string
  lines: T[]
  /** What the section's counted lines add up to (price). */
  subtotal: number
  /** What the section's counted lines cost us, where costed. */
  cost: number
  /** Of the subtotal, the part that is allowance. */
  allowance: number
}

type L = { section?: string | null; quantity?: unknown; unitPrice?: unknown; unitCost?: unknown; total?: unknown; allowance?: boolean | null; optional?: boolean | null; selected?: boolean | null }

/**
 * Lines grouped by section in the order each section first appears (the order they were entered in), with subtotals.
 * An optional line that is not ticked is shown in its section but does not count, as everywhere else on a quote.
 */
export function groupBySection<T extends L>(lines: T[]): SectionGroup<T>[] {
  const groups = new Map<string, SectionGroup<T>>()
  for (const l of lines) {
    const name = String(l.section ?? '').trim()
    let g = groups.get(name)
    if (!g) { g = { name, lines: [], subtotal: 0, cost: 0, allowance: 0 }; groups.set(name, g) }
    g.lines.push(l)
    const counts = !l.optional || l.selected !== false
    if (!counts) continue
    const total = l.total !== undefined && l.total !== null ? Number(l.total) : Number(l.quantity ?? 1) * Number(l.unitPrice ?? 0)
    g.subtotal = round2(g.subtotal + total)
    if (l.allowance) g.allowance = round2(g.allowance + total)
    if (l.unitCost !== undefined && l.unitCost !== null) g.cost = round2(g.cost + Number(l.quantity ?? 1) * Number(l.unitCost))
  }
  return [...groups.values()]
}

/** Is there anything to show in sections — a named section or an allowance? A plain quote is drawn as it always was. */
export const hasStructure = (lines: L[]): boolean => lines.some((l) => String(l.section ?? '').trim() !== '' || !!l.allowance)

/** The section summary a quote carries (no cost: a customer-facing or non-margin caller must not read it). */
export const sectionSummary = (lines: L[], withCost: boolean) =>
  groupBySection(lines).map((g) => ({ name: g.name, subtotal: g.subtotal, allowance: g.allowance, count: g.lines.length, ...(withCost ? { cost: g.cost } : {}) }))
