// The veterinary visit's SQL (moved from templates/crm-vet/backend/src/routes/visits.ts): the row lock that makes
// billing a visit happen once.
import { sql } from 'drizzle-orm'

const rowsOf = (r: any): any[] => (r?.rows ?? r ?? []) as any[]

/**
 * The visit, locked FOR UPDATE inside the caller's transaction, scoped to the company so one tenant cannot block
 * another's row by id. A second request to bill it waits here until the first commits, then reads the invoice the
 * first one wrote. (T41)
 */
export async function lockVisitForBilling(tx: any, companyId: string, visitId: string): Promise<{ id: string; patientId: string; total: string | null; invoiceId: string | null; visitDate: Date | null } | null> {
  const rows = rowsOf(await tx.execute(
    sql`SELECT id, patient_id, total, invoice_id, visit_date FROM visit WHERE id = ${visitId} AND company_id = ${companyId} FOR UPDATE`,
  ))
  const v = rows[0]
  if (!v) return null
  return { id: v.id, patientId: v.patient_id, total: v.total, invoiceId: v.invoice_id, visitDate: v.visit_date ? new Date(v.visit_date) : null }
}
