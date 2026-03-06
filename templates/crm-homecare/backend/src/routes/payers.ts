import { Hono } from 'hono'
import { eq, desc, asc } from 'drizzle-orm'
import { db } from '../../db/index.ts'
import { referralSources } from '../../db/schema.ts'
import { authenticate, requireAdmin } from '../middleware/auth.ts'

const app = new Hono()
app.use('*', authenticate)

// GET /
app.get('/', async (c) => {
  const payers = await db
    .select()
    .from(referralSources)
    .where(eq(referralSources.isActive, true))
    .orderBy(desc(referralSources.isActivePayer), asc(referralSources.name))
  return c.json(payers)
})

// POST /
app.post('/', requireAdmin, async (c) => {
  const body = await c.req.json()
  const [payer] = await db.insert(referralSources).values(body).returning()
  return c.json(payer, 201)
})

// PUT /:id
app.put('/:id', requireAdmin, async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json()
  const [payer] = await db.update(referralSources).set({ ...body, updatedAt: new Date() }).where(eq(referralSources.id, id)).returning()
  return c.json(payer)
})

export default app
