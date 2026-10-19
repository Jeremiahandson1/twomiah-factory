// The private-events module's raw SQL (server/crm/restaurant): the locks that serialise a business's book and an
// event's ledger, the invoice row lock, a room's case-blind name match, and the one-time backfill's query. Moved from
// templates/crm-restaurant/backend/src/services/{eventBooking,eventLedger}.ts and routes/eventSpaces.ts.
import { sql, and, eq, ne } from 'drizzle-orm'
import { eventSpace } from '../db/schema/index.ts'

/**
 * One advisory lock per business serialises a booking's check-then-write, so two coordinators holding the same
 * space+date at the same instant can't both pass the clash check. Held until the transaction ends.
 */
export async function lockEventBook(tx: any, companyId: string): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${companyId + ':event'}))`)
}

/** One event's ledger at a time: its schedule, its menu and its invoice change together. */
export async function lockEventLedger(tx: any, companyId: string, eventId: string): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${companyId + ':event-ledger:' + eventId}))`)
}

/**
 * Row-lock the event's invoice like the shared payment/refund/void handlers do, so a total can't be lowered
 * underneath a payment landing at the same instant.
 */
export async function lockEventInvoiceRow(tx: any, companyId: string, eventId: string): Promise<void> {
  await tx.execute(sql`SELECT id FROM invoice WHERE event_id = ${eventId} AND company_id = ${companyId} FOR UPDATE`)
}

/** A live (active) room of this business with the same name, ignoring case; a retired room's name may be reused. */
export async function liveSpaceNamed(db: any, companyId: string, name: string, ignoreId?: string): Promise<{ id: string; name: string } | undefined> {
  const rows = await db.select({ id: eventSpace.id, name: eventSpace.name }).from(eventSpace)
    .where(and(eq(eventSpace.companyId, companyId), eq(eventSpace.active, true), sql`lower(${eventSpace.name}) = lower(${name})`, ...(ignoreId ? [ne(eventSpace.id, ignoreId)] : [])))
    .limit(1)
  return rows[0]
}

/** Events with a payment schedule recorded before the ledger lived on invoices: no invoice carries them yet. */
export async function eventsWithPaymentsAndNoInvoice(db: any): Promise<Array<{ eventId: string; companyId: string }>> {
  const res: any = await db.execute(sql`
    SELECT DISTINCT ep.event_id AS "eventId", ep.company_id AS "companyId"
    FROM event_payment ep LEFT JOIN invoice i ON i.event_id = ep.event_id
    WHERE i.id IS NULL`)
  return (res?.rows ?? res ?? []) as Array<{ eventId: string; companyId: string }>
}
