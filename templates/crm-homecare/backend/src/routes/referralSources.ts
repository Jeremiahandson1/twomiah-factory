import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { referralSources } from '../../db/schema.ts'
import { eq, and, asc } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'

const app = new Hono()
app.use('*', authenticate)

// GET /api/referral-sources
app.get('/', async (c) => {
  const { type } = c.req.query()
  const conditions: any[] = [eq(referralSources.isActive, true)]
  if (type) conditions.push(eq(referralSources.type, type))

  const rows = await db
    .select()
    .from(referralSources)
    .where(and(...conditions))
    .orderBy(asc(referralSources.name))

  return c.json(rows)
})

// POST /api/referral-sources
app.post('/', async (c) => {
  const body = await c.req.json()
  const [row] = await db.insert(referralSources).values(body).returning()
  return c.json(row, 201)
})

// PUT /api/referral-sources/:id
app.put('/:id', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json()
  const [row] = await db
    .update(referralSources)
    .set({ ...body, updatedAt: new Date() })
    .where(eq(referralSources.id, id))
    .returning()
  if (!row) return c.json({ error: 'Not found' }, 404)
  return c.json(row)
})

export default app
