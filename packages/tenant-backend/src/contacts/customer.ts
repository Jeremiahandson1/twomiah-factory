// WHO A JOB, A QUOTE OR AN INVOICE IS FOR — one rule for every door that makes or edits one.
//
//   1. A record raised under a PROJECT is for the project's customer when no customer is named. "Add Job" on a project
//      opened the job form with the project filled and the customer empty, so the job read "No customer" although the
//      project had one (contractor live re-test, 2026-10-22). The screen now fills it too; this makes every door agree —
//      the API, an import, a form that was open before the fix.
//   2. A VENDOR IS NEVER THE CUSTOMER. A vendor is who the business buys from. The invoice route refused one already
//      (vendor_not_client); a quote (which becomes an invoice) and a job (which is billed) are held to the same rule. Only
//      a CHANGE of customer is asked, so a record already on a vendor keeps saving as it was.
//
// The customer pickers list customers only (GET /api/contacts?audience=customers), so the refusal is the second half of
// the same rule, never the first thing a person meets.
import { and, eq } from 'drizzle-orm'

export const VENDOR_NOT_CUSTOMER = 'That contact is a vendor — a vendor is who you buy from, not who the work or the bill is for. Pick the customer, or change the contact’s type.'

export interface CustomerTables { contact: any; project?: any }

export type CustomerAnswer =
  | { ok: true; contactId: string | null | undefined; inherited: boolean }
  | { ok: false; status: 400 | 404; error: string; code?: string }

/**
 * The customer a record will have, and whether it may.
 *
 * `given` is the body as the route parsed it: `contactId` undefined means "not said", null or '' means "cleared".
 * `existing` is the record before an edit (absent on a create). The answer's `contactId` is what to write: undefined
 * leaves the column as it is.
 */
export async function resolveCustomer(
  db: any, t: CustomerTables, companyId: string,
  given: { contactId?: string | null; projectId?: string | null },
  existing?: { contactId?: string | null; projectId?: string | null } | null,
): Promise<CustomerAnswer> {
  const said = given.contactId !== undefined
  const named = said && given.contactId ? String(given.contactId) : null

  if (named) {
    const [ct] = await db.select({ id: t.contact.id, type: t.contact.type }).from(t.contact)
      .where(and(eq(t.contact.id, named), eq(t.contact.companyId, companyId))).limit(1)
    if (!ct) return { ok: false, status: 404, error: 'That client does not exist.' }
    if (ct.type === 'vendor' && named !== (existing?.contactId ?? null)) return { ok: false, status: 400, error: VENDOR_NOT_CUSTOMER, code: 'vendor_not_client' }
    return { ok: true, contactId: named, inherited: false }
  }
  // Cleared on purpose: respected. (An edit form posts back an empty customer it never had — that clears nothing, so the
  // project's customer is still taken below.)
  if (said && existing?.contactId) return { ok: true, contactId: null, inherited: false }

  // Not said: the record keeps its customer, or — having none — takes its project's.
  if (existing?.contactId) return { ok: true, contactId: undefined, inherited: false }
  const projectId = given.projectId !== undefined ? given.projectId : existing?.projectId
  if (!projectId || !t.project) return { ok: true, contactId: undefined, inherited: false }
  const [pr] = await db.select({ contactId: t.project.contactId }).from(t.project)
    .where(and(eq(t.project.id, projectId), eq(t.project.companyId, companyId))).limit(1)
  if (!pr?.contactId) return { ok: true, contactId: undefined, inherited: false }
  const [ct] = await db.select({ type: t.contact.type }).from(t.contact)
    .where(and(eq(t.contact.id, pr.contactId), eq(t.contact.companyId, companyId))).limit(1)
  if (!ct || ct.type === 'vendor') return { ok: true, contactId: undefined, inherited: false }
  return { ok: true, contactId: pr.contactId, inherited: true }
}
