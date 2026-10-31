// The salon's raw SQL (RULEBOOK §2): the book's lock, the client's lifetime spend, the visit repairs, the win-back list,
// the dashboard's takings by chair and the team report. From templates/crm-salon/backend/src/routes (appointments,
// clients, serviceMenu, memberships, serviceRecords, reminders, dashboard, reporting).
import { and, eq, gte, lte, lt, isNotNull, or, sql, type AnyColumn, type SQL } from 'drizzle-orm'
import { invoice, serviceRecord, serviceMenu, membershipEnrollment, user, teamMember, contact, appointmentItem, salonGiftCard, appointment, invoiceLineItem, payment, salonStockMove, salonRetailSale, salonRetailProduct, saleTipSplit } from '../db/schema/index.ts'

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

/**
 * THE one definition of "this invoice is not revenue": it is the sale of a gift card. Selling a card is a liability (money owed to the
 * holder), not income; the income is counted when the card is SPENT, as a payment by gift card on the service or product it paid for.
 * Without this a $50 card sold and then spent on a $50 service read as $100 in every invoice-based total. Every place that adds
 * invoices up uses this one condition (follow-up 10/30 to PR #167): the shared Reports and the invoice list's stats are handed it by
 * the salon vertical (CrmSettings.invoices.giftCardSalesAreLiability), and the client's lifetime spend below uses it directly. It reads
 * the card's own row (salon_gift_card.invoice_id), not the invoice's lines, so editing a sale's lines cannot turn it back into revenue.
 */
export const notGiftCardSale: SQL = sql`NOT EXISTS (SELECT 1 FROM ${salonGiftCard} WHERE ${salonGiftCard.invoiceId} = ${invoice.id})`

/** Money the client actually paid, net of refunds, across every live invoice that is revenue (Salon T27 N9; gift-card sales are not, follow-up 10/30). */
export async function clientLifetimePaid(db: any, companyId: string, contactId: string): Promise<number> {
  const [row] = await db
    .select({ paid: sql<string>`COALESCE(SUM(GREATEST(0, COALESCE(${invoice.amountPaid}::numeric, 0) - COALESCE(${invoice.amountRefunded}::numeric, 0))), 0)` })
    .from(invoice)
    .where(and(eq(invoice.contactId, contactId), eq(invoice.companyId, companyId), sql`${invoice.status} NOT IN ('draft', 'void')`, notGiftCardSale))
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

// ─── Retention sends (crm/salon/retention.ts) ─────────────────────────────────────────────────────────────────────────

/** Clients whose most recent visit was on or after `from` and before `to` — the ones who crossed a lapse line in that stretch. */
export async function clientsLastSeenBetween(db: any, companyId: string, from: string, to: string, cap: number) {
  const rows = await db.select({ contactId: contact.id, lastVisit: sql<string | null>`max(${serviceRecord.performedAt})` })
    .from(contact)
    .innerJoin(serviceRecord, eq(serviceRecord.contactId, contact.id))
    .where(and(eq(contact.companyId, companyId), eq(serviceRecord.companyId, companyId)))
    .groupBy(contact.id)
    .having(sql`max(${serviceRecord.performedAt}) >= ${from} and max(${serviceRecord.performedAt}) < ${to}`)
    .limit(cap)
  return rows as Array<{ contactId: string; lastVisit: string | null }>
}

/** The active follow-up sequences a trigger starts (marketing's drip_sequence, trigger 'visit_completed' or 'lapsed'). */
export async function activeSequencesForTrigger(db: any, companyId: string, trigger: string): Promise<string[]> {
  const res: any = await db.execute(sql`SELECT id FROM drip_sequence WHERE company_id = ${companyId} AND trigger = ${trigger} AND active = true`)
  const rows: any[] = res?.rows ?? (Array.isArray(res) ? res : [])
  return rows.map((r) => String(r.id))
}

// ─── Gift cards (salon #10) ──────────────────────────────────────────────────────────────────────────

/** Take cents off a salon gift card. The row is locked by the caller; the `balance >= cents` guard is the second belt. False = it was not there to take. */
export async function takeFromSalonCard(tx: any, cardId: string, cents: number): Promise<boolean> {
  const out = await tx.update(salonGiftCard).set({ balanceCents: sql`${salonGiftCard.balanceCents} - ${cents}` })
    .where(and(eq(salonGiftCard.id, cardId), gte(salonGiftCard.balanceCents, cents))).returning({ id: salonGiftCard.id })
  return out.length > 0
}

/** Put cents back on a salon gift card (the row is locked by the caller). */
export async function putBackOnSalonCard(tx: any, cardId: string, cents: number): Promise<void> {
  await tx.update(salonGiftCard).set({ balanceCents: sql`${salonGiftCard.balanceCents} + ${cents}` }).where(eq(salonGiftCard.id, cardId))
}

// ─── Reports (salon #11; crm/salon/reports.ts) ───────────────────────────────────────────────────────────────────────

/** The most visits one report reads. A bigger window answers with `truncated`, never a quiet partial count. */
export const REPORT_VISIT_CAP = 50_000

/**
 * Every completed visit (service record) in [from, to), with whether the client LEFT WITH A NEXT APPOINTMENT: another appointment
 * after this visit, not cancelled or a no-show, that was booked no later than 24 hours after the visit (or long before it).
 */
export async function visitsForReport(db: any, companyId: string, from: Date, to: Date) {
  const rows = await db.select({
    id: serviceRecord.id, contactId: serviceRecord.contactId, stylistId: serviceRecord.stylistId, stylistMemberId: serviceRecord.stylistMemberId,
    firstName: user.firstName, lastName: user.lastName, memberName: teamMember.name, performedAt: serviceRecord.performedAt,
    rebooked: sql<boolean>`exists (select 1 from ${appointment} rb where rb.company_id = ${serviceRecord.companyId} and rb.contact_id = ${serviceRecord.contactId}
      and rb.status not in ('cancelled', 'no_show') and rb.start_time > ${serviceRecord.performedAt}
      and rb.created_at <= ${serviceRecord.performedAt} + interval '24 hours' and (${serviceRecord.appointmentId} is null or rb.id <> ${serviceRecord.appointmentId}))`,
  }).from(serviceRecord)
    .leftJoin(user, eq(serviceRecord.stylistId, user.id))
    .leftJoin(teamMember, eq(serviceRecord.stylistMemberId, teamMember.id))
    .where(and(eq(serviceRecord.companyId, companyId), gte(serviceRecord.performedAt, from), lt(serviceRecord.performedAt, to)))
    .orderBy(serviceRecord.performedAt).limit(REPORT_VISIT_CAP + 1)
  return rows as Array<{ id: string; contactId: string; stylistId: string | null; stylistMemberId: string | null; firstName: string | null; lastName: string | null; memberName: string | null; performedAt: Date; rebooked: boolean }>
}

/** The clients who had a visit in [from, to). */
export async function visitorsBetween(db: any, companyId: string, from: Date, to: Date): Promise<Set<string>> {
  const rows = await db.selectDistinct({ contactId: serviceRecord.contactId }).from(serviceRecord)
    .where(and(eq(serviceRecord.companyId, companyId), gte(serviceRecord.performedAt, from), lt(serviceRecord.performedAt, to)))
  return new Set(rows.map((r: any) => r.contactId))
}

/** Each client's first visit, last visit and how many visits they have had, ever. */
export async function visitSpans(db: any, companyId: string): Promise<Array<{ contactId: string; first: Date; last: Date; n: number }>> {
  const rows = await db.select({
    contactId: serviceRecord.contactId, first: sql<Date>`min(${serviceRecord.performedAt})`, last: sql<Date>`max(${serviceRecord.performedAt})`, n: sql<number>`count(*)`,
  }).from(serviceRecord).where(eq(serviceRecord.companyId, companyId)).groupBy(serviceRecord.contactId)
  return rows.map((r: any) => ({ contactId: r.contactId as string, first: new Date(r.first), last: new Date(r.last), n: Number(r.n) }))
}

/** Clients who hold an appointment from `now` on that is not cancelled or a no-show. */
export async function clientsWithFutureBooking(db: any, companyId: string, now: Date): Promise<Set<string>> {
  const rows = await db.selectDistinct({ contactId: appointment.contactId }).from(appointment)
    .where(and(eq(appointment.companyId, companyId), isNotNull(appointment.contactId), gte(appointment.startTime, now), sql`${appointment.status} not in ('cancelled', 'no_show')`))
  return new Set(rows.map((r: any) => r.contactId).filter(Boolean))
}

/** Retail lines on paid sales whose payment completed in [from, to), with the stylist of the visit the sale closed. */
export async function retailSold(db: any, companyId: string, from: Date, to: Date) {
  const rows = await db.select({
    description: invoiceLineItem.description, qty: sql<string>`sum(${invoiceLineItem.quantity}::numeric)`, total: sql<string>`sum(${invoiceLineItem.total}::numeric)`,
    stylistId: appointment.stylistId, stylistMemberId: appointment.stylistMemberId, firstName: user.firstName, lastName: user.lastName, memberName: teamMember.name,
  }).from(invoiceLineItem)
    .innerJoin(invoice, eq(invoiceLineItem.invoiceId, invoice.id))
    .leftJoin(appointment, eq(appointment.id, invoice.appointmentId))
    .leftJoin(user, eq(appointment.stylistId, user.id))
    .leftJoin(teamMember, eq(appointment.stylistMemberId, teamMember.id))
    .where(and(eq(invoice.companyId, companyId), eq(invoice.status, 'paid'), eq(invoiceLineItem.type, 'retail'), gte(invoice.paidAt, from), lt(invoice.paidAt, to)))
    .groupBy(invoiceLineItem.description, appointment.stylistId, appointment.stylistMemberId, user.firstName, user.lastName, teamMember.name)
  return rows as Array<{ description: string; qty: string; total: string; stylistId: string | null; stylistMemberId: string | null; firstName: string | null; lastName: string | null; memberName: string | null }>
}

// ─── Retail stock and tips (salon #7; crm/salon/retail.ts, reports.ts) ───────────────────────────────────────────────

/** Lock one retail product for the length of the caller's transaction: two sales of the last unit are taken one after the other. */
export async function lockRetailProduct(tx: any, companyId: string, productId: string) {
  const [row] = await tx.select().from(salonRetailProduct).where(and(eq(salonRetailProduct.id, productId), eq(salonRetailProduct.companyId, companyId))).limit(1).for('update')
  return row as typeof salonRetailProduct.$inferSelect | undefined
}

/**
 * Units on hand per product: stock received and corrected, less the units on sales that stand. A void sale gives its units back by itself
 * (nothing is "returned" by a second write that could be missed). `ids` null = every product of the salon.
 */
export async function retailOnHand(exec: any, companyId: string, ids: string[] | null): Promise<Map<string, number>> {
  const only = (col: AnyColumn) => (ids ? sql`${col} in (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})` : sql`true`)
  const moved = await exec.select({ productId: salonStockMove.productId, n: sql<string>`coalesce(sum(${salonStockMove.quantity}), 0)` })
    .from(salonStockMove).where(and(eq(salonStockMove.companyId, companyId), only(salonStockMove.productId))).groupBy(salonStockMove.productId)
  const sold = await exec.select({ productId: salonRetailSale.productId, n: sql<string>`coalesce(sum(${salonRetailSale.quantity}), 0)` })
    .from(salonRetailSale).innerJoin(invoice, eq(salonRetailSale.invoiceId, invoice.id))
    .where(and(eq(salonRetailSale.companyId, companyId), sql`${invoice.status} <> 'void'`, only(salonRetailSale.productId))).groupBy(salonRetailSale.productId)
  const out = new Map<string, number>()
  for (const r of moved) out.set(r.productId, Number(r.n) || 0)
  for (const r of sold) out.set(r.productId, (out.get(r.productId) || 0) - (Number(r.n) || 0))
  return out
}

/** The tips on a sale not yet given back: every tip taken, less every tip a refund returned (a refund line carries its tip as a negative). Dollars. */
export async function tipsOutstanding(db: any, invoiceId: string): Promise<number> {
  const [row] = await db.select({ n: sql<string>`coalesce(sum(${payment.tipAmount}::numeric), 0)` }).from(payment).where(eq(payment.invoiceId, invoiceId))
  return Math.max(0, Math.round(Number(row?.n || 0) * 100) / 100)
}

/**
 * Tips in [from, to), NET of tips given back, with the stylist of the visit the sale closed (a sale with no visit has none). A refund that
 * returned a tip carries it as a negative tip on its own line, dated when it was refunded, so it comes off the stylist's tips in the period
 * of the refund (follow-up 10/30); `payments` counts only the payments that took a tip.
 */
export async function tipsReceived(db: any, companyId: string, from: Date, to: Date) {
  const rows = await db.select({
    tips: sql<string>`sum(${payment.tipAmount}::numeric)`, payments: sql<string>`count(*) FILTER (WHERE ${payment.tipAmount}::numeric > 0)`,
    stylistId: appointment.stylistId, stylistMemberId: appointment.stylistMemberId, firstName: user.firstName, lastName: user.lastName, memberName: teamMember.name,
  }).from(payment)
    .innerJoin(invoice, eq(payment.invoiceId, invoice.id))
    .leftJoin(appointment, eq(appointment.id, invoice.appointmentId))
    .leftJoin(user, eq(appointment.stylistId, user.id))
    .leftJoin(teamMember, eq(appointment.stylistMemberId, teamMember.id))
    .where(and(eq(invoice.companyId, companyId), sql`${payment.tipAmount}::numeric <> 0`, gte(payment.paidAt, from), lt(payment.paidAt, to)))
    .groupBy(appointment.stylistId, appointment.stylistMemberId, user.firstName, user.lastName, teamMember.name)
  return rows as Array<{ tips: string; payments: string; stylistId: string | null; stylistMemberId: string | null; firstName: string | null; lastName: string | null; memberName: string | null }>
}


/**
 * Tips in [from, to) by SALE: the net of each sale's tip lines (refunds are negative), how many payments took a tip, and the visit's own
 * stylist. The Tips report splits each sale's net across the people on it (crm/salon/tipSplit.ts) — the sale's own shares if the salon set
 * them, else by the value of each person's services.
 */
export async function tipsBySale(db: any, companyId: string, from: Date, to: Date) {
  const rows = await db.select({
    invoiceId: payment.invoiceId, tips: sql<string>`sum(${payment.tipAmount}::numeric)`, payments: sql<string>`count(*) FILTER (WHERE ${payment.tipAmount}::numeric > 0)`,
    appointmentId: invoice.appointmentId, stylistId: appointment.stylistId, stylistMemberId: appointment.stylistMemberId,
  }).from(payment)
    .innerJoin(invoice, eq(payment.invoiceId, invoice.id))
    .leftJoin(appointment, eq(appointment.id, invoice.appointmentId))
    .where(and(eq(invoice.companyId, companyId), sql`${payment.tipAmount}::numeric <> 0`, gte(payment.paidAt, from), lt(payment.paidAt, to)))
    .groupBy(payment.invoiceId, invoice.appointmentId, appointment.stylistId, appointment.stylistMemberId)
  return rows as Array<{ invoiceId: string; tips: string; payments: string; appointmentId: string | null; stylistId: string | null; stylistMemberId: string | null }>
}

/** The services on these visits with who does each and its price (a visit with no rows has one stylist: the visit's). */
export async function itemsOfVisits(db: any, appointmentIds: string[]) {
  if (!appointmentIds.length) return []
  const rows = await db.select({ appointmentId: appointmentItem.appointmentId, stylistId: appointmentItem.stylistId, stylistMemberId: appointmentItem.stylistMemberId, price: appointmentItem.price })
    .from(appointmentItem).where(sql`${appointmentItem.appointmentId} in (${sql.join(appointmentIds.map((i) => sql`${i}`), sql`, `)})`)
  return rows as Array<{ appointmentId: string; stylistId: string | null; stylistMemberId: string | null; price: string | null }>
}

/** The shares the salon set on these sales (hundredths of a percent); a sale with none uses the default split. */
export async function tipSharesSet(db: any, companyId: string, invoiceIds: string[]) {
  if (!invoiceIds.length) return []
  const rows = await db.select({ invoiceId: saleTipSplit.invoiceId, stylistId: saleTipSplit.stylistId, stylistMemberId: saleTipSplit.stylistMemberId, shareBp: saleTipSplit.shareBp })
    .from(saleTipSplit).where(and(eq(saleTipSplit.companyId, companyId), sql`${saleTipSplit.invoiceId} in (${sql.join(invoiceIds.map((i) => sql`${i}`), sql`, `)})`))
  return rows as Array<{ invoiceId: string; stylistId: string | null; stylistMemberId: string | null; shareBp: number }>
}

/** Replace a sale's own shares (none = back to the default), in one transaction. */
export async function setTipShares(db: any, companyId: string, invoiceId: string, shares: Array<{ stylistId: string | null; stylistMemberId: string | null; shareBp: number }>, setByUserId: string | null) {
  await db.transaction(async (tx: any) => {
    await tx.delete(saleTipSplit).where(and(eq(saleTipSplit.companyId, companyId), eq(saleTipSplit.invoiceId, invoiceId)))
    if (shares.length) await tx.insert(saleTipSplit).values(shares.map((x) => ({ companyId, invoiceId, stylistId: x.stylistId, stylistMemberId: x.stylistMemberId, shareBp: x.shareBp, setByUserId })))
  })
}

/** Names for these logins and roster members, by key (`u:<id>` / `m:<id>`). */
export async function peopleNames(db: any, userIds: string[], memberIds: string[]) {
  const out = new Map<string, string>()
  if (userIds.length) {
    const rows = await db.select({ id: user.id, f: user.firstName, l: user.lastName }).from(user).where(sql`${user.id} in (${sql.join(userIds.map((i) => sql`${i}`), sql`, `)})`)
    for (const r of rows) out.set(`u:${r.id}`, [r.f, r.l].filter(Boolean).join(' ').trim() || 'Team member')
  }
  if (memberIds.length) {
    const rows = await db.select({ id: teamMember.id, n: teamMember.name }).from(teamMember).where(sql`${teamMember.id} in (${sql.join(memberIds.map((i) => sql`${i}`), sql`, `)})`)
    for (const r of rows) out.set(`m:${r.id}`, String(r.n || 'Team member'))
  }
  return out
}

/** The tip still on a sale in whole cents: every tip taken less every tip given back. */
export async function tipsNetCents(db: any, invoiceId: string): Promise<number> {
  const [row] = await db.select({ n: sql<string>`coalesce(sum(${payment.tipAmount}::numeric), 0)` }).from(payment).where(eq(payment.invoiceId, invoiceId))
  return Math.round(Number(row?.n || 0) * 100)
}
