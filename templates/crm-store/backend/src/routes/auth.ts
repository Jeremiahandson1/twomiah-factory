import { Hono } from 'hono'
import jwt from 'jsonwebtoken'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { users } from '../../db/schema.ts'
import { eq } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'

const auth = new Hono()

const generateTokens = (userId: string, email: string, role: string) => ({
  accessToken: jwt.sign({ userId, email, role }, process.env.JWT_SECRET!, { expiresIn: '15m' }),
  refreshToken: jwt.sign({ userId, type: 'refresh' }, process.env.JWT_REFRESH_SECRET!, { expiresIn: '7d' }),
})

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

auth.post('/login', async (c) => {
  const parsed = loginSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: 'Invalid credentials' }, 400)
  const { email, password } = parsed.data

  const [u] = await db.select().from(users).where(eq(users.email, email.toLowerCase())).limit(1)
  if (!u || !u.isActive) return c.json({ error: 'Invalid email or password' }, 401)

  const valid = await Bun.password.verify(password, u.passwordHash)
  if (!valid) return c.json({ error: 'Invalid email or password' }, 401)

  const tokens = generateTokens(u.id, u.email, u.role)
  await db.update(users).set({ refreshToken: tokens.refreshToken }).where(eq(users.id, u.id))

  return c.json({
    ...tokens,
    user: { id: u.id, email: u.email, name: u.name, role: u.role },
  })
})

auth.post('/refresh', async (c) => {
  const body = await c.req.json().catch(() => null)
  const token = body?.refreshToken
  if (!token) return c.json({ error: 'No refresh token' }, 400)

  try {
    const decoded = jwt.verify(token, process.env.JWT_REFRESH_SECRET!) as any
    const [u] = await db.select().from(users).where(eq(users.id, decoded.userId)).limit(1)
    if (!u || !u.isActive || u.refreshToken !== token) {
      return c.json({ error: 'Invalid refresh token' }, 401)
    }
    const tokens = generateTokens(u.id, u.email, u.role)
    await db.update(users).set({ refreshToken: tokens.refreshToken }).where(eq(users.id, u.id))
    return c.json(tokens)
  } catch {
    return c.json({ error: 'Invalid refresh token' }, 401)
  }
})

auth.post('/logout', authenticate, async (c) => {
  const u = c.get('user')
  await db.update(users).set({ refreshToken: null }).where(eq(users.id, u.userId))
  return c.json({ ok: true })
})

auth.get('/me', authenticate, async (c) => {
  const u = c.get('user')
  const [found] = await db.select({
    id: users.id, email: users.email, name: users.name, role: users.role,
  }).from(users).where(eq(users.id, u.userId)).limit(1)
  if (!found) return c.json({ error: 'Not found' }, 404)
  return c.json({ user: found })
})

const passwordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
})

auth.post('/password', authenticate, async (c) => {
  const u = c.get('user')
  const parsed = passwordSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: 'New password must be at least 8 characters' }, 400)

  const [found] = await db.select().from(users).where(eq(users.id, u.userId)).limit(1)
  if (!found) return c.json({ error: 'Not found' }, 404)

  const valid = await Bun.password.verify(parsed.data.currentPassword, found.passwordHash)
  if (!valid) return c.json({ error: 'Current password is incorrect' }, 401)

  const passwordHash = await Bun.password.hash(parsed.data.newPassword, 'bcrypt')
  await db.update(users).set({ passwordHash, refreshToken: null }).where(eq(users.id, found.id))
  return c.json({ ok: true })
})

export default auth
