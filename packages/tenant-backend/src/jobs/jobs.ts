// Jobs (service calls) — one implementation for every CRM. The template injects its Drizzle db + tables,
// auth middleware, socket emitter and sanitiser, plus options: extra writable columns (fs/landscaping
// equipmentId/siteId), an extra relation (equipment), lifecycle hooks (SMS, review requests, service
// agreements) and, when a job_photo table + storage are passed, the photo routes.
//
// Behaviour that used to differ per template and is now the same everywhere:
//   - job numbers come from the per-company max under an advisory lock — the old `count + 1` reused a
//     deleted job's number (proven live on every tenant) and raced under concurrent creates
//   - a malformed scheduledDate is a 400, not an "Invalid Date" 500
//   - the edit form's null relations and decimal-string hours are accepted on every template
//     (landscaping 400'd on both), search matches title / number / address everywhere (fieldservice
//     ignored ?search=), and related rows are fetched by id instead of the whole company
import { Hono } from 'hono'
import { z } from 'zod'
import { eq, and, gte, lt, count, asc, desc, or, ilike, inArray } from 'drizzle-orm'
import { nextNumber } from '../invoicing/money'
import { sniffType, baseMime } from '../files/storage'

export interface JobTables { job: any; contact: any; user: any; project?: any; timeEntry?: any; equipment?: any; jobPhoto?: any }
export interface JobPhotoStorage { put: (key: string, body: Buffer, contentType: string) => Promise<void>; deleteFile: (key: string) => boolean | Promise<boolean | void>; storageConfigured?: () => boolean }
export type JobHook = (ctx: { job: any; companyId: string; userId: string }) => Promise<Record<string, any> | void> | Record<string, any> | void

export interface JobOptions {
  numbering?: { prefix?: string; pad?: number }
  /** extra writable columns on this vertical's job table (e.g. equipmentId, siteId) */
  extraFields?: z.ZodRawShape
  /** private object storage for job photos (with tables.jobPhoto) */
  storage?: JobPhotoStorage
  /** URL prefix the media proxy is mounted at. Default /media/ */
  mediaUrlPrefix?: string
  onStart?: JobHook
  onDispatch?: JobHook
  /** may return extra fields merged into the complete response (e.g. nextServiceDate) */
  onComplete?: JobHook
  maxLimit?: number
}

export interface JobDeps {
  db: any
  tables: JobTables
  authenticate: any
  emitToCompany: (companyId: string, event: string, data: any) => void
  EVENTS: { JOB_CREATED: string; JOB_UPDATED: string; JOB_DELETED: string; JOB_STATUS_CHANGED: string }
  cleanText: (min?: number) => z.ZodTypeAny
  options?: JobOptions
}

export const JOB_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const
export const OPEN_JOB_STATUSES = ['scheduled', 'pending', 'confirmed']
const MAX_PHOTO_SIZE = 10 * 1024 * 1024
const PHOTO_EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' }

const emptyToUndef = (v: unknown) => (v === '' || v === null ? undefined : v)
const validDate = (v: unknown) => v === undefined || v === '' || (typeof v === 'string' && !isNaN(new Date(v).getTime()))

export function createJobRoutes(deps: JobDeps) {
  const { db, tables: t, authenticate, emitToCompany, EVENTS, cleanText } = deps
  const o = deps.options || {}
  const prefix = o.numbering?.prefix || 'JOB'
  const pad = o.numbering?.pad ?? 5
  const maxLimit = o.maxLimit || 500
  const mediaPrefix = o.mediaUrlPrefix || '/media/'

  const jobSchema = z.object({
    title: cleanText(1),
    description: cleanText().optional(),
    projectId: z.string().optional().transform(emptyToUndef as any),
    contactId: z.string().optional().transform(emptyToUndef as any),
    assignedToId: z.string().optional().transform(emptyToUndef as any),
    priority: z.enum(JOB_PRIORITIES).default('normal'),
    // Statuses are tenant-configurable (the dispatch board PUTs them), so any non-empty string.
    status: z.string().min(1).optional(),
    scheduledDate: z.string().optional().refine(validDate, { message: 'Invalid scheduled date' }),
    scheduledTime: z.string().optional(),
    // The edit form posts the decimal string the API returned ("4.00"), or "" when blank.
    estimatedHours: z.preprocess((v) => (v === '' || v === null || v === undefined ? undefined : v), z.coerce.number().min(0, 'Estimated hours cannot be negative').optional()),
    address: cleanText().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    zip: z.string().optional(),
    notes: cleanText().optional(),
    ...(o.extraFields || {}),
  })

  const app = new Hono()
  app.use('*', authenticate)

  const findOwned = async (id: string, companyId: string) => {
    const [row] = await db.select().from(t.job).where(and(eq(t.job.id, id), eq(t.job.companyId, companyId))).limit(1)
    return row
  }
  const uniq = (xs: (string | null | undefined)[]) => [...new Set(xs.filter(Boolean) as string[])]

  /** project / contact / assignedTo (/ equipment) for a set of rows, fetched by id and scoped to the company. */
  const withRelations = async (rows: any[], companyId: string, contactCols?: Record<string, any>) => {
    const projectIds = uniq(rows.map((j) => j.projectId)), contactIds = uniq(rows.map((j) => j.contactId)), userIds = uniq(rows.map((j) => j.assignedToId)), equipmentIds = t.equipment ? uniq(rows.map((j) => j.equipmentId)) : []
    const [projects, contacts, users, equipmentList] = await Promise.all([
      t.project && projectIds.length ? db.select({ id: t.project.id, name: t.project.name }).from(t.project).where(and(eq(t.project.companyId, companyId), inArray(t.project.id, projectIds))) : Promise.resolve([]),
      contactIds.length ? db.select(contactCols || { id: t.contact.id, name: t.contact.name }).from(t.contact).where(and(eq(t.contact.companyId, companyId), inArray(t.contact.id, contactIds))) : Promise.resolve([]),
      userIds.length ? db.select({ id: t.user.id, firstName: t.user.firstName, lastName: t.user.lastName }).from(t.user).where(and(eq(t.user.companyId, companyId), inArray(t.user.id, userIds))) : Promise.resolve([]),
      t.equipment && equipmentIds.length ? db.select({ id: t.equipment.id, name: t.equipment.name, manufacturer: t.equipment.manufacturer, model: t.equipment.model }).from(t.equipment).where(and(eq(t.equipment.companyId, companyId), inArray(t.equipment.id, equipmentIds))) : Promise.resolve([]),
    ])
    const by = (xs: any[]) => Object.fromEntries(xs.map((x) => [x.id, x]))
    const pm = by(projects), cm = by(contacts), um = by(users), em = by(equipmentList)
    return rows.map((j) => ({
      ...j,
      project: j.projectId ? pm[j.projectId] || null : null,
      contact: j.contactId ? cm[j.contactId] || null : null,
      assignedTo: j.assignedToId ? um[j.assignedToId] || null : null,
      ...(t.equipment ? { equipment: j.equipmentId ? em[j.equipmentId] || null : null } : {}),
    }))
  }
  const isOverdue = (j: any) => !!(j.scheduledDate && OPEN_JOB_STATUSES.includes(String(j.status)) && new Date(j.scheduledDate).getTime() < Date.now() - 86400000)
  const runHook = async (hook: JobHook | undefined, job: any, currentUser: any) => {
    if (!hook) return {}
    try { return (await hook({ job, companyId: currentUser.companyId, userId: currentUser.userId })) || {} } catch (err: any) { console.warn('[jobs] hook failed:', err?.message || err); return {} }
  }

  // ---------------------------------------------------------------- list / today
  app.get('/', async (c) => {
    const currentUser = c.get('user') as any
    const q = c.req.query()
    const page = Math.max(1, parseInt(q.page || '1', 10) || 1)
    const limit = Math.min(Math.max(1, parseInt(q.limit || '50', 10) || 50), maxLimit)
    const conditions: any[] = [eq(t.job.companyId, currentUser.companyId)]
    if (q.status) conditions.push(eq(t.job.status, q.status))
    if (q.projectId) conditions.push(eq(t.job.projectId, q.projectId))
    if (q.contactId) conditions.push(eq(t.job.contactId, q.contactId))
    if (q.assignedToId) conditions.push(eq(t.job.assignedToId, q.assignedToId))
    if (q.search?.trim()) { const p = `%${q.search.trim()}%`; conditions.push(or(ilike(t.job.title, p), ilike(t.job.number, p), ilike(t.job.address, p))!) }
    // The dispatch board passes ?date=YYYY-MM-DD (F-11).
    if (q.date && /^\d{4}-\d{2}-\d{2}$/.test(q.date)) {
      const dayStart = new Date(q.date + 'T00:00:00')
      if (!isNaN(dayStart.getTime())) conditions.push(gte(t.job.scheduledDate, dayStart), lt(t.job.scheduledDate, new Date(dayStart.getTime() + 86400000)))
    }
    const where = and(...conditions)
    const [rows, [{ value: total }]] = await Promise.all([
      db.select().from(t.job).where(where).orderBy(asc(t.job.scheduledDate), desc(t.job.createdAt)).offset((page - 1) * limit).limit(limit),
      db.select({ value: count() }).from(t.job).where(where),
    ])
    const data = (await withRelations(rows, currentUser.companyId)).map((j) => ({ ...j, isOverdue: isOverdue(j) }))
    return c.json({ data, pagination: { page, limit, total: Number(total), pages: Math.ceil(Number(total) / limit) } })
  })

  app.get('/today', async (c) => {
    const currentUser = c.get('user') as any
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1)
    const rows = await db.select().from(t.job).where(and(eq(t.job.companyId, currentUser.companyId), gte(t.job.scheduledDate, today), lt(t.job.scheduledDate, tomorrow))).orderBy(asc(t.job.scheduledTime))
    return c.json(await withRelations(rows, currentUser.companyId, { id: t.contact.id, name: t.contact.name, phone: t.contact.phone }))
  })

  // ---------------------------------------------------------------- photos (before /:id so /:id/photos routes resolve first)
  if (t.jobPhoto && o.storage) {
    const storage = o.storage
    const keyFromUrl = (url: string) => (url || '').startsWith(mediaPrefix) ? url.slice(mediaPrefix.length) : null

    app.post('/:id/photos', async (c) => {
      const currentUser = c.get('user') as any
      const id = c.req.param('id')
      if (!(await findOwned(id, currentUser.companyId))) return c.json({ error: 'Job not found' }, 404)
      const form = await c.req.formData().catch(() => null)
      const file = form?.get('photo') as File | null
      if (!file || typeof file === 'string') return c.json({ error: 'No photo provided' }, 400)
      if (file.size > MAX_PHOTO_SIZE) return c.json({ error: 'Photo exceeds 10MB limit' }, 400)
      const buffer = Buffer.from(await file.arrayBuffer())
      // Trust the bytes, not the declared type — a renamed HTML file must not be served as an image.
      const type = sniffType(buffer) || baseMime(file.type)
      if (!PHOTO_EXT[type]) return c.json({ error: 'File must be an image' }, 400)
      const key = `photos/${currentUser.companyId}/${id}/${crypto.randomUUID().replace(/-/g, '')}.${PHOTO_EXT[type]}`
      await storage.put(key, buffer, type)
      const caption = (form!.get('caption') as string) || null
      const [photo] = await db.insert(t.jobPhoto).values({ companyId: currentUser.companyId, jobId: id, uploadedById: currentUser.userId, url: mediaPrefix + key, caption }).returning()
      return c.json(photo, 201)
    })

    app.get('/:id/photos', async (c) => {
      const currentUser = c.get('user') as any
      const id = c.req.param('id')
      if (!(await findOwned(id, currentUser.companyId))) return c.json({ error: 'Job not found' }, 404)
      return c.json(await db.select().from(t.jobPhoto).where(and(eq(t.jobPhoto.jobId, id), eq(t.jobPhoto.companyId, currentUser.companyId))).orderBy(desc(t.jobPhoto.createdAt)))
    })

    app.delete('/:id/photos/:photoId', async (c) => {
      const currentUser = c.get('user') as any
      const [existing] = await db.select().from(t.jobPhoto).where(and(eq(t.jobPhoto.id, c.req.param('photoId')), eq(t.jobPhoto.jobId, c.req.param('id')), eq(t.jobPhoto.companyId, currentUser.companyId))).limit(1)
      if (!existing) return c.json({ error: 'Photo not found' }, 404)
      const key = keyFromUrl(existing.url)
      if (key) { try { await storage.deleteFile(key) } catch { /* the row is the source of truth */ } }
      await db.delete(t.jobPhoto).where(eq(t.jobPhoto.id, existing.id))
      return c.body(null, 204)
    })
  }

  // ---------------------------------------------------------------- one job
  app.get('/:id', async (c) => {
    const currentUser = c.get('user') as any
    const found = await findOwned(c.req.param('id'), currentUser.companyId)
    if (!found) return c.json({ error: 'Job not found' }, 404)
    const [jobProject, jobContact, assignedUser, entries, jobEquipment] = await Promise.all([
      t.project && found.projectId ? db.select().from(t.project).where(and(eq(t.project.id, found.projectId), eq(t.project.companyId, currentUser.companyId))).limit(1) : Promise.resolve([]),
      found.contactId ? db.select().from(t.contact).where(and(eq(t.contact.id, found.contactId), eq(t.contact.companyId, currentUser.companyId))).limit(1) : Promise.resolve([]),
      found.assignedToId ? db.select({ id: t.user.id, firstName: t.user.firstName, lastName: t.user.lastName, email: t.user.email, phone: t.user.phone }).from(t.user).where(and(eq(t.user.id, found.assignedToId), eq(t.user.companyId, currentUser.companyId))).limit(1) : Promise.resolve([]),
      t.timeEntry ? db.select().from(t.timeEntry).where(eq(t.timeEntry.jobId, found.id)).orderBy(desc(t.timeEntry.date)).limit(10) : Promise.resolve([]),
      t.equipment && found.equipmentId ? db.select({ id: t.equipment.id, name: t.equipment.name, manufacturer: t.equipment.manufacturer, model: t.equipment.model, serialNumber: t.equipment.serialNumber, location: t.equipment.location }).from(t.equipment).where(and(eq(t.equipment.id, found.equipmentId), eq(t.equipment.companyId, currentUser.companyId))).limit(1) : Promise.resolve([]),
    ])
    const { portalToken, portalTokenExp, ...safeContact } = (jobContact[0] || {}) as any
    return c.json({ ...found, project: jobProject[0] || null, contact: jobContact[0] ? safeContact : null, assignedTo: assignedUser[0] || null, timeEntries: entries, ...(t.equipment ? { equipment: jobEquipment[0] || null } : {}) })
  })

  app.post('/', async (c) => {
    const currentUser = c.get('user') as any
    const data: any = jobSchema.parse(await c.req.json())
    const created = await db.transaction(async (tx: any) => {
      const number = await nextNumber(tx, t.job, t.job.number, t.job.companyId, currentUser.companyId, { prefix, pad })
      const [row] = await tx.insert(t.job).values({
        ...data,
        number,
        scheduledDate: data.scheduledDate ? new Date(data.scheduledDate) : null,
        estimatedHours: data.estimatedHours !== undefined ? String(data.estimatedHours) : null,
        companyId: currentUser.companyId,
        createdById: currentUser.userId,
      }).returning()
      return row
    })
    const [result] = await withRelations([created], currentUser.companyId)
    emitToCompany(currentUser.companyId, EVENTS.JOB_CREATED, result)
    return c.json(result, 201)
  })

  app.put('/:id', async (c) => {
    const currentUser = c.get('user') as any
    const id = c.req.param('id')
    // The edit form posts back exactly what the API returned, including null for empty relations;
    // optional string fields reject null, so map null → undefined (clearing a field uses '').
    const raw = (await c.req.json().catch(() => null)) ?? {}
    const data: any = jobSchema.partial().parse(Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, v === null ? undefined : v])))
    if (!(await findOwned(id, currentUser.companyId))) return c.json({ error: 'Job not found' }, 404)
    const [updated] = await db.update(t.job).set({
      ...data,
      scheduledDate: data.scheduledDate ? new Date(data.scheduledDate) : undefined,
      estimatedHours: data.estimatedHours !== undefined ? String(data.estimatedHours) : undefined,
      updatedAt: new Date(),
    }).where(and(eq(t.job.id, id), eq(t.job.companyId, currentUser.companyId))).returning()
    const [result] = await withRelations([updated], currentUser.companyId)
    emitToCompany(currentUser.companyId, EVENTS.JOB_UPDATED, result)
    return c.json(result)
  })

  app.delete('/:id', async (c) => {
    const currentUser = c.get('user') as any
    const id = c.req.param('id')
    if (!(await findOwned(id, currentUser.companyId))) return c.json({ error: 'Job not found' }, 404)
    await db.delete(t.job).where(and(eq(t.job.id, id), eq(t.job.companyId, currentUser.companyId)))
    emitToCompany(currentUser.companyId, EVENTS.JOB_DELETED, { id })
    return c.body(null, 204)
  })

  // ---------------------------------------------------------------- lifecycle
  const transition = (path: string, status: string, hook: () => JobHook | undefined, extra: () => Record<string, any> = () => ({})) => {
    app.post(`/:id/${path}`, async (c) => {
      const currentUser = c.get('user') as any
      const id = c.req.param('id')
      if (!(await findOwned(id, currentUser.companyId))) return c.json({ error: 'Job not found' }, 404)
      const [updated] = await db.update(t.job).set({ status, ...extra(), updatedAt: new Date() }).where(and(eq(t.job.id, id), eq(t.job.companyId, currentUser.companyId))).returning()
      emitToCompany(currentUser.companyId, EVENTS.JOB_STATUS_CHANGED, { id: updated.id, status })
      const more = await runHook(hook(), updated, currentUser)
      return c.json({ ...updated, ...more })
    })
  }
  transition('start', 'in_progress', () => o.onStart)
  transition('complete', 'completed', () => o.onComplete, () => ({ completedAt: new Date() }))
  transition('dispatch', 'dispatched', () => o.onDispatch)

  return app
}

/**
 * Public, read-only media proxy for job photos: streams objects out of the private bucket, same-origin.
 * Photos appear in the CRM and the customer portal (which may be viewed without an admin token), so
 * this matches the previous public access model; keys are opaque (companyId/jobId/random). User uploads
 * are never served as inline HTML/SVG — only known-safe raster types keep their content-type.
 */
export function createMediaRoutes(storage: { getObject: (key: string) => Promise<{ body: ArrayBuffer; contentType: string } | null>; storageConfigured?: () => boolean }, opts: { mountPath?: string } = {}) {
  const SAFE_INLINE = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif'])
  const mount = (opts.mountPath || '/media').replace(/\/+$/, '')
  const app = new Hono()
  app.get('/*', async (c) => {
    if (storage.storageConfigured && !storage.storageConfigured()) return c.json({ error: 'Media storage not configured' }, 503)
    const key = decodeURIComponent(c.req.path.replace(new RegExp(`^${mount}/`), ''))
    if (!key || key.includes('..') || key.startsWith('/') || !key.startsWith('photos/')) return c.json({ error: 'Invalid media key' }, 400)
    const obj = await storage.getObject(key)
    if (!obj) return c.json({ error: 'Not found' }, 404)
    const safe = SAFE_INLINE.has(obj.contentType)
    c.header('Content-Type', safe ? obj.contentType : 'application/octet-stream')
    c.header('X-Content-Type-Options', 'nosniff')
    if (!safe) c.header('Content-Disposition', 'attachment')
    c.header('Cache-Control', 'public, max-age=31536000, immutable')
    return c.body(obj.body)
  })
  return app
}
