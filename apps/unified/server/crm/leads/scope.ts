// WHOSE ENQUIRIES AND QUOTES A SEAT READS here — the inbox's own rule (packages/tenant-backend leads.ts ownLeads, quotes.ts ownQuotes) for
// the doors that live in this app: Lost, the site visit and the pipeline strip. Every one with leads:read-all / quotes:read-all (admin and
// manager; a viewer reads every quote), else the contractor's Sales rep's own: the enquiries assigned to it, the quotes it wrote or is the
// salesperson on (contractor live test 11/07). Null for all; a failed check narrows.
import { eq, or } from 'drizzle-orm'
import { lead, quote } from '../../db/schema/index.ts'
import { canSeeWith, type CrmDeps } from '../deps.ts'

export async function ownLeadsWhere(d: CrmDeps, me: { role: string; userId: string }) {
  // A seat that reads no enquiries at all (no leads:read — a field seat a company granted leads:update) is not narrowed: the route's own
  // permission decides, as the inbox's door does (packages/tenant-backend leads.ts ownLeadDoor). Only a seat that reads its own is.
  let reads = false, all = false
  try { reads = !!(await canSeeWith(d.permissions)(me.role, 'leads:read', me.userId)) } catch { reads = true } // a failed check narrows
  if (!reads) return null
  try { all = !!(await canSeeWith(d.permissions)(me.role, 'leads:read-all', me.userId)) } catch { all = false }
  return all ? null : eq(lead.assignedToId, String(me.userId))
}

export async function ownQuotesWhere(d: CrmDeps, me: { role: string; userId: string }) {
  let all = false
  try { all = !!(await canSeeWith(d.permissions)(me.role, 'quotes:read-all', me.userId)) } catch { all = false }
  const id = String(me.userId)
  return all ? null : or(eq(quote.createdById, id), eq(quote.salespersonId, id))!
}
