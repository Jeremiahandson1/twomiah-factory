// The lock a quote's billing takes (crm/billing/quoteBilling.ts): a deposit, a progress invoice and the final invoice of
// one quote are raised one at a time, so two clicks — or the customer approving while the office bills — can never
// together bill more than the quote's total. The same row lock convert-to-invoice takes (packages/tenant-backend
// invoicing/quotes.ts), so the final invoice waits for a progress invoice being raised, and the other way round.
import { sql } from 'drizzle-orm'

export async function lockQuoteRow(tx: any, companyId: string, quoteId: string): Promise<void> {
  await tx.execute(sql`SELECT id FROM quote WHERE id = ${quoteId} AND company_id = ${companyId} FOR UPDATE`)
}
