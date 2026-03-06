import { Hono } from 'hono'
import { eq, asc } from 'drizzle-orm'
import { db } from '../../db/index.ts'
import { serviceCodes } from '../../db/schema.ts'
import { authenticate, requireAdmin } from '../middleware/auth.ts'

const app = new Hono()
app.use('*', authenticate)

// GET /
app.get('/', async (c) => {
  const codes = await db
    .select()
    .from(serviceCodes)
    .where(eq(serviceCodes.isActive, true))
    .orderBy(asc(serviceCodes.code))
  return c.json(codes)
})

// POST /
app.post('/', requireAdmin, async (c) => {
  const body = await c.req.json()
  const [code] = await db.insert(serviceCodes).values(body).returning()
  return c.json(code, 201)
})

// PUT /:id
app.put('/:id', requireAdmin, async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json()
  const [code] = await db.update(serviceCodes).set({ ...body }).where(eq(serviceCodes.id, id)).returning()
  return c.json(code)
})

export default app
