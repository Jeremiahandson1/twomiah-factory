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
import { normaliseState, normaliseZip, STATE_ERROR, ZIP_ERROR } from '../address'
import { checkFilter } from '../listFilter'
import { eq, ne, and, or, ilike, count, desc, asc, inArray, sql } from 'drizzle-orm'
import { repointContactReferences, mergePatch } from './mergeContacts'

/** Thrown inside the merge transaction when a locked row turned out to be gone, to roll it back. */
class MergeGone extends Error {}

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
  /**
   * The permission this list's own page asks — quotes:read, invoices:read. A seat without it is not handed the
   * list: every row links to a page that would refuse it, and the totals are money. (T62: "Field service
   * contact detail returns quote and invoice totals" to staff.) Needs `canSee`; without it the list is sent.
   */
  permission?: string
}

/** A table whose rows block deleting the contact they point at. */
export interface ContactGuard {
  /** The rows that hold the contact: `column` on `table` equals its id. Or `count`, for rows a step further away. */
  table?: any
  column?: any
  /** Counts the rows that hold this contact (or this site, as a site guard) when they are not a column away. */
  count?: (id: string) => Promise<number>
  /** singular noun used in the 409 message, e.g. 'invoice' → "2 invoices" */
  label: string
  plural?: string
  /** Optional full message override (vet: medical-history wording). Receives the row count. */
  message?: (n: number) => string
}

export interface ContactSitesTables {
  site: any; equipment: any; job: any
  /** What else holds a site (a landscaping route stop, a snow contract): counted before a site is deleted. */
  guards?: ContactGuard[]
}

/** How many rows a guard finds holding `id`. */
async function guardCount(db: any, g: ContactGuard, id: string): Promise<number> {
  if (g.count) return g.count(id)
  const [{ value }] = await db.select({ value: count() }).from(g.table).where(eq(g.column, id))
  return Number(value)
}

/** One contact's delete: done, or refused with the status and the body the single DELETE answers. */
export type ContactDeleteOutcome =
  | { deleted: true; contact: any }
  | { deleted: false; status: 404 | 409; body: { error: string; [k: string]: unknown } }

/**
 * THE ONE CONTACT-DELETE RULE, for every door that deletes a contact — the contact's own DELETE and the unified app's
 * bulk delete (salon live test, 2026-10-25: the bulk door deleted a salon client with appointments, visits and a
 * membership, which the single delete refuses, because it ran no guard at all). In order: the contact must be this
 * company's; every guard is counted and a hit refuses, naming what is attached (or in the guard's own words); then
 * `beforeDelete`, the delete, and what `beforeDelete` answered. A foreign-key refusal is the fallback 409.
 */
export function createContactDeleter(o: { db: any; contact: any; guards?: ContactGuard[]; beforeDelete?: ContactOptions['beforeDelete'] }) {
  const { db, contact } = o
  const guards = o.guards || []
  async function remove(companyId: string, id: string): Promise<ContactDeleteOutcome> {
    const [existing] = await db.select().from(contact).where(and(eq(contact.id, id), eq(contact.companyId, companyId))).limit(1)
    if (!existing) return { deleted: false, status: 404, body: { error: 'Contact not found' } }

    // Never let a delete silently orphan financial / work records or destroy history. Count what is
    // attached and name it so the user can reassign first.
    const counts = await Promise.all(guards.map((g) => guardCount(db, g, id)))
    const hit = guards.map((g, i) => ({ g, n: counts[i] })).filter((x) => x.n > 0)
    if (hit.length) {
      const custom = hit.find((x) => x.g.message)
      if (custom) return { deleted: false, status: 409, body: { error: custom.g.message!(custom.n), [`${custom.g.label}Count`]: custom.n } }
      const attached = hit.map(({ g, n }) => `${n} ${n === 1 ? g.label : (g.plural || g.label + 's')}`)
      return { deleted: false, status: 409, body: { error: `This contact still has ${attached.join(', ')} attached. Reassign or remove them before deleting the contact.` } }
    }

    // What the cascade takes that lives outside the database (ContactOptions.beforeDelete): read now, cleared after.
    const afterDelete = o.beforeDelete ? await o.beforeDelete(companyId, id) : undefined
    try {
      await db.delete(contact).where(and(eq(contact.id, id), eq(contact.companyId, companyId)))
    } catch (e: any) {
      const blob = [e?.code, e?.message, e?.cause?.code, e?.cause?.message].filter(Boolean).join(' ')
      if (/23503|foreign key|violates foreign/i.test(blob)) {
        return { deleted: false, status: 409, body: { error: 'Cannot delete a contact with linked records. Remove or reassign those first.' } }
      }
      throw e
    }
    afterDelete?.()
    return { deleted: true, contact: existing }
  }
  return { remove }
}
export type ContactDeleter = ReturnType<typeof createContactDeleter>


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
  /**
   * Run once the guards have passed and just before a contact is deleted; the function it answers runs after the delete
   * has gone through. For what the database's cascade takes with the contact that leaves something outside the
   * database — the unified app's salon visit photo files (crm/salon/visitPhotos.ts; salon live test, 2026-10-25).
   * Absent: nothing, as before.
   */
  beforeDelete?: (companyId: string, contactId: string) => Promise<(() => void) | void>
  /**
   * The contact-delete rule to use (createContactDeleter), when the app deletes contacts at another door too and both
   * must run the same guards. Given, it replaces `guards` and `beforeDelete` for the delete. Absent: built from them.
   */
  deleter?: { remove: (companyId: string, id: string) => Promise<ContactDeleteOutcome> }
}

export interface ContactDeps {
  db: any
  /** `company` holds the source choices (settings.leadSourceOptions); without it the defaults are served read-only. */
  tables: { contact: any; company?: any }
  authenticate: any
  requirePermission: (permission: string) => any
  emitToCompany: (companyId: string, event: string, data: any) => void
  EVENTS: { CONTACT_CREATED: string; CONTACT_UPDATED: string; CONTACT_DELETED: string }
  audit: { log: (entry: any) => any; diff: (before: any, after: any) => any; ACTIONS: Record<string, string> }
  /** the template's `cleanText(min)` zod helper (strips markup) */
  cleanText: (min?: number) => z.ZodTypeAny
  /** For the multi-line fields (notes, access notes): markup stripped, line breaks kept. Absent: cleanText. */
  cleanLines?: (min?: number) => z.ZodTypeAny
  /** May this person do X? (role list + per-user grants.) Decides which related lists a contact read carries. */
  canSee?: (role: string, permission: string, userId?: string) => Promise<boolean>
  /**
   * The contacts a seat without `contacts:read-all` reads: a condition on the contact table for that user — the customers
   * on the jobs assigned to them (Jobber's field seat). Not wired → every seat reads every contact.
   */
  ownContacts?: (userId: string) => any
  options?: ContactOptions
}

const PHONE_RE = /^[0-9+()\-.\s]+$/
/** Offered until a manager saves the company's own list. Neutral across verticals: every business gets referrals. */
/** The lists GET /api/contacts can be asked for by `audience`: 'customers' leaves vendors out (customer pickers). */
export const CONTACT_AUDIENCES = ['customers'] as const

export const DEFAULT_SOURCE_OPTIONS = ['Referral', 'Repeat customer', 'Website', 'Google', 'Facebook', 'Instagram', 'Walk-in']
/** Trimmed, blanks dropped, duplicates (ignoring case) dropped — first spelling wins. Never contains "Other": that is the form's own way out. */
export const cleanSourceOptions = (raw: unknown[]): string[] => {
  const seen = new Set<string>(), out: string[] = []
  for (const o of raw) {
    const v = String(o ?? '').trim().replace(/\s+/g, ' ')
    const k = v.toLowerCase()
    if (!v || k === 'other' || seen.has(k)) continue
    seen.add(k); out.push(v)
  }
  return out
}
export const isValidPhone = (v: unknown) => !v || (PHONE_RE.test(String(v)) && String(v).replace(/\D/g, '').length >= 7)
const phoneField = (what: string) => z.string().optional().nullable().refine(isValidPhone, { message: `Enter a valid ${what} (at least 7 digits)` })

/** The three lists every CRM shows on a contact: projects, quotes, invoices (whichever tables it has). */
export function standardRelations(t: { project?: any; quote?: any; invoice?: any; job?: any }): ContactRelation[] {
  const out: ContactRelation[] = []
  if (t.project) out.push({ key: 'projects', table: t.project, column: t.project.contactId, columns: { id: t.project.id, name: t.project.name, status: t.project.status } })
  if (t.quote) out.push({ key: 'quotes', table: t.quote, column: t.quote.contactId, columns: { id: t.quote.id, number: t.quote.number, total: t.quote.total, status: t.quote.status }, permission: 'quotes:read' })
  // dueDate and the amounts come too: the page derives "overdue" the same way every other surface does,
  // instead of printing the stored status. (T14 M17 / H10)
  if (t.invoice) out.push({ key: 'invoices', table: t.invoice, column: t.invoice.contactId, columns: { id: t.invoice.id, number: t.invoice.number, total: t.invoice.total, amountPaid: t.invoice.amountPaid, amountRefunded: t.invoice.amountRefunded, dueDate: t.invoice.dueDate, status: t.invoice.status }, permission: 'invoices:read' })
  // A contact's work, which the page counted and never listed: "Invoices 4" over a body showing quotes
  // only. (T14 M6)
  if (t.job) out.push({ key: 'jobs', table: t.job, column: t.job.contactId, columns: { id: t.job.id, number: t.job.number, title: t.job.title, status: t.job.status, scheduledDate: t.job.scheduledDate } })
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

/**
 * A contact row with the portal credential removed.
 *
 * `portalToken` is a BEARER CREDENTIAL: whoever holds it opens that customer's portal as the
 * customer — invoices, documents, and on the contractor template the page where change orders get
 * signed. It is not a field, it is a password, and the only places it belongs are the handler that
 * mints it and the handler that redeems it.
 *
 * This module has stripped it from every contact response since T22. It was exported in T42 because
 * the contact row leaves the server through more doors than this module: a vertical's own client
 * chart, an SMS conversation, a lead conversion, an agreement. Every one of those was handing out
 * the credential, and each had to be found separately because each had its own copy of "return the
 * row". One helper now, so the next door has something to call.
 */
export const withoutPortalCredential = (row: any) => {
  if (!row) return row
  const { portalToken, portalTokenExp, ...rest } = row
  return withoutPaymentInternals(rest)
}

/**
 * …and without the payment system's own identifiers. (T69: "contact records show Stripe customer IDs to the
 * viewer, and one contact also exposes the connected Stripe account ID (acct_…). Staff probably gets them too.")
 *
 * payments/stripe.ts keeps the customer it created in customFields — stripeCustomerId, and stripeCustomerAccount,
 * the connected account (acct_…) that customer lives on — so a saved card is found again next time. They are keys
 * into the shop's Stripe account, not facts about the customer: no screen reads them, and every contact response
 * handed them to whoever could open a contact. Stripped for EVERY seat; the payments module reads the row itself.
 * Nothing that saves a contact accepts customFields, so taking them out of the answer cannot wipe them.
 * Called through withoutPortalCredential, so every door that strips the credential strips these too.
 */
export const PAYMENT_INTERNAL_KEYS = ['stripeCustomerId', 'stripeCustomerAccount'] as const
export const withoutPaymentInternals = (row: any) => {
  if (!row || !row.customFields || typeof row.customFields !== 'object') return row
  const fields: Record<string, unknown> = { ...row.customFields }
  let changed = false
  for (const k of PAYMENT_INTERNAL_KEYS) if (k in fields) { delete fields[k]; changed = true }
  return changed ? { ...row, customFields: fields } : row
}

export function createContactRoutes(deps: ContactDeps) {
  const { db, tables: t, authenticate, requirePermission, emitToCompany, EVENTS, audit, cleanText } = deps
  const cleanLines = deps.cleanLines ?? cleanText
  const o = deps.options || {}
  const types = (o.types && o.types.length ? o.types : DEFAULT_CONTACT_TYPES) as [string, ...string[]]
  const defaultType = o.defaultType || 'lead'
  const convertTo = o.convertTo || 'client'
  const relations = o.relations || []
  // A caller that also deletes contacts elsewhere (the unified app's bulk door) passes its deleter, built from these same
  // guards; otherwise one is built here.
  const deleter = o.deleter || createContactDeleter({ db, contact: t.contact, guards: o.guards, beforeDelete: o.beforeDelete })
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
    // the only two contact fields with no checking at all — "VVVVV" and an 11-digit ZIP both saved (T12 L3)
    state: cleanText().optional().refine((v: unknown) => !v || normaliseState(v) !== null, { message: STATE_ERROR }).transform((v: unknown) => (v ? normaliseState(v)! : v)),
    zip: cleanText().optional().refine((v: unknown) => !v || normaliseZip(v) !== null, { message: ZIP_ERROR }).transform((v: unknown) => (v ? normaliseZip(v)! : v)),
    source: cleanText().optional(),
    notes: cleanLines().optional(),
    tags: z.array(cleanText()).optional(),
    ...(o.extraFields || {}),
  })

  const app = new Hono()
  app.use('*', authenticate)

  const findOwned = async (id: string, companyId: string) => {
    const [row] = await db.select().from(t.contact).where(and(eq(t.contact.id, id), eq(t.contact.companyId, companyId))).limit(1)
    return row
  }

  /**
   * The condition narrowing this seat to its own customers, or null for every contact (contacts:read-all). A crew login
   * was shown every customer's name (landscaping live retest, 2026-10-24). A failed check narrows (fails closed).
   */
  const ownScope = async (c: any): Promise<any | null> => {
    if (!deps.ownContacts || !deps.canSee) return null
    const u = c.get('user') as any
    let all = false
    try { all = await deps.canSee(u?.role, 'contacts:read-all', u?.userId) } catch { all = false }
    return all ? null : deps.ownContacts(String(u?.userId || ''))
  }
  // Every /:id door answers 404 for a contact outside the seat's own; a path word that is no contact id passes through.
  const ownContactOnly = async (c: any, next: any) => {
    const scope = await ownScope(c)
    if (scope) {
      const u = c.get('user') as any
      const id = c.req.param('id')
      const [exists] = await db.select({ id: t.contact.id }).from(t.contact).where(and(eq(t.contact.id, id), eq(t.contact.companyId, u.companyId))).limit(1)
      if (exists) {
        const [inScope] = await db.select({ id: t.contact.id }).from(t.contact).where(and(eq(t.contact.id, id), scope)).limit(1)
        if (!inScope) return c.json({ error: 'Contact not found' }, 404)
      }
    }
    await next()
  }
  app.use('/:id', ownContactOnly)
  app.use('/:id/*', ownContactOnly)
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

    // A type this CRM has no word for is a typo, not an empty page — and the words differ per vertical (the RV
    // dealership keeps 'customer' where the others keep 'client'), so the vocabulary is the same list that
    // governs writes rather than a second copy. (T29 N2)
    const badType = checkFilter(c, 'type', type, types)
    if (badType) return badType
    /**
     * ?audience=customers — WHO A CUSTOMER PICKER MAY OFFER: every contact but a vendor. A vendor is who the business
     * buys from, never who it quotes, invoices or sends to a job (the invoice route refuses one: vendor_not_client).
     * Asked of the server, not filtered after a page of 200, so suppliers never take a customer's place in the list.
     * (Live tests 2026-10-22: "Test Vendor Three" in the invoice Client dropdown.)
     */
    const audience = c.req.query('audience')
    const badAudience = checkFilter(c, 'audience', audience, CONTACT_AUDIENCES)
    if (badAudience) return badAudience
    const conditions: any[] = [eq(t.contact.companyId, currentUser.companyId)]
    if (type) conditions.push(eq(t.contact.type, type))
    if (audience === 'customers') conditions.push(ne(t.contact.type, 'vendor'))
    const scope = await ownScope(c)
    if (scope) conditions.push(scope)
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
      db.select().from(t.contact).where(where).orderBy(desc(t.contact.createdAt), asc(t.contact.id)).offset((page - 1) * limit).limit(limit),
      db.select({ value: count() }).from(t.contact).where(where),
    ])
    return c.json({ data: data.map(withoutPortalCredential), pagination: { page, limit, total: Number(total), pages: Math.ceil(Number(total) / limit) } })
  })

  /**
   * THE SOURCE CHOICES — a list managers keep, everyone picks from. (T63; owner's decision 2026-10-09)
   *
   *   "Anyone should be able to add a lead, but only managers should be able to add a source, like a dropdown …
   *    staff should be able to choose the lead source, and add an Other for one-offs, but not add actual lead
   *    source choices."
   *
   * contact.source stays free text: a one-off "Other" is written on that contact and never joins this list. The list
   * is company.settings.leadSourceOptions; until a manager saves one, the defaults below are offered. Read with
   * contacts:read (anybody who can open the form); written with leads:update — owners, admins and managers, the
   * same people who connect where leads come from on the Lead Sources page.
   */
  app.get('/source-options', requirePermission('contacts:read'), async (c) => {
    const currentUser = c.get('user') as any
    if (!t.company) return c.json({ options: DEFAULT_SOURCE_OPTIONS, isDefault: true })
    const [co] = await db.select({ settings: t.company.settings }).from(t.company).where(eq(t.company.id, currentUser.companyId)).limit(1)
    const saved = (co?.settings as any)?.leadSourceOptions
    return Array.isArray(saved) ? c.json({ options: cleanSourceOptions(saved), isDefault: false }) : c.json({ options: DEFAULT_SOURCE_OPTIONS, isDefault: true })
  })

  app.put('/source-options', requirePermission('leads:update'), async (c) => {
    const currentUser = c.get('user') as any
    if (!t.company) return c.json({ error: 'Source choices cannot be saved on this CRM.' }, 400)
    const body = await c.req.json().catch(() => ({}))
    if (!Array.isArray(body?.options)) return c.json({ error: 'Send the full list of source choices.', field: 'options' }, 400)
    const tooLong = body.options.find((o: unknown) => String(o ?? '').trim().length > 40)
    if (tooLong) return c.json({ error: `"${String(tooLong).trim().slice(0, 40)}…" is too long for a source — 40 characters at most.`, field: 'options' }, 400)
    const options = cleanSourceOptions(body.options)
    if (options.length > 50) return c.json({ error: 'That is more than 50 source choices — combine some, or use Other for the rare ones.', field: 'options' }, 400)
    // read-merge-write: the settings blob holds the plan and the money defaults too, and must keep them
    const [co] = await db.select({ settings: t.company.settings }).from(t.company).where(eq(t.company.id, currentUser.companyId)).limit(1)
    const before = (co?.settings as any)?.leadSourceOptions
    await db.update(t.company).set({ settings: { ...((co?.settings as any) || {}), leadSourceOptions: options } }).where(eq(t.company.id, currentUser.companyId))
    try { audit.log({ action: audit.ACTIONS.UPDATE, entity: 'company', entityId: currentUser.companyId, entityName: 'Lead source choices', changes: { leadSourceOptions: { old: before ?? null, new: options } }, req: c }) } catch { /* the save stands */ }
    return c.json({ options, isDefault: false })
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
    const { site, equipment, job, guards: siteGuards = [] } = o.sites
    const siteSchema = z.object({
      name: cleanText(1),
      address: cleanText().optional(),
      city: cleanText().optional(),
      state: cleanText().optional().refine((v: unknown) => !v || normaliseState(v) !== null, { message: STATE_ERROR }).transform((v: unknown) => (v ? normaliseState(v)! : v)),
      zip: cleanText().optional().refine((v: unknown) => !v || normaliseZip(v) !== null, { message: ZIP_ERROR }).transform((v: unknown) => (v ? normaliseZip(v)! : v)),
      accessNotes: cleanLines().optional(),
    })
    const findSite = async (siteId: string, companyId: string) => {
      const [row] = await db.select().from(site).where(and(eq(site.id, siteId), eq(site.companyId, companyId))).limit(1)
      return row
    }

    app.get('/:id/sites', requirePermission('contacts:read'), async (c) => {
      const currentUser = c.get('user') as any
      const contactId = c.req.param('id')
      if (!(await findOwned(contactId, currentUser.companyId))) return c.json({ error: 'Contact not found' }, 404)
      const sites = await db.select().from(site).where(eq(site.contactId, contactId)).orderBy(asc(site.name), asc(site.id))
      const enriched = await Promise.all(sites.map(async (s: any) => {
        const [eqCount] = await db.select({ value: count() }).from(equipment).where(eq(equipment.siteId, s.id))
        const [lastJob] = await db.select({ completedAt: job.completedAt }).from(job)
          .where(and(eq(job.siteId, s.id), eq(job.status, 'completed'))).orderBy(desc(job.completedAt), asc(job.id)).limit(1)
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
        }).from(job).where(eq(job.siteId, existing.id)).orderBy(desc(job.scheduledDate), asc(job.id)).limit(20),
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
      // A site's other holders (its cascade would take them silently): named, as the contact's guards are.
      const held = (await Promise.all(siteGuards.map(async (g) => ({ g, n: await guardCount(db, g, existing.id) })))).filter((x) => x.n > 0)
      if (held.length) {
        const attached = held.map(({ g, n }) => `${n} ${n === 1 ? g.label : (g.plural || g.label + 's')}`)
        return c.json({ error: `This location still has ${attached.join(', ')} attached. Remove them before deleting the location.` }, 409)
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
    // Only the lists this seat may open. (T62)
    const allowed = await Promise.all(relations.map(async (r) => {
      if (!r.permission || !deps.canSee) return true
      try { return await deps.canSee(currentUser?.role, r.permission, currentUser?.userId) } catch { return false }
    }))
    const visible = relations.filter((_, i) => allowed[i])
    const lists = await Promise.all(visible.map((r) => {
      let q = (r.columns ? db.select(r.columns) : db.select()).from(r.table).where(eq(r.column, id))
      if (r.orderBy) q = q.orderBy(r.orderBy)
      return q
    }))
    const out: any = withoutPortalCredential(found)
    visible.forEach((r, i) => { out[r.key] = lists[i] })
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
    const safe = withoutPortalCredential(created)
    emitToCompany(currentUser.companyId, EVENTS.CONTACT_CREATED, safe)
    audit.log({ action: audit.ACTIONS.CREATE, entity: 'contact', entityId: created.id, entityName: created.name, req: c })
    return c.json(safe, 201)
  })

  app.put('/:id', requirePermission('contacts:update'), async (c) => {
    const currentUser = c.get('user') as any
    const id = c.req.param('id')
    const body = normaliseBody(await c.req.json())
    const data = contactSchema.partial().parse(body)
    const existing = await findOwned(id, currentUser.companyId)
    if (!existing) return c.json({ error: 'Contact not found' }, 404)

    // Same duplicate guard as create, but scoped to the fields THIS edit changes and excluding this record —
    // editing a contact's email/phone to one another contact already owns was allowed (the guard was create-only).
    if (duplicateCheck && !body.allowDuplicate) {
      const conds: any[] = []
      if (data.email !== undefined && data.email) conds.push(sql`lower(${t.contact.email}) = ${data.email}`)
      const phones = [data.phone, data.mobile]
        .filter((p: unknown) => p !== undefined)
        .map((p: unknown) => String(p || '').replace(/\D/g, ''))
        .filter((p: string) => p.length >= 7)
        .map((p: string) => '%' + p.slice(-10))
      for (const p of phones) {
        conds.push(sql`regexp_replace(coalesce(${t.contact.phone}, ''), '\\D', '', 'g') like ${p}`)
        conds.push(sql`regexp_replace(coalesce(${t.contact.mobile}, ''), '\\D', '', 'g') like ${p}`)
      }
      if (conds.length) {
        const [dupe] = await db.select({ id: t.contact.id, name: t.contact.name }).from(t.contact)
          .where(and(eq(t.contact.companyId, currentUser.companyId), ne(t.contact.id, id), or(...conds))).limit(1)
        if (dupe) return c.json({ error: `${dupe.name} already has this email or phone number. Open that record, or save anyway.`, existingId: dupe.id, duplicate: true }, 409)
      }
    }

    const [updated] = await db.update(t.contact).set({ ...data, updatedAt: new Date() }).where(eq(t.contact.id, id)).returning()
    const safe = withoutPortalCredential(updated)
    emitToCompany(currentUser.companyId, EVENTS.CONTACT_UPDATED, safe)
    const changes = audit.diff(withoutPortalCredential(existing), safe)
    if (changes) audit.log({ action: audit.ACTIONS.UPDATE, entity: 'contact', entityId: updated.id, entityName: updated.name, changes, req: c })
    return c.json(safe)
  })

  app.delete('/:id', requirePermission('contacts:delete'), async (c) => {
    const currentUser = c.get('user') as any
    const id = c.req.param('id')
    // The one contact-delete rule (createContactDeleter): the bulk door runs the same.
    const out = await deleter.remove(currentUser.companyId, id)
    if (!out.deleted) return c.json(out.body, out.status)
    const existing = out.contact
    emitToCompany(currentUser.companyId, EVENTS.CONTACT_DELETED, { id })
    audit.log({ action: audit.ACTIONS.DELETE, entity: 'contact', entityId: existing.id, entityName: existing.name, req: c })
    return c.body(null, 204)
  })

  /**
   * POST /:id/merge  { duplicateId }
   *
   * `:id` is the contact that SURVIVES. The duplicate's records move onto it, the duplicate's
   * missing details are copied across, and the duplicate is deleted — all in one transaction, so
   * either every reference moved and the duplicate is gone, or nothing changed at all.
   *
   * The create and update routes above already refuse a duplicate email or phone with 409 +
   * existingId. Until now that was the end of the road: the user was told a duplicate exists and
   * given no way to resolve one that already did. (T32 M11)
   *
   * Gated on contacts:delete rather than contacts:update, because a merge deletes a contact. Anyone
   * who may not delete a contact may not delete one by calling it something else.
   */
  app.post('/:id/merge', requirePermission('contacts:delete'), async (c) => {
    const currentUser = c.get('user') as any
    const keepId = c.req.param('id')
    const body = await c.req.json().catch(() => ({}))
    const loseId = String(body?.duplicateId || '').trim()
    if (!loseId) return c.json({ error: 'Tell us which duplicate to merge in (duplicateId).' }, 400)
    if (loseId === keepId) return c.json({ error: 'A contact cannot be merged into itself.' }, 400)

    // Checked before the transaction so the two "not found" cases can say which one is missing.
    // Re-read under a lock inside it, because between here and there is where a race lives.
    if (!(await findOwned(keepId, currentUser.companyId))) return c.json({ error: 'Contact not found' }, 404)
    if (!(await findOwned(loseId, currentUser.companyId))) return c.json({ error: 'The duplicate contact was not found.' }, 404)

    let merged: any = null
    let summary: any = null
    try {
      await db.transaction(async (tx: any) => {
        // Both rows locked in one ordered statement. Two users merging the same pair in opposite
        // directions take the locks in the same sequence and one of them waits, instead of
        // deadlocking — and neither merge can run against a contact the other is deleting.
        const locked = await tx.select().from(t.contact)
          .where(and(inArray(t.contact.id, [keepId, loseId]), eq(t.contact.companyId, currentUser.companyId)))
          .orderBy(asc(t.contact.id)).for('update')
        const keeper = locked.find((r: any) => r.id === keepId)
        const loser = locked.find((r: any) => r.id === loseId)
        if (!keeper || !loser) throw new MergeGone()

        const repoint = await repointContactReferences(tx, { contactTable: t.contact, keepId, loseId })
        const patch = mergePatch(keeper, loser)
        const [updated] = await tx.update(t.contact).set({ ...patch, updatedAt: new Date() }).where(eq(t.contact.id, keepId)).returning()
        await tx.delete(t.contact).where(eq(t.contact.id, loseId))

        merged = updated
        summary = {
          kept: { id: keeper.id, name: keeper.name },
          absorbed: { id: loser.id, name: loser.name },
          movedRecords: repoint.moved,
          discardedRecords: repoint.discarded,
          moved: repoint.moves.filter((m) => m.moved > 0 || m.discarded > 0),
          fieldsFilled: Object.keys(patch).filter((k) => k !== 'notes'),
          // The duplicate's portal token dies with its row, so a client who bookmarked THAT link
          // loses it. The survivor's own token cannot be given up to keep it alive — that would
          // break the survivor's link instead — so the honest thing is to say it happened and let
          // the user re-send an invitation.
          portalLinkLost: !!loser.portalToken,
        }
      })
    } catch (e: any) {
      if (e instanceof MergeGone) return c.json({ error: 'One of those contacts was changed or deleted while the merge was running. Reload and try again.' }, 409)
      const blob = [e?.code, e?.message, e?.cause?.code, e?.cause?.message].filter(Boolean).join(' ')
      // A reference we could not move is the one outcome that must never be papered over: the
      // transaction has already rolled back, so say so rather than report a merge that did not happen.
      if (/23503|foreign key|violates foreign/i.test(blob)) {
        return c.json({ error: 'Some of the duplicate\'s records could not be moved, so nothing was merged. Please report this.' }, 409)
      }
      throw e
    }

    const safe = withoutPortalCredential(merged)
    emitToCompany(currentUser.companyId, EVENTS.CONTACT_UPDATED, safe)
    emitToCompany(currentUser.companyId, EVENTS.CONTACT_DELETED, { id: loseId })
    audit.log({ action: audit.ACTIONS.DELETE, entity: 'contact', entityId: summary.absorbed.id, entityName: `${summary.absorbed.name} (merged into ${summary.kept.name})`, req: c })
    audit.log({ action: audit.ACTIONS.UPDATE, entity: 'contact', entityId: keepId, entityName: safe.name, changes: { mergedFrom: { old: null, new: `${summary.absorbed.name} — ${summary.movedRecords} record(s) moved` } }, req: c })
    return c.json({ ...safe, merge: summary })
  })

  app.post('/:id/convert', requirePermission('contacts:update'), async (c) => {
    const currentUser = c.get('user') as any
    const id = c.req.param('id')
    const existing = await findOwned(id, currentUser.companyId)
    if (!existing) return c.json({ error: 'Contact not found' }, 404)
    if (existing.type !== 'lead') return c.json({ error: 'Only leads can be converted' }, 400)
    const [updated] = await db.update(t.contact).set({ type: convertTo, updatedAt: new Date() }).where(eq(t.contact.id, id)).returning()
    const safe = withoutPortalCredential(updated)
    emitToCompany(currentUser.companyId, EVENTS.CONTACT_UPDATED, safe)
    audit.log({ action: audit.ACTIONS.STATUS_CHANGE, entity: 'contact', entityId: updated.id, entityName: updated.name, changes: { type: { old: 'lead', new: convertTo } }, req: c })
    return c.json(safe)
  })

  return app
}
