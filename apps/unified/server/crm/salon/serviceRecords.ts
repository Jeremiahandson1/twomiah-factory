// The formula log — what was actually done in the chair. Moved from templates/crm-salon/backend/src/routes/serviceRecords.ts.
//
// The salon's clinical record: it makes a colour repeatable by any stylist in the shop, and its performedAt with the
// service's rebookIntervalDays is what the recall list reads. Logging a visit against an appointment completes it and
// raises the sale; deleting one answers for the sale it raised.
import { Hono } from 'hono'
import { and, desc, eq, ne, or } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import { hasHappened, money } from '@twomiah/tenant-backend'
import { serviceRecord, serviceMenu, contact, user, appointment, teamMember, invoice } from '../../db/schema/index.ts'
import {
  orphanVisitSales, voidOrphanVisitSale, restoreDuplicateVoidedSales, futureVisits, redateVisitToCreation,
  visitsOfCancelledAppointments, deleteVisitRecord, pricelessVisits, setVisitPrice, undoOrphanVoids,
} from '../../data/salon.ts'
import type { AppEnv } from '../../http/env.ts'
import { fail, list, one } from '../../http/reply.ts'
import type { CrmDeps } from '../deps.ts'
import { AUTO_VISIT_NOTE, CANCELLED_VISIT_LABEL, REPAIR_MARK, normaliseFormula } from './formulas.ts'
import { resolveStylist, unknownStylist, stylistIdOf } from './people.ts'
import type { SalonServices } from './services.ts'

const EDITABLE = ['appointmentId', 'stylistId', 'serviceId', 'performedAt', 'formula', 'developerVolume', 'processingMin', 'productsUsed', 'result', 'photoBefore', 'photoAfter', 'priceCharged', 'notes'] as const
const MERGEABLE = ['serviceId', 'developerVolume', 'processingMin', 'productsUsed', 'result', 'photoBefore', 'photoAfter', 'priceCharged', 'notes'] as const

/** A date-only value is a calendar date: stored at noon UTC so it renders as that date in any US zone. (SALON-H9) */
const visitDate = (v: unknown) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? new Date(`${v}T12:00:00.000Z`) : new Date(v as string))

export function createServiceRecordRoutes(d: CrmDeps, salon: SalonServices) {
  const { db, audit, logger } = d
  const { requirePermission } = d.permissions
  const live = d.realtime
  const { checkout, formulas } = salon
  const refresh = (companyId: string, entity: string) => live.emitToCompany(companyId, live.EVENTS.REFRESH, { entity })
  const app = new Hono<AppEnv>()

  // GET /service-records — ?contactId=, ?stylistId= (either column — the caller knows one id, T20 H1)
  app.get('/', requirePermission('contacts:read'), async (c) => {
    const currentUser = c.get('user') as any
    const contactId = c.req.query('contactId')
    const stylistId = c.req.query('stylistId')
    const conditions = [eq(serviceRecord.companyId, currentUser.companyId)]
    if (contactId) conditions.push(eq(serviceRecord.contactId, contactId))
    if (stylistId) conditions.push(or(eq(serviceRecord.stylistId, stylistId), eq(serviceRecord.stylistMemberId, stylistId))!)

    const data: any[] = await db.select({
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
      .leftJoin(teamMember, eq(serviceRecord.stylistMemberId, teamMember.id))
      .where(and(...conditions))
      .orderBy(desc(serviceRecord.performedAt))
      .limit(200)

    const rows = data.map((r) => {
      const parts = String(r.stylistMemberName || '').trim().split(/\s+/)
      return {
        ...r.record,
        stylistId: stylistIdOf(r.record),
        clientName: r.clientName, serviceName: r.serviceName,
        stylistFirstName: r.stylistFirstName ?? (parts[0] || null),
        stylistLastName: r.stylistLastName ?? (parts.slice(1).join(' ') || null),
      }
    })
    return list(c, rows, { page: 1, limit: 200, total: rows.length })
  })

  /**
   * Clear up what the old write paths left behind — an endpoint an operator calls, idempotent, reporting every row it
   * touched: sales whose visit is gone voided (T20 H3), sales a duplicate clean-up voided put back (LYR N3), future-dated
   * visits moved to the day they were created (T20 M4), visits of cancelled appointments removed with their formula
   * kept on the client (FULL0929 F1), and priceless visits priced from their sale or menu (RR2 R3).
   */
  app.post('/repair-legacy', requirePermission('company:update'), async (c) => {
    const currentUser = c.get('user') as any
    const cid = currentUser.companyId

    const orphanRows = await orphanVisitSales(db, cid)
    for (const row of orphanRows) await voidOrphanVisitSale(db, row.id, cid)

    const unvoidedRows = await restoreDuplicateVoidedSales(db, cid)

    const futureRows = await futureVisits(db, cid)
    for (const row of futureRows) await redateVisitToCreation(db, row.id, cid)

    const staleRows = await visitsOfCancelledAppointments(db, cid)
    const visitsRemoved: Array<{ id: string; contactId: string }> = []
    const formulasKept: Array<{ recordId: string; contactId: string; formulaId: string }> = []
    for (const row of staleRows) {
      const ownNotes = String(row.notes || '').trim()
      const bare = (ownNotes.endsWith(REPAIR_MARK) ? ownNotes.slice(0, -REPAIR_MARK.length) : ownNotes).trim()
      // The note the SYSTEM writes on every completed visit is not a stylist's work.
      const stylistNote = bare === AUTO_VISIT_NOTE ? '' : bare
      const kept = await formulas.keepFromRecord(cid, {
        id: row.id, contactId: row.contactId, formula: row.formula, developerVolume: row.developerVolume,
        processingMin: row.processingMin, performedAt: row.performedAt, notes: stylistNote,
      }, CANCELLED_VISIT_LABEL)
      if (kept) formulasKept.push({ recordId: row.id, contactId: row.contactId, formulaId: kept.kept.id })
      await deleteVisitRecord(db, row.id, cid)
      visitsRemoved.push({ id: row.id, contactId: row.contactId })
    }

    await audit.log({
      action: 'update', entity: 'service_record', entityId: 'repair-legacy',
      metadata: { invoicesVoided: orphanRows.length, invoicesRestored: unvoidedRows.length, visitsRedated: futureRows.length, visitsRemoved: visitsRemoved.length, formulasKept: formulasKept.length },
      req: { user: currentUser },
    })
    if (orphanRows.length || unvoidedRows.length || futureRows.length || staleRows.length) refresh(cid, 'service_record')
    if (orphanRows.length || unvoidedRows.length) refresh(cid, 'invoice')

    // No sale, no quote and no menu price is not a zero — it is unknown, and is left alone.
    const pricelessRows: Array<{ id: string; price: number }> = []
    for (const r of await pricelessVisits(db, cid)) {
      const price = Number(r.price)
      if (!Number.isFinite(price) || price <= 0) continue
      await setVisitPrice(db, r.id, cid, price.toFixed(2))
      pricelessRows.push({ id: r.id, price: Number(price.toFixed(2)) })
    }

    return one(c, {
      invoicesVoided: orphanRows.length,
      invoices: orphanRows,
      visitsPriced: pricelessRows.length,
      priced: pricelessRows,
      invoicesRestored: unvoidedRows.length,
      restored: unvoidedRows,
      visitsRedated: futureRows.length,
      visits: futureRows.map((r) => ({ id: r.id, was: r.performedAt, now: r.createdAt })),
      visitsRemoved: visitsRemoved.length,
      removed: visitsRemoved,
      formulasKept: formulasKept.length,
      keptFormulas: formulasKept,
    })
  })

  /** Put back an invoice the repair voided: voiding is terminal in the invoice editor, so the repair must be reversible. */
  app.post('/repair-legacy/undo', requirePermission('company:update'), async (c) => {
    const currentUser = c.get('user') as any
    const cid = currentUser.companyId
    const rows = await undoOrphanVoids(db, cid)
    await audit.log({ action: 'update', entity: 'invoice', entityId: 'repair-legacy-undo', metadata: { restored: rows.length }, req: { user: currentUser } })
    if (rows.length) refresh(cid, 'service_record')
    return one(c, { restored: rows.length, invoices: rows })
  })

  app.get('/:id', requirePermission('contacts:read'), async (c) => {
    const currentUser = c.get('user') as any
    const [row] = await db.select().from(serviceRecord)
      .where(and(eq(serviceRecord.id, c.req.param('id')), eq(serviceRecord.companyId, currentUser.companyId))).limit(1)
    if (!row) return fail(c, 404, 'Service record not found')
    return one(c, { ...row, stylistId: stylistIdOf(row) })
  })

  // POST — writing a record completes its appointment, so the front desk never closes the ticket twice.
  app.post('/', requirePermission('schedule:create'), async (c) => {
    const currentUser = c.get('user') as any
    const body = (await c.req.json().catch(() => null)) ?? ({} as any)
    if (typeof body.contactId !== 'string' || !body.contactId) return fail(c, 400, 'contactId is required')

    const [ct] = await db.select().from(contact).where(and(eq(contact.id, body.contactId), eq(contact.companyId, currentUser.companyId))).limit(1)
    if (!ct) return fail(c, 404, 'Client not found')

    if (body.processingMin != null && body.processingMin !== '' && (isNaN(Number(body.processingMin)) || Number(body.processingMin) < 0 || Number(body.processingMin) > 600)) {
      return fail(c, 400, 'Processing time must be between 0 and 600 minutes.')
    }
    // "Is there a formula here" decided the way the card decides it. (RR2 R1)
    const hasFormula = normaliseFormula(body.formula).some((l) => String(l?.product || l?.shade || '').trim())
    if (!body.serviceId && !hasFormula && !body.result && !body.productsUsed && (body.priceCharged == null || body.priceCharged === '') && !body.notes) {
      return fail(c, 400, 'Add a service, a formula, a result or a price — an empty record tells the next stylist nothing.')
    }
    if (body.priceCharged != null && (isNaN(Number(body.priceCharged)) || Number(body.priceCharged) < 0)) return fail(c, 400, 'Price charged cannot be negative.')
    // A visit is something that HAPPENED. (T20 M4)
    if (!hasHappened(body.performedAt)) {
      return fail(c, 400, 'A visit can only be dated to a day that has happened. Check the year.', 'FUTURE_VISIT', { performedAt: 'A visit can only be dated to a day that has happened.' })
    }

    const stylist = await resolveStylist(db, currentUser.companyId, body.stylistId)
    if (!stylist) return unknownStylist(c, body.stylistId)

    // Reuse the record Complete wrote for this appointment rather than logging a second visit. (SALON-H4)
    if (body.appointmentId) {
      const [auto] = await db.select().from(serviceRecord).where(and(eq(serviceRecord.appointmentId, body.appointmentId), eq(serviceRecord.companyId, currentUser.companyId))).limit(1)
      if (auto) {
        const upd: Record<string, unknown> = { updatedAt: new Date() }
        for (const k of MERGEABLE) if (k in body) upd[k] = body[k] === '' ? null : body[k]
        if ('stylistId' in body) { upd.stylistId = stylist.stylistId; upd.stylistMemberId = stylist.stylistMemberId }
        if ('formula' in body) upd.formula = normaliseFormula(body.formula)
        if (body.performedAt) upd.performedAt = visitDate(body.performedAt)
        const [merged] = await db.update(serviceRecord).set(upd).where(eq(serviceRecord.id, auto.id)).returning()
        refresh(currentUser.companyId, 'service_record')
        // The bill this visit already has, not null. (Salon RR8)
        const billed = merged.invoiceId || await checkout.invoiceIdForVisit(currentUser.companyId, body.appointmentId)
        return one(c, { ...merged, stylistId: stylistIdOf(merged), invoiceId: billed, merged: true })
      }
    }
    const [created] = await db.insert(serviceRecord).values({
      id: createId(),
      contactId: body.contactId,
      appointmentId: body.appointmentId || null,
      stylistId: stylist.stylistId,
      stylistMemberId: stylist.stylistMemberId,
      serviceId: body.serviceId || null,
      performedAt: body.performedAt ? visitDate(body.performedAt) : new Date(),
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
      await db.update(appointment).set({ status: 'completed', updatedAt: new Date() })
        .where(and(eq(appointment.id, created.appointmentId), eq(appointment.companyId, currentUser.companyId)))
    }

    // Logging the service closes the visit: the sale (once per appointment) and the review request. Neither may fail the
    // record write. (SALON-H4 / H2)
    let invoiceId: string | null = null
    try {
      let serviceName: string | null = null
      if (created.serviceId) {
        const [svc] = await db.select({ name: serviceMenu.name }).from(serviceMenu).where(eq(serviceMenu.id, created.serviceId)).limit(1)
        serviceName = svc?.name || null
      }
      const inv = await checkout.ensureInvoiceForVisit({ companyId: currentUser.companyId, contactId: created.contactId, appointmentId: created.appointmentId, serviceName, price: Number(created.priceCharged), actor: currentUser })
      invoiceId = inv?.id || null
      // Which sale this visit raised, so deleting the visit can answer for it. (T20 H3)
      if (invoiceId) await db.update(serviceRecord).set({ invoiceId, updatedAt: new Date() } as any).where(eq(serviceRecord.id, created.id))
    } catch (e: any) { logger.warn('[service-records] sale not created', { error: e?.message || String(e) }) }
    d.services.reviews.scheduleReviewRequestForVisit({ companyId: currentUser.companyId, contactId: created.contactId })
      .catch((e: any) => logger.warn('[service-records] review schedule failed', { error: e?.message || String(e) }))

    await audit.log({ action: 'create', entity: 'service_record', entityId: created.id, metadata: created, req: { user: currentUser } })
    refresh(currentUser.companyId, 'service_record')
    return one(c, { ...created, stylistId: stylistIdOf(created), invoiceId }, 201)
  })

  app.put('/:id', requirePermission('schedule:update'), async (c) => {
    const currentUser = c.get('user') as any
    const id = c.req.param('id')
    const body = (await c.req.json().catch(() => null)) ?? ({} as any)

    const [existing] = await db.select().from(serviceRecord).where(and(eq(serviceRecord.id, id), eq(serviceRecord.companyId, currentUser.companyId))).limit(1)
    if (!existing) return fail(c, 404, 'Service record not found')

    const updates: Record<string, any> = { updatedAt: new Date() }
    for (const k of EDITABLE) if (k in body) updates[k] = body[k]
    // A whitelist says which keys may be written, not that the values are the right shape. (RR2 R1)
    if ('formula' in body) updates.formula = normaliseFormula(body.formula)
    if ('stylistId' in updates) {
      const resolved = await resolveStylist(db, currentUser.companyId, updates.stylistId)
      if (!resolved) return unknownStylist(c, updates.stylistId)
      updates.stylistId = resolved.stylistId
      updates.stylistMemberId = resolved.stylistMemberId
    }
    // An edit must not be the way a future visit gets in. (T20 M4)
    if ('performedAt' in updates && !hasHappened(updates.performedAt)) {
      return fail(c, 400, 'A visit can only be dated to a day that has happened. Check the year.', 'FUTURE_VISIT', { performedAt: 'A visit can only be dated to a day that has happened.' })
    }
    if (updates.performedAt) updates.performedAt = new Date(updates.performedAt)

    const [updated] = await db.update(serviceRecord).set(updates).where(eq(serviceRecord.id, id)).returning()
    await audit.log({ action: 'update', entity: 'service_record', entityId: id, changes: audit.diff(existing, updated), req: { user: currentUser } })
    refresh(currentUser.companyId, 'service_record')
    return one(c, { ...updated, stylistId: stylistIdOf(updated) })
  })

  /**
   * DELETE — answers for the sale the visit raised (T20 H3): an issued invoice is VOIDED, never deleted, and money that
   * was collected blocks the deletion. Unless the visit is not going anywhere: deleting one of several records filed
   * against the same appointment removes a duplicate, and the sale keeps its visit. (LYR N3)
   */
  app.delete('/:id', requirePermission('invoices:update'), async (c) => {
    const currentUser = c.get('user') as any
    const id = c.req.param('id')
    const [existing] = await db.select().from(serviceRecord).where(and(eq(serviceRecord.id, id), eq(serviceRecord.companyId, currentUser.companyId))).limit(1)
    if (!existing) return fail(c, 404, 'Service record not found')

    const [linkedInvoice] = existing.invoiceId
      ? await db.select().from(invoice).where(and(eq(invoice.id, existing.invoiceId), eq(invoice.companyId, currentUser.companyId))).limit(1)
      // records written before the link existed: the appointment the sale was filed against
      : existing.appointmentId
        ? await db.select().from(invoice).where(and(eq(invoice.appointmentId, existing.appointmentId), eq(invoice.companyId, currentUser.companyId))).limit(1)
        : []

    const survivors = linkedInvoice
      ? await db.select({ id: serviceRecord.id }).from(serviceRecord).where(and(
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
        // The template also sent the invoice's id, number and the amount; the sentence names them.
        return fail(c, 400, `This visit has been paid for — ${linkedInvoice.number} holds ${money(paid)}. Refund the payment and void the invoice first, then delete the visit.`, 'VISIT_HAS_PAYMENT')
      }
    }

    let voidedInvoice: { id: string; number: string } | null = null
    await db.transaction(async (tx: any) => {
      if (linkedInvoice && !visitSurvives && linkedInvoice.status !== 'void' && linkedInvoice.status !== 'refunded') {
        const note = 'Voided: the visit it was raised from was deleted'
        await tx.update(invoice).set({ status: 'void', notes: linkedInvoice.notes ? `${linkedInvoice.notes}\n${note}` : note, updatedAt: new Date() }).where(eq(invoice.id, linkedInvoice.id))
        voidedInvoice = { id: linkedInvoice.id, number: linkedInvoice.number }
      }
      await tx.delete(serviceRecord).where(eq(serviceRecord.id, id))
    })

    await audit.log({ action: 'delete', entity: 'service_record', entityId: id, metadata: { ...existing, voidedInvoice }, req: { user: currentUser } })
    refresh(currentUser.companyId, 'service_record')
    if (voidedInvoice) refresh(currentUser.companyId, 'invoice')
    return one(c, { success: true, voidedInvoice })
  })

  return app
}
