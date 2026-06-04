/**
 * Admin JSON API for the premium template.
 *
 * Mounted at /api/admin/* by server-static.ts. Token-based auth (Bearer
 * Authorization header). Pages CRUD reads + writes the `pages` table.
 *
 * Auth:
 *   POST   /login              public, returns { token, user }
 *   GET    /me                 auth, returns { user }
 *   POST   /password           auth, body { currentPassword, newPassword }
 * Users (admin role only, except /password above):
 *   GET    /users              admin, list users
 *   POST   /users              admin, body { email, password, name?, role? }
 *   PATCH  /users/:id          admin, body { name?, role? }
 *   DELETE /users/:id          admin, refuses to remove last admin or self
 * Pages:
 *   GET    /pages              auth, list pages
 *   GET    /pages/:slug        auth, single page including sections JSON
 *   POST   /pages              auth, body { slug, title, sections?, ... }
 *   PATCH  /pages/:slug        auth, partial update
 *   DELETE /pages/:slug        auth, refuses to delete 'home'
 * Settings / Photos / Leads — auth, see below.
 */
import { Hono, type Context } from 'hono'
import { eq, asc, desc, and, not } from 'drizzle-orm'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import sharp from 'sharp'
import { db } from '../db'
import { users as usersTbl, pages as pagesTbl, photos as photosTbl, settings as settingsTbl, leads as leadsTbl } from '../db/schema'
import { uploadImage, deleteImage } from '../services/storage'

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

// Password change — current user only. Verifies the current password
// before accepting a new one; rejects new passwords shorter than 8 chars.
// Re-uses the JWT subject as the target user so a stolen token can't
// reset somebody else's password.
app.post('/password', authMiddleware, async (c) => {
  const userId = c.get('userId')!
  const body = await c.req.json().catch(() => ({})) as { currentPassword?: string; newPassword?: string }
  const current = String(body.currentPassword || '')
  const next = String(body.newPassword || '')
  if (!current || !next) return c.json({ error: 'currentPassword and newPassword are required' }, 400)
  if (next.length < 8) return c.json({ error: 'New password must be at least 8 characters' }, 400)
  if (next === current) return c.json({ error: 'New password must differ from current password' }, 400)

  const rows = await db.select().from(usersTbl).where(eq(usersTbl.id, userId)).limit(1)
  const user = rows[0]
  if (!user) return c.json({ error: 'User not found' }, 404)

  const ok = await bcrypt.compare(current, user.passwordHash)
  if (!ok) return c.json({ error: 'Current password is incorrect' }, 401)

  const newHash = await bcrypt.hash(next, 10)
  await db.update(usersTbl).set({ passwordHash: newHash }).where(eq(usersTbl.id, userId))
  return c.json({ ok: true })
})

// ─── Users ────────────────────────────────────────────────────────────────
// Role-gated to 'admin'. Editors can still change their own password and
// name via /password and (TODO if we add it) /me PATCH; managing the user
// list is owner/admin only.

const VALID_ROLES = new Set(['admin', 'editor'])

async function requireAdmin(c: Context<{ Variables: AdminVars }>, next: () => Promise<void>) {
  const role = c.get('userRole')
  if (role !== 'admin') return c.json({ error: 'Admin role required' }, 403)
  await next()
}

app.get('/users', authMiddleware, requireAdmin, async (c) => {
  const rows = await db.select({
    id: usersTbl.id, email: usersTbl.email, name: usersTbl.name,
    role: usersTbl.role, lastLoginAt: usersTbl.lastLoginAt, createdAt: usersTbl.createdAt,
  }).from(usersTbl).orderBy(asc(usersTbl.createdAt))
  return c.json({ users: rows })
})

app.post('/users', authMiddleware, requireAdmin, async (c) => {
  const body = await c.req.json().catch(() => ({})) as {
    email?: string; password?: string; name?: string; role?: string
  }
  const email = String(body.email || '').trim().toLowerCase()
  const password = String(body.password || '')
  const name = typeof body.name === 'string' ? body.name.trim() : null
  const role = body.role && VALID_ROLES.has(body.role) ? body.role : 'editor'

  if (!email || !password) return c.json({ error: 'Email and password are required' }, 400)
  if (password.length < 8) return c.json({ error: 'Password must be at least 8 characters' }, 400)

  const existing = await db.select({ id: usersTbl.id }).from(usersTbl).where(eq(usersTbl.email, email)).limit(1)
  if (existing[0]) return c.json({ error: 'A user with that email already exists' }, 409)

  const passwordHash = await bcrypt.hash(password, 10)
  const [created] = await db.insert(usersTbl).values({
    email, passwordHash, name: name || null, role,
  }).returning({
    id: usersTbl.id, email: usersTbl.email, name: usersTbl.name,
    role: usersTbl.role, lastLoginAt: usersTbl.lastLoginAt, createdAt: usersTbl.createdAt,
  })
  return c.json({ user: created }, 201)
})

app.patch('/users/:id', authMiddleware, requireAdmin, async (c) => {
  const targetId = c.req.param('id')
  const selfId = c.get('userId')!
  const body = await c.req.json().catch(() => ({})) as { name?: string | null; role?: string }
  const patch: Record<string, any> = {}
  if (typeof body.name === 'string' || body.name === null) patch.name = body.name
  if (body.role !== undefined) {
    if (!VALID_ROLES.has(body.role)) return c.json({ error: 'Invalid role' }, 400)
    patch.role = body.role
  }
  if (Object.keys(patch).length === 0) return c.json({ error: 'No allowed fields in patch' }, 400)

  // Lockout protection: if the change demotes the *last* admin to a
  // non-admin role, refuse. Otherwise an owner could lock themselves
  // and everyone else out of the user-management UI.
  if (patch.role && patch.role !== 'admin') {
    const adminCount = await db.select({ id: usersTbl.id }).from(usersTbl).where(eq(usersTbl.role, 'admin'))
    const target = await db.select({ id: usersTbl.id, role: usersTbl.role }).from(usersTbl).where(eq(usersTbl.id, targetId)).limit(1)
    if (target[0]?.role === 'admin' && adminCount.length <= 1) {
      return c.json({ error: 'Refusing to demote the last admin — promote another user first.' }, 400)
    }
    if (target[0]?.id === selfId) {
      return c.json({ error: 'You can\'t demote yourself — ask another admin.' }, 400)
    }
  }

  const result = await db.update(usersTbl).set(patch).where(eq(usersTbl.id, targetId)).returning({
    id: usersTbl.id, email: usersTbl.email, name: usersTbl.name,
    role: usersTbl.role, lastLoginAt: usersTbl.lastLoginAt, createdAt: usersTbl.createdAt,
  })
  if (result.length === 0) return c.json({ error: 'User not found' }, 404)
  return c.json({ user: result[0] })
})

app.delete('/users/:id', authMiddleware, requireAdmin, async (c) => {
  const targetId = c.req.param('id')
  const selfId = c.get('userId')!
  if (targetId === selfId) return c.json({ error: 'You can\'t delete yourself.' }, 400)

  const target = await db.select({ id: usersTbl.id, role: usersTbl.role }).from(usersTbl).where(eq(usersTbl.id, targetId)).limit(1)
  if (!target[0]) return c.json({ error: 'User not found' }, 404)
  if (target[0].role === 'admin') {
    const otherAdmins = await db.select({ id: usersTbl.id }).from(usersTbl).where(and(eq(usersTbl.role, 'admin'), not(eq(usersTbl.id, targetId))))
    if (otherAdmins.length === 0) {
      return c.json({ error: 'Refusing to delete the last admin — promote another user first.' }, 400)
    }
  }

  await db.delete(usersTbl).where(eq(usersTbl.id, targetId))
  return c.json({ ok: true })
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

// Slugs that collide with server routes (or are visually confusing). The
// premium server mounts /api/admin/*, the auth flow uses /login, and we
// reserve a handful of common slugs to keep URLs predictable.
const RESERVED_SLUGS = new Set([
  'api', 'admin', 'login', 'logout', 'auth', 'static', 'uploads',
  'assets', 'build', 'public', 'sitemap.xml', 'robots.txt',
])
// Single-segment slug only — the public renderer's /:slug route matches
// one path segment. Nested paths (service-areas/madison) would need both
// route changes in server-static.ts AND admin UI support; not in this pass.
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/

// Create a new page. Slug must be URL-safe and not reserved. Sections
// default to empty — the admin builds it up from there.
app.post('/pages', authMiddleware, async (c) => {
  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>
  const slug = String(body.slug || '').trim().toLowerCase()
  const title = String(body.title || '').trim()

  if (!slug) return c.json({ error: 'slug is required' }, 400)
  if (!title) return c.json({ error: 'title is required' }, 400)
  if (!SLUG_RE.test(slug)) {
    return c.json({ error: 'slug must be lowercase letters, numbers, and hyphens (e.g. "service-areas")' }, 400)
  }
  if (RESERVED_SLUGS.has(slug)) {
    return c.json({ error: `Slug "${slug}" is reserved` }, 400)
  }

  const existing = await db.select({ id: pagesTbl.id }).from(pagesTbl).where(eq(pagesTbl.slug, slug)).limit(1)
  if (existing[0]) return c.json({ error: 'A page with that slug already exists' }, 409)

  const sections = Array.isArray(body.sections) ? body.sections : []
  const isPublished = typeof body.isPublished === 'boolean' ? body.isPublished : true
  const navOrder = typeof body.navOrder === 'number' ? body.navOrder : 100
  const metaTitle = typeof body.metaTitle === 'string' ? body.metaTitle : null
  const metaDescription = typeof body.metaDescription === 'string' ? body.metaDescription : null

  const [created] = await db.insert(pagesTbl).values({
    slug, title, sections, isPublished, navOrder, metaTitle, metaDescription,
  }).returning()
  return c.json({ page: created }, 201)
})

// Delete a page. 'home' is essential to the site (template's root route
// reads from it), so we refuse rather than 404 the public homepage.
app.delete('/pages/:slug', authMiddleware, async (c) => {
  const slug = c.req.param('slug')
  if (slug === 'home') {
    return c.json({ error: 'The home page can\'t be deleted. Hide it via isPublished instead.' }, 400)
  }
  const result = await db.delete(pagesTbl).where(eq(pagesTbl.slug, slug)).returning({ id: pagesTbl.id })
  if (result.length === 0) return c.json({ error: 'Page not found' }, 404)
  return c.json({ ok: true })
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

// ─── Settings ─────────────────────────────────────────────────────────────

const SETTINGS_FIELDS = [
  'companyName', 'tagline', 'phone', 'email', 'address',
  'seoTitle', 'seoDescription', 'contactCtaLabel',
  'primaryColor', 'secondaryColor', 'accentColor',
  'logoUrl', 'faviconUrl', 'nav',
] as const

app.get('/settings', authMiddleware, async (c) => {
  const rows = await db.select().from(settingsTbl).limit(1)
  return c.json({ settings: rows[0] || null })
})

app.patch('/settings', authMiddleware, async (c) => {
  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>
  const patch: Record<string, any> = {}
  for (const f of SETTINGS_FIELDS) {
    if (f in body) patch[f] = body[f]
  }
  if (Object.keys(patch).length === 0) return c.json({ error: 'No allowed fields in patch' }, 400)

  const existing = await db.select().from(settingsTbl).limit(1)
  patch.updatedAt = new Date()
  if (existing[0]) {
    const [updated] = await db.update(settingsTbl).set(patch).where(eq(settingsTbl.id, existing[0].id)).returning()
    return c.json({ settings: updated })
  }
  // First-ever PATCH — companyName is required when no row exists
  if (!patch.companyName) return c.json({ error: 'companyName is required on first save' }, 400)
  const [created] = await db.insert(settingsTbl).values(patch).returning()
  return c.json({ settings: created })
})

// ─── Leads ────────────────────────────────────────────────────────────────

app.get('/leads', authMiddleware, async (c) => {
  const status = c.req.query('status')
  const query = status
    ? db.select().from(leadsTbl).where(eq(leadsTbl.status, status)).orderBy(desc(leadsTbl.createdAt))
    : db.select().from(leadsTbl).orderBy(desc(leadsTbl.createdAt))
  const rows = await query
  return c.json({ leads: rows })
})

app.patch('/leads/:id', authMiddleware, async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>
  const patch: Record<string, any> = {}
  if (typeof body.status === 'string' && ['new', 'replied', 'closed', 'spam'].includes(body.status)) {
    patch.status = body.status
  }
  if (typeof body.notes === 'string' || body.notes === null) patch.notes = body.notes
  if (Object.keys(patch).length === 0) return c.json({ error: 'No allowed fields in patch' }, 400)
  const result = await db.update(leadsTbl).set(patch).where(eq(leadsTbl.id, id)).returning()
  if (result.length === 0) return c.json({ error: 'Lead not found' }, 404)
  return c.json({ lead: result[0] })
})

// ─── Photos ───────────────────────────────────────────────────────────────

const ALLOWED_IMAGE_TYPES = new Set([
  'image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif',
])
const MAX_IMAGE_BYTES = 8 * 1024 * 1024  // 8 MB

app.get('/photos', authMiddleware, async (c) => {
  const tag = c.req.query('tag')
  const query = tag
    ? db.select().from(photosTbl).where(eq(photosTbl.tag, tag)).orderBy(desc(photosTbl.createdAt))
    : db.select().from(photosTbl).orderBy(desc(photosTbl.createdAt))
  const rows = await query
  return c.json({ photos: rows })
})

app.post('/photos', authMiddleware, async (c) => {
  try {
    const body = await c.req.parseBody() as Record<string, any>
    const file = body.file as File | undefined
    const tag = typeof body.tag === 'string' ? body.tag : null
    const alt = typeof body.alt === 'string' ? body.alt : null

    if (!file || typeof file !== 'object' || typeof (file as any).arrayBuffer !== 'function') {
      return c.json({ error: 'File is required' }, 400)
    }
    if (file.size > MAX_IMAGE_BYTES) {
      return c.json({ error: 'Image is too large (max 8 MB).' }, 400)
    }
    if (file.type && !ALLOWED_IMAGE_TYPES.has(file.type)) {
      return c.json({ error: 'Unsupported image type. Use JPG, PNG, WebP, or GIF.' }, 400)
    }

    const raw = Buffer.from(await file.arrayBuffer())

    // Normalize: re-encode to web-friendly format + extract dimensions.
    // Lossless conversion for PNG-with-alpha (kept as PNG); everything
    // else flattens to JPEG at q82 for reasonable file size.
    const meta = await sharp(raw).metadata()
    const width = meta.width || null
    const height = meta.height || null

    let processedBuffer: Buffer = raw
    let processedType = file.type || 'image/jpeg'
    const isAlphaPng = meta.format === 'png' && meta.hasAlpha
    if (!isAlphaPng) {
      processedBuffer = await sharp(raw).rotate().jpeg({ quality: 82, mozjpeg: true }).toBuffer()
      processedType = 'image/jpeg'
    }

    const upload = await uploadImage(processedBuffer, {
      filename: file.name || 'photo' + (isAlphaPng ? '.png' : '.jpg'),
      contentType: processedType,
    })

    const [row] = await db.insert(photosTbl).values({
      url: upload.url,
      storageKey: upload.storageKey,
      alt: alt || null,
      tag: tag || null,
      width: width || null,
      height: height || null,
      bytes: upload.bytes,
      contentType: upload.contentType,
    }).returning()

    return c.json({ photo: row })
  } catch (err: any) {
    console.error('[Photos] Upload failed:', err.message)
    return c.json({ error: err.message || 'Upload failed' }, 500)
  }
})

app.patch('/photos/:id', authMiddleware, async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>
  const patch: Record<string, any> = {}
  if (typeof body.tag === 'string' || body.tag === null) patch.tag = body.tag
  if (typeof body.alt === 'string' || body.alt === null) patch.alt = body.alt
  if (Object.keys(patch).length === 0) return c.json({ error: 'No allowed fields in patch' }, 400)
  const result = await db.update(photosTbl).set(patch).where(eq(photosTbl.id, id)).returning()
  if (result.length === 0) return c.json({ error: 'Photo not found' }, 404)
  return c.json({ photo: result[0] })
})

app.delete('/photos/:id', authMiddleware, async (c) => {
  const id = c.req.param('id')
  const rows = await db.select().from(photosTbl).where(eq(photosTbl.id, id)).limit(1)
  const photo = rows[0]
  if (!photo) return c.json({ error: 'Photo not found' }, 404)
  if (photo.storageKey) {
    await deleteImage(photo.storageKey).catch(() => { /* non-fatal */ })
  }
  await db.delete(photosTbl).where(eq(photosTbl.id, id))
  return c.json({ ok: true })
})

export default app
