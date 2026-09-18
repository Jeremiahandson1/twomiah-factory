// Lead Inbox — inbound leads from marketplaces / ads / booking apps / website forms, ONE implementation for every CRM.
// The template injects its tables, middleware and socket/audit services; the vertical decides which platforms it
// offers (options.platforms) and what a converted lead becomes (options.contactType).
//
// Two public inbound doors, both unauthenticated by nature and therefore locked differently:
//   POST /inbound/email            — lead-source email. The address handed out is
//                                    {factoryTenantId-without-dashes}-leads-{platform}@{parse hostname}
//                                    (default parse.twomiah.com: MX → SendGrid Inbound Parse → Factory /inbound-parse/:secret,
//                                    the same path the branded-email aliases use). The Factory reads the tenant from the
//                                    local part and posts {platform, from, subject, text, html} here with X-Factory-Key
//                                    (FACTORY_SYNC_KEY). Before: addresses were on inbound.twomiah.com, which has no DNS.
//   POST /inbound/webhook/:source  — Zapier / Make / any platform webhook. Locked with the per-source secret
//                                    (?secret= or x-webhook-secret). Before: a missing secret fell back to
//                                    ?company_id=… and accepted the lead — anyone could inject leads.
// Also fixed here: source platform validated against the vertical's list (was free text, duplicates allowed), lead
// status validated (any string was stored; "converted" could be set without a contact), convert links an existing
// contact with the same email/phone instead of creating a duplicate and refuses a second convert, list paging clamped,
// form-encoded / non-JSON webhook bodies handled instead of 500.
import { Hono } from 'hono'
import { z } from 'zod'
import { eq, and, or, ilike, count, desc, gte, sql } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import crypto from 'crypto'

export interface LeadsTables { lead: any; leadSource: any; contact: any }
export interface LeadsOptions {
  /** Platform ids this vertical offers on the Lead Sources page. Create refuses anything else. Default: the trades set. */
  platforms?: string[]
  /** Parse hostname the lead addresses live on. Default INBOUND_PARSE_HOSTNAME env, else parse.twomiah.com (MX → SendGrid Inbound Parse → Factory /inbound-parse → here). */
  inboundDomain?: string
  /** Contact type a converted lead is created with. Default 'lead'. */
  contactType?: string
  /** Max page size for the inbox list. Default 100. */
  maxLimit?: number
}
export interface LeadsDeps {
  db: any
  tables: LeadsTables
  authenticate: any
  requirePermission: (permission: string) => any
  emitToCompany: (companyId: string, event: string, data: any) => void
  EVENTS: { LEAD_CREATED: string; LEAD_UPDATED: string; CONTACT_CREATED: string }
  audit: { log: (entry: any) => any }
  /** process.env by default: TENANT_ID (Factory tenant id → inbound prefix), FACTORY_SYNC_KEY (X-Factory-Key), FRONTEND_URL. */
  env?: Record<string, string | undefined>
  options?: LeadsOptions
}

export const TRADES_LEAD_PLATFORMS = ['angi', 'homeadvisor', 'thumbtack', 'google_lsa', 'houzz']
export const LEAD_STATUSES = ['new', 'contacted', 'converted', 'dismissed'] as const
/** Statuses a user may set directly; 'converted' only ever comes from POST /:id/convert (it creates/links the contact). */
const SETTABLE_STATUSES = ['new', 'contacted', 'dismissed'] as const
const PLATFORM_RE = /^[a-z][a-z0-9_]{1,30}$/

const safeEqual = (a: string, b: string) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b))
const clampInt = (v: unknown, min: number, max: number, dflt: number) => { const n = parseInt(String(v ?? ''), 10); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : dflt }
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (ch) => '\\' + ch)
const clip = (v: unknown, n: number) => { const s = v == null ? '' : String(v).trim(); return s ? s.slice(0, n) : undefined }
const digits = (v: unknown) => String(v || '').replace(/\D/g, '')

/** JSON or form-encoded body → plain object; null when unparseable. Webhook senders (Zapier, Make, form builders) send either. */
export async function readInboundBody(c: any): Promise<Record<string, any> | null> {
  const ct = String(c.req.header('content-type') || '').toLowerCase()
  if (ct.includes('multipart/form-data') || ct.includes('application/x-www-form-urlencoded')) {
    const fd = await c.req.parseBody().catch(() => null)
    if (!fd) return null
    const out: Record<string, any> = {}
    for (const [k, v] of Object.entries(fd)) if (typeof v === 'string') out[k] = v
    return out
  }
  const raw = await c.req.text().catch(() => '')
  if (!raw.trim()) return {}
  try { const j = JSON.parse(raw); return j && typeof j === 'object' && !Array.isArray(j) ? j : null } catch { return null }
}

export function createLeadsRoutes(deps: LeadsDeps) {
  const { db, tables: t, authenticate, requirePermission, emitToCompany, EVENTS, audit } = deps
  const env = deps.env || process.env
  const platforms = deps.options?.platforms || TRADES_LEAD_PLATFORMS
  const inboundDomain = deps.options?.inboundDomain || env.INBOUND_PARSE_HOSTNAME || 'parse.twomiah.com'
  const contactType = deps.options?.contactType || 'lead'
  const maxLimit = deps.options?.maxLimit || 100
  const app = new Hono()

  // The Factory's /inbound-parse router identifies the tenant from the full FACTORY tenant id (dashes stripped, 32 hex).
  // Falls back to the company id only where TENANT_ID is unset (local dev) — there the Factory isn't in the path anyway.
  const inboundTenantKey = (companyId: string) => String(env.TENANT_ID || companyId).replace(/-/g, '').toLowerCase()
  const inboundAddress = (companyId: string, platform: string) => `${inboundTenantKey(companyId)}-leads-${platform}@${inboundDomain}`
  // Build from FRONTEND_URL (https, real host). c.req.url is http:// behind Render's TLS-terminating proxy.
  const webhookBase = (c: any) => String(env.FRONTEND_URL || c.req.url.replace(/\/api\/leads\/.*$/, '')).replace(/\/+$/, '').replace(/^http:\/\//, 'https://')
  const webhookUrlFor = (c: any, platform: string) => `${webhookBase(c)}/api/leads/inbound/webhook/${platform}`

  const storeLead = async (source: any, platform: string, parsed: ParsedLead, rawPayload: any) => {
    const [row] = await db.insert(t.lead).values({
      id: createId(),
      sourcePlatform: platform,
      sourceId: source.id,
      homeownerName: clip(parsed.name, 200) || 'Unknown',
      email: clip(parsed.email, 320),
      phone: clip(parsed.phone, 50),
      jobType: clip(parsed.jobType, 200),
      location: clip(parsed.location, 300),
      budget: clip(parsed.budget, 100),
      description: clip(parsed.description, 5000),
      status: 'new',
      rawPayload,
      receivedAt: new Date(),
      companyId: source.companyId,
    }).returning()
    emitToCompany(source.companyId, EVENTS.LEAD_CREATED, { id: row.id, sourcePlatform: platform, homeownerName: row.homeownerName })
    return row
  }

  // ─── Public inbound endpoints ───────────────────────────────────────────────

  app.post('/inbound/email', async (c) => {
    const key = env.FACTORY_SYNC_KEY
    if (!key) return c.json({ error: 'Inbound email not configured' }, 503)
    const got = c.req.header('X-Factory-Key') || ''
    if (!safeEqual(got, key)) return c.json({ error: 'Unauthorized' }, 401)
    const body = await readInboundBody(c)
    if (!body) return c.json({ error: 'Invalid body' }, 400)
    // The Factory already resolved the tenant from the recipient address; this backend holds one company.
    const platform = String(body.platform || '')
    if (!PLATFORM_RE.test(platform)) return c.json({ error: 'Invalid lead platform' }, 400)
    const [source] = await db.select().from(t.leadSource)
      .where(and(eq(t.leadSource.platform, platform), eq(t.leadSource.enabled, true))).limit(1)
    if (!source) return c.json({ error: 'Source not found or disabled' }, 404)
    const parsed = parseLeadEmail(platform, String(body.subject || ''), String(body.text || ''), String(body.html || ''))
    const row = await storeLead(source, platform, parsed, body)
    return c.json({ success: true, leadId: row.id }, 201)
  })

  app.post('/inbound/webhook/:source', async (c) => {
    const platform = c.req.param('source')
    const secret = String(c.req.header('x-webhook-secret') || c.req.query('secret') || '')
    if (!secret) return c.json({ error: 'Missing webhook secret (send ?secret= or the x-webhook-secret header — both are on the Lead Sources page)' }, 401)
    const [source] = await db.select().from(t.leadSource)
      .where(and(eq(t.leadSource.platform, platform), eq(t.leadSource.webhookSecret, secret))).limit(1)
    if (!source || !source.enabled) return c.json({ error: 'Source not found or disabled' }, 404)
    const body = await readInboundBody(c)
    if (!body) return c.json({ error: 'Body must be JSON or form-encoded' }, 400)
    const parsed = parseWebhookPayload(platform, body)
    const row = await storeLead(source, platform, parsed, body)
    return c.json({ success: true, leadId: row.id }, 201)
  })

  // ─── Authenticated ──────────────────────────────────────────────────────────
  app.use('*', authenticate)

  const sourceCreateSchema = z.object({
    platform: z.string().trim().regex(PLATFORM_RE, 'Invalid platform'),
    label: z.string().trim().max(80).optional(),
    config: z.record(z.any()).optional(),
  })
  const sourceUpdateSchema = z.object({
    label: z.string().trim().min(1).max(80).optional(),
    enabled: z.boolean().optional(),
    config: z.record(z.any()).optional(),
  })
  const stripTags = (s: string) => s.replace(/<[^>]*>/g, '').trim()

  app.get('/sources', requirePermission('contacts:read'), async (c) => {
    const currentUser = (c as any).get('user')
    const sources = await db.select().from(t.leadSource)
      .where(eq(t.leadSource.companyId, currentUser.companyId))
      .orderBy(desc(t.leadSource.createdAt))
    // Self-heal the addresses we hand out: rows created before the tenant-id prefix fix (or before FRONTEND_URL /
    // a custom domain was set) still carry values that can't route. Recompute and persist so the page shows the truth.
    for (const s of sources) {
      const wantEmail = inboundAddress(s.companyId, s.platform)
      const wantHook = webhookUrlFor(c, s.platform)
      if (s.inboundEmail !== wantEmail || s.webhookUrl !== wantHook) {
        await db.update(t.leadSource).set({ inboundEmail: wantEmail, webhookUrl: wantHook, updatedAt: new Date() }).where(eq(t.leadSource.id, s.id))
        s.inboundEmail = wantEmail; s.webhookUrl = wantHook
      }
    }
    return c.json({ data: sources })
  })

  app.post('/sources', requirePermission('contacts:create'), async (c) => {
    const currentUser = (c as any).get('user')
    const parsed = sourceCreateSchema.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) return c.json({ error: parsed.error.errors[0]?.message || 'Invalid source' }, 400)
    const { platform, config } = parsed.data
    // Say which ones there are — "Unknown lead source" left the user guessing what to type. (Landscaping T21 L6)
    if (!platforms.includes(platform)) return c.json({ error: `"${platform}" is not a lead source we connect to. Choose one of: ${platforms.join(', ')}.`, platforms }, 400)
    const [dupe] = await db.select({ id: t.leadSource.id }).from(t.leadSource)
      .where(and(eq(t.leadSource.companyId, currentUser.companyId), eq(t.leadSource.platform, platform))).limit(1)
    if (dupe) return c.json({ error: 'This lead source is already connected', existingId: dupe.id }, 409)
    const label = stripTags(parsed.data.label || '') || platform
    const [source] = await db.insert(t.leadSource).values({
      id: createId(),
      platform,
      label,
      inboundEmail: inboundAddress(currentUser.companyId, platform),
      webhookUrl: webhookUrlFor(c, platform),
      webhookSecret: createId(),
      enabled: true,
      config: config || {},
      companyId: currentUser.companyId,
    }).returning()
    await audit.log({ action: 'create', entity: 'lead_source', entityId: source.id, metadata: { platform, label }, req: { user: currentUser } })
    return c.json(source, 201)
  })

  app.put('/sources/:id', requirePermission('contacts:update'), async (c) => {
    const currentUser = (c as any).get('user')
    const id = c.req.param('id')
    const parsed = sourceUpdateSchema.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) return c.json({ error: parsed.error.errors[0]?.message || 'Invalid update' }, 400)
    const [existing] = await db.select().from(t.leadSource)
      .where(and(eq(t.leadSource.id, id), eq(t.leadSource.companyId, currentUser.companyId))).limit(1)
    if (!existing) return c.json({ error: 'Source not found' }, 404)
    const updates: any = { updatedAt: new Date() }
    if (parsed.data.label !== undefined) updates.label = stripTags(parsed.data.label) || existing.label
    if (parsed.data.enabled !== undefined) updates.enabled = parsed.data.enabled
    if (parsed.data.config !== undefined) updates.config = parsed.data.config
    const [updated] = await db.update(t.leadSource).set(updates).where(eq(t.leadSource.id, id)).returning()
    return c.json(updated)
  })

  app.delete('/sources/:id', requirePermission('contacts:delete'), async (c) => {
    const currentUser = (c as any).get('user')
    const id = c.req.param('id')
    const [existing] = await db.select().from(t.leadSource)
      .where(and(eq(t.leadSource.id, id), eq(t.leadSource.companyId, currentUser.companyId))).limit(1)
    if (!existing) return c.json({ error: 'Source not found' }, 404)
    await db.delete(t.leadSource).where(eq(t.leadSource.id, id)) // lead.sourceId is ON DELETE SET NULL — leads are kept
    await audit.log({ action: 'delete', entity: 'lead_source', entityId: id, metadata: { platform: existing.platform, label: existing.label }, req: { user: currentUser } })
    return c.json({ success: true })
  })

  // ─── Lead inbox ─────────────────────────────────────────────────────────────

  app.get('/', requirePermission('contacts:read'), async (c) => {
    const currentUser = (c as any).get('user')
    const status = c.req.query('status') || ''
    const source = (c.req.query('source') || '').slice(0, 40)
    const search = (c.req.query('search') || '').trim().slice(0, 100)
    const page = clampInt(c.req.query('page'), 1, 1_000_000, 1)
    const limit = clampInt(c.req.query('limit'), 1, maxLimit, 25)
    if (status && !(LEAD_STATUSES as readonly string[]).includes(status)) return c.json({ error: 'Invalid status filter' }, 400)

    const conditions: any[] = [eq(t.lead.companyId, currentUser.companyId)]
    if (status) conditions.push(eq(t.lead.status, status))
    if (source) conditions.push(eq(t.lead.sourcePlatform, source))
    if (search) {
      const p = `%${escapeLike(search)}%`
      conditions.push(or(ilike(t.lead.homeownerName, p), ilike(t.lead.email, p), ilike(t.lead.phone, p), ilike(t.lead.jobType, p), ilike(t.lead.location, p))!)
    }
    const where = and(...conditions)
    const [data, [{ value: total }]] = await Promise.all([
      db.select().from(t.lead).where(where).orderBy(desc(t.lead.receivedAt)).offset((page - 1) * limit).limit(limit),
      db.select({ value: count() }).from(t.lead).where(where),
    ])
    return c.json({ data, pagination: { page, limit, total: Number(total), pages: Math.max(1, Math.ceil(Number(total) / limit)) } })
  })

  app.get('/stats', requirePermission('contacts:read'), async (c) => {
    const currentUser = (c as any).get('user')
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    const leads = await db.select({ sourcePlatform: t.lead.sourcePlatform, status: t.lead.status, receivedAt: t.lead.receivedAt, contactedAt: t.lead.contactedAt })
      .from(t.lead).where(and(eq(t.lead.companyId, currentUser.companyId), gte(t.lead.receivedAt, thirtyDaysAgo)))

    const bySource: Record<string, { total: number; converted: number; totalResponseMs: number; respondedCount: number }> = {}
    for (const l of leads) {
      const s = (bySource[l.sourcePlatform] ||= { total: 0, converted: 0, totalResponseMs: 0, respondedCount: 0 })
      s.total++
      if (l.status === 'converted') s.converted++
      if (l.contactedAt && l.receivedAt) { s.totalResponseMs += new Date(l.contactedAt).getTime() - new Date(l.receivedAt).getTime(); s.respondedCount++ }
    }
    const stats = Object.entries(bySource).map(([platform, s]) => ({
      platform,
      leadsReceived: s.total,
      conversionRate: s.total > 0 ? Math.round((s.converted / s.total) * 100) : 0,
      avgResponseTimeMin: s.respondedCount > 0 ? Math.round(s.totalResponseMs / s.respondedCount / 60000) : null,
    }))
    const totals = {
      total: leads.length,
      new: leads.filter((l: any) => l.status === 'new').length,
      contacted: leads.filter((l: any) => l.status === 'contacted').length,
      converted: leads.filter((l: any) => l.status === 'converted').length,
      dismissed: leads.filter((l: any) => l.status === 'dismissed').length,
    }
    return c.json({ stats, totals })
  })

  const ownLead = async (id: string, companyId: string) => {
    const [row] = await db.select().from(t.lead).where(and(eq(t.lead.id, id), eq(t.lead.companyId, companyId))).limit(1)
    return row
  }

  app.put('/:id/status', requirePermission('contacts:update'), async (c) => {
    const currentUser = (c as any).get('user')
    const id = c.req.param('id')
    const parsed = z.object({ status: z.enum(SETTABLE_STATUSES) }).safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) return c.json({ error: `Status must be one of ${SETTABLE_STATUSES.join(', ')} (use Convert to mark a lead converted)` }, 400)
    const existing = await ownLead(id, currentUser.companyId)
    if (!existing) return c.json({ error: 'Lead not found' }, 404)
    const updates: any = { status: parsed.data.status, updatedAt: new Date() }
    if (parsed.data.status === 'contacted' && !existing.contactedAt) updates.contactedAt = new Date()
    const [updated] = await db.update(t.lead).set(updates).where(eq(t.lead.id, id)).returning()
    emitToCompany(currentUser.companyId, EVENTS.LEAD_UPDATED, { id, status: updated.status })
    return c.json(updated)
  })

  app.post('/:id/convert', requirePermission('contacts:create'), async (c) => {
    const currentUser = (c as any).get('user')
    const id = c.req.param('id')
    const existing = await ownLead(id, currentUser.companyId)
    if (!existing) return c.json({ error: 'Lead not found' }, 404)

    if (existing.status === 'converted' && existing.convertedContactId) {
      const [already] = await db.select().from(t.contact).where(and(eq(t.contact.id, existing.convertedContactId), eq(t.contact.companyId, currentUser.companyId))).limit(1)
      if (already) return c.json({ error: `Already converted to ${already.name}`, contactId: already.id, lead: existing, contact: already }, 409)
    }

    // Link an existing contact with the same email / phone instead of creating a duplicate (same rule the contacts module enforces).
    const conds: any[] = []
    const email = clip(existing.email, 320)?.toLowerCase()
    if (email) conds.push(sql`lower(${t.contact.email}) = ${email}`)
    const d = digits(existing.phone)
    if (d.length >= 7) {
      const p = '%' + d.slice(-10)
      conds.push(sql`regexp_replace(coalesce(${t.contact.phone}, ''), '\\D', '', 'g') like ${p}`)
      conds.push(sql`regexp_replace(coalesce(${t.contact.mobile}, ''), '\\D', '', 'g') like ${p}`)
    }
    let contactRow: any = null
    if (conds.length) {
      const [match] = await db.select().from(t.contact).where(and(eq(t.contact.companyId, currentUser.companyId), or(...conds))).orderBy(desc(t.contact.createdAt)).limit(1)
      contactRow = match || null
    }
    const matched = !!contactRow
    if (!contactRow) {
      const [created] = await db.insert(t.contact).values({
        id: createId(),
        name: existing.homeownerName,
        email: existing.email || undefined,
        phone: existing.phone || undefined,
        address: existing.location || undefined,
        source: existing.sourcePlatform,
        type: contactType,
        notes: `Converted from ${existing.sourcePlatform} lead. Job type: ${existing.jobType || 'N/A'}. Budget: ${existing.budget || 'N/A'}. Description: ${existing.description || 'N/A'}`,
        companyId: currentUser.companyId,
      }).returning()
      contactRow = created
    }

    await db.update(t.lead).set({ status: 'converted', convertedContactId: contactRow.id, updatedAt: new Date() }).where(eq(t.lead.id, id))
    await audit.log({ action: 'status_change', entity: 'lead', entityId: id, metadata: { contactId: contactRow.id, matched }, req: { user: currentUser } })
    emitToCompany(currentUser.companyId, EVENTS.LEAD_UPDATED, { id, status: 'converted', contactId: contactRow.id })
    if (!matched) emitToCompany(currentUser.companyId, EVENTS.CONTACT_CREATED, { id: contactRow.id, name: contactRow.name })
    return c.json({ lead: { ...existing, status: 'converted', convertedContactId: contactRow.id }, contact: contactRow, matched })
  })

  app.delete('/:id', requirePermission('contacts:delete'), async (c) => {
    const currentUser = (c as any).get('user')
    const id = c.req.param('id')
    const existing = await ownLead(id, currentUser.companyId)
    if (!existing) return c.json({ error: 'Lead not found' }, 404)
    await db.delete(t.lead).where(eq(t.lead.id, id))
    await audit.log({ action: 'delete', entity: 'lead', entityId: id, metadata: { homeownerName: existing.homeownerName, sourcePlatform: existing.sourcePlatform }, req: { user: currentUser } })
    emitToCompany(currentUser.companyId, EVENTS.LEAD_UPDATED, { id, deleted: true })
    return c.json({ success: true })
  })

  return app
}

// ─── Parsers ─────────────────────────────────────────────────────────────────
// Platform-specific shapes for the trades marketplaces; everything else (Google Business Profile, Meta, Yelp,
// booking apps, website forms, RV Trader, The Knot…) goes through the generic label-based parser.

export interface ParsedLead {
  name?: string
  email?: string
  phone?: string
  jobType?: string
  location?: string
  budget?: string
  description?: string
}

const pick = (m: RegExpMatchArray | null | undefined) => m?.[1]?.trim() || undefined

export function parseLeadEmail(platform: string, subject: string, text: string, html: string): ParsedLead {
  const content = text || html?.replace(/<[^>]+>/g, ' ') || ''
  switch (platform) {
    case 'angi': return parseAngiEmail(subject, content)
    case 'homeadvisor': return parseHomeAdvisorEmail(subject, content)
    case 'thumbtack': return parseThumbtackEmail(subject, content)
    case 'google_lsa': return parseGoogleLSAEmail(subject, content)
    case 'houzz': return parseHouzzEmail(subject, content)
    default: return parseGenericEmail(subject, content)
  }
}

function parseAngiEmail(subject: string, content: string): ParsedLead {
  // Angi emails: "New Lead from Angi: John Smith - Bathroom Remodel"
  return {
    name: pick(content.match(/(?:Customer|Homeowner|Name)[:\s]+([^\n]+)/i)),
    phone: pick(content.match(/(?:Phone|Tel)[:\s]+([\d\-\(\)\s\+]+)/i)),
    email: pick(content.match(/(?:Email)[:\s]+([^\s\n]+@[^\s\n]+)/i)),
    jobType: pick(subject.match(/[-–]\s*(.+)$/) || content.match(/(?:Service|Project|Job)[:\s]+([^\n]+)/i)),
    location: pick(content.match(/(?:Location|Address|City)[:\s]+([^\n]+)/i)),
    description: pick(content.match(/(?:Description|Details|Notes)[:\s]+([^\n]+(?:\n[^\n]+)*)/i)),
  }
}

function parseHomeAdvisorEmail(_subject: string, content: string): ParsedLead {
  return {
    name: pick(content.match(/(?:Customer|Homeowner|Name)[:\s]+([^\n]+)/i)),
    phone: pick(content.match(/(?:Phone|Tel)[:\s]+([\d\-\(\)\s\+]+)/i)),
    email: pick(content.match(/(?:Email)[:\s]+([^\s\n]+@[^\s\n]+)/i)),
    jobType: pick(content.match(/(?:Task|Service|Category)[:\s]+([^\n]+)/i)),
    location: pick(content.match(/(?:Location|Address|Zip)[:\s]+([^\n]+)/i)),
    budget: pick(content.match(/(?:Budget|Estimated Cost)[:\s]+([^\n]+)/i)),
    description: pick(content.match(/(?:Description|Details)[:\s]+([^\n]+(?:\n[^\n]+)*)/i)),
  }
}

function parseThumbtackEmail(subject: string, content: string): ParsedLead {
  // Thumbtack: "New request from John S. - Plumbing Repair"
  const subjectName = subject.match(/from\s+(.+?)(?:\s*[-–]|$)/i)
  return {
    name: pick(content.match(/(?:Customer|Name)[:\s]+([^\n]+)/i) || subjectName),
    phone: pick(content.match(/(?:Phone|Tel)[:\s]+([\d\-\(\)\s\+]+)/i)),
    email: pick(content.match(/(?:Email)[:\s]+([^\s\n]+@[^\s\n]+)/i)),
    jobType: pick(subject.match(/[-–]\s*(.+)$/) || content.match(/(?:Service|Request|Project)[:\s]+([^\n]+)/i)),
    location: pick(content.match(/(?:Location|Zip|Area)[:\s]+([^\n]+)/i)),
    budget: pick(content.match(/(?:Budget|Price Range)[:\s]+([^\n]+)/i)),
    description: pick(content.match(/(?:Details|Description|Message)[:\s]+([^\n]+(?:\n[^\n]+)*)/i)),
  }
}

function parseGoogleLSAEmail(_subject: string, content: string): ParsedLead {
  return {
    name: pick(content.match(/(?:Customer|Name)[:\s]+([^\n]+)/i)),
    phone: pick(content.match(/(?:Phone|Tel)[:\s]+([\d\-\(\)\s\+]+)/i)),
    jobType: pick(content.match(/(?:Service|Category|Job Type)[:\s]+([^\n]+)/i)),
    location: pick(content.match(/(?:Location|Zip|City)[:\s]+([^\n]+)/i)),
  }
}

function parseHouzzEmail(_subject: string, content: string): ParsedLead {
  return {
    name: pick(content.match(/(?:From|Name|Homeowner)[:\s]+([^\n]+)/i)),
    email: pick(content.match(/(?:Email)[:\s]+([^\s\n]+@[^\s\n]+)/i)),
    phone: pick(content.match(/(?:Phone|Tel)[:\s]+([\d\-\(\)\s\+]+)/i)),
    description: pick(content.match(/(?:Message|Description|Details)[:\s]+([^\n]+(?:\n[^\n]+)*)/i)),
    location: pick(content.match(/(?:Location|City|Address)[:\s]+([^\n]+)/i)),
  }
}

function parseGenericEmail(subject: string, content: string): ParsedLead {
  return {
    name: pick(content.match(/(?:Name|Customer|Client|From)[:\s]+([^\n]+)/i)) || pick(subject.match(/from\s+(.+?)(?:\s*[-–]|$)/i)),
    phone: pick(content.match(/(?:Phone|Tel|Mobile)[:\s]+([\d\-\(\)\s\+]+)/i)),
    email: pick(content.match(/(?:Email)[:\s]+([^\s\n]+@[^\s\n]+)/i)),
    jobType: pick(content.match(/(?:Service|Interested in|Request|Subject)[:\s]+([^\n]+)/i)),
    location: pick(content.match(/(?:Location|Address|City|Zip)[:\s]+([^\n]+)/i)),
    description: pick(content.match(/(?:Message|Details|Description|Notes)[:\s]+([^\n]+(?:\n[^\n]+)*)/i)),
  }
}

export function parseWebhookPayload(platform: string, body: any): ParsedLead {
  switch (platform) {
    case 'angi':
      return { name: body.customer_name || body.name, email: body.customer_email || body.email, phone: body.customer_phone || body.phone, jobType: body.service_type || body.category, location: body.zip_code || body.location || body.city, budget: body.budget, description: body.description || body.details }
    case 'homeadvisor':
      return { name: body.leadName || body.consumerName, email: body.leadEmail || body.consumerEmail, phone: body.leadPhone || body.consumerPhone, jobType: body.taskName || body.serviceName, location: body.zip || body.city, budget: body.estimatedBudget, description: body.description }
    case 'thumbtack':
      return { name: body.customer?.name || body.request?.customer_name, email: body.customer?.email, phone: body.customer?.phone, jobType: body.request?.category || body.category, location: body.request?.location || body.zip_code, budget: body.request?.budget, description: body.request?.details || body.description }
    case 'google_lsa':
      return { name: body.lead?.customer_name || body.customerName, phone: body.lead?.phone_number || body.phoneNumber, jobType: body.lead?.category || body.jobType, location: body.lead?.geo || body.location }
    case 'houzz':
      return { name: body.lead_name || body.name, email: body.lead_email || body.email, phone: body.lead_phone || body.phone, description: body.message || body.description, location: body.location || body.city }
    default:
      return {
        name: body.name || body.full_name || body.customer_name || body.lead_name || [body.first_name, body.last_name].filter(Boolean).join(' ') || undefined,
        email: body.email || body.customer_email,
        phone: body.phone || body.customer_phone || body.phone_number,
        jobType: body.job_type || body.service || body.category || body.interest,
        location: body.location || body.address || body.city || body.zip,
        budget: body.budget,
        description: body.description || body.message || body.details || body.notes,
      }
  }
}
