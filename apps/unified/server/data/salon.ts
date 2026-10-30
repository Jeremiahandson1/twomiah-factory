// The salon's raw SQL (RULEBOOK §2): the book's lock, the client's lifetime spend, the visit repairs, the win-back list,
// the dashboard's takings by chair and the team report. From templates/crm-salon/backend/src/routes (appointments,
// clients, serviceMenu, memberships, serviceRecords, reminders, dashboard, reporting).
import { and, eq, gte, lte, lt, isNotNull, or, sql, type AnyColumn, type SQL } from 'drizzle-orm'
import { invoice, serviceRecord, serviceMenu, membershipEnrollment, user, teamMember, contact, appointmentItem } from '../db/schema/index.ts'

const rowsOf = (r: any): any[] => ((r as any)?.rows || r) as any[]

/**
 * One mutex per business for the whole check-then-write of a booking: two staff saving the same chair or stylist slot
 * at the same instant are serialised, so the overlap scan an insert relies on can't be raced. Held for the few ms of
 * the check and the write, released at commit.
 */
export async function lockAppointmentBook(tx: any, companyId: string): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${companyId + ':appt'}))`)
}

/** The visit whose id is in `apptId` has a service (an appointment_item row) matching `cond` — a visit with several services (salon #5). */
export const visitHasService = (apptId: AnyColumn, cond: SQL): SQL =>
  sql`exists (select 1 from ${appointmentItem} where ${appointmentItem.appointmentId} = ${apptId} and ${cond})`

/** A service already on this menu by the same name, case aside. (SALON-M5) */
export async function serviceNamedOnMenu(db: any, companyId: string, name: string): Promise<string | null> {
  const [dupe] = await db.select({ id: serviceMenu.id }).from(serviceMenu)
    .where(and(eq(serviceMenu.companyId, companyId), sql`lower(${serviceMenu.name}) = lower(${name})`)).limit(1)
  return dupe?.id ?? null
}

/** Money the client actually paid, net of refunds, across every live invoice (Salon T27 N9). */
export async function clientLifetimePaid(db: any, companyId: string, contactId: string): Promise<number> {
  const [row] = await db
    .select({ paid: sql<string>`COALESCE(SUM(GREATEST(0, COALESCE(${invoice.amountPaid}::numeric, 0) - COALESCE(${invoice.amountRefunded}::numeric, 0))), 0)` })
    .from(invoice)
    .where(and(eq(invoice.contactId, contactId), eq(invoice.companyId, companyId), sql`${invoice.status} NOT IN ('draft', 'void')`))
  return Math.round(Number(row?.paid || 0) * 100) / 100
}

/** Burn one visit credit, in SQL so two front-desk tabs redeeming at once can't both spend the last one. */
export async function takeMembershipCredit(db: any, id: string, companyId: string) {
  const [updated] = await db.update(membershipEnrollment)
    .set({ creditsRemaining: sql`${membershipEnrollment.creditsRemaining} - 1`, updatedAt: new Date() })
    .where(and(eq(membershipEnrollment.id, id), eq(membershipEnrollment.companyId, companyId), sql`${membershipEnrollment.creditsRemaining} > 0`))
    .returning()
  return updated ?? null
}

// ─── The visit repairs (POST /api/service-records/repair-legacy and its undo) ─────────────────────────────────────

/**
 * Sales raised from the book whose visit is gone, holding no money, and with no unlinked visit of the same client and
 * price that could be the one that raised them (T20 H3; the price match was found live: two $50 visits matched two
 * $54.25 invoices — $50 plus 8.5% tax).
 */
export async function orphanVisitSales(db: any, cid: string): Promise<Array<{ id: string; number: string; total: string }>> {
  const r = await db.execute(sql`
    SELECT i.id, i.number, i.total
    FROM invoice i
    WHERE i.company_id = ${cid}
      AND i.notes = 'Created from the appointment book'
      AND i.status <> 'void'
      AND COALESCE(i.amount_paid, '0')::numeric - COALESCE(i.amount_refunded, '0')::numeric <= 0.005
      AND NOT EXISTS (SELECT 1 FROM service_record sr WHERE sr.invoice_id = i.id)
      AND (i.appointment_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM service_record sr2 WHERE sr2.appointment_id = i.appointment_id AND sr2.company_id = ${cid}
      ))
      AND NOT EXISTS (
        SELECT 1 FROM service_record sr3
        WHERE sr3.company_id = ${cid}
          AND sr3.contact_id = i.contact_id
          AND sr3.invoice_id IS NULL
          AND sr3.price_charged IS NOT NULL
          AND round(sr3.price_charged::numeric, 2) = round(i.subtotal::numeric, 2)
      )
  `)
  return rowsOf(r).map((x) => ({ id: x.id, number: x.number, total: x.total }))
}

export async function voidOrphanVisitSale(db: any, id: string, cid: string): Promise<void> {
  await db.execute(sql`
    UPDATE invoice
    SET status = 'void',
        notes = COALESCE(notes || E'\n', '') || 'Voided: the visit this sale came from was deleted before the sale was linked to it.',
        updated_at = NOW()
    WHERE id = ${id} AND company_id = ${cid}
  `)
}

/** Sales voided by a duplicate clean-up whose visit never went anywhere, put back (LYR N3). */
export async function restoreDuplicateVoidedSales(db: any, cid: string): Promise<Array<{ id: string; number: string; total: string }>> {
  const r = await db.execute(sql`
    UPDATE invoice i
    SET status = 'open',
        notes = NULLIF(regexp_replace(i.notes, E'\nVoided: the visit it was raised from was deleted$', ''), ''),
        updated_at = NOW()
    WHERE i.company_id = ${cid}
      AND i.status = 'void'
      AND i.notes LIKE '%Voided: the visit it was raised from was deleted'
      AND EXISTS (
        SELECT 1 FROM service_record sr
        WHERE sr.company_id = ${cid}
          AND (sr.invoice_id = i.id OR (i.appointment_id IS NOT NULL AND sr.appointment_id = i.appointment_id))
      )
    RETURNING i.id, i.number, i.total
  `)
  return rowsOf(r).map((x) => ({ id: x.id, number: x.number, total: x.total }))
}

/** Visits dated to a day that has not happened (T20 M4). */
export async function futureVisits(db: any, cid: string): Promise<Array<{ id: string; performedAt: unknown; createdAt: unknown }>> {
  const r = await db.execute(sql`SELECT id, performed_at, created_at FROM service_record WHERE company_id = ${cid} AND performed_at > NOW()`)
  return rowsOf(r).map((x) => ({ id: x.id, performedAt: x.performed_at, createdAt: x.created_at }))
}

export async function redateVisitToCreation(db: any, id: string, cid: string): Promise<void> {
  await db.execute(sql`UPDATE service_record SET performed_at = created_at, updated_at = NOW() WHERE id = ${id} AND company_id = ${cid}`)
}

/** Visit records standing against an appointment that was cancelled or a no-show (FULL0929 F1). */
export async function visitsOfCancelledAppointments(db: any, cid: string) {
  const r = await db.execute(sql`
    SELECT sr.id, sr.notes, sr.formula, sr.developer_volume, sr.processing_min, sr.performed_at,
           sr.contact_id, a.status AS appointment_status
    FROM service_record sr
    JOIN appointment a ON a.id = sr.appointment_id AND a.company_id = sr.company_id
    WHERE sr.company_id = ${cid} AND a.status IN ('cancelled', 'no_show')
  `)
  return rowsOf(r).map((x) => ({
    id: x.id as string, notes: x.notes as string | null, formula: x.formula, developerVolume: x.developer_volume as string | null,
    processingMin: x.processing_min as number | null, performedAt: x.performed_at, contactId: x.contact_id as string,
    appointmentStatus: x.appointment_status as string,
  }))
}

export async function deleteVisitRecord(db: any, id: string, cid: string): Promise<void> {
  await db.execute(sql`DELETE FROM service_record WHERE id = ${id} AND company_id = ${cid}`)
}

/** Appointment visits with no price, and the price their own sale, quote or menu says (RR2 R3). */
export async function pricelessVisits(db: any, cid: string): Promise<Array<{ id: string; price: unknown }>> {
  // These columns are DECIMAL in this schema, not text: compared to NULL, not to ''.
  const r = await db.execute(sql`
    SELECT sr.id, COALESCE(i.subtotal, a.quoted_price, sm.price) AS price
    FROM service_record sr
    LEFT JOIN invoice i ON i.appointment_id = sr.appointment_id AND i.company_id = ${cid} AND i.status <> 'void'
    LEFT JOIN appointment a ON a.id = sr.appointment_id AND a.company_id = ${cid}
    LEFT JOIN service_menu sm ON sm.id = sr.service_id AND sm.company_id = ${cid}
    WHERE sr.company_id = ${cid} AND sr.appointment_id IS NOT NULL AND sr.price_charged IS NULL
  `)
  return rowsOf(r).map((x) => ({ id: x.id, price: x.price }))
}

export async function setVisitPrice(db: any, id: string, cid: string, price: string): Promise<void> {
  await db.execute(sql`UPDATE service_record SET price_charged = ${price}, updated_at = NOW() WHERE id = ${id} AND company_id = ${cid}`)
}

/** Put back the invoices the repair voided — the repair signs its work with an exact note. */
export async function undoOrphanVoids(db: any, cid: string): Promise<Array<{ id: string; number: string; total: string }>> {
  const r = await db.execute(sql`
    UPDATE invoice
    SET status = 'open',
        notes = NULLIF(regexp_replace(notes, E'\nVoided: the visit this sale came from was deleted before the sale was linked to it\\.$', ''), ''),
        updated_at = NOW()
    WHERE company_id = ${cid}
      AND status = 'void'
      AND notes LIKE '%Voided: the visit this sale came from was deleted before the sale was linked to it.'
    RETURNING id, number, total
  `)
  return rowsOf(r).map((x) => ({ id: x.id, number: x.number, total: x.total }))
}

// ─── Recall ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** Clients whose last visit is before the cutoff, highest spend first, at most `cap`. */
export async function lapsedClients(db: any, companyId: string, cutoffIso: string, cap: number) {
  const rows = await db.select({
    contactId: contact.id,
    clientName: contact.name,
    clientEmail: contact.email,
    clientPhone: contact.phone,
    clientMobile: contact.mobile,
    lastVisit: sql<string | null>`max(${serviceRecord.performedAt})`,
    visits: sql<number>`count(${serviceRecord.id})`,
    lifetimeValue: sql<string>`coalesce(sum(${serviceRecord.priceCharged}), 0)`,
  })
    .from(contact)
    .innerJoin(serviceRecord, eq(serviceRecord.contactId, contact.id))
    .where(and(eq(contact.companyId, companyId), eq(serviceRecord.companyId, companyId)))
    .groupBy(contact.id)
    .having(sql`max(${serviceRecord.performedAt}) < ${cutoffIso}`)
    .orderBy(sql`coalesce(sum(${serviceRecord.priceCharged}), 0) desc`)
    .limit(cap)
  return rows as Array<{ contactId: string; clientName: string | null; clientEmail: string | null; clientPhone: string | null; clientMobile: string | null; lastVisit: string | null; visits: number; lifetimeValue: string }>
}

// ─── The dashboard and the team report ──────────────────────────────────────────────────────────────────────────

/** This month's visits and takings by chair, whichever column holds the stylist (Salon T27 N5). */
export async function takingsByChair(db: any, companyId: string, from: Date, to: Date) {
  return db.select({
    stylistId: serviceRecord.stylistId,
    stylistMemberId: serviceRecord.stylistMemberId,
    firstName: user.firstName,
    lastName: user.lastName,
    memberName: teamMember.name,
    visits: sql<number>`count(*)`,
    revenue: sql<string>`coalesce(sum(${serviceRecord.priceCharged}), 0)`,
  })
    .from(serviceRecord)
    .leftJoin(user, eq(serviceRecord.stylistId, user.id))
    .leftJoin(teamMember, eq(serviceRecord.stylistMemberId, teamMember.id))
    .where(and(eq(serviceRecord.companyId, companyId), gte(serviceRecord.performedAt, from), lt(serviceRecord.performedAt, to), or(isNotNull(serviceRecord.stylistId), isNotNull(serviceRecord.stylistMemberId))))
    .groupBy(serviceRecord.stylistId, serviceRecord.stylistMemberId, user.firstName, user.lastName, teamMember.name) as Promise<Array<{ stylistId: string | null; stylistMemberId: string | null; firstName: string | null; lastName: string | null; memberName: string | null; visits: number; revenue: string }>>
}

/**
 * Team productivity for a salon: the services each chair performed and what they took, by both kinds of stylist — a
 * login user and a roster stylist (Salon T28 M6). The shared report counts hours and jobs, which a salon has neither of.
 */
export async function salonTeamProductivity(db: any, companyId: string, range: { gte?: Date; lte?: Date }) {
  const where = [eq(serviceRecord.companyId, companyId)]
  if (range?.gte) where.push(gte(serviceRecord.performedAt, range.gte))
  if (range?.lte) where.push(lte(serviceRecord.performedAt, range.lte))

  const rows = await db
    .select({
      firstName: user.firstName,
      lastName: user.lastName,
      memberName: teamMember.name,
      services: sql<number>`count(*)`,
      revenue: sql<string>`COALESCE(SUM(COALESCE(${serviceRecord.priceCharged}::numeric, 0)), 0)`,
    })
    .from(serviceRecord)
    .leftJoin(user, eq(serviceRecord.stylistId, user.id))
    .leftJoin(teamMember, eq(serviceRecord.stylistMemberId, teamMember.id))
    .where(and(...where))
    .groupBy(user.firstName, user.lastName, teamMember.name)

  const out: Array<{ user: { firstName: string; lastName?: string }; servicesCompleted: number; revenue: number }> = []
  for (const r of rows as any[]) {
    const login = [r.firstName, r.lastName].filter(Boolean).join(' ').trim()
    const name = login || String(r.memberName || '').trim()
    if (!name) continue // an unassigned visit is not a person
    const parts = name.split(/\s+/)
    out.push({
      user: { firstName: parts[0], lastName: parts.slice(1).join(' ') || undefined },
      servicesCompleted: Number(r.services || 0),
      revenue: Math.round(Number(r.revenue || 0) * 100) / 100,
    })
  }
  return out.sort((a, b) => b.revenue - a.revenue || b.servicesCompleted - a.servicesCompleted)
}
