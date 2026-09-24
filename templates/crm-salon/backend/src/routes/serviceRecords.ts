import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { serviceRecord, serviceMenu, contact, user, appointment, teamMember, invoice } from '../../db/schema.ts'
import { eq, and, desc, or, sql } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'
import { emitToCompany, EVENTS } from '../services/socket.ts'
import audit from '../services/audit.ts'
import { createId } from '@paralleldrive/cuid2'
import { ensureInvoiceForVisit } from '../services/salonCheckout.ts'
import { resolveStylist, unknownStylist, stylistIdOf } from '../utils/stylist.ts'
import { hasHappened } from '../shared/index.ts'
import { scheduleReviewRequestForVisit } from '../services/reviews.ts'

/**
 * The formula log — what was actually done in the chair. This is the salon's
 * clinical record: it makes a colour repeatable by any stylist in the shop, and
 * its performedAt + the service's rebookIntervalDays are what the reminder
 * engine reads to decide who is due back.
 */

const app = new Hono()
app.use('*', authenticate)

// GET /service-records — ?contactId=, ?stylistId=
app.get('/', requirePermission('contacts:read'), async (c) => {
  const currentUser = c.get('user') as any
  const contactId = c.req.query('contactId')
  const stylistId = c.req.query('stylistId')

  const conditions = [eq(serviceRecord.companyId, currentUser.companyId)]
  if (contactId) conditions.push(eq(serviceRecord.contactId, contactId))
  // filter on either column — the caller knows one stylist id, not which table it came from (T20 H1)
  if (stylistId) conditions.push(or(eq(serviceRecord.stylistId, stylistId), eq(serviceRecord.stylistMemberId, stylistId))!)

  const data = await db.select({
    record: serviceRecord,
    clientName: contact.name,
    serviceName: serviceMenu.name,
    stylistFirstName: user.firstName,
    stylistLastName: user.lastName,
    stylistMemberName: teamMember.name,
  })
    .from(serviceRecord)
    .leftJoin(contact, eq(serviceRecord.contactId, contact.id))
    .leftJoin(serviceMenu, eq(serviceRecord.serviceId, serviceMenu.id))
    .leftJoin(user, eq(serviceRecord.stylistId, user.id))
    // a roster stylist's name lives in team_member (T20 H1)
    .leftJoin(teamMember, eq(serviceRecord.stylistMemberId, teamMember.id))
    .where(and(...conditions))
    .orderBy(desc(serviceRecord.performedAt))
    .limit(200)

  const rows = data.map((r: any) => {
    // one stylistId back out, whichever column holds them (T20 H1)
    const parts = String(r.stylistMemberName || '').trim().split(/\s+/)
    return {
      ...r.record,
      stylistId: stylistIdOf(r.record),
      clientName: r.clientName, serviceName: r.serviceName,
      stylistFirstName: r.stylistFirstName ?? (parts[0] || null),
      stylistLastName: r.stylistLastName ?? (parts.slice(1).join(' ') || null),
    }
  })
  return c.json({ data: rows })
})

// GET /service-records/:id
/**
 * Clear up what the old write paths left behind.
 *
 * Two fixes landed on the write path and did nothing for the rows already written, which the retest
 * called out by name: "Both H3 and M4 fixed the write path without backfilling — four orphan invoices
 * worth $70.53 are still Open, and the old future-dated visits still head Recent Services."
 *
 *   H3 — deleting a visit now voids the sale it raised. Before that the invoice survived its visit:
 *        Open, owed, and pointing back at a record that no longer exists. Those are voided here, by
 *        the same rule the delete uses — an invoice holding money is never touched, and voiding keeps
 *        the number and the audit trail rather than deleting anything.
 *   M4 — a visit must be dated to a day that has happened. The ones accepted before that rule still
 *        sit at the top of Recent Services, because that panel orders by performedAt and theirs are in
 *        the future. They are moved back to the day the record was actually created, which is the one
 *        date we know is true about them.
 *
 * Deliberately an endpoint an operator calls, not a boot job: it voids invoices and moves dates on a
 * clinical record, and that should be something a person triggers and sees the result of. It reports
 * every row it touched, and it is idempotent.
 */
app.post('/repair-legacy', requirePermission('company:update'), async (c: any) => {
  const currentUser = c.get('user') as any
  const cid = currentUser.companyId

  // ── H3: sales whose visit is gone ───────────────────────────────────────────────────────────────
  const orphans: any = await db.execute(sql`
    SELECT i.id, i.number, i.total, i.amount_paid, i.amount_refunded
    FROM invoice i
    WHERE i.company_id = ${cid}
      AND i.notes = 'Created from the appointment book'
      AND i.status <> 'void'
      AND COALESCE(i.amount_paid, '0')::numeric - COALESCE(i.amount_refunded, '0')::numeric <= 0.005
      AND NOT EXISTS (SELECT 1 FROM service_record sr WHERE sr.invoice_id = i.id)
      AND (i.appointment_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM service_record sr2 WHERE sr2.appointment_id = i.appointment_id AND sr2.company_id = ${cid}
      ))
      -- A visit logged before H3 has NO link to its sale at all — not by invoice id and not by
      -- appointment — so "nothing points at this invoice" does not mean the visit is gone. It also
      -- describes every sale raised by those older visits, which are still on the tenant and still
      -- owed. The price is what connects them: a visit charging P raised an invoice whose SUBTOTAL is
      -- P, before tax. If such a visit exists for this client and has no sale of its own, this invoice
      -- is very likely the sale it raised, so it is left alone for a person to judge.
      -- (Found live: two $50 visits matched two $54.25 invoices — $50 plus 8.5% tax — and the first
      --  version of this voided both of them.)
      AND NOT EXISTS (
        SELECT 1 FROM service_record sr3
        WHERE sr3.company_id = ${cid}
          AND sr3.contact_id = i.contact_id
          AND sr3.invoice_id IS NULL
          AND sr3.price_charged IS NOT NULL
          AND round(sr3.price_charged::numeric, 2) = round(i.subtotal::numeric, 2)
      )
  `)
  const orphanRows = ((orphans as any).rows || orphans) as any[]
  for (const row of orphanRows) {
    await db.execute(sql`
      UPDATE invoice
      SET status = 'void',
          notes = COALESCE(notes || E'\n', '') || 'Voided: the visit this sale came from was deleted before the sale was linked to it.',
          updated_at = NOW()
      WHERE id = ${row.id} AND company_id = ${cid}
    `)
  }

  // ── M4: visits dated to a day that has not happened ─────────────────────────────────────────────
  const future: any = await db.execute(sql`
    SELECT id, performed_at, created_at FROM service_record
    WHERE company_id = ${cid} AND performed_at > NOW()
  `)
  const futureRows = ((future as any).rows || future) as any[]
  for (const row of futureRows) {
    await db.execute(sql`
      UPDATE service_record SET performed_at = created_at, updated_at = NOW()
      WHERE id = ${row.id} AND company_id = ${cid}
    `)
  }

  await audit.log({
    action: 'update', entity: 'service_record', entityId: 'repair-legacy',
    metadata: { invoicesVoided: orphanRows.length, visitsRedated: futureRows.length },
    req: { user: currentUser },
  })
  if (orphanRows.length || futureRows.length) emitToCompany(cid, EVENTS.REFRESH, { entity: 'service_record' })

  return c.json({
    invoicesVoided: orphanRows.length,
    invoices: orphanRows.map((r) => ({ id: r.id, number: r.number, total: r.total })),
    visitsRedated: futureRows.length,
    visits: futureRows.map((r) => ({ id: r.id, was: r.performed_at, now: r.created_at })),
  })
})

/**
 * Put back an invoice this repair voided.
 *
 * A repair that writes to money has to be reversible, and this one cannot be undone by hand: voiding is
 * deliberately terminal, so the invoice editor refuses a void invoice. The repair signs its work with an
 * exact note, and this restores the invoices carrying that signature and strips the line.
 *
 * It restores to 'open', which is the status ensureInvoiceForVisit gives a sale raised from the book —
 * right for every invoice this repair can have touched, since that is the only kind it voids.
 *
 * Written because the first version of the repair got it wrong on a live tenant: it voided two sales
 * whose visits still existed, unlinked, from before H3 gave a visit a link to its sale.
 */
app.post('/repair-legacy/undo', requirePermission('company:update'), async (c: any) => {
  const currentUser = c.get('user') as any
  const cid = currentUser.companyId
  const restored: any = await db.execute(sql`
    UPDATE invoice
    SET status = 'open',
        notes = NULLIF(regexp_replace(notes, E'\nVoided: the visit this sale came from was deleted before the sale was linked to it\\.$', ''), ''),
        updated_at = NOW()
    WHERE company_id = ${cid}
      AND status = 'void'
      AND notes LIKE '%Voided: the visit this sale came from was deleted before the sale was linked to it.'
    RETURNING id, number, total
  `)
  const rows = ((restored as any).rows || restored) as any[]
  await audit.log({ action: 'update', entity: 'invoice', entityId: 'repair-legacy-undo', metadata: { restored: rows.length }, req: { user: currentUser } })
  if (rows.length) emitToCompany(cid, EVENTS.REFRESH, { entity: 'service_record' })
  return c.json({ restored: rows.length, invoices: rows.map((r) => ({ id: r.id, number: r.number, total: r.total })) })
})

app.get('/:id', requirePermission('contacts:read'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const [row] = await db.select().from(serviceRecord)
    .where(and(eq(serviceRecord.id, id), eq(serviceRecord.companyId, currentUser.companyId)))
    .limit(1)
  if (!row) return c.json({ error: 'Service record not found' }, 404)

  return c.json({ ...row, stylistId: stylistIdOf(row) })
})

// POST /service-records — writing a record completes its appointment, so the
// front desk never has to close the ticket twice.
app.post('/', requirePermission('schedule:create'), async (c) => {
  const currentUser = c.get('user') as any
  const body = (await c.req.json().catch(() => null)) ?? ({} as any)
  if (typeof body.contactId !== 'string' || !body.contactId) {
    return c.json({ error: 'contactId is required' }, 400)
  }

  const [ct] = await db.select().from(contact)
    .where(and(eq(contact.id, body.contactId), eq(contact.companyId, currentUser.companyId)))
    .limit(1)
  if (!ct) return c.json({ error: 'Client not found' }, 404)

  if (body.processingMin != null && body.processingMin !== '' && (isNaN(Number(body.processingMin)) || Number(body.processingMin) < 0 || Number(body.processingMin) > 600)) {
    return c.json({ error: 'Processing time must be between 0 and 600 minutes.' }, 400)
  }
  const hasFormula = Array.isArray(body.formula) && body.formula.some((l: any) => (l?.product || l?.shade || '').toString().trim())
  if (!body.serviceId && !hasFormula && !body.result && !body.productsUsed && (body.priceCharged == null || body.priceCharged === '') && !body.notes) {
    return c.json({ error: 'Add a service, a formula, a result or a price — an empty record tells the next stylist nothing.' }, 400)
  }
  // A negative price charged dragged the client's lifetime value negative. (CC-18)
  if (body.priceCharged != null && (isNaN(Number(body.priceCharged)) || Number(body.priceCharged) < 0)) {
    return c.json({ error: 'Price charged cannot be negative.' }, 400)
  }
  // A visit is something that HAPPENED. performedAt 2027-06-15 was accepted without a word and then
  // headed Recent Services on the dashboard and Recent Activity on the owner portal, above every real
  // visit — the "most recent" panels were showing the furthest-FUTURE records. Same rule expenses and
  // time entries already follow. (T20 M4)
  if (!hasHappened(body.performedAt)) {
    return c.json({ error: 'A visit can only be dated to a day that has happened. Check the year.', code: 'FUTURE_VISIT', field: 'performedAt' }, 400)
  }

  // The person who did the work may be a login user or a roster-only stylist; work out which before
  // writing, and refuse an id that is neither with a message that names the field. (T20 H1)
  const stylist = await resolveStylist(currentUser.companyId, body.stylistId)
  if (!stylist) return unknownStylist(c, body.stylistId)

  // SALON-H4: reuse the record that Complete auto-created for this appointment rather than logging a second visit.
  if (body.appointmentId) {
    const [auto] = await db.select().from(serviceRecord).where(and(eq(serviceRecord.appointmentId, body.appointmentId), eq(serviceRecord.companyId, currentUser.companyId))).limit(1)
    if (auto) {
      const upd: any = { updatedAt: new Date() }
      for (const k of ['serviceId', 'developerVolume', 'processingMin', 'productsUsed', 'result', 'photoBefore', 'photoAfter', 'priceCharged', 'notes']) if (k in body) upd[k] = body[k] === '' ? null : body[k]
      // the resolved chair, into whichever column holds it (T20 H1)
      if ('stylistId' in body) { upd.stylistId = stylist.stylistId; upd.stylistMemberId = stylist.stylistMemberId }
      if (Array.isArray(body.formula)) upd.formula = body.formula
      if (body.performedAt) upd.performedAt = /^\d{4}-\d{2}-\d{2}$/.test(String(body.performedAt)) ? new Date(`${body.performedAt}T12:00:00.000Z`) : new Date(body.performedAt)
      const [merged] = await db.update(serviceRecord).set(upd).where(eq(serviceRecord.id, auto.id)).returning()
      emitToCompany(currentUser.companyId, EVENTS.REFRESH, { entity: 'service_record' })
      return c.json({ ...merged, stylistId: stylistIdOf(merged), invoiceId: null, merged: true }, 200)
    }
  }
  const [created] = await db.insert(serviceRecord).values({
    id: createId(),
    contactId: body.contactId,
    appointmentId: body.appointmentId || null,
    stylistId: stylist.stylistId,
    stylistMemberId: stylist.stylistMemberId,
    serviceId: body.serviceId || null,
    // A date-only value ("2026-09-11") is a calendar date: store it at noon UTC so it renders as that
    // date in any US timezone instead of UTC midnight rolling back a day. (SALON-H9)
    performedAt: body.performedAt ? (/^\d{4}-\d{2}-\d{2}$/.test(String(body.performedAt)) ? new Date(`${body.performedAt}T12:00:00.000Z`) : new Date(body.performedAt)) : new Date(),
    formula: Array.isArray(body.formula) ? body.formula : [],
    developerVolume: body.developerVolume || null,
    processingMin: body.processingMin ?? null,
    productsUsed: body.productsUsed || null,
    result: body.result || null,
    photoBefore: body.photoBefore || null,
    photoAfter: body.photoAfter || null,
    priceCharged: body.priceCharged ?? null,
    notes: body.notes || null,
    companyId: currentUser.companyId,
  }).returning()

  if (created.appointmentId) {
    await db.update(appointment)
      .set({ status: 'completed', updatedAt: new Date() })
      .where(and(eq(appointment.id, created.appointmentId), eq(appointment.companyId, currentUser.companyId)))
  }

  // Logging the service closes the visit: create the sale (once per appointment) and queue the
  // review request. Neither may fail the record write. (SALON-H4 / H2)
  let invoiceId: string | null = null
  try {
    let serviceName: string | null = null
    if (created.serviceId) {
      const [svc] = await db.select({ name: serviceMenu.name }).from(serviceMenu).where(eq(serviceMenu.id, created.serviceId)).limit(1)
      serviceName = svc?.name || null
    }
    const inv = await ensureInvoiceForVisit({ companyId: currentUser.companyId, contactId: created.contactId, appointmentId: created.appointmentId, serviceName, price: Number(created.priceCharged) })
    invoiceId = inv?.id || null
    // Remember which sale this visit raised, so deleting the visit can answer for it. A visit logged
    // without an appointment had no link to its invoice at all. (T20 H3)
    if (invoiceId) await db.update(serviceRecord).set({ invoiceId, updatedAt: new Date() } as any).where(eq(serviceRecord.id, created.id))
  } catch (e: any) { console.warn('[service-records] sale not created:', e?.message || e) }
  scheduleReviewRequestForVisit({ companyId: currentUser.companyId, contactId: created.contactId }).catch((e) => console.warn('[service-records] review schedule failed:', e?.message || e))

  await audit.log({ action: 'create', entity: 'service_record', entityId: created.id, metadata: created, req: { user: currentUser } })
  emitToCompany(currentUser.companyId, EVENTS.REFRESH, { entity: 'service_record' })
  // answer with the stylist id the caller gave us, whichever column it landed in (T20 H1)
  return c.json({ ...created, stylistId: stylistIdOf(created), invoiceId }, 201)
})

// PUT /service-records/:id
app.put('/:id', requirePermission('schedule:update'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')
  const body = (await c.req.json().catch(() => null)) ?? ({} as any)

  const [existing] = await db.select().from(serviceRecord)
    .where(and(eq(serviceRecord.id, id), eq(serviceRecord.companyId, currentUser.companyId)))
    .limit(1)
  if (!existing) return c.json({ error: 'Service record not found' }, 404)

  // Whitelist editable columns — never let companyId/id be reassigned from the body.
  const EDITABLE = ['appointmentId', 'stylistId', 'serviceId', 'performedAt', 'formula', 'developerVolume', 'processingMin', 'productsUsed', 'result', 'photoBefore', 'photoAfter', 'priceCharged', 'notes'] as const
  const updates: any = { updatedAt: new Date() }
  for (const k of EDITABLE) if (k in body) updates[k] = body[k]
  // Reassigning the stylist has to land in the right column, and they have to exist. (T20 H1)
  if ('stylistId' in updates) {
    const resolved = await resolveStylist(currentUser.companyId, updates.stylistId)
    if (!resolved) return unknownStylist(c, updates.stylistId)
    updates.stylistId = resolved.stylistId
    updates.stylistMemberId = resolved.stylistMemberId
  }
  // an edit must not be the way a future visit gets in (T20 M4)
  if ('performedAt' in updates && !hasHappened(updates.performedAt)) {
    return c.json({ error: 'A visit can only be dated to a day that has happened. Check the year.', code: 'FUTURE_VISIT', field: 'performedAt' }, 400)
  }
  if (updates.performedAt) updates.performedAt = new Date(updates.performedAt)

  const [updated] = await db.update(serviceRecord).set(updates).where(eq(serviceRecord.id, id)).returning()
  await audit.log({ action: 'update', entity: 'service_record', entityId: id, changes: audit.diff(existing, updated), req: { user: currentUser } })
  emitToCompany(currentUser.companyId, EVENTS.REFRESH, { entity: 'service_record' })
  return c.json({ ...updated, stylistId: stylistIdOf(updated) })
})

// DELETE /service-records/:id
app.delete('/:id', requirePermission('invoices:update'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const [existing] = await db.select().from(serviceRecord)
    .where(and(eq(serviceRecord.id, id), eq(serviceRecord.companyId, currentUser.companyId)))
    .limit(1)
  if (!existing) return c.json({ error: 'Service record not found' }, 404)

  // Deleting a visit has to answer for the sale it raised. The invoice used to survive — Open, full
  // balance, still counted in Outstanding everywhere — so a stylist who logged a service against the
  // wrong client and deleted it had silently created a real debt against that client, with nothing on
  // the invoice connecting it back to a record that no longer existed. (T20 H3)
  //
  // An issued invoice is never deleted: it is VOIDED, which keeps the number and the audit trail and
  // takes it out of outstanding. Money that was collected and not refunded blocks a void — the same
  // rule POST /invoices/:id/void enforces — and here it blocks the whole deletion, because removing
  // the visit would strand a real payment with nothing to explain it.
  const [linkedInvoice] = (existing as any).invoiceId
    ? await db.select().from(invoice).where(and(eq(invoice.id, (existing as any).invoiceId), eq(invoice.companyId, currentUser.companyId))).limit(1)
    // records written before the link existed: fall back to the appointment the sale was filed against
    : existing.appointmentId
      ? await db.select().from(invoice).where(and(eq(invoice.appointmentId, existing.appointmentId), eq(invoice.companyId, currentUser.companyId))).limit(1)
      : []

  if (linkedInvoice && linkedInvoice.status !== 'void') {
    const paid = Math.round((Number(linkedInvoice.amountPaid || 0) - Number(linkedInvoice.amountRefunded || 0)) * 100) / 100
    if (paid > 0.005) {
      return c.json({
        error: `This visit has been paid for — ${linkedInvoice.number} holds $${paid.toFixed(2)}. Refund the payment and void the invoice first, then delete the visit.`,
        code: 'VISIT_HAS_PAYMENT',
        invoiceId: linkedInvoice.id,
        invoiceNumber: linkedInvoice.number,
        amountPaid: paid,
      }, 400)
    }
  }

  let voidedInvoice: { id: string; number: string } | null = null
  await db.transaction(async (tx: any) => {
    if (linkedInvoice && linkedInvoice.status !== 'void' && linkedInvoice.status !== 'refunded') {
      const note = `Voided: the visit it was raised from was deleted`
      await tx.update(invoice)
        .set({ status: 'void', notes: linkedInvoice.notes ? `${linkedInvoice.notes}\n${note}` : note, updatedAt: new Date() })
        .where(eq(invoice.id, linkedInvoice.id))
      voidedInvoice = { id: linkedInvoice.id, number: linkedInvoice.number }
    }
    await tx.delete(serviceRecord).where(eq(serviceRecord.id, id))
  })

  await audit.log({ action: 'delete', entity: 'service_record', entityId: id, metadata: { ...existing, voidedInvoice }, req: { user: currentUser } })
  emitToCompany(currentUser.companyId, EVENTS.REFRESH, { entity: 'service_record' })
  if (voidedInvoice) emitToCompany(currentUser.companyId, EVENTS.REFRESH, { entity: 'invoice' })
  return c.json({ success: true, voidedInvoice })
})

export default app
