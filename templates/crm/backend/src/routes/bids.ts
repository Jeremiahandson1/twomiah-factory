import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { bid, project } from '../../db/schema.ts'
import { eq, and, count, asc } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'

const app = new Hono()
app.use('*', authenticate)
/**
 * Reads are checked against the matrix too — this is what the company bid and what it won. (T32 H1)
 *
 * Every write below has always been gated on `bids:*`; the GETs were on `authenticate`
 * alone, so any signed-in user of the company could read them. The matrix already draws the line:
 * `bids` sits with admin and manager, and `field` and `viewer` hold none of it.
 *
 * On the MOUNT rather than per handler, so the next GET added to this file is gated by
 * construction and cannot repeat the omission.
 */
app.use('*', requirePermission('bids:read'))

/**
 * `estimatedValue` and `bidAmount` are money and cannot be negative. The report entered a −$500 bid
 * and it was accepted, which then flowed into the pipeline total as a negative. (T32 H6)
 */
const money = z.number().min(0, 'A bid amount cannot be negative').max(1_000_000_000)
const schema = z.object({ projectName: z.string().min(1), client: z.string().optional(), contactId: z.string().optional(), bidType: z.enum(['lump_sum', 'unit_price', 'cost_plus', 'gmp', 'design_build']).default('lump_sum'), dueDate: z.string().optional(), dueTime: z.string().optional(), estimatedValue: money.optional(), bidAmount: money.optional(), bondRequired: z.boolean().default(false), prebidDate: z.string().optional(), prebidLocation: z.string().optional(), scope: z.string().optional(), notes: z.string().optional() })

/**
 * THE LIFECYCLE. (T32 H6)
 *
 * There were no guards at all: the report walked Won → Lost → Submitted straight through, which also
 * left `resultDate` holding the old win date (T32 L5) on a bid that was back in the pipeline.
 *
 *   draft ──submit──▶ submitted ──won/lost──▶ won | lost        ← decided; the result is the record
 *
 * Won and lost are terminal. A decided bid is what the company actually bid and what the client
 * actually answered — the same reason an approved change order is terminal (T32 H2). Editing one is
 * refused too, because its amount is the number that was submitted.
 *
 * `under_review` is in the stats and has no endpoint; it is accepted as a submitted-equivalent so a
 * row already carrying it can still be decided.
 */
const LIVE = ['draft', 'submitted', 'under_review']
const SUBMITTABLE = ['draft']
const DECIDABLE = ['submitted', 'under_review']

const refuse = (c: any, b: { number: string; status: string }, verb: string, allowed: string[]) =>
  c.json({
    error: ['won', 'lost'].includes(b.status)
      ? `${b.number} is marked ${b.status}, so it cannot be ${verb}. A decided bid is the record of what was bid and what the client said.`
      : `${b.number} is ${b.status}, and only a bid that is ${allowed.join(' or ')} can be ${verb}.`,
    code: ['won', 'lost'].includes(b.status) ? 'bid_decided' : 'bid_wrong_status',
    status: b.status,
    allowedFrom: allowed,
  }, 400)

/**
 * ONE notion of what a bid is worth. (T32 H6)
 *
 * The Pipeline tile summed `estimatedValue` and the Won value summed `bidAmount`, so one bid was two
 * different figures depending which tile you read — $18,000 in the pipeline and $16,900 won, for the
 * same bid. The bid amount is the real number once there is one; the estimate is what you have
 * before that. Same rule everywhere, so the two tiles are comparable.
 */
const bidValue = (b: { bidAmount?: unknown; estimatedValue?: unknown }) =>
  Number(b.bidAmount ?? b.estimatedValue ?? 0) || 0

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

  return c.json({ data, pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) } })
})

app.get('/stats', async (c) => {
  const user = c.get('user') as any
  const bids = await db.select({
    status: bid.status,
    bidAmount: bid.bidAmount,
    estimatedValue: bid.estimatedValue,
  }).from(bid).where(eq(bid.companyId, user.companyId))

  const stats: any = { total: bids.length, draft: 0, submitted: 0, won: 0, lost: 0, pipelineValue: 0, wonValue: 0, winRate: 0 }
  let decided = 0
  bids.forEach((b: any) => {
    stats[b.status] = (stats[b.status] || 0) + 1
    // `bidValue` for BOTH tiles. These used `estimatedValue || bidAmount` here and `bidAmount` below,
    // so the same bid was $18,000 in the pipeline and $16,900 once won. (T32 H6)
    if (LIVE.includes(b.status)) stats.pipelineValue += bidValue(b)
    if (b.status === 'won') { stats.wonValue += bidValue(b); decided++ }
    if (b.status === 'lost') decided++
  })
  stats.pipelineValue = Math.round(stats.pipelineValue * 100) / 100
  stats.wonValue = Math.round(stats.wonValue * 100) / 100
  stats.winRate = decided > 0 ? Math.round((stats.won / decided) * 100) : 0
  return c.json(stats)
})

app.get('/:id', async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')
  const [result] = await db.select().from(bid).where(and(eq(bid.id, id), eq(bid.companyId, user.companyId))).limit(1)
  if (!result) return c.json({ error: 'Bid not found' }, 404)
  return c.json(result)
})

app.post('/', requirePermission('bids:create'), async (c) => {
  const user = c.get('user') as any
  const data = schema.parse(await c.req.json())
  const [{ value: countVal }] = await db.select({ value: count() }).from(bid).where(eq(bid.companyId, user.companyId))
  const [result] = await db.insert(bid).values({
    ...data,
    number: `BID-${String(countVal + 1).padStart(4, '0')}`,
    dueDate: data.dueDate ? new Date(data.dueDate) : null,
    prebidDate: data.prebidDate ? new Date(data.prebidDate) : null,
    companyId: user.companyId,
  }).returning()
  return c.json(result, 201)
})

app.put('/:id', requirePermission('bids:update'), async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')
  const data = schema.partial().parse(await c.req.json())
  // Scoped to the caller's company like the list above, not matched on id alone.
  const existing = await load(id, user.companyId)
  if (!existing) return c.json({ error: 'Bid not found' }, 404)
  // A decided bid's amount IS the number that was submitted to the client. Same rule as an approved
  // change order (T32 H2): the way to record something different is a new bid.
  if (!LIVE.includes(existing.status)) return refuse(c, existing, 'edited', LIVE)
  const [result] = await db.update(bid).set({
    ...data,
    dueDate: data.dueDate ? new Date(data.dueDate) : undefined,
    prebidDate: data.prebidDate ? new Date(data.prebidDate) : undefined,
    updatedAt: new Date(),
  }).where(and(eq(bid.id, id), eq(bid.companyId, user.companyId))).returning()
  if (!result) return c.json({ error: 'Bid not found' }, 404)
  return c.json(result)
})

app.delete('/:id', requirePermission('bids:delete'), async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')
  // `returning()` so a delete that matched nothing is a 404 rather than a silent "deleted".
  const [gone] = await db.delete(bid).where(and(eq(bid.id, id), eq(bid.companyId, user.companyId))).returning()
  if (!gone) return c.json({ error: 'Bid not found' }, 404)
  return c.json(null, 204)
})

app.post('/:id/submit', requirePermission('bids:update'), async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')
  const existing = await load(id, user.companyId)
  if (!existing) return c.json({ error: 'Bid not found' }, 404)
  if (!SUBMITTABLE.includes(existing.status)) return refuse(c, existing, 'submitted', SUBMITTABLE)
  const [result] = await db.update(bid).set({ status: 'submitted', submittedAt: new Date(), updatedAt: new Date() }).where(eq(bid.id, id)).returning()
  return c.json(result)
})

for (const outcome of ['won', 'lost'] as const) {
  app.post(`/:id/${outcome}`, requirePermission('bids:update'), async (c) => {
    const user = c.get('user') as any
    const id = c.req.param('id')
    const existing = await load(id, user.companyId)
    if (!existing) return c.json({ error: 'Bid not found' }, 404)
    // A bid has to have been submitted before anyone can tell you the answer.
    if (!DECIDABLE.includes(existing.status)) return refuse(c, existing, `marked ${outcome}`, DECIDABLE)
    const [result] = await db.update(bid).set({ status: outcome, resultDate: new Date(), updatedAt: new Date() }).where(eq(bid.id, id)).returning()
    return c.json(result)
  })
}

/**
 * WON → WORK. The step that did not exist. (T32 H6)
 *
 * The report marked BID-0001 won and then looked for the conversion: no action on screen, and
 * convert / convert-to-job / create-job all 404. So winning a bid meant retyping the project name,
 * the client and the value into the Projects screen by hand — the one moment in the whole flow where
 * the data is already sitting in front of you.
 *
 * It creates a PROJECT, not a job. A bid in a contractor CRM is for a body of work, and a project is
 * what holds the jobs, the change orders, the RFIs and the selections that follow. Going straight to
 * a job would strand all of those.
 *
 * IDEMPOTENT, deliberately. `bid.project_id` records what the bid became, so a second click returns
 * the project that already exists rather than making another — which is precisely the fault T32 H3
 * found in selections, where one decision raised five change orders.
 *
 * The contact carries over when there is one. When the client is still free text, the project is
 * created without a contact and the response says so, rather than silently inventing a contact
 * record from a string somebody typed.
 */
app.post('/:id/convert', requirePermission('bids:update'), async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')
  const existing = await load(id, user.companyId)
  if (!existing) return c.json({ error: 'Bid not found' }, 404)

  if (existing.status !== 'won') {
    return c.json({
      error: `${existing.number} is ${existing.status}. Mark a bid won before turning it into a project — otherwise the project is work nobody has awarded.`,
      code: 'bid_not_won',
      status: existing.status,
    }, 400)
  }

  if (existing.projectId) {
    const [already] = await db.select().from(project)
      .where(and(eq(project.id, existing.projectId), eq(project.companyId, user.companyId))).limit(1)
    if (already) {
      return c.json({ bid: existing, project: already, created: false, message: `${existing.number} is already ${already.number}.` })
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

    // Project numbers are per company and sequential, the same shape the Projects route uses.
    const [{ value: n }] = await tx.select({ value: count() }).from(project).where(eq(project.companyId, user.companyId))
    const [made] = await tx.insert(project).values({
      companyId: user.companyId,
      contactId: locked.contactId || null,
      number: `PRJ-${String(Number(n) + 1).padStart(4, '0')}`,
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

  return c.json({
    ...outcome,
    // Said out loud rather than left for somebody to notice on the project screen.
    contactCarried: !!outcome.project?.contactId,
    message: outcome.created
      ? `${existing.number} is now ${outcome.project.number}.${outcome.project.contactId ? '' : ' No contact was linked to the bid, so the project has none — add the client on the project.'}`
      : `${existing.number} is already ${outcome.project.number}.`,
  }, outcome.created ? 201 : 200)
})

export default app
