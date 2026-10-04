import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { serviceRecord, serviceMenu, contact, user, appointment, teamMember, invoice } from '../../db/schema.ts'
import { eq, and, ne, desc, or, sql } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'
import { emitToCompany, EVENTS } from '../services/socket.ts'
import audit from '../services/audit.ts'
import { createId } from '@paralleldrive/cuid2'
import { ensureInvoiceForVisit, invoiceIdForVisit } from '../services/salonCheckout.ts'
import { resolveStylist, unknownStylist, stylistIdOf } from '../utils/stylist.ts'
import { hasHappened } from '../shared/index.ts'
import { scheduleReviewRequestForVisit } from '../services/reviews.ts'
import { AUTO_VISIT_NOTE, CANCELLED_VISIT_NOTE, CANCELLED_VISIT_LABEL } from './appointments.ts'
// normaliseFormula: a formula is ALWAYS a list of step objects, at every write. RR2 R1 — the card
// path normalised a string and this file did not, so `formula: "6N + 20vol"` was stored raw and the
// client chart's visit list threw on `.map`, taking the whole chart down behind an error boundary.
import { keepFromRecord, normaliseFormula } from '../services/clientFormulas.ts'
import { money } from '../shared/invoicing/money.ts'

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
 *   N3 — and the same fix in the other direction, added by the loyalty retest: deleting one of
 *        several records filed against the SAME appointment voided the sale the visit still needed.
 *        Those are put back, which is the only one of these three that restores money to the
 *        outstanding column rather than taking it out.
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

  // ── LYR N3: sales voided by a duplicate clean-up, whose visit never went anywhere ───────────────
  //
  // The mirror image of H3, and the damage runs the other way: a visit with no sale instead of a
  // sale with no visit. Deleting one of several records filed against the same appointment used to
  // void the invoice, so tidying LY0928's duplicates voided INV-00204 and left Bravo's 27 Sep
  // Men's Cut $37.98 unbilled. The delete rule now checks for survivors; this puts back what it
  // voided before it did.
  //
  // Only invoices carrying that rule's exact note are touched, and only where a service record
  // still points at them — an invoice a person voided deliberately says something else and is left
  // alone. Restored to 'open', the status a sale raised from the book is given.
  const unvoided: any = await db.execute(sql`
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
  const unvoidedRows = ((unvoided as any).rows || unvoided) as any[]

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

  // ── FULL0929 F1: visits standing against an appointment that was cancelled ─────────────────────
  //
  // Cancelling a completed visit now takes the visit record with it. That changed what happens
  // NEXT; the records the old build left are still on the chart — counted in the client's visit
  // total, used as their last visit, and feeding the rebooking reminder. On the test tenant that is
  // seven of them, and one is the retest's own named symptom: LYR2 Papa is on Due to Rebook for 8
  // October because of a cut that was cancelled. A reminder to come back for an appointment the
  // salon agreed never took place is the one thing here a CLIENT sees, so leaving the old rows in
  // place would leave the finding half-fixed.
  //
  // Exactly the cancel path's rule, and no wider. That rule used to be "delete it unless a stylist
  // wrote on it", and the records it kept went on driving rebooking reminders for visits that never
  // happened — a compromise, and named as one. It is not a compromise any more: a formula belongs to
  // the CLIENT, so whatever a stylist wrote is lifted onto their card first and the phantom visit
  // then goes. Nothing clinical is lost and nothing false survives. (services/clientFormulas.ts)
  //
  // Records the OLDER builds annotated are handled too: the repair's own line is stripped before the
  // note is kept, so a card does not inherit this script's housekeeping as if a stylist had typed it.
  const stale: any = await db.execute(sql`
    SELECT sr.id, sr.notes, sr.formula, sr.developer_volume, sr.processing_min, sr.performed_at,
           sr.contact_id, a.status AS appointment_status
    FROM service_record sr
    JOIN appointment a ON a.id = sr.appointment_id AND a.company_id = sr.company_id
    WHERE sr.company_id = ${cid} AND a.status IN ('cancelled', 'no_show')
  `)
  const staleRows = ((stale as any).rows || stale) as any[]
  const visitsRemoved: any[] = []
  const formulasKept: any[] = []
  for (const row of staleRows) {
    const ownNotes = String(row.notes || '').trim()
    const bare = (ownNotes.endsWith(CANCELLED_VISIT_NOTE) ? ownNotes.slice(0, -CANCELLED_VISIT_NOTE.length) : ownNotes).trim()
    // The note the SYSTEM writes on every completed visit is not a stylist's work and is not kept.
    const stylistNote = bare === AUTO_VISIT_NOTE ? '' : bare
    const kept = await keepFromRecord(cid, {
      id: row.id, contactId: row.contact_id, formula: row.formula,
      developerVolume: row.developer_volume, processingMin: row.processing_min,
      performedAt: row.performed_at, notes: stylistNote,
    }, CANCELLED_VISIT_LABEL)
    if (kept) formulasKept.push({ recordId: row.id, contactId: row.contact_id, formulaId: kept.kept.id })
    await db.execute(sql`DELETE FROM service_record WHERE id = ${row.id} AND company_id = ${cid}`)
    visitsRemoved.push({ id: row.id, contactId: row.contact_id })
  }

  await audit.log({
    action: 'update', entity: 'service_record', entityId: 'repair-legacy',
    metadata: {
      invoicesVoided: orphanRows.length, invoicesRestored: unvoidedRows.length, visitsRedated: futureRows.length,
      visitsRemoved: visitsRemoved.length, formulasKept: formulasKept.length,
    },
    req: { user: currentUser },
  })
  if (orphanRows.length || unvoidedRows.length || futureRows.length || staleRows.length) emitToCompany(cid, EVENTS.REFRESH, { entity: 'service_record' })
  if (orphanRows.length || unvoidedRows.length) emitToCompany(cid, EVENTS.REFRESH, { entity: 'invoice' })

  // ── R3: visits written before N8, which show $0.00 on the chart ─────────────────────────────
  //
  // RR2 R3: N8 fixed the WRITE — a completed booking now carries the price the service charges —
  // and 105 of the 122 appointment-linked records already on the tenant still had priceCharged
  // null, so most of a client's history reads $0.00 beside real invoices. Fixing the writer never
  // heals the rows already written; that is the same lesson as the formula normaliser one file
  // over, and it needs a one-off pass like the loyalty invoices got.
  //
  // The price comes from the SALE first and the menu second, which is the same order
  // onVisitCompleted resolves it in — so a backfilled row and a fresh one agree. Only rows with NO
  // price are touched: a visit someone priced by hand is their number, not ours.
  const pricelessRows: any[] = []
  {
    const rows: any = await db.execute(sql`
      -- These columns are DECIMAL in the salon schema, not text. The first version wrapped them in
      -- NULLIF(x, '') out of habit from the dispensary, where they ARE text, and every call answered
      -- 400 "One of the values is not in a valid format" — which also took the four repairs that
      -- share this route down with it. Numeric columns are compared to NULL, not to ''.
      SELECT sr.id,
             COALESCE(i.subtotal, a.quoted_price, sm.price) AS price
      FROM service_record sr
      LEFT JOIN invoice i ON i.appointment_id = sr.appointment_id AND i.company_id = ${cid} AND i.status <> 'void'
      LEFT JOIN appointment a ON a.id = sr.appointment_id AND a.company_id = ${cid}
      LEFT JOIN service_menu sm ON sm.id = sr.service_id AND sm.company_id = ${cid}
      WHERE sr.company_id = ${cid}
        AND sr.appointment_id IS NOT NULL
        AND sr.price_charged IS NULL
    `)
    for (const r of ((rows as any).rows || rows)) {
      const price = Number(r.price)
      // No sale, no quote and no menu price is not a zero — it is unknown, and writing 0.00 would
      // turn "we do not know" into "it was free".
      if (!Number.isFinite(price) || price <= 0) continue
      await db.execute(sql`
        UPDATE service_record SET price_charged = ${price.toFixed(2)}, updated_at = NOW()
        WHERE id = ${r.id} AND company_id = ${cid}
      `)
      pricelessRows.push({ id: r.id, price: Number(price.toFixed(2)) })
    }
  }

  return c.json({
    invoicesVoided: orphanRows.length,
    invoices: orphanRows.map((r) => ({ id: r.id, number: r.number, total: r.total })),
    // Visits that predate N8 and showed $0.00, given the price their own sale or menu says. (RR2 R3)
    visitsPriced: pricelessRows.length,
    priced: pricelessRows,
    // Sales put back on a visit that was never deleted. (LYR N3)
    invoicesRestored: unvoidedRows.length,
    restored: unvoidedRows.map((r) => ({ id: r.id, number: r.number, total: r.total })),
    visitsRedated: futureRows.length,
    visits: futureRows.map((r) => ({ id: r.id, was: r.performed_at, now: r.created_at })),
    // Visits that never happened, taken off the chart and off the rebooking list. (FULL0929 F1)
    visitsRemoved: visitsRemoved.length,
    removed: visitsRemoved,
    // …and the stylists' work lifted off them onto the clients' own cards first, so removing the
    // phantom visit costs nothing. No record is kept back any more: the reminder is clean AND the
    // formula survives, which the earlier version had to choose between.
    formulasKept: formulasKept.length,
    keptFormulas: formulasKept,
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
  // Through the normaliser, so "is there a formula here" is decided the same way the card decides
  // it. Asking Array.isArray meant a string formula counted as no formula at all. (RR2 R1)
  const hasFormula = normaliseFormula(body.formula).some((l: any) => (l?.product || l?.shade || '').toString().trim())
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
      if ('formula' in body) upd.formula = normaliseFormula(body.formula)
      if (body.performedAt) upd.performedAt = /^\d{4}-\d{2}-\d{2}$/.test(String(body.performedAt)) ? new Date(`${body.performedAt}T12:00:00.000Z`) : new Date(body.performedAt)
      const [merged] = await db.update(serviceRecord).set(upd).where(eq(serviceRecord.id, auto.id)).returning()
      emitToCompany(currentUser.companyId, EVENTS.REFRESH, { entity: 'service_record' })
      // The bill this visit already has, not null. Logging a service against an appointment that
      // Complete already closed merges into that record — and the visit IS billed, so a screen that
      // links to the invoice afterwards must be told which one. (Salon RR8 observation)
      const billed = (merged as any).invoiceId || await invoiceIdForVisit(currentUser.companyId, body.appointmentId)
      return c.json({ ...merged, stylistId: stylistIdOf(merged), invoiceId: billed, merged: true }, 200)
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
    // Normalised, not dropped: `Array.isArray(...) ? ... : []` silently deleted a string formula
    // rather than keeping it as one step. (RR2 R1)
    formula: normaliseFormula(body.formula),
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
  // …and the formula through the normaliser, like every other write of it.
  //
  // RR2 R1: this whitelist copied the body value straight through, so
  // PUT /api/service-records/:id { formula: "6N + 20vol" } answered 200 and stored the string. The
  // client chart's visit list then ran `(r.formula || []).map(...)` on it and threw, and the error
  // boundary took down the WHOLE chart — formulas, appointments and the account balance — for that
  // client. `formula: true` did the same.
  //
  // A whitelist says which keys may be written. It does not say the values are the right shape, and
  // I had read it as though it did.
  if ('formula' in body) updates.formula = normaliseFormula(body.formula)
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

  // …unless the visit is not actually going anywhere. Deleting one of several records filed against
  // the SAME appointment is removing a duplicate, not removing the visit, and the sale still has a
  // visit to belong to.
  //
  // LYR N3: clearing up LY0928's duplicates deleted two of Bravo's three records for one 27 Sep
  // Men's Cut, and this rule voided INV-00204 with the note "the visit it was raised from was
  // deleted". The visit was still there, still completed, and now $37.98 unbilled — the exact
  // opposite of the debt H3 was written to prevent. A sale outlives its visit only when nothing is
  // left pointing at it.
  const survivors = linkedInvoice
    ? await db.select({ id: serviceRecord.id }).from(serviceRecord)
        .where(and(
          eq(serviceRecord.companyId, currentUser.companyId),
          ne(serviceRecord.id, id),
          existing.appointmentId
            ? or(eq(serviceRecord.appointmentId, existing.appointmentId), eq(serviceRecord.invoiceId, linkedInvoice.id))
            : eq(serviceRecord.invoiceId, linkedInvoice.id),
        )).limit(1)
    : []
  const visitSurvives = survivors.length > 0

  if (linkedInvoice && !visitSurvives && linkedInvoice.status !== 'void') {
    const paid = Math.round((Number(linkedInvoice.amountPaid || 0) - Number(linkedInvoice.amountRefunded || 0)) * 100) / 100
    if (paid > 0.005) {
      return c.json({
        error: `This visit has been paid for — ${linkedInvoice.number} holds ${money(paid)}. Refund the payment and void the invoice first, then delete the visit.`,
        code: 'VISIT_HAS_PAYMENT',
        invoiceId: linkedInvoice.id,
        invoiceNumber: linkedInvoice.number,
        amountPaid: paid,
      }, 400)
    }
  }

  let voidedInvoice: { id: string; number: string } | null = null
  await db.transaction(async (tx: any) => {
    if (linkedInvoice && !visitSurvives && linkedInvoice.status !== 'void' && linkedInvoice.status !== 'refunded') {
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
