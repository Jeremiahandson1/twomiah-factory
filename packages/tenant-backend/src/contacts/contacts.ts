// Contacts — one implementation for every CRM. The template injects its Drizzle db + `contact` table,
// its auth/permission middleware, socket emitter, audit log and sanitiser, plus a small options object:
// which contact types it sells, which related lists GET /:id returns, which tables block a delete,
// and (field service / landscaping) the tables that back per-contact service locations ("sites").
//
// Behaviour that used to differ per template and is now the same everywhere:
//   - phone / mobile must look like a phone number (>= 7 digits, phone punctuation only)
//   - name is capped at 200 characters
//   - a create that matches an existing contact's email or phone is refused with 409 + existingId
//     unless the body carries `allowDuplicate: true` (the UI offers "open existing" / "create anyway")
//   - deleting a contact that still owns invoices / quotes / jobs / projects (+ vertical records) is
//     refused with 409 naming what is attached — their FKs are ON DELETE SET NULL / CASCADE, so the
//     old behaviour silently blanked the client on financial records or destroyed history
//   - portal tokens are never returned, on any route (list/get already stripped; create/update leaked)
import { Hono } from 'hono'
import { z } from 'zod'
import { eq, and, or, ilike, count, desc, asc, sql } from 'drizzle-orm'

export const DEFAULT_CONTACT_TYPES = ['lead', 'client', 'subcontractor', 'vendor']

/** A related list returned inline on GET /:id (e.g. `projects` for this contact). */
export interface ContactRelation {
  key: string
  table: any
  /** the FK column on `table` that points at contact.id */
  column: any
  /** drizzle select map; omit to select every column */
  columns?: Record<string, any>
  orderBy?: any
}

/** A table whose rows block deleting the contact they point at. */
export interface ContactGuard {
  table: any
  column: any
  /** singular noun used in the 409 message, e.g. 'invoice' → "2 invoices" */
  label: string
  plural?: string
  /** Optional full message override (vet: medical-history wording). Receives the row count. */
  message?: (n: number) => string
}

export interface ContactSitesTables { site: any; equipment: any; job: any }

export interface ContactOptions {
  /** Accepted `type` values. Default lead/client/subcontractor/vendor. */
  types?: string[]
  /** Type a new contact gets when none is sent. Default 'lead'. */
  defaultType?: string
  /** What POST /:id/convert turns a lead into. Default 'client'. */
  convertTo?: string
  /** Related lists on GET /:id. */
  relations?: ContactRelation[]
  /** Counted delete guards (checked before the delete; FK violations are still caught as a fallback). */
  guards?: ContactGuard[]
  /** Refuse creates that match an existing email/phone unless allowDuplicate. Default true. */
  duplicateCheck?: boolean
  /** Extra writable columns this vertical's contact table has (e.g. optedOutSms). */
  extraFields?: z.ZodRawShape
  /** Mount the per-contact service-location routes (field service / landscaping). */
  sites?: ContactSitesTables
  /** Hard page-size cap. Default 500 (matches the templates' global pagination guard). */
  maxLimit?: number
}

export interface ContactDeps {
  db: any
  tables: { contact: any }
  authenticate: any
  requirePermission: (permission: string) => any
  emitToCompany: (companyId: string, event: string, data: any) => void
  EVENTS: { CONTACT_CREATED: string; CONTACT_UPDATED: string; CONTACT_DELETED: string }
  audit: { log: (entry: any) => any; diff: (before: any, after: any) => any; ACTIONS: Record<string, string> }
  /** the template's `cleanText(min)` zod helper (strips markup) */
  cleanText: (min?: number) => z.ZodTypeAny
  options?: ContactOptions
}

const PHONE_RE = /^[0-9+()\-.\s]+$/
export const isValidPhone = (v: unknown) => !v || (PHONE_RE.test(String(v)) && String(v).replace(/\D/g, '').length >= 7)
const phoneField = (what: string) => z.string().optional().nullable().refine(isValidPhone, { message: `Enter a valid ${what} (at least 7 digits)` })

/** The three lists every CRM shows on a contact: projects, quotes, invoices (whichever tables it has). */
export function standardRelations(t: { project?: any; quote?: any; invoice?: any }): ContactRelation[] {
  const out: ContactRelation[] = []
  if (t.project) out.push({ key: 'projects', table: t.project, column: t.project.contactId, columns: { id: t.project.id, name: t.project.name, status: t.project.status } })
  if (t.quote) out.push({ key: 'quotes', table: t.quote, column: t.quote.contactId, columns: { id: t.quote.id, number: t.quote.number, total: t.quote.total, status: t.quote.status } })
  if (t.invoice) out.push({ key: 'invoices', table: t.invoice, column: t.invoice.contactId, columns: { id: t.invoice.id, number: t.invoice.number, total: t.invoice.total, amountPaid: t.invoice.amountPaid, status: t.invoice.status } })
  return out
}

/** Financial / work records that must never be orphaned by a contact delete. */
export function standardGuards(t: { invoice?: any; quote?: any; job?: any; project?: any }): ContactGuard[] {
  const out: ContactGuard[] = []
  if (t.invoice) out.push({ table: t.invoice, column: t.invoice.contactId, label: 'invoice' })
  if (t.quote) out.push({ table: t.quote, column: t.quote.contactId, label: 'quote' })
  if (t.job) out.push({ table: t.job, column: t.job.contactId, label: 'job' })
  if (t.project) out.push({ table: t.project, column: t.project.contactId, label: 'project' })
  return out
}

const stripPortal = (row: any) => {
  if (!row) return row
  const { portalToken, portalTokenExp, ...rest } = row
  return rest
}

export function createContactRoutes(deps: ContactDeps) {
  const { db, tables: t, authenticate, requirePermission, emitToCompany, EVENTS, audit, cleanText } = deps
  const o = deps.options || {}
  const types = (o.types && o.types.length ? o.types : DEFAULT_CONTACT_TYPES) as [string, ...string[]]
  const defaultType = o.defaultType || 'lead'
  const convertTo = o.convertTo || 'client'
  const relations = o.relations || []
  const guards = o.guards || []
  const duplicateCheck = o.duplicateCheck !== false
  const maxLimit = o.maxLimit || 500

  const contactSchema = z.object({
    name: cleanText(1).pipe(z.string().max(200, 'Name is too long (200 characters max).')),
    type: z.enum(types).default(defaultType as any),
    company: cleanText().optional(),
    email: z.string().email().optional().or(z.literal('')),
    phone: phoneField('phone number'),
    mobile: phoneField('mobile number'),
    address: cleanText().optional(),
    city: cleanText().optional(),
    state: cleanText().optional(),
    zip: cleanText().optional(),
    source: cleanText().optional(),
    notes: cleanText().optional(),
    tags: z.array(cleanText()).optional(),
    ...(o.extraFields || {}),
  })

  const app = new Hono()
  app.use('*', authenticate)

  const findOwned = async (id: string, companyId: string) => {
    const [row] = await db.select().from(t.contact).where(and(eq(t.contact.id, id), eq(t.contact.companyId, companyId))).limit(1)
    return row
  }
  const normaliseBody = (body: any) => {
    if (body && typeof body.email === 'string') body.email = body.email.toLowerCase().trim()
    return body
  }

  // ---------------------------------------------------------------- list / stats
  app.get('/', requirePermission('contacts:read'), async (c) => {
    const currentUser = c.get('user') as any
    const type = c.req.query('type')
    const search = c.req.query('search')?.trim()
    const page = Math.max(1, parseInt(c.req.query('page') || '1', 10) || 1)
    const limit = Math.min(Math.max(1, parseInt(c.req.query('limit') || '25', 10) || 25), maxLimit)

    const conditions: any[] = [eq(t.contact.companyId, currentUser.companyId)]
    if (type) conditions.push(eq(t.contact.type, type))
    if (search) {
      conditions.push(or(
        ilike(t.contact.name, `%${search}%`),
        ilike(t.contact.email, `%${search}%`),
        ilike(t.contact.company, `%${search}%`),
        ilike(t.contact.phone, `%${search}%`),
      )!)
    }
    const where = and(...conditions)
    const [data, [{ value: total }]] = await Promise.all([
      db.select().from(t.contact).where(where).orderBy(desc(t.contact.createdAt)).offset((page - 1) * limit).limit(limit),
      db.select({ value: count() }).from(t.contact).where(where),
    ])
    return c.json({ data: data.map(stripPortal), pagination: { page, limit, total: Number(total), pages: Math.ceil(Number(total) / limit) } })
  })

  app.get('/stats', requirePermission('contacts:read'), async (c) => {
    const currentUser = c.get('user') as any
    const rows = await db.select({ type: t.contact.type }).from(t.contact).where(eq(t.contact.companyId, currentUser.companyId))
    const stats: Record<string, number> = { total: rows.length }
    for (const ty of types) stats[ty] = 0
    for (const r of rows) stats[r.type] = (stats[r.type] || 0) + 1
    return c.json(stats)
  })

  // ---------------------------------------------------------------- sites (field service / landscaping)
  if (o.sites) {
    const { site, equipment, job } = o.sites
    const siteSchema = z.object({
      name: cleanText(1),
      address: cleanText().optional(),
      city: cleanText().optional(),
      state: cleanText().optional(),
      zip: cleanText().optional(),
      accessNotes: cleanText().optional(),
    })
    const findSite = async (siteId: string, companyId: string) => {
      const [row] = await db.select().from(site).where(and(eq(site.id, siteId), eq(site.companyId, companyId))).limit(1)
      return row
    }

    app.get('/:id/sites', requirePermission('contacts:read'), async (c) => {
      const currentUser = c.get('user') as any
      const contactId = c.req.param('id')
      if (!(await findOwned(contactId, currentUser.companyId))) return c.json({ error: 'Contact not found' }, 404)
      const sites = await db.select().from(site).where(eq(site.contactId, contactId)).orderBy(asc(site.name))
      const enriched = await Promise.all(sites.map(async (s: any) => {
        const [eqCount] = await db.select({ value: count() }).from(equipment).where(eq(equipment.siteId, s.id))
        const [lastJob] = await db.select({ completedAt: job.completedAt }).from(job)
          .where(and(eq(job.siteId, s.id), eq(job.status, 'completed'))).orderBy(desc(job.completedAt)).limit(1)
        return { ...s, equipmentCount: Number(eqCount.value), lastServiceDate: lastJob?.completedAt || null }
      }))
      return c.json(enriched)
    })

    app.post('/:id/sites', requirePermission('contacts:create'), async (c) => {
      const currentUser = c.get('user') as any
      const contactId = c.req.param('id')
      const data = siteSchema.parse(await c.req.json())
      if (!(await findOwned(contactId, currentUser.companyId))) return c.json({ error: 'Contact not found' }, 404)
      const [newSite] = await db.insert(site).values({ ...data, companyId: currentUser.companyId, contactId }).returning()
      return c.json(newSite, 201)
    })

    app.get('/sites/:siteId', requirePermission('contacts:read'), async (c) => {
      const currentUser = c.get('user') as any
      const existing = await findSite(c.req.param('siteId'), currentUser.companyId)
      if (!existing) return c.json({ error: 'Site not found' }, 404)
      const [siteEquipment, siteJobs] = await Promise.all([
        db.select({
          id: equipment.id, name: equipment.name, manufacturer: equipment.manufacturer, model: equipment.model,
          serialNumber: equipment.serialNumber, status: equipment.status, location: equipment.location,
          purchaseDate: equipment.purchaseDate, warrantyExpiry: equipment.warrantyExpiry,
        }).from(equipment).where(eq(equipment.siteId, existing.id)),
        db.select({
          id: job.id, number: job.number, title: job.title, status: job.status,
          jobType: job.jobType, scheduledDate: job.scheduledDate, completedAt: job.completedAt,
        }).from(job).where(eq(job.siteId, existing.id)).orderBy(desc(job.scheduledDate)).limit(20),
      ])
      return c.json({ ...existing, equipment: siteEquipment, jobs: siteJobs })
    })

    app.put('/sites/:siteId', requirePermission('contacts:update'), async (c) => {
      const currentUser = c.get('user') as any
      const data = siteSchema.partial().parse(await c.req.json())
      const existing = await findSite(c.req.param('siteId'), currentUser.companyId)
      if (!existing) return c.json({ error: 'Site not found' }, 404)
      const [updated] = await db.update(site).set({ ...data, updatedAt: new Date() }).where(eq(site.id, existing.id)).returning()
      return c.json(updated)
    })

    app.delete('/sites/:siteId', requirePermission('contacts:delete'), async (c) => {
      const currentUser = c.get('user') as any
      const existing = await findSite(c.req.param('siteId'), currentUser.companyId)
      if (!existing) return c.json({ error: 'Site not found' }, 404)
      const [[eqCount], [jobCount]] = await Promise.all([
        db.select({ value: count() }).from(equipment).where(eq(equipment.siteId, existing.id)),
        db.select({ value: count() }).from(job).where(eq(job.siteId, existing.id)),
      ])
      if (Number(eqCount.value) > 0 || Number(jobCount.value) > 0) {
        return c.json({ error: 'Cannot delete a location with linked equipment or jobs. Reassign them first.' }, 409)
      }
      await db.delete(site).where(eq(site.id, existing.id))
      return c.body(null, 204)
    })
  }

  // ---------------------------------------------------------------- one contact
  app.get('/:id', requirePermission('contacts:read'), async (c) => {
    const currentUser = c.get('user') as any
    const id = c.req.param('id')
    const found = await findOwned(id, currentUser.companyId)
    if (!found) return c.json({ error: 'Contact not found' }, 404)
    const lists = await Promise.all(relations.map((r) => {
      let q = (r.columns ? db.select(r.columns) : db.select()).from(r.table).where(eq(r.column, id))
      if (r.orderBy) q = q.orderBy(r.orderBy)
      return q
    }))
    const out: any = stripPortal(found)
    relations.forEach((r, i) => { out[r.key] = lists[i] })
    return c.json(out)
  })

  app.post('/', requirePermission('contacts:create'), async (c) => {
    const currentUser = c.get('user') as any
    const body = normaliseBody(await c.req.json())
    const data: any = contactSchema.parse(body)

    if (duplicateCheck && !body.allowDuplicate) {
      const conds: any[] = []
      if (data.email) conds.push(sql`lower(${t.contact.email}) = ${data.email}`)
      const phones = [data.phone, data.mobile]
        .map((p: unknown) => String(p || '').replace(/\D/g, ''))
        .filter((p: string) => p.length >= 7)
        .map((p: string) => '%' + p.slice(-10))
      for (const p of phones) {
        conds.push(sql`regexp_replace(coalesce(${t.contact.phone}, ''), '\\D', '', 'g') like ${p}`)
        conds.push(sql`regexp_replace(coalesce(${t.contact.mobile}, ''), '\\D', '', 'g') like ${p}`)
      }
      if (conds.length) {
        const [dupe] = await db.select({ id: t.contact.id, name: t.contact.name }).from(t.contact)
          .where(and(eq(t.contact.companyId, currentUser.companyId), or(...conds))).limit(1)
        if (dupe) {
          return c.json({ error: `${dupe.name} already has this email or phone number. Open that record, or create this contact anyway.`, existingId: dupe.id, duplicate: true }, 409)
        }
      }
    }

    const [created] = await db.insert(t.contact).values({ ...data, companyId: currentUser.companyId }).returning()
    const safe = stripPortal(created)
    emitToCompany(currentUser.companyId, EVENTS.CONTACT_CREATED, safe)
    audit.log({ action: audit.ACTIONS.CREATE, entity: 'contact', entityId: created.id, entityName: created.name, req: c.req })
    return c.json(safe, 201)
  })

  app.put('/:id', requirePermission('contacts:update'), async (c) => {
    const currentUser = c.get('user') as any
    const id = c.req.param('id')
    const data = contactSchema.partial().parse(normaliseBody(await c.req.json()))
    const existing = await findOwned(id, currentUser.companyId)
    if (!existing) return c.json({ error: 'Contact not found' }, 404)
    const [updated] = await db.update(t.contact).set({ ...data, updatedAt: new Date() }).where(eq(t.contact.id, id)).returning()
    const safe = stripPortal(updated)
    emitToCompany(currentUser.companyId, EVENTS.CONTACT_UPDATED, safe)
    const changes = audit.diff(stripPortal(existing), safe)
    if (changes) audit.log({ action: audit.ACTIONS.UPDATE, entity: 'contact', entityId: updated.id, entityName: updated.name, changes, req: c.req })
    return c.json(safe)
  })

  app.delete('/:id', requirePermission('contacts:delete'), async (c) => {
    const currentUser = c.get('user') as any
    const id = c.req.param('id')
    const existing = await findOwned(id, currentUser.companyId)
    if (!existing) return c.json({ error: 'Contact not found' }, 404)

    // Never let a delete silently orphan financial / work records or destroy history. Count what is
    // attached and name it so the user can reassign first.
    const counts = await Promise.all(guards.map(async (g) => {
      const [{ value }] = await db.select({ value: count() }).from(g.table).where(eq(g.column, id))
      return Number(value)
    }))
    const hit = guards.map((g, i) => ({ g, n: counts[i] })).filter((x) => x.n > 0)
    if (hit.length) {
      const custom = hit.find((x) => x.g.message)
      if (custom) return c.json({ error: custom.g.message!(custom.n), [`${custom.g.label}Count`]: custom.n }, 409)
      const attached = hit.map(({ g, n }) => `${n} ${n === 1 ? g.label : (g.plural || g.label + 's')}`)
      return c.json({ error: `This contact still has ${attached.join(', ')} attached. Reassign or remove them before deleting the contact.` }, 409)
    }

    try {
      await db.delete(t.contact).where(eq(t.contact.id, id))
    } catch (e: any) {
      const blob = [e?.code, e?.message, e?.cause?.code, e?.cause?.message].filter(Boolean).join(' ')
      if (/23503|foreign key|violates foreign/i.test(blob)) {
        return c.json({ error: 'Cannot delete a contact with linked records. Remove or reassign those first.' }, 409)
      }
      throw e
    }
    emitToCompany(currentUser.companyId, EVENTS.CONTACT_DELETED, { id })
    audit.log({ action: audit.ACTIONS.DELETE, entity: 'contact', entityId: existing.id, entityName: existing.name, req: c.req })
    return c.body(null, 204)
  })

  app.post('/:id/convert', requirePermission('contacts:update'), async (c) => {
    const currentUser = c.get('user') as any
    const id = c.req.param('id')
    const existing = await findOwned(id, currentUser.companyId)
    if (!existing) return c.json({ error: 'Contact not found' }, 404)
    if (existing.type !== 'lead') return c.json({ error: 'Only leads can be converted' }, 400)
    const [updated] = await db.update(t.contact).set({ type: convertTo, updatedAt: new Date() }).where(eq(t.contact.id, id)).returning()
    const safe = stripPortal(updated)
    emitToCompany(currentUser.companyId, EVENTS.CONTACT_UPDATED, safe)
    audit.log({ action: audit.ACTIONS.STATUS_CHANGE, entity: 'contact', entityId: updated.id, entityName: updated.name, changes: { type: { old: 'lead', new: convertTo } }, req: c.req })
    return c.json(safe)
  })

  return app
}
