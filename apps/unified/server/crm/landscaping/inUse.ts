// What holds a property (a `site`): a crew's route stop, a snow contract with its billed visits. A property and a
// customer cascade into both (ON DELETE CASCADE), so each is a guard on every way a property can go — deleting it here
// (sites.ts), deleting it from the customer's page, or deleting the customer (the shared contacts routes). The template
// guarded only snow contracts, only on its own property delete.
import { and, count, eq } from 'drizzle-orm'
import { site, recurringRoute, recurringRouteStop, snowContract } from '../../db/schema/index.ts'

export interface Holder { label: string; plural?: string; count: (id: string) => Promise<number> }

export function propertyHolders(db: any): { bySite: Holder[]; byContact: Holder[] } {
  const n = async (q: Promise<Array<{ value: unknown }>>) => Number((await q)[0]?.value ?? 0)
  return {
    bySite: [
      { label: 'route stop', count: (id) => n(db.select({ value: count() }).from(recurringRouteStop).where(eq(recurringRouteStop.siteId, id))) },
      { label: 'snow contract', count: (id) => n(db.select({ value: count() }).from(snowContract).where(eq(snowContract.siteId, id))) },
    ],
    byContact: [
      {
        label: 'route stop on their properties', plural: 'route stops on their properties',
        count: (id) => n(db.select({ value: count() }).from(recurringRouteStop).innerJoin(site, eq(site.id, recurringRouteStop.siteId)).where(eq(site.contactId, id))),
      },
      {
        label: 'snow contract on their properties', plural: 'snow contracts on their properties',
        count: (id) => n(db.select({ value: count() }).from(snowContract).innerJoin(site, eq(site.id, snowContract.siteId)).where(eq(site.contactId, id))),
      },
    ],
  }
}

/** The routes a property is a stop on, by name. */
export async function routesWithStopAt(db: any, companyId: string, siteId: string): Promise<string[]> {
  const rows = await db.selectDistinct({ name: recurringRoute.name }).from(recurringRouteStop)
    .innerJoin(recurringRoute, eq(recurringRoute.id, recurringRouteStop.recurringRouteId))
    .where(and(eq(recurringRouteStop.siteId, siteId), eq(recurringRouteStop.companyId, companyId)))
  return rows.map((r: { name: string }) => r.name)
}
