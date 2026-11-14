// A quote's lines and its Good / Better / Best options as the New Quote form and PUT /api/quotes/:id/proposal take them — the pieces
// "Create similar" and "From a template" share (quoteTemplates.tsx re-exports them). Plain functions, no screen.
import type { LineItemInput } from './types'

/** A quote's lines as the New Quote form takes them. PUT replaces every line, so the cost and estimating fields ride along. */
export function formLines(lineItems: any[] | undefined, blank: () => LineItemInput): LineItemInput[] {
  if (!lineItems?.length) return [blank()]
  return lineItems.map((li: any) => ({
    description: li.description, quantity: Number(li.quantity), unitPrice: Number(li.unitPrice),
    ...(li.type ? { type: li.type } : {}),
    ...(li.unitCost === null || li.unitCost === undefined ? {} : { unitCost: Number(li.unitCost) }),
    ...(li.pricebookItemId ? { pricebookItemId: li.pricebookItemId } : {}),
    ...(li.optional ? { optional: true, selected: !!li.selected } : {}),
    ...(li.section ? { section: li.section } : {}),
    ...(li.markupPct === null || li.markupPct === undefined ? {} : { markupPct: Number(li.markupPct) }),
    ...(li.allowance ? { allowance: true } : {}),
    ...(li.costCode ? { costCode: li.costCode } : {}),
    ...(li.imageUrl ? { imageUrl: li.imageUrl } : {}),
    ...(li.formulaKey ? { formulaKey: li.formulaKey } : {}),
    ...(li.quantityFormula ? { quantityFormula: li.quantityFormula } : {}),
    ...(li.priceFormula ? { priceFormula: li.priceFormula } : {}),
  }))
}

/**
 * A quote's Good / Better / Best options as PUT /api/quotes/:id/proposal takes them, for "Create similar" (contractor final pass
 * 11/14: the copy dropped the options, while a template kept them). The customer's pick is not copied. Null when it has none.
 */
export function proposalFromQuote(view: any): { sets: any[] } | null {
  const sets = Array.isArray(view?.sets) ? view.sets : []
  if (!sets.length) return null
  const lines = (ls: any[] | undefined) => formLines(ls, () => ({} as LineItemInput)).filter((l: any) => l.description).map(({ optional: _o, selected: _s, ...rest }: any) => rest)
  return {
    sets: sets.map((st: any) => ({
      name: st.name ?? null, kind: st.kind || 'one',
      options: (st.options || []).map((o: any) => ({
        name: o.name, tier: o.tier ?? null, brand: o.brand ?? null, warranty: o.warranty ?? null, description: o.description ?? null,
        photos: Array.isArray(o.photos) ? o.photos : [], recommended: !!o.recommended, attachments: Array.isArray(o.attachments) ? o.attachments : [],
        lines: lines(o.lines), upgrades: o.upgrades?.length ? lines(o.upgrades) : [],
        discount: Number(o.discountCents) > 0 ? { type: 'amount', cents: Number(o.discountCents) } : Number(o.discountPercent) > 0 ? { type: 'percent', percent: Number(o.discountPercent) } : null,
      })),
    })),
  }
}
