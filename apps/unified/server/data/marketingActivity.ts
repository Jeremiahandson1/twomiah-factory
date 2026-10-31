// What "a customer coming back" means in each trade, as SQL for the shared marketing module (RULEBOOK §2: raw SQL lives
// here). 2026-10-30, store gap 3: the win-back email and the "not back in N days" audience read one value per customer —
// the moment of their latest job (trades), visit (salon, vet, bar), repair order (RV), event (restaurant) or paid order
// (store) — in the trade's own terms. A customer with none has no value and is never counted as lapsed.
//
// The value is a correlated subquery over `contact`, so it can be dropped into a WHERE or a SELECT of the contact table.
import { sql, eq, inArray, type SQL } from 'drizzle-orm'
import { contact } from '../db/schema/index.ts'
import { storeCustomerGroup } from '../db/schema/store.ts'

/** The latest of a customer's jobs: done, or booked (a booked job in the future means they have not lapsed). Not cancelled. */
const jobs = sql`(SELECT max(coalesce(j.completed_at, j.scheduled_date, j.created_at)) FROM job j WHERE j.contact_id = ${contact.id} AND j.status <> 'cancelled')`

/** Trade → its value and the word for one. A trade not listed has no email marketing, or no clear "came back". */
export function lastActivityFor(featureSet: string | undefined): { sql: SQL; word: string } | undefined {
  switch (featureSet) {
    case 'crm': case 'crm-fieldservice': case 'crm-landscaping': case 'crm-basic':
      return { sql: jobs, word: 'job' }
    case 'crm-salon':
      return { sql: sql`(SELECT max(s.performed_at) FROM service_record s WHERE s.contact_id = ${contact.id})`, word: 'visit' }
    case 'crm-vet':
      return { sql: sql`(SELECT max(v.visit_date) FROM visit v JOIN patient p ON p.id = v.patient_id WHERE p.owner_id = ${contact.id})`, word: 'visit' }
    case 'crm-rv':
      return { sql: sql`(SELECT max(r.write_up_date) FROM repair_order r WHERE r.customer_id = ${contact.id})`, word: 'visit' }
    case 'crm-bar':
      return { sql: sql`(SELECT max(b.closed_at) FROM bar_check b WHERE b.contact_id = ${contact.id} AND b.status = 'paid')`, word: 'visit' }
    case 'crm-restaurant':
      return { sql: sql`(SELECT max(e.event_date)::timestamp FROM event e WHERE e.contact_id = ${contact.id} AND e.status IN ('confirmed', 'completed'))`, word: 'event' }
    case 'crm-store':
      // A sale that counts (the sales reports' rule): not an unfinished checkout, not a cancelled order — a refunded sale still was one.
      return { sql: sql`(SELECT max(o.created_at) FROM orders o WHERE o.contact_id = ${contact.id} AND o.status NOT IN ('pending', 'cancelled'))`, word: 'order' }
    default:
      return undefined
  }
}

/** The store's own audience filter: customers in one customer group. A value that is not a group id matches nobody. */
export function inCustomerGroup(value: unknown, companyId: string): SQL | undefined {
  if (typeof value !== 'string' || !value) return undefined
  return inArray(contact.id, sql`(SELECT m.contact_id FROM store_customer_group_members m WHERE m.group_id = ${value} AND m.company_id = ${companyId})` as any)
}

/** The company's customer groups, for the audience picker. */
export async function customerGroupOptions(db: any, companyId: string): Promise<Array<{ id: string; name: string }>> {
  return db.select({ id: storeCustomerGroup.id, name: storeCustomerGroup.name }).from(storeCustomerGroup).where(eq(storeCustomerGroup.companyId, companyId)).orderBy(storeCustomerGroup.name)
}
