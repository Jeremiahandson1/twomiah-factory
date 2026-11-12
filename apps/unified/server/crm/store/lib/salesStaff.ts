// WHO A SALE IS CREDITED TO (Shopify POS's attributed staff; the Sales by staff report): the company's active logins, a read-only
// seat (viewer) excepted — the same rule as who may be given work (@twomiah/tenant-backend NOT_GIVEN_WORK_ROLES). Named as the team
// picker names them: first and last name, else the email.
import { and, asc, eq, inArray, notInArray } from 'drizzle-orm'
import { NOT_GIVEN_WORK_ROLES } from '@twomiah/tenant-backend'
import { user } from '../../../db/schema/index.ts'

export interface SalesPerson { userId: string; name: string }

export function createSalesStaff(db: any) {
  const nameOf = (u: { firstName?: string | null; lastName?: string | null; email?: string | null }) => `${u.firstName || ''} ${u.lastName || ''}`.trim() || String(u.email || 'Staff')
  const base = (companyId: string) => and(eq(user.companyId, companyId), eq(user.isActive, true), notInArray(user.role, [...NOT_GIVEN_WORK_ROLES]))

  /** Everyone a sale may be credited to, by first name. */
  async function list(companyId: string): Promise<SalesPerson[]> {
    const rows = await db.select({ id: user.id, firstName: user.firstName, lastName: user.lastName, email: user.email }).from(user).where(base(companyId)).orderBy(asc(user.firstName), asc(user.id))
    return rows.map((u: any) => ({ userId: u.id, name: nameOf(u) }))
  }

  /** The people these ids name, where each may be credited (another company's, inactive or a viewer is left out). */
  async function resolve(companyId: string, ids: string[]): Promise<Map<string, SalesPerson>> {
    const out = new Map<string, SalesPerson>()
    const want = [...new Set(ids.filter(Boolean))]
    if (!want.length) return out
    const rows = await db.select({ id: user.id, firstName: user.firstName, lastName: user.lastName, email: user.email }).from(user).where(and(base(companyId), inArray(user.id, want)))
    for (const u of rows as any[]) out.set(u.id, { userId: u.id, name: nameOf(u) })
    return out
  }

  return { list, resolve }
}
