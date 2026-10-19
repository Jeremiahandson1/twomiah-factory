// What this group's routers share: whether an id names someone (or a client) of the signed-in person's company, and the
// CSV escape the payroll exports use.
//
// The template's database held one agency, so any caregiver or client id was the agency's. Here a write that names a
// person or a client — an office recording a trip, a rate, a time-off request or an expense for someone — must name one
// of its own company's, or a row of this company would point into another's.
import { and, eq } from 'drizzle-orm'
import { clients, user } from '../../../db/schema/index.ts'
import type { CrmDeps } from '../../deps.ts'

/**
 * The gate of a self-service payroll path (a person's own mileage, time off, rates, payday confirmation): whoever holds
 * care-payroll:<verb> (the office, everyone's), or my-pay:<verb> (their own — a caregiver holds it; the route narrows
 * them to themselves, as the template's open-to-anyone-signed-in paths did). Both are permissions, so an owner can
 * grant or take either from one person (Settings › Users); no role is compared.
 */
export const payrollOrCaregiver = (d: CrmDeps, verb: 'read' | 'create') =>
  d.permissions.requireAnyPermission([`care-payroll:${verb}`, `my-pay:${verb}`])

/** Is `id` a person of this company? */
export async function isCompanyPerson(d: CrmDeps, companyId: string, id: unknown): Promise<boolean> {
  if (typeof id !== 'string' || !id) return false
  const [u] = await d.db.select({ id: user.id }).from(user).where(and(eq(user.id, id), eq(user.companyId, companyId))).limit(1)
  return !!u
}

/** Is `id` a client of this company? */
export async function isCompanyClient(d: CrmDeps, companyId: string, id: unknown): Promise<boolean> {
  if (typeof id !== 'string' || !id) return false
  const [c] = await d.db.select({ id: clients.id }).from(clients).where(and(eq(clients.id, id), eq(clients.companyId, companyId))).limit(1)
  return !!c
}

/** Escape a string for CSV output: doubled quotes, and a leading formula character neutralised (Excel injection). */
export function csvEscape(val: string | null | undefined): string {
  if (!val) return ''
  let s = val.replace(/"/g, '""')
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s
  return s
}
