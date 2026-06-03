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
import { eq, asc, desc } from 'drizzle-orm'
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
