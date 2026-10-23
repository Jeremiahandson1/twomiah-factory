// A pricebook item's code (SVC-0001) is the office's filing number, never the customer's (live test 2026-10-22: a quote
// email listed "Standard (SVC-0001)"). The quote and invoice editors put it into the line's description when a line
// was picked from the pricebook (tenant-ui invoicing/ui.tsx pricebookLine); they no longer do, and the line keeps the
// item's id (pricebookItemId) as its link to the book. Lines written before that still carry it, and a signed quote's
// fingerprint covers its stored text, so stored lines are not rewritten: every place that hands a line to a customer —
// the quote email, the PDFs, the portal and the private link — and every place that copies one into a new document
// (quote → invoice, quote → job, job → invoice, QuickBooks) passes it through customerLines first.
//
// Only this business's own codes are taken out, and only where the picker put them: " (CODE)" at the end of the text
// or just before an option's " — Name". A customer's own words in brackets stay.
import { sql } from 'drizzle-orm'

/** This business's pricebook codes. A CRM without a pricebook (no table) has none. */
export async function itemCodes(db: any, companyId: string): Promise<Set<string>> {
  try {
    const res: any = await db.execute(sql`SELECT code FROM pricebook_item WHERE company_id = ${companyId} AND code IS NOT NULL AND code <> ''`)
    const rows: any[] = (res?.rows || res || []) as any[]
    return new Set(rows.map((r) => String(r.code)))
  } catch {
    return new Set()
  }
}

const BRACKETED = /\s\(([^()]{1,50})\)(?=$|\s—\s)/g

/** A line's text with this business's item codes taken out. */
export function withoutItemCodes(description: unknown, codes: Set<string>): string {
  const text = String(description ?? '')
  if (!codes.size || !text.includes('(')) return text
  return text.replace(BRACKETED, (whole, inner: string) => (codes.has(inner.trim()) ? '' : whole))
}

/** Lines as a customer reads them: each description without this business's item codes. */
export async function customerLines<T extends { description?: unknown }>(db: any, companyId: string, lines: T[]): Promise<T[]> {
  if (!lines.length) return lines
  const codes = await itemCodes(db, companyId)
  if (!codes.size) return lines
  return lines.map((l) => ({ ...l, description: withoutItemCodes(l.description, codes) }))
}
