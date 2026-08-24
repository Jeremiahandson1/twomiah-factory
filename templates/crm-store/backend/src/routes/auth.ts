import { Hono } from 'hono'
import jwt from 'jsonwebtoken'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { users, storeSettings } from '../../db/schema.ts'
import { eq } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { sendPasswordReset } from '../services/email.ts'

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
  // No refresh-token ROTATION here. The DB stores a single refresh token;
  // rotating it on every access-token refresh races with concurrent
  // requests and multiple tabs — the loser presents a now-stale token,
  // gets 401, and is logged out mid-work. Issue a fresh access token and
  // keep the same refresh token (still expires on its own 7d clock).
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
    return c.json({ accessToken: tokens.accessToken, refreshToken: token })
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

// ── Forgot / reset password ──────────────────────────────────────────────────
// Token-based email flow, mirroring the other CRM templates. The forgot
// endpoint ALWAYS returns ok so it can't be used to probe which emails have
// accounts.

auth.post('/forgot-password', async (c) => {
  const body = await c.req.json().catch(() => null)
  const email = String(body?.email || '').toLowerCase().trim()
  if (email) {
    const [u] = await db.select().from(users).where(eq(users.email, email)).limit(1)
    if (u && u.isActive) {
      const resetToken = crypto.randomUUID()
      await db.update(users)
        .set({ resetToken, resetTokenExp: new Date(Date.now() + 60 * 60 * 1000) })
        .where(eq(users.id, u.id))
      const [settings] = await db.select().from(storeSettings).limit(1)
      const base = (process.env.BACKEND_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/$/, '')
      // Fire-and-forget: response time must not reveal whether an email matched.
      sendPasswordReset({
        toEmail: u.email,
        storeName: settings?.companyName || 'Your store',
        resetUrl: `${base}/reset-password?token=${resetToken}`,
      }).catch(() => {})
    }
  }
  return c.json({ ok: true })
})

auth.post('/reset-password', async (c) => {
  const body = await c.req.json().catch(() => null)
  const token = String(body?.token || '')
  const password = String(body?.password || '')
  if (!token || password.length < 8) {
    return c.json({ error: 'Password must be at least 8 characters' }, 400)
  }
  const [u] = await db.select().from(users).where(eq(users.resetToken, token)).limit(1)
  if (!u || !u.resetTokenExp || new Date(u.resetTokenExp) < new Date()) {
    return c.json({ error: 'This reset link is invalid or has expired. Request a new one.' }, 400)
  }
  const passwordHash = await Bun.password.hash(password, 'bcrypt')
  // Also rotate out any live refresh token — a reset must end existing sessions.
  await db.update(users)
    .set({ passwordHash, resetToken: null, resetTokenExp: null, refreshToken: null })
    .where(eq(users.id, u.id))
  return c.json({ ok: true })
})

export default auth
