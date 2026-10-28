// Bids: what the company bid, its lifecycle (draft → submitted → won | lost), and turning a won bid into a project.
// Moved from templates/crm/backend/src/routes/bids.ts.
import { Hono } from 'hono'
import { z } from 'zod'
import { eq, and, count, asc } from 'drizzle-orm'
import { nextNumber } from '@twomiah/tenant-backend'
import { bid, project } from '../../db/schema/index.ts'
import type { AppEnv } from '../../http/env.ts'
import { fail, list, one } from '../../http/reply.ts'
import type { CrmDeps } from '../deps.ts'
import { partialOf } from '@twomiah/tenant-backend'

/** Bid money cannot be negative: a −$500 bid flowed into the pipeline total as a negative (T32 H6). */
const money = z.number().min(0, 'A bid amount cannot be negative').max(1_000_000_000)
const schema = z.object({ projectName: z.string().min(1), client: z.string().optional(), contactId: z.string().optional(), bidType: z.enum(['lump_sum', 'unit_price', 'cost_plus', 'gmp', 'design_build']).default('lump_sum'), dueDate: z.string().optional(), dueTime: z.string().optional(), estimatedValue: money.optional(), bidAmount: money.optional(), bondRequired: z.boolean().default(false), prebidDate: z.string().optional(), prebidLocation: z.string().optional(), scope: z.string().optional(), notes: z.string().optional() })

/**
 * THE LIFECYCLE (T32 H6): draft ──submit──▶ submitted ──won/lost──▶ won | lost. Won and lost are terminal, and a
 * decided bid can't be edited: its amount is the number that was submitted. `under_review` is accepted as a
 * submitted-equivalent so a row already carrying it can still be decided.
 */
const LIVE = ['draft', 'submitted', 'under_review']
const SUBMITTABLE = ['draft']
const DECIDABLE = ['submitted', 'under_review']

const refuse = (c: any, b: { number: string; status: string }, verb: string, allowed: string[]) =>
  fail(c, 400,
    ['won', 'lost'].includes(b.status)
      ? `${b.number} is marked ${b.status}, so it cannot be ${verb}. A decided bid is the record of what was bid and what the client said.`
      : `${b.number} is ${b.status}, and only a bid that is ${allowed.join(' or ')} can be ${verb}.`,
    ['won', 'lost'].includes(b.status) ? 'bid_decided' : 'bid_wrong_status')

/** ONE notion of what a bid is worth (T32 H6): the bid amount once there is one, the estimate before that. */
const bidValue = (b: { bidAmount?: unknown; estimatedValue?: unknown }) =>
  Number(b.bidAmount ?? b.estimatedValue ?? 0) || 0

export function createBidRoutes(d: CrmDeps) {
  const { db } = d
  const { requirePermission } = d.permissions
  const app = new Hono<AppEnv>()
  // Reads are checked against the matrix too, on the mount so a GET added later is gated by construction (T32 H1).
  app.use('*', requirePermission('bids:read'))

  const load = async (id: string, companyId: string) => {
    const [row] = await db.select().from(bid).where(and(eq(bid.id, id), eq(bid.companyId, companyId))).limit(1)
    return row || null
  }

  app.get('/', async (c) => {
    const { status, page = '1', limit = '50' } = c.req.query() as any
    const user = c.get('user') as any
    const conditions: any[] = [eq(bid.companyId, user.companyId)]
    if (status) conditions.push(eq(bid.status, status))

    const where = and(...conditions)
    const pageNum = +page
    const limitNum = +limit

    const [data, [{ value: total }]] = await Promise.all([
      db.select().from(bid).where(where).orderBy(asc(bid.dueDate)).offset((pageNum - 1) * limitNum).limit(limitNum),
      db.select({ value: count() }).from(bid).where(where),
    ])

    return list(c, data, { page: pageNum, limit: limitNum, total: Number(total) })
  })

  app.get('/stats', async (c) => {
    const user = c.get('user') as any
    const bids: any[] = await db.select({
      status: bid.status,
      bidAmount: bid.bidAmount,
      estimatedValue: bid.estimatedValue,
    }).from(bid).where(eq(bid.companyId, user.companyId))

    const stats: any = { total: bids.length, draft: 0, submitted: 0, won: 0, lost: 0, pipelineValue: 0, wonValue: 0, winRate: 0 }
    let decided = 0
    bids.forEach((b: any) => {
      stats[b.status] = (stats[b.status] || 0) + 1
      // `bidValue` for BOTH tiles, so one bid is one figure (T32 H6).
      if (LIVE.includes(b.status)) stats.pipelineValue += bidValue(b)
      if (b.status === 'won') { stats.wonValue += bidValue(b); decided++ }
      if (b.status === 'lost') decided++
    })
    stats.pipelineValue = Math.round(stats.pipelineValue * 100) / 100
    stats.wonValue = Math.round(stats.wonValue * 100) / 100
    stats.winRate = decided > 0 ? Math.round((stats.won / decided) * 100) : 0
    return one(c, stats)
  })

  app.get('/:id', async (c) => {
    const user = c.get('user') as any
    const id = c.req.param('id')
    const [result] = await db.select().from(bid).where(and(eq(bid.id, id), eq(bid.companyId, user.companyId))).limit(1)
    if (!result) return fail(c, 404, 'Bid not found')
    return one(c, result)
  })

  app.post('/', requirePermission('bids:create'), async (c) => {
    const user = c.get('user') as any
    const data = schema.parse(await c.req.json())
    // BID numbers only go forwards (T58k).
    const result = await db.transaction(async (tx: any) => {
      const number = await nextNumber(tx, bid, bid.number, bid.companyId, user.companyId, { prefix: 'BID', pad: 4 })
      const [row] = await tx.insert(bid).values({
        ...data,
        number,
        dueDate: data.dueDate ? new Date(data.dueDate) : null,
        prebidDate: data.prebidDate ? new Date(data.prebidDate) : null,
        companyId: user.companyId,
      }).returning()
      return row
    })
    return one(c, result, 201)
  })

  app.put('/:id', requirePermission('bids:update'), async (c) => {
    const user = c.get('user') as any
    const id = c.req.param('id')
    const data = partialOf(schema).parse(await c.req.json())
    const existing = await load(id, user.companyId)
    if (!existing) return fail(c, 404, 'Bid not found')
    // A decided bid's amount IS the number that was submitted (same rule as an approved change order, T32 H2).
    if (!LIVE.includes(existing.status)) return refuse(c, existing, 'edited', LIVE)
    const [result] = await db.update(bid).set({
      ...data,
      dueDate: data.dueDate ? new Date(data.dueDate) : undefined,
      prebidDate: data.prebidDate ? new Date(data.prebidDate) : undefined,
      updatedAt: new Date(),
    }).where(and(eq(bid.id, id), eq(bid.companyId, user.companyId))).returning()
    if (!result) return fail(c, 404, 'Bid not found')
    return one(c, result)
  })

  app.delete('/:id', requirePermission('bids:delete'), async (c) => {
    const user = c.get('user') as any
    const id = c.req.param('id')
    // `returning()` so a delete that matched nothing is a 404 rather than a silent "deleted".
    const [gone] = await db.delete(bid).where(and(eq(bid.id, id), eq(bid.companyId, user.companyId))).returning()
    if (!gone) return fail(c, 404, 'Bid not found')
    return c.body(null, 204)
  })

  app.post('/:id/submit', requirePermission('bids:update'), async (c) => {
    const user = c.get('user') as any
    const id = c.req.param('id')
    const existing = await load(id, user.companyId)
    if (!existing) return fail(c, 404, 'Bid not found')
    if (!SUBMITTABLE.includes(existing.status)) return refuse(c, existing, 'submitted', SUBMITTABLE)
    const [result] = await db.update(bid).set({ status: 'submitted', submittedAt: new Date(), updatedAt: new Date() }).where(eq(bid.id, id)).returning()
    return one(c, result)
  })

  for (const outcome of ['won', 'lost'] as const) {
    app.post(`/:id/${outcome}`, requirePermission('bids:update'), async (c) => {
      const user = c.get('user') as any
      const id = c.req.param('id')
      const existing = await load(id, user.companyId)
      if (!existing) return fail(c, 404, 'Bid not found')
      // A bid has to have been submitted before anyone can tell you the answer.
      if (!DECIDABLE.includes(existing.status)) return refuse(c, existing, `marked ${outcome}`, DECIDABLE)
      const [result] = await db.update(bid).set({ status: outcome, resultDate: new Date(), updatedAt: new Date() }).where(eq(bid.id, id)).returning()
      return one(c, result)
    })
  }

  /**
   * WON → WORK (T32 H6): a won bid becomes a PROJECT (which holds the jobs, change orders, RFIs and selections
   * that follow). Idempotent: `bid.project_id` records what the bid became, so a second click returns that project.
   * The contact carries over when there is one; free-text clients are said out loud, never invented as a contact.
   */
  app.post('/:id/convert', requirePermission('bids:update'), async (c) => {
    const user = c.get('user') as any
    const id = c.req.param('id')
    const existing = await load(id, user.companyId)
    if (!existing) return fail(c, 404, 'Bid not found')

    if (existing.status !== 'won') {
      return fail(c, 400,
        `${existing.number} is ${existing.status}. Mark a bid won before turning it into a project — otherwise the project is work nobody has awarded.`,
        'bid_not_won')
    }

    if (existing.projectId) {
      const [already] = await db.select().from(project)
        .where(and(eq(project.id, existing.projectId), eq(project.companyId, user.companyId))).limit(1)
      if (already) {
        return one(c, { bid: existing, project: already, created: false, message: `${existing.number} is already ${already.number}.` })
      }
      // The project was deleted since. Fall through and make a new one rather than refusing forever.
    }

    const outcome = await db.transaction(async (tx: any) => {
      const [locked] = await tx.select().from(bid)
        .where(and(eq(bid.id, id), eq(bid.companyId, user.companyId))).for('update').limit(1)
      if (locked?.projectId) {
        const [already] = await tx.select().from(project).where(eq(project.id, locked.projectId)).limit(1)
        if (already) return { bid: locked, project: already, created: false }
      }

      // The SAME numbering as the Projects route, inside this award's transaction so the lock holds (T58k).
      const number = await nextNumber(tx, project, project.number, project.companyId, user.companyId, { prefix: 'PRJ', pad: 4 })
      const [made] = await tx.insert(project).values({
        companyId: user.companyId,
        contactId: locked.contactId || null,
        number,
        name: locked.projectName,
        // The awarded figure, which is what the contract is worth — not the estimate it started from.
        estimatedValue: bidValue(locked).toFixed(2),
        status: 'planning',
        description: [locked.scope, locked.notes].filter(Boolean).join('\n\n') || null,
        notes: `From ${locked.number}${locked.client ? ` · ${locked.client}` : ''}`,
      }).returning()

      const [updatedBid] = await tx.update(bid).set({ projectId: made.id, updatedAt: new Date() })
        .where(eq(bid.id, id)).returning()
      return { bid: updatedBid, project: made, created: true }
    })

    return one(c, {
      ...outcome,
      contactCarried: !!outcome.project?.contactId,
      message: outcome.created
        ? `${existing.number} is now ${outcome.project.number}.${outcome.project.contactId ? '' : ' No contact was linked to the bid, so the project has none — add the client on the project.'}`
        : `${existing.number} is already ${outcome.project.number}.`,
    }, outcome.created ? 201 : 200)
  })

  return app
}
