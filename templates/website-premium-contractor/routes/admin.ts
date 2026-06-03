/**
 * Admin JSON API for the premium template.
 *
 * Mounted at /api/admin/* by server-static.ts. Token-based auth (Bearer
 * Authorization header). Pages CRUD reads + writes the `pages` table.
 *
 * Endpoints (this commit — more in follow-up):
 *   POST /login          public, returns { token, user }
 *   GET  /me             auth, returns { user }
 *   GET  /pages          auth, list pages
 *   GET  /pages/:slug    auth, single page row including sections JSON
 *   PATCH /pages/:slug   auth, update title/sections/isPublished/navOrder/meta*
 *
 * (Photos, settings, leads, password change land in follow-up commits.)
 */
import { Hono, type Context } from 'hono'
import { eq, asc } from 'drizzle-orm'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { db } from '../db'
import { users as usersTbl, pages as pagesTbl } from '../db/schema'

type AdminVars = {
  userId?: string
  userEmail?: string
  userRole?: string
}

const app = new Hono<{ Variables: AdminVars }>()

const JWT_SECRET = process.env.JWT_SECRET || ''
const TOKEN_TTL_SECONDS = 60 * 60 * 12 // 12h

function signToken(user: { id: string; email: string; role: string }): string {
  if (!JWT_SECRET) throw new Error('JWT_SECRET not set')
  return jwt.sign({ sub: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: TOKEN_TTL_SECONDS })
}

async function authMiddleware(c: Context<{ Variables: AdminVars }>, next: () => Promise<void>) {
  if (!JWT_SECRET) return c.json({ error: 'JWT_SECRET not configured' }, 503)
  const header = c.req.header('Authorization') || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : ''
  if (!token) return c.json({ error: 'Missing auth token' }, 401)
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { sub?: string; email?: string; role?: string }
    if (!decoded.sub) return c.json({ error: 'Invalid token' }, 401)
    c.set('userId', decoded.sub)
    c.set('userEmail', decoded.email)
    c.set('userRole', decoded.role || 'admin')
    await next()
  } catch {
    return c.json({ error: 'Invalid or expired token' }, 401)
  }
}

// ─── Auth ─────────────────────────────────────────────────────────────────

app.post('/login', async (c) => {
  const body = await c.req.json().catch(() => ({})) as { email?: string; password?: string }
  const email = String(body.email || '').trim().toLowerCase()
  const password = String(body.password || '')
  if (!email || !password) return c.json({ error: 'Email and password are required' }, 400)

  const rows = await db.select().from(usersTbl).where(eq(usersTbl.email, email)).limit(1)
  const user = rows[0]
  // Constant-time-ish: always do the bcrypt comparison even if user not found,
  // so we don't leak whether the email exists.
  const ok = user
    ? await bcrypt.compare(password, user.passwordHash)
    : await bcrypt.compare(password, '$2a$10$invalidsaltinvalidsaltinvalidsaltinvalidsaltinval')

  if (!user || !ok) return c.json({ error: 'Incorrect email or password' }, 401)

  await db.update(usersTbl).set({ lastLoginAt: new Date() }).where(eq(usersTbl.id, user.id))

  const token = signToken({ id: user.id, email: user.email, role: user.role })
  return c.json({
    token,
    user: { id: user.id, email: user.email, name: user.name, role: user.role },
  })
})

app.get('/me', authMiddleware, async (c) => {
  const userId = c.get('userId')!
  const rows = await db.select().from(usersTbl).where(eq(usersTbl.id, userId)).limit(1)
  const user = rows[0]
  if (!user) return c.json({ error: 'User not found' }, 404)
  return c.json({ user: { id: user.id, email: user.email, name: user.name, role: user.role } })
})

// ─── Pages ────────────────────────────────────────────────────────────────

app.get('/pages', authMiddleware, async (_c) => {
  const rows = await db.select().from(pagesTbl).orderBy(asc(pagesTbl.navOrder), asc(pagesTbl.title))
  return _c.json({
    pages: rows.map(r => ({
      id: r.id,
      slug: r.slug,
      title: r.title,
      isPublished: r.isPublished,
      navOrder: r.navOrder,
      updatedAt: r.updatedAt,
    })),
  })
})

app.get('/pages/:slug', authMiddleware, async (c) => {
  const slug = c.req.param('slug')
  const rows = await db.select().from(pagesTbl).where(eq(pagesTbl.slug, slug)).limit(1)
  const page = rows[0]
  if (!page) return c.json({ error: 'Page not found' }, 404)
  return c.json({ page })
})

app.patch('/pages/:slug', authMiddleware, async (c) => {
  const slug = c.req.param('slug')
  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>

  // Allow-list which fields can be patched. Sections gets the full JSON
  // array; per-section field editing happens client-side, server just
  // accepts the new array verbatim.
  const allowed: Record<string, any> = {}
  if (typeof body.title === 'string') allowed.title = body.title
  if (Array.isArray(body.sections)) allowed.sections = body.sections
  if (typeof body.metaTitle === 'string' || body.metaTitle === null) allowed.metaTitle = body.metaTitle
  if (typeof body.metaDescription === 'string' || body.metaDescription === null) allowed.metaDescription = body.metaDescription
  if (typeof body.isPublished === 'boolean') allowed.isPublished = body.isPublished
  if (typeof body.navOrder === 'number') allowed.navOrder = body.navOrder

  if (Object.keys(allowed).length === 0) return c.json({ error: 'No allowed fields in patch' }, 400)
  allowed.updatedAt = new Date()

  const result = await db.update(pagesTbl).set(allowed).where(eq(pagesTbl.slug, slug)).returning()
  if (result.length === 0) return c.json({ error: 'Page not found' }, 404)
  return c.json({ page: result[0] })
})

export default app
