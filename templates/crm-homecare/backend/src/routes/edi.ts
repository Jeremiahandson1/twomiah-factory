import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { ediBatches, referralSources, claims } from '../../db/schema.ts'
import { eq, count, desc, sql } from 'drizzle-orm'
import { authenticate, requireAdmin } from '../middleware/auth.ts'

const app = new Hono()
app.use('*', authenticate, requireAdmin)

app.get('/batches', async (c) => {
  const rows = await db.select({
    batch: ediBatches,
    payerName: referralSources.name,
    claimCount: sql<number>`(select count(*) from claims where claims.edi_batch_id = ${ediBatches.id})`.as('claim_count'),
  })
    .from(ediBatches)
    .leftJoin(referralSources, eq(ediBatches.payerId, referralSources.id))
    .orderBy(desc(ediBatches.createdAt))

  const result = rows.map(r => ({
    ...r.batch,
    payer: r.payerName ? { name: r.payerName } : null,
    _count: { claims: Number(r.claimCount) },
  }))

  return c.json(result)
})

app.post('/batches', async (c) => {
  const body = await c.req.json()
  const user = c.get('user')
  const [{ value: cnt }] = await db.select({ value: count() }).from(ediBatches)

  const [batch] = await db.insert(ediBatches).values({
    ...body,
    batchNumber: `EDI-${String(cnt + 1).padStart(5, '0')}`,
    createdById: user.userId,
  }).returning()

  return c.json(batch, 201)
})

app.patch('/batches/:id/submit', async (c) => {
  const id = c.req.param('id')
  const [batch] = await db.update(ediBatches)
    .set({ status: 'submitted', submittedAt: new Date(), updatedAt: new Date() })
    .where(eq(ediBatches.id, id))
    .returning()

  return c.json(batch)
})

export default app
