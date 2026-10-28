// Change orders: an agreed change to the contract's money and days. Moved from
// templates/crm/backend/src/routes/changeOrders.ts. The registry signs the person in and applies the 'change_orders'
// feature gate; every read is checked against change-orders:read on the router itself (T32 H1).
import { Hono } from 'hono'
import { z } from 'zod'
import { eq, and, count, desc, asc } from 'drizzle-orm'
import { createActorName, withoutSigningEvidence, nextNumber } from '@twomiah/tenant-backend'
import { changeOrder, changeOrderLineItem, project, user } from '../../db/schema/index.ts'
import type { CrmDeps } from '../deps.ts'
import type { AppEnv } from '../../http/env.ts'
import { fail, list, one } from '../../http/reply.ts'
import { partialOf } from '@twomiah/tenant-backend'

/**
 * THE LIFECYCLE. (T32 H2)
 *
 *   draft ──submit──▶ submitted ──approve──▶ approved        ← the client agreed the money; final
 *     ▲                   │
 *     └──────── reject ◀──┘      rejected ──submit──▶ submitted   ← a rejected CO can be reworked
 *
 * `approved` is deliberately terminal: the way to undo one is another change order for the credit. `pending` is what
 * the selections flow used to stamp, accepted as a synonym for `submitted` so any row carrying it still moves.
 */
const EDITABLE = ['draft', 'submitted', 'rejected', 'pending']
const SUBMITTABLE = ['draft', 'rejected']
const APPROVABLE = ['submitted', 'pending']
const REJECTABLE = ['draft', 'submitted', 'pending']

/**
 * A CHANGE ORDER IS NOT BORN APPROVED. (T41) An approval is a decision recorded against a document, through
 * POST /:id/approve; create accepts only the states a new change order can legitimately be in.
 */
const CREATABLE = ['draft', 'submitted', 'pending']

/** The one place a refusal is worded, so all four say the same thing in the same way. */
const refuse = (c: any, co: { number: string; status: string }, verb: string, allowed: string[]) =>
  fail(c, 400,
    co.status === 'approved'
      ? `${co.number} has been approved, so it cannot be ${verb}. Raise another change order for the difference — a credit if the amount is coming back off.`
      : `${co.number} is ${co.status}, and only a change order that is ${allowed.join(' or ')} can be ${verb}.`,
    co.status === 'approved' ? 'change_order_approved' : 'change_order_wrong_status')

/**
 * `unitPrice` takes either sign: a deductive change order is a negative line (T32 H5). `quantity` does not — the
 * price carries the sign.
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
  // Status flows through ...coData on PUT (API-02). Guided transitions still use /submit, /approve, /reject.
  status: z.string().optional(),
  lineItems: z.array(lineItemSchema).default([]),
  // A LUMP-SUM CHANGE ORDER (T44): line items still win when they are present.
  amount: z.number().optional(),
})

/**
 * A LIST DOES NOT CARRY SIGNATURE EVIDENCE. (T41) The list keeps that it IS signed, by whom and when, and the
 * tamper hash; the signature image, IP and browser string belong on the one document they prove.
 */
const SIGNATURE_EVIDENCE = ['signature', 'signedIp', 'signedUserAgent'] as const
const signatureSummary = (co: any) => {
  const out: any = { ...co, signed: !!co.signature }
  for (const k of SIGNATURE_EVIDENCE) delete out[k]
  return out
}

export function createChangeOrderRoutes(d: CrmDeps) {
  const { db, audit } = d
  const { requirePermission, hasPermission, getExtraPermissions } = d.permissions
  /** Who approved this, by name, for the record. Never the request body. (shared: auth/actorName) */
  const actorName = createActorName({ db, tables: { user } } as any)

  /**
   * …AND THE REST OF THE EVIDENCE IS FOR THE SEAT THAT ADMINISTERS THE AGREEMENT. (T43 viewer round, T68) A reader
   * without change-orders:update keeps that it was signed, by whom and when.
   */
  const maySignOff = async (c: any): Promise<boolean> => {
    const u = c.get('user') as any
    try { return hasPermission(u?.role, 'change-orders:update', await getExtraPermissions(u?.userId)) } catch { return false }
  }

  /** The row, proven to be this company's, or null. Every transition starts here. */
  const load = async (id: string, companyId: string) => {
    const [row] = await db.select().from(changeOrder)
      .where(and(eq(changeOrder.id, id), eq(changeOrder.companyId, companyId))).limit(1)
    return row || null
  }

  const app = new Hono<AppEnv>()
  // Reads are checked against the matrix too — this is contract value changes (T32 H1). On the router rather than per
  // handler, so the next GET added here is gated by construction.
  app.use('*', requirePermission('change-orders:read'))

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
    const coIds = data.map((co: any) => co.id)
    const projectIds = [...new Set(data.map((co: any) => co.projectId))]

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

    const projectMap = Object.fromEntries((projects as any[]).map((p) => [p.id, p]))
    const lineItemMap: Record<string, (typeof changeOrderLineItem.$inferSelect)[]> = {}
    lineItems.forEach((li) => { (lineItemMap[li.changeOrderId] ||= []).push(li) })

    const signsOff = await maySignOff(c)
    const dataWithRelations = data.map((co: any) => ({
      ...(signsOff ? signatureSummary(co) : withoutSigningEvidence(signatureSummary(co))),
      project: projectMap[co.projectId] || null,
      lineItems: lineItemMap[co.id] || [],
    }))

    return list(c, dataWithRelations, { page, limit, total: Number(total) })
  })

  app.get('/:id', async (c) => {
    const currentUser = c.get('user') as any
    const id = c.req.param('id')

    const [foundCo] = await db.select().from(changeOrder).where(and(eq(changeOrder.id, id), eq(changeOrder.companyId, currentUser.companyId))).limit(1)
    if (!foundCo) return fail(c, 404, 'Change order not found')

    const [coProject, lineItems] = await Promise.all([
      db.select().from(project).where(eq(project.id, foundCo.projectId)).limit(1),
      db.select().from(changeOrderLineItem).where(eq(changeOrderLineItem.changeOrderId, id)).orderBy(asc(changeOrderLineItem.sortOrder)),
    ])

    const shown = (await maySignOff(c)) ? foundCo : withoutSigningEvidence(foundCo)
    return one(c, { ...shown, project: coProject[0] || null, lineItems })
  })

  app.post('/', requirePermission('change-orders:create'), async (c) => {
    const currentUser = c.get('user') as any
    const data = changeOrderSchema.parse(await c.req.json())
    const { lineItems, amount: sentAmount, ...coData } = data

    if (coData.status !== undefined && !CREATABLE.includes(coData.status)) {
      return fail(c, 400,
        `A new change order cannot start as "${coData.status}". Raise it as a draft or submit it to the `
          + 'client, and record their answer with Approve or Reject — an approval carries the signature and '
          + 'cannot be set by hand.',
        'change_order_bad_initial_status')
    }

    // Line items are authoritative when given; a flat amount is honoured when there are none. (T44)
    const amount = lineItems.length > 0
      ? lineItems.reduce((s, i) => s + i.quantity * i.unitPrice, 0)
      : (sentAmount ?? 0)
    /**
     * CO NUMBERS ONLY GO FORWARDS, AND NEVER COLLIDE. (T58k) The sequence is per PROJECT, so the scope and the
     * high-water mark are the project's. Number and row are taken in one transaction, with the line items.
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

    return one(c, created, 201)
  })

  // `existing` is looked up with id AND companyId (404 otherwise) and every later statement operates on that row.
  app.put('/:id', requirePermission('change-orders:update'), async (c) => {
    const currentUser = c.get('user') as any
    const id = c.req.param('id')
    const data = partialOf(changeOrderSchema).parse(await c.req.json())
    const { lineItems, amount: sentAmount, ...coData } = data
    // PUT may move a change order between the working states and no further; /approve does approvals.
    if (coData.status !== undefined && !EDITABLE.includes(coData.status)) {
      return fail(c, 400,
        `A change order cannot be set to "${coData.status}" by editing it. Use POST /api/change-orders/:id/approve or /reject, so who decided and when is recorded.`,
        'change_order_status_needs_transition')
    }

    const [existing] = await db.select().from(changeOrder).where(and(eq(changeOrder.id, id), eq(changeOrder.companyId, currentUser.companyId))).limit(1)
    if (!existing) return fail(c, 404, 'Change order not found')
    // An approved change order is an agreement about money; editing its lines afterwards rewrites what was signed.
    if (!EDITABLE.includes(existing.status)) return refuse(c, existing, 'edited', EDITABLE)

    // Items win, then a sent flat amount, then what it already was. (T44)
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
    return one(c, result)
  })

  app.delete('/:id', requirePermission('change-orders:delete'), async (c) => {
    const currentUser = c.get('user') as any
    const id = c.req.param('id')
    // Deleting an APPROVED change order would take agreed money back off the contract and leave nothing behind.
    const existing = await load(id, currentUser.companyId)
    if (!existing) return fail(c, 404, 'Change order not found')
    if (!EDITABLE.includes(existing.status)) return refuse(c, existing, 'deleted', EDITABLE)
    // `returning()` so a delete that matched nothing is a 404 rather than a silent "deleted".
    const [gone] = await db.delete(changeOrder).where(and(eq(changeOrder.id, id), eq(changeOrder.companyId, currentUser.companyId))).returning()
    if (!gone) return fail(c, 404, 'Change order not found')
    return c.body(null, 204)
  })

  app.post('/:id/submit', requirePermission('change-orders:update'), async (c) => {
    const currentUser = c.get('user') as any
    const id = c.req.param('id')
    const existing = await load(id, currentUser.companyId)
    if (!existing) return fail(c, 404, 'Change order not found')
    if (!SUBMITTABLE.includes(existing.status)) return refuse(c, existing, 'submitted', SUBMITTABLE)
    const [updated] = await db.update(changeOrder).set({ status: 'submitted', submittedDate: new Date(), updatedAt: new Date() }).where(eq(changeOrder.id, id)).returning()
    return one(c, updated)
  })

  /**
   * Approve — and MOVE THE CONTRACT. (T32 H2 + H4) The approver is the signed-in person, and the change order and the
   * project's value and end date move in ONE transaction.
   */
  app.post('/:id/approve', requirePermission('change-orders:update'), async (c) => {
    const currentUser = c.get('user') as any
    const id = c.req.param('id')
    const existing = await load(id, currentUser.companyId)
    if (!existing) return fail(c, 404, 'Change order not found')
    if (!APPROVABLE.includes(existing.status)) return refuse(c, existing, 'approved', APPROVABLE)

    // Resolved BEFORE the transaction opens: a helper querying the outer `db` inside `db.transaction` deadlocks.
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

      // The revised contract: the agreed amount on top of the project's value, and the agreed days on the end date.
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

    if (outcome.status === 404) return fail(c, 404, 'Change order not found')
    if (outcome.status === 'conflict') return refuse(c, outcome.body as any, 'approved', APPROVABLE)

    // THE AGREEMENT, IN THE LOG. (T58) After the transaction, so the row describes a change that actually committed.
    const body: any = outcome.body
    audit.log({
      action: audit.ACTIONS.STATUS_CHANGE,
      entity: audit.ENTITIES.CHANGE_ORDER,
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

    return one(c, body)
  })

  app.post('/:id/reject', requirePermission('change-orders:update'), async (c) => {
    const currentUser = c.get('user') as any
    const id = c.req.param('id')
    const existing = await load(id, currentUser.companyId)
    if (!existing) return fail(c, 404, 'Change order not found')
    // Rejecting an APPROVED change order would take money off the contract with no paper trail.
    if (!REJECTABLE.includes(existing.status)) return refuse(c, existing, 'rejected', REJECTABLE)
    const [updated] = await db.update(changeOrder).set({ status: 'rejected', updatedAt: new Date() }).where(eq(changeOrder.id, id)).returning()
    // The other half of the agreement: who turned this down, and when. (T58)
    audit.log({
      action: audit.ACTIONS.STATUS_CHANGE,
      entity: audit.ENTITIES.CHANGE_ORDER,
      entityId: id,
      entityName: updated?.number || existing.number,
      changes: { status: { old: existing.status, new: 'rejected' } },
      metadata: { amount: existing.amount, daysAdded: existing.daysAdded, projectId: existing.projectId },
      req: c,
    })
    return one(c, updated)
  })

  return app
}
