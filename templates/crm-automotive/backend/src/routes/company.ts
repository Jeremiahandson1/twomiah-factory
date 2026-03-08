import { Hono } from 'hono'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { db } from '../../db/index.ts'
import { company, user } from '../../db/schema.ts'
import { eq, and } from 'drizzle-orm'
import { authenticate, requireAdmin } from '../middleware/auth.ts'

const app = new Hono()
app.use('*', authenticate)

app.get('/', async (c) => {
  const currentUser = c.get('user') as any
  const [result] = await db.select().from(company).where(eq(company.id, currentUser.companyId)).limit(1)
  return c.json(result)
})

app.put('/', requireAdmin, async (c) => {
  const currentUser = c.get('user') as any
  const schema = z.object({ name: z.string().min(1).optional(), email: z.string().email().optional(), phone: z.string().optional(), address: z.string().optional(), city: z.string().optional(), state: z.string().optional(), zip: z.string().optional(), logo: z.string().optional(), primaryColor: z.string().optional(), website: z.string().optional(), licenseNumber: z.string().optional(), settings: z.record(z.any()).optional() })
  const data = schema.parse(await c.req.json())
  const [result] = await db.update(company).set({ ...data, updatedAt: new Date() }).where(eq(company.id, currentUser.companyId)).returning()
  return c.json(result)
})

app.put('/features', requireAdmin, async (c) => {
  const currentUser = c.get('user') as any
  const { features } = await c.req.json()
  const [result] = await db.update(company).set({ enabledFeatures: features, updatedAt: new Date() }).where(eq(company.id, currentUser.companyId)).returning()
  return c.json(result)
})

// User management
app.get('/users', async (c) => {
  const currentUser = c.get('user') as any
  const users = await db.select({
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    phone: user.phone,
    role: user.role,
    isActive: user.isActive,
    lastLogin: user.lastLogin,
    createdAt: user.createdAt,
  }).from(user).where(eq(user.companyId, currentUser.companyId))
  return c.json(users)
})

app.post('/users', requireAdmin, async (c) => {
  const currentUser = c.get('user') as any
  const schema = z.object({ email: z.string().email(), password: z.string().min(8), firstName: z.string().min(1), lastName: z.string().min(1), phone: z.string().optional(), role: z.enum(['admin', 'manager', 'user', 'field']).default('user') })
  const data = schema.parse(await c.req.json())

  const [existing] = await db.select().from(user).where(and(eq(user.email, data.email), eq(user.companyId, currentUser.companyId))).limit(1)
  if (existing) return c.json({ error: 'Email already exists' }, 409)

  const passwordHash = await bcrypt.hash(data.password, 12)
  const { password, ...rest } = data
  const [newUser] = await db.insert(user).values({
    ...rest,
    passwordHash,
    companyId: currentUser.companyId,
  }).returning({
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role,
  })
  return c.json(newUser, 201)
})

app.put('/users/:id', requireAdmin, async (c) => {
  const id = c.req.param('id')
  const schema = z.object({ firstName: z.string().optional(), lastName: z.string().optional(), phone: z.string().optional(), role: z.enum(['admin', 'manager', 'user', 'field']).optional(), isActive: z.boolean().optional() })
  const data = schema.parse(await c.req.json())
  const [result] = await db.update(user).set({ ...data, updatedAt: new Date() }).where(eq(user.id, id)).returning({
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role,
    isActive: user.isActive,
  })
  return c.json(result)
})

app.delete('/users/:id', requireAdmin, async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')
  if (id === currentUser.userId) return c.json({ error: 'Cannot delete yourself' }, 400)
  await db.delete(user).where(eq(user.id, id))
  return c.json(null, 204)
})

export default app
