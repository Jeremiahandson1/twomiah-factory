import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { company } from '../../db/schema.ts'
import { eq } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'

const app = new Hono()
app.use('*', authenticate)

// Get company settings
app.get('/company', async (c) => {
  const currentUser = c.get('user') as any
  const [comp] = await db.select().from(company).where(eq(company.id, currentUser.companyId)).limit(1)
  if (!comp) return c.json({ error: 'Company not found' }, 404)
  return c.json(comp)
})

// Update company info
app.put('/company', async (c) => {
  const currentUser = c.get('user') as any
  const schema = z.object({
    name: z.string().optional(),
    phone: z.string().optional(),
    email: z.string().optional(),
    address: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    zip: z.string().optional(),
  })
  const data = schema.parse(await c.req.json())
  await db.update(company).set({ ...data, updatedAt: new Date() })
    .where(eq(company.id, currentUser.companyId))
  return c.json({ message: 'Saved' })
})

// Update branding
app.put('/branding', async (c) => {
  const currentUser = c.get('user') as any
  const schema = z.object({
    primaryColor: z.string().optional(),
  })
  const data = schema.parse(await c.req.json())
  await db.update(company).set({ ...data, updatedAt: new Date() })
    .where(eq(company.id, currentUser.companyId))
  return c.json({ message: 'Saved' })
})

// Update estimator settings
app.put('/estimator', async (c) => {
  const currentUser = c.get('user') as any
  const schema = z.object({
    estimatorEnabled: z.boolean(),
    pricePerSquareLow: z.string(),
    pricePerSquareHigh: z.string(),
    estimatorHeadline: z.string(),
    estimatorDisclaimer: z.string(),
  })
  const data = schema.parse(await c.req.json())
  await db.update(company).set({ ...data, updatedAt: new Date() })
    .where(eq(company.id, currentUser.companyId))
  return c.json({ message: 'Saved' })
})

export default app
