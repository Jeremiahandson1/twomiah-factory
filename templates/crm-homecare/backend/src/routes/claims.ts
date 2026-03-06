import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { claims, ediBatches, evvVisits } from '../../db/schema.ts'
import { eq, and, count, desc } from 'drizzle-orm'
import { authenticate, requireAdmin } from '../middleware/auth.ts'

const app = new Hono()
app.use('*', authenticate, requireAdmin)

app.get('/', async (c) => {
  const { status, page = '1', limit = '50' } = c.req.query()
  const skip = (parseInt(page) - 1) * parseInt(limit)

  const where = status ? eq(claims.status, status) : undefined

  const [rows, [{ value: total }]] = await Promise.all([
    db.select({
      claim: claims,
      batchNumber: ediBatches.batchNumber,
      serviceDate: evvVisits.serviceDate,
    })
      .from(claims)
      .leftJoin(ediBatches, eq(claims.ediBatchId, ediBatches.id))
      .leftJoin(evvVisits, eq(claims.evvVisitId, evvVisits.id))
      .where(where)
      .orderBy(desc(claims.createdAt))
      .offset(skip)
      .limit(parseInt(limit)),
    db.select({ value: count() }).from(claims).where(where),
  ])

  const result = rows.map(r => ({
    ...r.claim,
    ediBatch: r.batchNumber ? { batchNumber: r.batchNumber } : null,
    evvVisit: r.serviceDate ? { serviceDate: r.serviceDate } : null,
  }))

  return c.json({ claims: result, total })
})

app.post('/', async (c) => {
  const body = await c.req.json()
  const [claim] = await db.insert(claims).values(body).returning()
  return c.json(claim, 201)
})

app.patch('/:id', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json()
  const [claim] = await db.update(claims)
    .set({ ...body, updatedAt: new Date() })
    .where(eq(claims.id, id))
    .returning()

  return c.json(claim)
})

export default app
