// Visits: what happened when the animal was on the table — vitals, SOAP notes, diagnoses, treatments and the charge,
// and billing that charge to the owner once. Moved from templates/crm-vet/backend/src/routes/visits.ts. The registry
// signs the person in and applies the 'patient_records' gate: the template mounted it ungated, and visits are read and
// written only from the patient's chart, whose menu item is 'patient_records'.
import { Hono } from 'hono'
import { eq, and, desc } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import {
  insertInvoice, dueDateFromTerms, businessToday, markerDay, companyTimeZone, storeDateString, isValidTimeZone,
  DEFAULT_BUSINESS_ZONE, money,
} from '@twomiah/tenant-backend'
import { visit, user, patient, invoice, invoiceLineItem, company } from '../../db/schema/index.ts'
import { lockVisitForBilling } from '../../data/vetVisits.ts'
import type { CrmDeps } from '../deps.ts'
import type { AppEnv } from '../../http/env.ts'
import { done, fail, list, one } from '../../http/reply.ts'

/** Same numbering as the invoices module, so a billed visit continues the same sequence. */
const INVOICE_NUMBERING = { prefix: 'INV', pad: 5, seed: 0 }

const FUTURE_VISIT = 'A visit is a record of something that has happened, so its date cannot be in the future. '
  + 'Book an appointment instead, or correct the date.'

/**
 * A VISIT IS SOMETHING THAT HAPPENED (T41), and the question is which DAY it is where the practice is, not how many
 * hours ahead the value is (T58, T59 at 11:24pm ET). A picked day ("2026-10-07") already is a calendar day and is
 * compared as one; a full timestamp is resolved to the calendar day it falls on in the practice's zone. A time later
 * today is still today; anything after the practice's midnight is refused.
 */
export function visitDateError(value: unknown, timeZone: string = DEFAULT_BUSINESS_ZONE, now: Date = new Date()): string | null {
  if (value === undefined || value === null || String(value).trim() === '') return null
  const raw = String(value).trim()
  const d = new Date(raw)
  if (isNaN(d.getTime())) return 'The visit date is not a date.'
  const tz = isValidTimeZone(timeZone) ? timeZone : DEFAULT_BUSINESS_ZONE
  const day = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : storeDateString(d, tz)
  // ISO dates compare correctly as strings.
  return day > storeDateString(now, tz) ? FUTURE_VISIT : null
}

/**
 * The dates on an invoice raised from a visit, on the PRACTICE's calendar (T59): `issueDate` is today where the
 * practice is; `visitLabel` is the visit's own day as M/D/YYYY — a picked day (a midnight-UTC marker) read as
 * stored, a recorded instant read in the practice's zone.
 */
export function visitInvoiceDates(visitDate: Date | null, timeZone: string, now: Date = new Date()): { issueDate: Date; visitLabel: string } {
  const tz = isValidTimeZone(timeZone) ? timeZone : DEFAULT_BUSINESS_ZONE
  const issueDate = businessToday(tz, now)
  if (!visitDate || isNaN(visitDate.getTime())) return { issueDate, visitLabel: '' }
  const isMarker = visitDate.getUTCHours() === 0 && visitDate.getUTCMinutes() === 0 && visitDate.getUTCSeconds() === 0 && visitDate.getUTCMilliseconds() === 0
  const [y, m, dd] = (isMarker ? markerDay(visitDate) : storeDateString(visitDate, tz)).split('-')
  return { issueDate, visitLabel: `${Number(m)}/${Number(dd)}/${y}` }
}

type BillOutcome = { status: 201; body: any } | { status: 400 | 404 | 409; error: string; code?: string }

export function createVisitRoutes(d: CrmDeps) {
  const { db, audit } = d
  const { requirePermission } = d.permissions
  const { emitToCompany, EVENTS } = d.realtime
  const app = new Hono<AppEnv>()

  // GET /visits — ?patientId=. A list reply (the template: { data } alone).
  app.get('/', requirePermission('contacts:read'), async (c) => {
    const currentUser = c.get('user') as any
    const patientId = c.req.query('patientId')

    const conditions = [eq(visit.companyId, currentUser.companyId)]
    if (patientId) conditions.push(eq(visit.patientId, patientId))

    const data = await db.select({ visit, providerFirstName: user.firstName, providerLastName: user.lastName })
      .from(visit)
      .leftJoin(user, eq(visit.providerId, user.id))
      .where(and(...conditions))
      .orderBy(desc(visit.visitDate))

    const rows = data.map((r: any) => ({ ...r.visit, providerFirstName: r.providerFirstName, providerLastName: r.providerLastName }))
    return list(c, rows, { page: 1, limit: rows.length, total: rows.length })
  })

  app.get('/:id', requirePermission('contacts:read'), async (c) => {
    const currentUser = c.get('user') as any
    const [row] = await db.select().from(visit)
      .where(and(eq(visit.id, c.req.param('id')), eq(visit.companyId, currentUser.companyId)))
      .limit(1)
    if (!row) return fail(c, 404, 'Visit not found')
    return one(c, row)
  })

  app.post('/', requirePermission('contacts:create'), async (c) => {
    const currentUser = c.get('user') as any
    const body = await c.req.json()

    const badDate = visitDateError(body.visitDate, await companyTimeZone(db, currentUser.companyId))
    if (badDate) return fail(c, 400, badDate, 'visit_date_in_future')

    const [created] = await db.insert(visit).values({
      id: createId(),
      patientId: body.patientId,
      appointmentId: body.appointmentId || null,
      providerId: body.providerId || null,
      visitDate: body.visitDate ? new Date(body.visitDate) : new Date(),
      reason: body.reason || null,
      weightLb: body.weightLb ?? null,
      temperatureF: body.temperatureF ?? null,
      heartRate: body.heartRate ?? null,
      respRate: body.respRate ?? null,
      subjective: body.subjective || null,
      objective: body.objective || null,
      assessment: body.assessment || null,
      plan: body.plan || null,
      diagnoses: body.diagnoses || [],
      treatments: body.treatments || null,
      notes: body.notes || null,
      total: body.total ?? null,
      companyId: currentUser.companyId,
    }).returning()

    await audit.log({ action: 'create', entity: 'visit', entityId: created.id, metadata: created, req: { user: currentUser } })
    emitToCompany(currentUser.companyId, EVENTS.REFRESH, { entity: 'visit' })
    return one(c, created, 201)
  })

  /**
   * POST /visits/:id/invoice — the visit's charge as a draft invoice billed to the pet's owner, ONCE, even when two
   * people press the button at the same moment (T41): the visit row is locked FOR UPDATE inside a transaction (the
   * second request waits, then sees the invoice and gets a 409), and the invoice is written by the shared
   * insertInvoice, which numbers under an advisory lock. Everything inside the transaction uses `tx` (an outer `db`
   * read there deadlocks PGlite). Due on the practice's payment terms, not the day it is raised (T51), dated on the
   * practice's calendar (T59).
   */
  app.post('/:id/invoice', requirePermission('invoices:create'), async (c) => {
    const currentUser = c.get('user') as any
    const id = c.req.param('id')
    // The practice's zone, read BEFORE the transaction.
    const tz = await companyTimeZone(db, currentUser.companyId)

    const outcome: BillOutcome = await db.transaction(async (tx: any): Promise<BillOutcome> => {
      const v = await lockVisitForBilling(tx, currentUser.companyId, id)
      if (!v) return { status: 404, error: 'Visit not found' }
      if (v.invoiceId) return { status: 409, error: 'This visit has already been billed.' }

      const charge = Number(v.total)
      if (!charge || charge <= 0) return { status: 400, error: 'This visit has no charge to bill.' }

      const [pet] = await tx.select({ ownerId: patient.ownerId, name: patient.name }).from(patient).where(eq(patient.id, v.patientId)).limit(1)
      if (!pet?.ownerId) return { status: 400, error: 'This patient has no owner to bill.' }

      const amount = Math.round(charge * 100) / 100
      const [co] = await tx.select({ settings: company.settings }).from(company).where(eq(company.id, currentUser.companyId)).limit(1)
      const { issueDate: today, visitLabel } = visitInvoiceDates(v.visitDate, tz)
      const dueDate = dueDateFromTerms(co?.settings, today)
      const inv = await insertInvoice(
        tx,
        { invoice, invoiceLineItem } as any,
        INVOICE_NUMBERING,
        {
          companyId: currentUser.companyId,
          contactId: pet.ownerId,
          issueDate: today, dueDate,
          taxRate: 0, status: 'draft',
          // The owner is billed, but the charges are this animal's — the chart's Invoices tab reads it. (T12 M6)
          extra: { patientId: v.patientId },
        } as any,
        [{ description: `Veterinary visit${visitLabel ? ' — ' + visitLabel : ''}${pet.name ? ` (${pet.name})` : ''}`, quantity: 1, unitPrice: amount }] as any,
      )

      await tx.update(visit).set({ invoiceId: inv.id, updatedAt: new Date() }).where(eq(visit.id, id))
      return { status: 201, body: inv }
    })

    if (outcome.status !== 201) return fail(c, outcome.status, outcome.error)
    await audit.log({ action: 'create', entity: 'invoice', entityId: outcome.body.id, metadata: { fromVisit: id }, req: { user: currentUser } })
    emitToCompany(currentUser.companyId, EVENTS.REFRESH, { entity: 'invoice' })
    return one(c, outcome.body, 201)
  })

  app.put('/:id', requirePermission('contacts:update'), async (c) => {
    const currentUser = c.get('user') as any
    const id = c.req.param('id')
    const body = await c.req.json()

    const [existing] = await db.select().from(visit)
      .where(and(eq(visit.id, id), eq(visit.companyId, currentUser.companyId)))
      .limit(1)
    if (!existing) return fail(c, 404, 'Visit not found')

    // Whitelist editable columns — never let companyId/id be reassigned from the body.
    const EDITABLE = ['patientId', 'appointmentId', 'providerId', 'visitDate', 'reason', 'weightLb', 'temperatureF', 'heartRate', 'respRate', 'subjective', 'objective', 'assessment', 'plan', 'diagnoses', 'treatments', 'notes', 'total'] as const
    const updates: any = { updatedAt: new Date() }
    for (const k of EDITABLE) if (k in body) updates[k] = body[k]

    /**
     * Once the bill is raised, the charge is what the bill says (T41). Only the money is frozen: the clinical record
     * stays editable after invoicing. The template's refusal also carried the invoice id and the total as fields; the
     * total is in the sentence and the screen reads only the sentence (RULEBOOK §3).
     */
    if (existing.invoiceId && 'total' in updates) {
      const changed = Number(updates.total ?? 0).toFixed(2) !== Number(existing.total ?? 0).toFixed(2)
      if (changed) {
        return fail(c, 400, `This visit has already been invoiced, so its charge is fixed at ${money(Number(existing.total ?? 0))}. `
          + 'To change what the owner pays, credit or void the invoice and raise a new one.', 'visit_already_invoiced')
      }
      // Unchanged (the edit form posts every field back): accept the rest and leave the figure alone.
      delete updates.total
    }
    // The same date rule on the edit as on the create. (T41)
    if ('visitDate' in updates) {
      const badDate = visitDateError(updates.visitDate, await companyTimeZone(db, currentUser.companyId))
      if (badDate) return fail(c, 400, badDate, 'visit_date_in_future')
    }
    if ('visitDate' in updates && updates.visitDate) updates.visitDate = new Date(updates.visitDate)

    const [updated] = await db.update(visit).set(updates).where(eq(visit.id, id)).returning()
    await audit.log({ action: 'update', entity: 'visit', entityId: id, changes: audit.diff(existing, updated), req: { user: currentUser } })
    emitToCompany(currentUser.companyId, EVENTS.REFRESH, { entity: 'visit' })
    return one(c, updated)
  })

  app.delete('/:id', requirePermission('contacts:update'), async (c) => {
    const currentUser = c.get('user') as any
    const id = c.req.param('id')

    const [existing] = await db.select().from(visit)
      .where(and(eq(visit.id, id), eq(visit.companyId, currentUser.companyId)))
      .limit(1)
    if (!existing) return fail(c, 404, 'Visit not found')

    /**
     * A billed visit is not deleted under its invoice — for any role (T62). Void the invoice (or delete it while it is
     * still a draft) and the visit can go. The template's refusal also carried the invoice id; its number is in the
     * sentence.
     */
    if (existing.invoiceId) {
      const [billed] = await db.select({ id: invoice.id, number: invoice.number, status: invoice.status }).from(invoice)
        .where(and(eq(invoice.id, existing.invoiceId), eq(invoice.companyId, currentUser.companyId))).limit(1)
      if (billed && billed.status !== 'void') {
        return fail(c, 409, `This visit has been invoiced on ${billed.number}, so it can't be deleted. Void the invoice first (or delete it if it is still a draft), then delete the visit.`, 'visit_already_invoiced')
      }
    }

    await db.delete(visit).where(eq(visit.id, id))
    await audit.log({ action: 'delete', entity: 'visit', entityId: id, metadata: existing, req: { user: currentUser } })
    emitToCompany(currentUser.companyId, EVENTS.REFRESH, { entity: 'visit' })
    return done(c)
  })

  return app
}
