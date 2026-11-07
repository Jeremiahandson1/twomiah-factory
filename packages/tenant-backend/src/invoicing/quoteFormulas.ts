// Formula estimating on a saved quote (contractor parity row 9; quote_formulas): work its formula lines out again — after its
// parameters change, or its project's — and the totals with them. The formulas themselves are formulas.ts. A quote whose
// formulas no longer work out (a parameter removed that a line reads) is left exactly as it was and the answer says why.
import { and, asc, eq } from 'drizzle-orm'
import { round2 } from './money'
import { workOut, mergeParameters, type Parameter } from './formulas'
import { retotalQuote } from './quoteOptions'

/** Does this app's schema carry the formula columns? A template's does not, and keeps what it had. */
export const quoteHasFormulas = (t: { quote: any; quoteLineItem: any }) => !!t.quoteLineItem?.quantityFormula && !!t.quote?.parameters

/** The parameters a quote's formulas read: its project's, with the quote's own over them. */
export async function parametersFor(db: any, t: { project?: any }, companyId: string, quote: { projectId?: string | null; parameters?: unknown }, own?: Parameter[]) {
  let fromProject: Parameter[] = []
  if (quote.projectId && t.project?.parameters) {
    const [p] = await db.select({ parameters: t.project.parameters }).from(t.project).where(and(eq(t.project.id, quote.projectId), eq(t.project.companyId, companyId))).limit(1)
    fromProject = Array.isArray(p?.parameters) ? p.parameters : []
  }
  return mergeParameters(fromProject, own ?? (Array.isArray(quote.parameters) ? (quote.parameters as Parameter[]) : []))
}

/** The words a save refuses with: which line, and what is wrong with its formula. */
export const formulaRefusal = (lines: Array<{ description?: string }>, e: { line: number; message: string }) =>
  `Line ${e.line + 1}${lines[e.line]?.description ? ` ("${String(lines[e.line].description).slice(0, 60)}")` : ''}: ${e.message}`

export async function recalculateQuote(db: any, t: { quote: any; quoteLineItem: any; project?: any; quoteProposalOption?: any }, companyId: string, quoteId: string):
  Promise<{ quote: any; lineItems: any[]; changed: number } | { error: string } | null> {
  const [q] = await db.select().from(t.quote).where(and(eq(t.quote.id, quoteId), eq(t.quote.companyId, companyId))).limit(1)
  if (!q) return null
  const lines = await db.select().from(t.quoteLineItem).where(eq(t.quoteLineItem.quoteId, quoteId)).orderBy(asc(t.quoteLineItem.sortOrder), asc(t.quoteLineItem.id))
  if (!lines.some((l: any) => l.quantityFormula || l.priceFormula)) return { quote: q, lineItems: lines, changed: 0 }
  const worked = workOut(lines.map((l: any) => ({ ...l, quantity: Number(l.quantity), unitPrice: Number(l.unitPrice) })), await parametersFor(db, t, companyId, q))
  if (worked.firstError) return { error: formulaRefusal(lines, worked.firstError) }
  let changed = 0
  await db.transaction(async (tx: any) => {
    for (let i = 0; i < lines.length; i++) {
      const r = worked.results[i], l = lines[i]
      const qty = r.quantity ?? Number(l.quantity), price = r.unitPrice ?? Number(l.unitPrice)
      if (qty === Number(l.quantity) && price === Number(l.unitPrice)) continue
      await tx.update(t.quoteLineItem).set({ quantity: qty.toString(), unitPrice: price.toString(), total: round2(qty * price).toString() }).where(eq(t.quoteLineItem.id, l.id))
      changed += 1
    }
  })
  const again = await retotalQuote(db, t, companyId, quoteId)
  return again ? { ...again, changed } : null
}
