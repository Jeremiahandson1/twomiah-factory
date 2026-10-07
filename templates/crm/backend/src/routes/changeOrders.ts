import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { changeOrder, changeOrderLineItem, project, user } from '../../db/schema.ts'
import { eq, and, count, desc, asc } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'
import { createActorName } from '../shared/index.ts'
// One numbering rule for every document in the product — locked, and only ever forwards.
import { nextNumber } from '../shared/invoicing/money.ts'
// Approving a change order moves the contract value. This module wrote no audit row of any kind. (T58)
import audit from '../services/audit.ts'

const app = new Hono()
app.use('*', authenticate)
/**
 * Reads are checked against the matrix too — this is contract value changes. (T32 H1)
 *
 * Every write below has always been gated on `change-orders:*`; the GETs were on `authenticate`
 * alone, so any signed-in user of the company could read them. The matrix already draws the line:
 * `change-orders` sits with admin and manager, and `field` and `viewer` hold none of it.
 *
 * On the MOUNT rather than per handler, so the next GET added to this file is gated by
 * construction and cannot repeat the omission.
 */
app.use('*', requirePermission('change-orders:read'))

/**
 * THE LIFECYCLE. (T32 H2)
 *
 * A change order moves the contract value, so each step is a decision somebody made and the record
 * has to be able to prove which one. None of that was enforced: an APPROVED change order's lines
 * were edited to $99,999 and it stayed Approved; approved → rejected → approved went through; and a
 * draft was approved without ever being submitted. `approvedBy` came out of the request body, and
 * the screen always sent the string "Current User", so the one field that says who agreed to the
 * money was decoration.
 *
 *   draft ──submit──▶ submitted ──approve──▶ approved        ← the client agreed the money; final
 *     ▲                   │
 *     └──────── reject ◀──┘      rejected ──submit──▶ submitted   ← a rejected CO can be reworked
 *
 * `approved` is deliberately terminal. The way to undo an approved change order is another change
 * order for the credit — which is how the paperwork works on a real job, and which H5 made possible
 * on the screen as well as in the API.
 *
 * `pending` is what the selections flow used to stamp (see services/selections.ts, T32 H3/L12). It
 * is accepted here as a synonym for `submitted` so that any row already carrying it still moves.
 */
const EDITABLE = ['draft', 'submitted', 'rejected', 'pending']
const SUBMITTABLE = ['draft', 'rejected']
const APPROVABLE = ['submitted', 'pending']
const REJECTABLE = ['draft', 'submitted', 'pending']

/** The one place a refusal is worded, so all four say the same thing in the same way. */
const refuse = (c: any, co: { number: string; status: string }, verb: string, allowed: string[]) =>
  c.json({
    error: co.status === 'approved'
      ? `${co.number} has been approved, so it cannot be ${verb}. Raise another change order for the difference — a credit if the amount is coming back off.`
      : `${co.number} is ${co.status}, and only a change order that is ${allowed.join(' or ')} can be ${verb}.`,
    code: co.status === 'approved' ? 'change_order_approved' : 'change_order_wrong_status',
    status: co.status,
    allowedFrom: allowed,
  }, 400)

/** Who approved this, by name, for the record. Never the request body. (shared: auth/actorName) */
const actorName = createActorName({ db, tables: { user } })

/**
 * `unitPrice` takes either sign: a deductive change order is a negative line, and that is routine
 * paperwork — the screen used to refuse it while this schema accepted it (T32 H5).
 *
 * `quantity` does not. "−2 counters at $615" and "2 counters at −$615" are the same money, and
 * accepting both spellings makes two rows that look different and net identically. The price carries
 * the sign; the same rule the screen now states when it refuses one.
 */
const lineItemSchema = z.object({
  description: z.string().min(1),
  quantity: z.number().min(0, 'Quantity cannot be negative — for a credit, put the minus sign on the price').default(1),
  unitPrice: z.number().default(0),
})
const changeOrderSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  projectId: z.string(),
  reason: z.string().optional(),
  daysAdded: z.number().default(0),
  // Status was omitted so PUT {status} silently no-op'd (API-02); it flows through
  // ...coData once accepted. Guided transitions still use /submit,/approve,/reject.
  status: z.string().optional(),
  lineItems: z.array(lineItemSchema).default([]),
  /**
   * A LUMP-SUM CHANGE ORDER. (T44 — "a change order sent with only an amount saves as $0")
   *
   * This field was missing entirely, so zod stripped it and the amount was then computed from the
   * line items — of which there were none — giving $0. A change order for a flat figure is an
   * ordinary thing to raise; itemising it is optional. Line items still win when they are present,
   * because an itemised total is the sum of its items.
   */
  amount: z.number().optional(),
})

/**
 * A LIST DOES NOT CARRY SIGNATURE EVIDENCE. (T41)
 *
 *   "Change-order API sends signedIp, user agent and the base64 signature, including in list rows."
 *
 * The signature is an image of somebody's handwriting, and signedIp plus signedUserAgent say where
 * a named person was and what they were using when they signed. That is evidence: it belongs on the
 * ONE document it proves, read by someone who opened that document — not broadcast fifty rows at a
 * time to every screen that lists change orders, where it is also fifty times the payload.
 *
 * The list keeps what a list is for: that it IS signed, by whom, and when. `signatureHash` stays
 * too — it is the tamper check and reveals nothing by itself. The detail read below is unchanged
 * and still carries everything.
 */
const SIGNATURE_EVIDENCE = ['signature', 'signedIp', 'signedUserAgent'] as const
const signatureSummary = (co: any) => {
  const out: any = { ...co, signed: !!co.signature }
  for (const k of SIGNATURE_EVIDENCE) delete out[k]
  return out
}

app.get('/', async (c) => {
  const currentUser = c.get('user') as any
  const status = c.req.query('status')
  const projectId = c.req.query('projectId')
  const page = +(c.req.query('page') || '1')
  const limit = +(c.req.query('limit') || '50')

  const conditions = [eq(changeOrder.companyId, currentUser.companyId)]
  if (status) conditions.push(eq(changeOrder.status, status))
  if (projectId) conditions.push(eq(changeOrder.projectId, projectId))

  const where = and(...conditions)
  const [data, [{ value: total }]] = await Promise.all([
    db.select().from(changeOrder).where(where).orderBy(desc(changeOrder.createdAt)).offset((page - 1) * limit).limit(limit),
    db.select({ value: count() }).from(changeOrder).where(where),
  ])

  // Fetch related projects and line items
  const coIds = data.map(co => co.id)
  const projectIds = [...new Set(data.map(co => co.projectId))]

  const [projects, lineItems] = await Promise.all([
    projectIds.length ? db.select({ id: project.id, name: project.name }).from(project).where(eq(project.companyId, currentUser.companyId)) : Promise.resolve([]),
    (async () => {
      const allItems: (typeof changeOrderLineItem.$inferSelect)[] = []
      for (const coid of coIds) {
        const items = await db.select().from(changeOrderLineItem).where(eq(changeOrderLineItem.changeOrderId, coid))
        allItems.push(...items)
      }
      return allItems
    })(),
  ])

  const projectMap = Object.fromEntries(projects.map(p => [p.id, p]))
  const lineItemMap: Record<string, (typeof changeOrderLineItem.$inferSelect)[]> = {}
  lineItems.forEach(li => { (lineItemMap[li.changeOrderId] ||= []).push(li) })

  const dataWithRelations = data.map(co => ({
    ...signatureSummary(co),
    project: projectMap[co.projectId] || null,
    lineItems: lineItemMap[co.id] || [],
  }))

  return c.json({ data: dataWithRelations, pagination: { page, limit, total: Number(total), pages: Math.ceil(Number(total) / limit) } })
})

app.get('/:id', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const [foundCo] = await db.select().from(changeOrder).where(and(eq(changeOrder.id, id), eq(changeOrder.companyId, currentUser.companyId))).limit(1)
  if (!foundCo) return c.json({ error: 'Change order not found' }, 404)

  const [coProject, lineItems] = await Promise.all([
    db.select().from(project).where(eq(project.id, foundCo.projectId)).limit(1),
    db.select().from(changeOrderLineItem).where(eq(changeOrderLineItem.changeOrderId, id)).orderBy(asc(changeOrderLineItem.sortOrder)),
  ])

  return c.json({ ...foundCo, project: coProject[0] || null, lineItems })
})

/**
 * A CHANGE ORDER IS NOT BORN APPROVED. (T41)
 *
 *   "A change order can be created directly as 'approved' with no signature (201), and it counts
 *    toward approved COs."
 *
 * `status` is accepted on this schema so PUT can move one (API-02 added it for that reason), and
 * create spreads the same object — so a caller could post `status: 'approved'` and mint a signed
 * agreement that nobody signed. It then counts in the approved total on the project page, and the
 * revised budget with it, which is money the client never agreed to.
 *
 * An approval is a DECISION recorded against a document: POST /:id/approve is where it happens, and
 * it is the path that captures who signed, from where, and a hash of what they saw. There is no
 * honest way to arrive at 'approved' without that, so create accepts only the two states a new
 * change order can legitimately be in — being written, or sent.
 *
 * `pending` is in the list as the synonym for `submitted` that the selections flow stamps (see the
 * note on EDITABLE above).
 */
const CREATABLE = ['draft', 'submitted', 'pending']

app.post('/', requirePermission('change-orders:create'), async (c) => {
  const currentUser = c.get('user') as any
  const data = changeOrderSchema.parse(await c.req.json())
  const { lineItems, amount: sentAmount, ...coData } = data

  if (coData.status !== undefined && !CREATABLE.includes(coData.status)) {
    return c.json({
      error: `A new change order cannot start as "${coData.status}". Raise it as a draft or submit it to the `
        + 'client, and record their answer with Approve or Reject — an approval carries the signature and '
        + 'cannot be set by hand.',
      code: 'change_order_bad_initial_status',
      allowed: CREATABLE,
    }, 400)
  }

  // Line items are authoritative when given; a flat amount is honoured when there are none, and
  // only then does $0 mean somebody actually raised a change order worth nothing. (T44)
  const amount = lineItems.length > 0
    ? lineItems.reduce((s, i) => s + i.quantity * i.unitPrice, 0)
    : (sentAmount ?? 0)
  /**
   * CO NUMBERS ONLY GO FORWARDS, AND NEVER COLLIDE. (T58k)
   *
   *   owner: "CO-030 was issued twice. The new docSeq counter covers only INV and QTE."
   *
   * Exactly right on both counts. This counted the project's change orders and added one, so
   * deleting any one of them handed its number to the next — and because the count ran in its own
   * statement with no lock, two raised together both saw the same count. T58j routed invoices,
   * quotes, jobs, agreements and repair orders through the shared numbering and never touched this
   * file, which is why `docSeq` held only INV and QTE.
   *
   * The sequence is per PROJECT (CO-001, CO-002 within each project), so the scope and the
   * high-water mark are the project's — see `scope`/`markKey` on nextNumber. Number and row are
   * taken in one transaction, with the line items, so the lock still holds when the row lands and a
   * change order can never commit without the amounts it is made of.
   */
  const created = await db.transaction(async (tx: any) => {
    const number = await nextNumber(tx, changeOrder, changeOrder.number, changeOrder.companyId, currentUser.companyId, {
      prefix: 'CO', pad: 3,
      scope: eq(changeOrder.projectId, data.projectId),
      markKey: `CO:${data.projectId}`,
    })
    const [newCo] = await tx.insert(changeOrder).values({
      ...coData,
      number,
      amount: amount.toString(),
      companyId: currentUser.companyId,
    }).returning()
    const insertedLineItems = lineItems.length > 0
      ? await tx.insert(changeOrderLineItem).values(lineItems.map((item, i) => ({
          ...item,
          quantity: item.quantity.toString(),
          unitPrice: item.unitPrice.toString(),
          total: (item.quantity * item.unitPrice).toString(),
          sortOrder: i,
          changeOrderId: newCo.id,
        }))).returning()
      : []
    return { ...newCo, lineItems: insertedLineItems }
  })

  return c.json(created, 201)
})

// The body below already proves ownership (`existing` is looked up with id AND companyId, 404 otherwise)
// and every later statement operates on that proven row — so this one needs the permission gate only.
app.put('/:id', requirePermission('change-orders:update'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')
  const data = changeOrderSchema.partial().parse(await c.req.json())
  const { lineItems, amount: sentAmount, ...coData } = data
  /**
   * `status` flows through this handler (it was added so PUT {status} would stop silently no-opping),
   * which means it is also a way round every guard below. APPROVING is the one transition that has
   * to carry more than a status: who approved it, when, and the project's revised contract value. So
   * PUT may move a change order between the working states and no further; /approve does approvals.
   */
  if (coData.status !== undefined && !EDITABLE.includes(coData.status)) {
    return c.json({
      error: `A change order cannot be set to "${coData.status}" by editing it. Use POST /api/change-orders/:id/approve or /reject, so who decided and when is recorded.`,
      code: 'change_order_status_needs_transition',
      allowed: EDITABLE,
    }, 400)
  }

  const [existing] = await db.select().from(changeOrder).where(and(eq(changeOrder.id, id), eq(changeOrder.companyId, currentUser.companyId))).limit(1)
  if (!existing) return c.json({ error: 'Change order not found' }, 404)
  // An approved change order is an agreement about money. Editing its lines afterwards rewrites what
  // the client signed up to and leaves no trace — the report put an approved CO to $99,999 and it
  // stayed Approved.
  if (!EDITABLE.includes(existing.status)) return refuse(c, existing, 'edited', EDITABLE)

  // Same rule as create: items win, then a sent flat amount, then what it already was — so an
  // edit that mentions neither leaves the figure alone instead of zeroing it. (T44)
  let amount = sentAmount ?? Number(existing.amount)
  if (lineItems) {
    await db.delete(changeOrderLineItem).where(eq(changeOrderLineItem.changeOrderId, id))
    amount = lineItems.reduce((s, i) => s + i.quantity * i.unitPrice, 0)
  }

  const [updated] = await db.update(changeOrder).set({ ...coData, amount: amount.toString(), updatedAt: new Date() }).where(eq(changeOrder.id, id)).returning()

  let insertedLineItems: (typeof changeOrderLineItem.$inferSelect)[] = []
  if (lineItems && lineItems.length > 0) {
    insertedLineItems = await db.insert(changeOrderLineItem).values(lineItems.map((item, i) => ({
      ...item,
      quantity: item.quantity.toString(),
      unitPrice: item.unitPrice.toString(),
      total: (item.quantity * item.unitPrice).toString(),
      sortOrder: i,
      changeOrderId: id,
    }))).returning()
  }

  const result = { ...updated, lineItems: insertedLineItems.length > 0 ? insertedLineItems : await db.select().from(changeOrderLineItem).where(eq(changeOrderLineItem.changeOrderId, id)) }
  return c.json(result)
})

app.delete('/:id', requirePermission('change-orders:delete'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')
  // Not in the report, but the same hole as editing one: deleting an APPROVED change order takes the
  // agreed money back off the contract and leaves nothing behind to say it was ever there — and now
  // that approval moves the project's value, it would leave that value wrong as well.
  const existing = await load(id, currentUser.companyId)
  if (!existing) return c.json({ error: 'Change order not found' }, 404)
  if (!EDITABLE.includes(existing.status)) return refuse(c, existing, 'deleted', EDITABLE)
  // `returning()` so a delete that matched nothing is a 404 rather than a silent "deleted".
  const [gone] = await db.delete(changeOrder).where(and(eq(changeOrder.id, id), eq(changeOrder.companyId, currentUser.companyId))).returning()
  if (!gone) return c.json({ error: 'Change order not found' }, 404)
  return c.body(null, 204)
})

/** The row, proven to be this company's, or null. Every transition starts here. */
const load = async (id: string, companyId: string) => {
  const [row] = await db.select().from(changeOrder)
    .where(and(eq(changeOrder.id, id), eq(changeOrder.companyId, companyId))).limit(1)
  return row || null
}

app.post('/:id/submit', requirePermission('change-orders:update'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')
  const existing = await load(id, currentUser.companyId)
  if (!existing) return c.json({ error: 'Change order not found' }, 404)
  if (!SUBMITTABLE.includes(existing.status)) return refuse(c, existing, 'submitted', SUBMITTABLE)
  const [updated] = await db.update(changeOrder).set({ status: 'submitted', submittedDate: new Date(), updatedAt: new Date() }).where(eq(changeOrder.id, id)).returning()
  return c.json(updated)
})

/**
 * Approve — and MOVE THE CONTRACT. (T32 H2 + H4)
 *
 * Two things were wrong beyond the missing state guard. `approvedBy` was whatever the caller put in
 * the body, and the screen always put "Current User" there, so the field that records who agreed to
 * the money said nothing. And an approved change order changed nothing about the project: the
 * report approved +$2,877 and +3 days and the project's value and end date did not move, so the
 * revised contract value existed only as a sum somebody did by eye.
 *
 * Both now happen in ONE transaction: a change order cannot be approved without the project moving,
 * and the project cannot move without the change order being approved.
 */
app.post('/:id/approve', requirePermission('change-orders:update'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')
  const existing = await load(id, currentUser.companyId)
  if (!existing) return c.json({ error: 'Change order not found' }, 404)
  if (!APPROVABLE.includes(existing.status)) return refuse(c, existing, 'approved', APPROVABLE)

  // Resolved BEFORE the transaction opens. A helper that queries the outer `db` from inside
  // `db.transaction` deadlocks — the connection is held by the transaction and the read waits on it
  // forever, which shows up as a request that never answers rather than an error.
  const approver = await actorName(currentUser)

  const outcome = await db.transaction(async (tx: any) => {
    // Locked, so two people clicking Approve cannot both add the amount to the project.
    const [locked] = await tx.select().from(changeOrder)
      .where(and(eq(changeOrder.id, id), eq(changeOrder.companyId, currentUser.companyId))).for('update').limit(1)
    if (!locked) return { status: 404 as const, body: { error: 'Change order not found' } }
    if (!APPROVABLE.includes(locked.status)) return { status: 'conflict' as const, body: locked }

    const [updated] = await tx.update(changeOrder).set({
      status: 'approved',
      approvedDate: new Date(),
      // The signed-in person, never the body. A name the record can stand behind.
      approvedBy: approver,
      updatedAt: new Date(),
    }).where(eq(changeOrder.id, id)).returning()

    // The revised contract: the agreed amount on top of the project's value, and the agreed days on
    // the end date. `estimatedValue` is the contract figure the project screen and job costing read.
    const [proj] = await tx.select().from(project)
      .where(and(eq(project.id, locked.projectId), eq(project.companyId, currentUser.companyId))).for('update').limit(1)
    let revised: any = null
    if (proj) {
      const value = Number(proj.estimatedValue || 0) + Number(locked.amount || 0)
      const days = Number(locked.daysAdded || 0)
      const endDate = proj.endDate && days
        ? new Date(new Date(proj.endDate).getTime() + days * 86_400_000)
        : proj.endDate
      ;[revised] = await tx.update(project).set({
        estimatedValue: value.toFixed(2),
        endDate,
        updatedAt: new Date(),
      }).where(eq(project.id, proj.id)).returning()
    }
    return { status: 200 as const, body: { ...updated, project: revised } }
  })

  if (outcome.status === 'conflict') return refuse(c, outcome.body as any, 'approved', APPROVABLE)

  /**
   * THE AGREEMENT, IN THE LOG. (T58)
   *
   * This module wrote no audit row at all — not create, not edit, and not this: the moment somebody
   * agrees to move the contract value and the end date. The generic request floor (middleware/
   * auditWrites.ts) now covers every write in this template, and for THIS event a floor is not
   * enough: what matters is the amount, the days, who agreed and what the contract became, and the
   * handler is the only place that knows them.
   *
   * After the transaction, so the row describes a change that actually committed.
   */
  if (outcome.status === 200) {
    const body: any = outcome.body
    audit.log({
      action: audit.ACTIONS.STATUS_CHANGE,
      entity: 'change_order',
      entityId: id,
      entityName: body?.number || existing.number,
      changes: { status: { old: existing.status, new: 'approved' } },
      metadata: {
        amount: body?.amount ?? existing.amount,
        daysAdded: body?.daysAdded ?? existing.daysAdded,
        approvedBy: approver,
        projectId: existing.projectId,
        // What the contract became, so the log answers "what did this do" without a second lookup.
        ...(body?.project ? { projectValueAfter: body.project.estimatedValue, projectEndDateAfter: body.project.endDate } : {}),
      },
      req: c,
    })
  }

  return c.json(outcome.body, outcome.status)
})

app.post('/:id/reject', requirePermission('change-orders:update'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')
  const existing = await load(id, currentUser.companyId)
  if (!existing) return c.json({ error: 'Change order not found' }, 404)
  // Rejecting an APPROVED change order would take money off the contract with no paper trail. The
  // report walked approved → rejected → approved straight through.
  if (!REJECTABLE.includes(existing.status)) return refuse(c, existing, 'rejected', REJECTABLE)
  const [updated] = await db.update(changeOrder).set({ status: 'rejected', updatedAt: new Date() }).where(eq(changeOrder.id, id)).returning()
  // The other half of the agreement. "Who turned this down, and when" is asked as often as who
  // approved it, and it had no answer either. (T58)
  audit.log({
    action: audit.ACTIONS.STATUS_CHANGE,
    entity: 'change_order',
    entityId: id,
    entityName: updated?.number || existing.number,
    changes: { status: { old: existing.status, new: 'rejected' } },
    metadata: { amount: existing.amount, daysAdded: existing.daysAdded, projectId: existing.projectId },
    req: c,
  })
  return c.json(updated)
})

export default app
