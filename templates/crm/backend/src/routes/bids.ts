import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { bid } from '../../db/schema.ts'
import { eq, and, count, asc } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'

const app = new Hono()
app.use('*', authenticate)

const schema = z.object({ projectName: z.string().min(1), client: z.string().optional(), bidType: z.enum(['lump_sum', 'unit_price', 'cost_plus', 'gmp', 'design_build']).default('lump_sum'), dueDate: z.string().optional(), dueTime: z.string().optional(), estimatedValue: z.number().optional(), bidAmount: z.number().optional(), bondRequired: z.boolean().default(false), prebidDate: z.string().optional(), prebidLocation: z.string().optional(), scope: z.string().optional(), notes: z.string().optional() })

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
    if (['draft', 'submitted', 'under_review'].includes(b.status)) stats.pipelineValue += Number(b.estimatedValue || b.bidAmount || 0)
    if (b.status === 'won') { stats.wonValue += Number(b.bidAmount || 0); decided++ }
    if (b.status === 'lost') decided++
  })
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

app.post('/', async (c) => {
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

app.put('/:id', async (c) => {
  const id = c.req.param('id')
  const data = schema.partial().parse(await c.req.json())
  const [result] = await db.update(bid).set({
    ...data,
    dueDate: data.dueDate ? new Date(data.dueDate) : undefined,
    prebidDate: data.prebidDate ? new Date(data.prebidDate) : undefined,
    updatedAt: new Date(),
  }).where(eq(bid.id, id)).returning()
  return c.json(result)
})

app.delete('/:id', async (c) => {
  const id = c.req.param('id')
  await db.delete(bid).where(eq(bid.id, id))
  return c.json(null, 204)
})

app.post('/:id/submit', async (c) => {
  const id = c.req.param('id')
  const [result] = await db.update(bid).set({ status: 'submitted', submittedAt: new Date(), updatedAt: new Date() }).where(eq(bid.id, id)).returning()
  return c.json(result)
})

app.post('/:id/won', async (c) => {
  const id = c.req.param('id')
  const [result] = await db.update(bid).set({ status: 'won', resultDate: new Date(), updatedAt: new Date() }).where(eq(bid.id, id)).returning()
  return c.json(result)
})

app.post('/:id/lost', async (c) => {
  const id = c.req.param('id')
  const [result] = await db.update(bid).set({ status: 'lost', resultDate: new Date(), updatedAt: new Date() }).where(eq(bid.id, id)).returning()
  return c.json(result)
})

export default app
