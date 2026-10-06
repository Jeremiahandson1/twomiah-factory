import { Hono } from 'hono'
import { db } from '../../db/index.ts'
// `company` is read for its settings blob, which is where Invoice Payment Terms live. (T51)
import { visit, user, patient, invoice, invoiceLineItem, company } from '../../db/schema.ts'
import { eq, and, desc, sql } from 'drizzle-orm'
// insertInvoice is the ONE write path for a new invoice — it numbers under an advisory lock, which is
// what stops two concurrent bills taking the same number. See POST /:id/invoice. (T41)
// dueDateFromTerms: the shared net-30-by-default rule every other invoicing path already uses, so a
// visit invoice stops being due the day it is raised. A terms value of 0 still means due today. (T51)
import { insertInvoice, dueDateFromTerms } from '../shared/index.ts'

/** Same numbering as this CRM's invoices route, so a billed visit continues the same sequence. */
const INVOICE_NUMBERING = { prefix: 'INV', pad: 5, seed: 0 }

/** db.execute shapes differ by driver; every raw read here goes through this. */
const rowsOf = (r: any): any[] => (r?.rows ?? r ?? []) as any[]
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'
import { emitToCompany, EVENTS } from '../services/socket.ts'
import audit from '../services/audit.ts'
import { createId } from '@paralleldrive/cuid2'
import { money } from '../shared/invoicing/money.ts'

const app = new Hono()
app.use('*', authenticate)

/**
 * A VISIT IS SOMETHING THAT HAPPENED. (T41)
 *
 *   "Recent Visits is led by a future-dated 2027 visit"
 *
 * Nothing checked visitDate, so a mistyped year saved happily and then sat at the top of every
 * list that orders by it — the dashboard's Recent Visits panel, the patient's chart, the practice's
 * visit list. It is not only ugly: a visit carries vitals, an assessment and a charge, so a record
 * dated in the future is a consultation the clinic is asserting it has already done.
 *
 * An APPOINTMENT is the thing that may be in the future; that is a different table with its own
 * screen. A visit is written when the animal is on the table.
 *
 * The tolerance is a day, not zero, because the date arrives as the browser's local day and the
 * server reads it in UTC — a clinic in Auckland entering today's date is already "tomorrow" here,
 * and refusing that would make the page unusable in half the world. A year out is still refused.
 */
const VISIT_DATE_SKEW_MS = 36 * 60 * 60 * 1000

export function visitDateError(value: unknown): string | null {
  if (value === undefined || value === null || String(value).trim() === '') return null
  const d = new Date(String(value))
  if (isNaN(d.getTime())) return 'The visit date is not a date.'
  if (d.getTime() > Date.now() + VISIT_DATE_SKEW_MS) {
    return 'A visit is a record of something that has happened, so its date cannot be in the future. '
      + 'Book an appointment instead, or correct the date.'
  }
  return null
}

// GET /visits — ?patientId=
app.get('/', requirePermission('contacts:read'), async (c) => {
  const currentUser = c.get('user') as any
  const patientId = c.req.query('patientId')

  const conditions = [eq(visit.companyId, currentUser.companyId)]
  if (patientId) conditions.push(eq(visit.patientId, patientId))

  const data = await db.select({
    visit,
    providerFirstName: user.firstName,
    providerLastName: user.lastName,
  })
    .from(visit)
    .leftJoin(user, eq(visit.providerId, user.id))
    .where(and(...conditions))
    .orderBy(desc(visit.visitDate))

  // Flatten the joined visit + provider fields to one row level so list
  // consumers can read `row.id` / `row.visitDate` / `row.providerFirstName` directly.
  const rows = data.map((r: any) => ({ ...r.visit, providerFirstName: r.providerFirstName, providerLastName: r.providerLastName }))
  return c.json({ data: rows })
})

// GET /visits/:id
app.get('/:id', requirePermission('contacts:read'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const [row] = await db.select().from(visit)
    .where(and(eq(visit.id, id), eq(visit.companyId, currentUser.companyId)))
    .limit(1)
  if (!row) return c.json({ error: 'Visit not found' }, 404)

  return c.json(row)
})

// POST /visits
app.post('/', requirePermission('contacts:create'), async (c) => {
  const currentUser = c.get('user') as any
  const body = await c.req.json()

  const badDate = visitDateError(body.visitDate)
  if (badDate) return c.json({ error: badDate, code: 'visit_date_in_future' }, 400)

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
  return c.json(created, 201)
})

// POST /visits/:id/invoice — turn a visit's charge into a draft invoice billed to the
// pet's owner. Without this the charge captured on a visit never reached billing. (VET-15)
/**
 * Bill a visit — ONCE, even when two people press the button at the same moment. (T41)
 *
 * THE FAULT. This read the visit, checked `invoiceId`, and inserted, all outside a transaction. Two
 * parallel requests both passed the check and both inserted: T41 raced it five times two-way and
 * double-billed five times out of five, across owner, staff and manager, and a four-way race
 * produced three invoices. Twice the pair even shared a number (INV-00061, INV-00070), because the
 * number came from a `max()` scan with nothing serialising it. The visit links only the LAST
 * invoice, so the others sit in AR with no visit pointing at them — money owed by nobody,
 * discoverable only by reconciling the ledger by hand.
 *
 * THE FIX IS NOT A TIGHTER CHECK. A re-read cannot fix a race; it just narrows the window. Two
 * things make it impossible instead:
 *
 *   1. `SELECT … FOR UPDATE` on the VISIT row inside a transaction. The second request blocks until
 *      the first commits, then reads the invoice_id the first one wrote and answers 409. That is the
 *      same lock invoices.ts already takes before it moves money on an invoice.
 *   2. The shared `insertInvoice`, instead of this file's own copy of invoice creation. It numbers
 *      under `pg_advisory_xact_lock` so two invoices cannot take the same number, and it is the one
 *      write path every other vertical uses — snow billing, agreements, wellness plans and event
 *      deposits all go through it. Vet having its own hand-rolled copy is why vet alone had the
 *      duplicate-number bug.
 *
 * Everything inside the transaction uses `tx`. A helper that reaches for the outer `db` here would
 * deadlock PGlite and hang the suite with no output.
 */
app.post('/:id/invoice', requirePermission('invoices:create'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const outcome = await db.transaction(async (tx: any) => {
    // The lock. Scoped to the company, so one tenant cannot block another's row by id.
    const locked = rowsOf(await tx.execute(
      sql`SELECT id, patient_id, total, invoice_id, visit_date FROM visit
           WHERE id = ${id} AND company_id = ${currentUser.companyId} FOR UPDATE`,
    ))
    const v = locked[0]
    if (!v) return { status: 404 as const, body: { error: 'Visit not found' } }
    if (v.invoice_id) return { status: 409 as const, body: { error: 'This visit has already been billed.' } }

    const charge = Number(v.total)
    if (!charge || charge <= 0) return { status: 400 as const, body: { error: 'This visit has no charge to bill.' } }

    const [pet] = await tx.select({ ownerId: patient.ownerId, name: patient.name }).from(patient)
      .where(eq(patient.id, v.patient_id)).limit(1)
    if (!pet?.ownerId) return { status: 400 as const, body: { error: 'This patient has no owner to bill.' } }

    const amount = Math.round(charge * 100) / 100
    const when = v.visit_date ? new Date(v.visit_date) : null

    /**
     * THE PRACTICE'S PAYMENT TERMS, NOT "DUE NOW". (T51)
     *
     *   "Visit invoices are due the day they're issued."
     *
     * This passed `dueDate: new Date()`, so every invoice raised from a visit was due the moment it
     * existed — and `isOverdue` waits only for the day to end, so it went overdue overnight. The
     * practice sets Invoice Payment Terms in Settings → Company and every other invoicing path in
     * the fleet reads it; this one path ignored it, so the vet's Invoices list filled with overdue
     * rows nobody was late paying, and the Reports overdue figure counted them.
     *
     * dueDateFromTerms is the shared helper the rest of the app uses: net-30 when unset, and a terms
     * value of 0 — "due on receipt", which is a real choice for a clinic taking payment at the desk —
     * still comes out as today. So a practice that genuinely wants due-on-receipt keeps it; one that
     * never set terms stops being told its invoices are late.
     */
    const [co] = await tx.select({ settings: company.settings }).from(company)
      .where(eq(company.id, currentUser.companyId)).limit(1)
    const dueDate = dueDateFromTerms(co?.settings)
    const inv = await insertInvoice(
      tx,
      { invoice, invoiceLineItem } as any,
      INVOICE_NUMBERING,
      {
        companyId: currentUser.companyId,
        contactId: pet.ownerId,
        issueDate: new Date(), dueDate,
        taxRate: 0, status: 'draft',
        // The owner is billed, but the charges are this animal's — the chart's Invoices tab reads it. (T12 M6)
        extra: { patientId: v.patient_id },
      },
      [{
        description: `Veterinary visit${when ? ' — ' + when.toLocaleDateString('en-US') : ''}${pet.name ? ` (${pet.name})` : ''}`,
        quantity: 1, unitPrice: amount,
      }] as any,
    )

    await tx.update(visit).set({ invoiceId: inv.id, updatedAt: new Date() }).where(eq(visit.id, id))
    return { status: 201 as const, body: inv }
  })

  if (outcome.status === 201) {
    await audit.log({ action: 'create', entity: 'invoice', entityId: (outcome.body as any).id, metadata: { fromVisit: id }, req: { user: currentUser } })
    emitToCompany(currentUser.companyId, EVENTS.REFRESH, { entity: 'invoice' })
  }
  return c.json(outcome.body as any, outcome.status)
})

// PUT /visits/:id
app.put('/:id', requirePermission('contacts:update'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')
  const body = await c.req.json()

  const [existing] = await db.select().from(visit)
    .where(and(eq(visit.id, id), eq(visit.companyId, currentUser.companyId)))
    .limit(1)
  if (!existing) return c.json({ error: 'Visit not found' }, 404)

  // Whitelist editable columns — never let companyId/id be reassigned from the body.
  const EDITABLE = ['patientId', 'appointmentId', 'providerId', 'visitDate', 'reason', 'weightLb', 'temperatureF', 'heartRate', 'respRate', 'subjective', 'objective', 'assessment', 'plan', 'diagnoses', 'treatments', 'notes', 'total'] as const
  const updates: any = { updatedAt: new Date() }
  for (const k of EDITABLE) if (k in body) updates[k] = body[k]

  /**
   * ONCE THE BILL IS RAISED, THE CHARGE IS WHAT THE BILL SAYS. (T41)
   *
   *   "A billed visit's total can still be edited after invoicing (PUT 999 → 200; the invoice stays
   *    125.50)."
   *
   * That is the whole fault: the two figures simply stopped agreeing. The visit said $999, the
   * invoice said $125.50, and the owner is holding the $125.50 one. Every surface that totals
   * visits — the patient chart, the dashboard, a revenue report — then reads a number the practice
   * never asked anyone to pay.
   *
   * ONLY THE MONEY IS FROZEN, and that distinction matters. The clinical record must stay editable
   * after invoicing: a vet writes up the assessment properly that evening, a lab result comes back,
   * a weight was typed wrong. Refusing the whole PUT would push that work out of the record
   * altogether, which is the worse outcome in a medical note. So the charge is fixed and the
   * medicine is not.
   *
   * The way to change what was charged is the invoice: credit it, void it, or raise another. That is
   * the same answer routes/changeOrders.ts gives for an approved change order, and for the same
   * reason — the document has left the building.
   */
  if (existing.invoiceId && 'total' in updates) {
    const changed = Number(updates.total ?? 0).toFixed(2) !== Number(existing.total ?? 0).toFixed(2)
    if (changed) {
      return c.json({
        error: `This visit has already been invoiced, so its charge is fixed at ${money(Number(existing.total ?? 0))}. `
          + 'To change what the owner pays, credit or void the invoice and raise a new one.',
        code: 'visit_already_invoiced',
        invoiceId: existing.invoiceId,
        total: existing.total,
      }, 400)
    }
    // Unchanged (the edit form posts every field back, including the total it was shown) — accept the
    // rest of the edit and leave the figure alone rather than refusing a save that changes nothing.
    delete updates.total
  }
  // The same rule on the edit as on the create — a date nobody may enter is a date nobody may
  // correct a record INTO either, and the edit is the likelier typo of the two. (T41)
  if ('visitDate' in updates) {
    const badDate = visitDateError(updates.visitDate)
    if (badDate) return c.json({ error: badDate, code: 'visit_date_in_future' }, 400)
  }
  if ('visitDate' in updates && updates.visitDate) updates.visitDate = new Date(updates.visitDate)

  const [updated] = await db.update(visit).set(updates).where(eq(visit.id, id)).returning()
  await audit.log({ action: 'update', entity: 'visit', entityId: id, changes: audit.diff(existing, updated), req: { user: currentUser } })
  emitToCompany(currentUser.companyId, EVENTS.REFRESH, { entity: 'visit' })
  return c.json(updated)
})

// DELETE /visits/:id
app.delete('/:id', requirePermission('contacts:update'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const [existing] = await db.select().from(visit)
    .where(and(eq(visit.id, id), eq(visit.companyId, currentUser.companyId)))
    .limit(1)
  if (!existing) return c.json({ error: 'Visit not found' }, 404)

  await db.delete(visit).where(eq(visit.id, id))
  await audit.log({ action: 'delete', entity: 'visit', entityId: id, metadata: existing, req: { user: currentUser } })
  emitToCompany(currentUser.companyId, EVENTS.REFRESH, { entity: 'visit' })
  return c.json({ success: true })
})

export default app
