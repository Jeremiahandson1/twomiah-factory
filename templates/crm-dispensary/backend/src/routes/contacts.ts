import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { contact, order, loyaltyMember, loyaltyTransaction } from '../../db/schema.ts'
import { eq, and, or, ilike, count, desc, sql } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'
import { emitToCompany, EVENTS } from '../services/socket.ts'
import audit from '../services/audit.ts'
import { stripHtml } from '../utils/sanitize.ts'

const app = new Hono()
app.use('*', authenticate)

// Free-text fields are stored with markup stripped (QA F-09): a customer named `<script>`
// was persisted verbatim. React escapes it in the SPA, but receipts, labels, emails and CSV
// exports are not React. Strip on input; a name that is ONLY markup fails min(1).
const cleanText = (min = 0) => z.string().transform(stripHtml).pipe(min > 0 ? z.string().min(min) : z.string())

const contactSchema = z.object({
  name: cleanText(1),
  type: z.enum(['lead', 'client', 'patient', 'vendor']).default('lead'),
  company: cleanText().optional(),
  email: z.string().email().optional().or(z.literal('')),
  phone: cleanText().optional(),
  mobile: cleanText().optional(),
  address: cleanText().optional(),
  city: cleanText().optional(),
  state: cleanText().optional(),
  zip: cleanText().optional(),
  // Dispensary customer fields — real columns date_of_birth / medical_card_*.
  // Empty strings from the form are coerced to undefined so they don't get
  // written into the date columns as invalid ''.
  dateOfBirth: z.string().optional().transform((v) => (v ? v : undefined)),
  medicalCardNumber: cleanText().optional(),
  medicalCardExpiry: z.string().optional().transform((v) => (v ? v : undefined)),
  source: cleanText().optional(),
  notes: cleanText().optional(),
  tags: z.array(cleanText()).optional(),
})

app.get('/', requirePermission('contacts:read'), async (c) => {
  const currentUser = c.get('user') as any
  const type = c.req.query('type')
  const search = c.req.query('search')?.trim()
  // Clamp paging: negative page → negative SQL OFFSET → 500 (F93); unbounded limit
  // pulls every row (F94).
  const page = Math.max(1, Math.floor(+(c.req.query('page') || '1') || 1))
  const limit = Math.min(100, Math.max(1, Math.floor(+(c.req.query('limit') || '25') || 25)))

  const loyaltyTier = c.req.query('loyaltyTier')?.trim()
  const conditions = [eq(contact.companyId, currentUser.companyId)]
  if (type) conditions.push(eq(contact.type, type))
  // Honor the loyalty-tier filter — the Customers page sent ?loyaltyTier=bronze but the list
  // ignored it and returned everyone. Restrict to contacts whose membership is that tier. (retest#9)
  if (loyaltyTier) conditions.push(sql`${contact.id} IN (SELECT contact_id FROM loyalty_members WHERE company_id = ${currentUser.companyId} AND tier = ${loyaltyTier})`)
  if (search) {
    // Escape LIKE wildcards so a literal "%"/"_" matches itself, not every row (F1).
    const esc = search.replace(/[\\%_]/g, (ch) => '\\' + ch)
    conditions.push(or(
      ilike(contact.name, `%${esc}%`),
      ilike(contact.email, `%${esc}%`),
      ilike(contact.company, `%${esc}%`),
      ilike(contact.phone, `%${esc}%`),
    )!)
  }

  const where = and(...conditions)
  const [data, [{ value: total }]] = await Promise.all([
    db.select().from(contact).where(where).orderBy(desc(contact.createdAt)).offset((page - 1) * limit).limit(limit),
    db.select({ value: count() }).from(contact).where(where),
  ])

  const safeData = data.map(({ portalToken, portalTokenExp, ...rest }) => rest) // strip portal token (VET-29)

  // The customers list showed Total Spent $0 and a blank tier for patients with orders,
  // because the list omitted totalSpent/loyaltyTier/loyaltyPoints (only the detail had
  // them). Attach per-contact spend + loyalty so the columns populate. (retest#5 N2)
  const [spentRes, loyRes] = await Promise.all([
    // Spend/order-count/last-visit are COMPLETED-only. Using status != 'cancelled' still
    // counted refunded orders, so a refund reversed points but left spend and count inflated —
    // a customer could bank spend (and any spend-keyed tier) from returned goods. (retest#10)
    db.execute(sql`SELECT contact_id, COALESCE(SUM(COALESCE(total::numeric, 0)), 0)::numeric as spent, COUNT(*)::int as order_count, MAX(created_at) as last_order FROM orders WHERE company_id = ${currentUser.companyId} AND status = 'completed' AND contact_id IS NOT NULL GROUP BY contact_id`),
    db.execute(sql`SELECT contact_id, tier, points_balance FROM loyalty_members WHERE company_id = ${currentUser.companyId}`),
  ])
  const spentMap = new Map(((spentRes as any).rows || spentRes).map((r: any) => [r.contact_id, r]))
  const loyMap = new Map(((loyRes as any).rows || loyRes).map((r: any) => [r.contact_id, r]))
  for (const cRow of safeData as any[]) {
    const s: any = spentMap.get(cRow.id)
    cRow.totalSpent = String(s?.spent ?? 0)
    cRow.orderCount = Number(s?.order_count ?? 0)
    cRow.lastVisit = s?.last_order ?? null
    const l: any = loyMap.get(cRow.id)
    cRow.loyaltyTier = l?.tier ?? null
    cRow.loyaltyPoints = Number(l?.points_balance ?? 0)
  }

  return c.json({ data: safeData, pagination: { page, limit, total: Number(total), pages: Math.ceil(Number(total) / limit) } })
})

app.get('/stats', requirePermission('contacts:read'), async (c) => {
  const currentUser = c.get('user') as any
  const contacts = await db.select({ type: contact.type }).from(contact).where(eq(contact.companyId, currentUser.companyId))
  const stats: Record<string, number> = { total: contacts.length, lead: 0, client: 0, patient: 0, vendor: 0, bronze: 0, silver: 0, gold: 0, platinum: 0 }
  contacts.forEach(ct => stats[ct.type] = (stats[ct.type] || 0) + 1)
  // Tier counts for the loyalty-tier cards — they read stats[tier] (bronze/silver/gold/platinum)
  // but /stats only returned contact-type counts, so every tier card read 0. (retest#9)
  const tierRows = await db.execute(sql`SELECT tier, COUNT(*)::int as cnt FROM loyalty_members WHERE company_id = ${currentUser.companyId} GROUP BY tier`)
  for (const r of ((tierRows as any).rows || tierRows) as any[]) { if (r.tier && r.tier in stats) stats[r.tier] = Number(r.cnt) }
  return c.json(stats)
})

// GET /:id/loyalty — Loyalty snapshot for the contact detail page. Literal-suffix route,
// declared above '/:id' so it is matched first. Returns null (200) when the contact has no
// loyalty membership, which the UI renders as "No loyalty data available".
app.get('/:id/loyalty', requirePermission('contacts:read'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const [member] = await db.select().from(loyaltyMember)
    .where(and(eq(loyaltyMember.contactId, id), eq(loyaltyMember.companyId, currentUser.companyId)))
    .limit(1)
  if (!member) return c.json(null)

  const recentTransactions = await db.select({
    type: loyaltyTransaction.type,
    points: loyaltyTransaction.points,
    description: loyaltyTransaction.description,
    createdAt: loyaltyTransaction.createdAt,
  }).from(loyaltyTransaction)
    .where(eq(loyaltyTransaction.memberId, member.id))
    .orderBy(desc(loyaltyTransaction.createdAt))
    .limit(10)

  return c.json({ ...member, points: member.pointsBalance ?? 0, recentTransactions })
})

app.get('/:id', requirePermission('contacts:read'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const [foundContact] = await db.select().from(contact).where(and(eq(contact.id, id), eq(contact.companyId, currentUser.companyId))).limit(1)
  if (!foundContact) return c.json({ error: 'Contact not found' }, 404)

  // Fetch related data separately
  const [orders, loyaltyMembers] = await Promise.all([
    db.select({ id: order.id, orderNumber: order.orderNumber, total: order.total, status: order.status, createdAt: order.createdAt }).from(order).where(eq(order.contactId, id)),
    db.select().from(loyaltyMember).where(and(eq(loyaltyMember.contactId, id), eq(loyaltyMember.companyId, currentUser.companyId))).limit(1),
  ])

  const { portalToken, portalTokenExp, ...safeContact } = foundContact // (VET-29)
  return c.json({ ...safeContact, orders, loyalty: loyaltyMembers[0] || null })
})

app.post('/', requirePermission('contacts:create'), async (c) => {
  const currentUser = c.get('user') as any
  const cBody = await c.req.json()
  if (cBody.email && typeof cBody.email === 'string') cBody.email = cBody.email.toLowerCase().trim()
  const data = contactSchema.parse(cBody)

  // Block duplicate customers within the company on email or phone (S22). Only
  // check the identifiers actually supplied so blank fields never collide.
  const dupeChecks = []
  if (data.email) dupeChecks.push(eq(contact.email, data.email))
  if (data.phone) dupeChecks.push(eq(contact.phone, data.phone))
  if (dupeChecks.length) {
    const [existing] = await db.select({ id: contact.id, email: contact.email, phone: contact.phone })
      .from(contact)
      .where(and(eq(contact.companyId, currentUser.companyId), or(...dupeChecks)!))
      .limit(1)
    if (existing) {
      const field = existing.email && data.email && existing.email === data.email ? 'email address' : 'phone number'
      return c.json({ error: `A customer with that ${field} already exists.` }, 409)
    }
  }

  const [newContact] = await db.insert(contact).values({ ...data, companyId: currentUser.companyId }).returning()
  emitToCompany(currentUser.companyId, EVENTS.CONTACT_CREATED, newContact)
  audit.log({ action: audit.ACTIONS.CREATE, entity: 'contact', entityId: newContact.id, entityName: newContact.name, req: c.req })
  return c.json(newContact, 201)
})

app.put('/:id', requirePermission('contacts:update'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')
  const uBody = await c.req.json()
  if (uBody.email && typeof uBody.email === 'string') uBody.email = uBody.email.toLowerCase().trim()
  const data = contactSchema.partial().parse(uBody)

  const [existing] = await db.select().from(contact).where(and(eq(contact.id, id), eq(contact.companyId, currentUser.companyId))).limit(1)
  if (!existing) return c.json({ error: 'Contact not found' }, 404)

  const [updated] = await db.update(contact).set({ ...data, updatedAt: new Date() }).where(eq(contact.id, id)).returning()
  emitToCompany(currentUser.companyId, EVENTS.CONTACT_UPDATED, updated)
  const changes = audit.diff(existing, updated)
  if (changes) audit.log({ action: audit.ACTIONS.UPDATE, entity: 'contact', entityId: updated.id, entityName: updated.name, changes, req: c.req })
  return c.json(updated)
})

app.delete('/:id', requirePermission('contacts:delete'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const [existing] = await db.select().from(contact).where(and(eq(contact.id, id), eq(contact.companyId, currentUser.companyId))).limit(1)
  if (!existing) return c.json({ error: 'Contact not found' }, 404)

  await db.delete(contact).where(eq(contact.id, id))
  emitToCompany(currentUser.companyId, EVENTS.CONTACT_DELETED, { id })
  audit.log({ action: audit.ACTIONS.DELETE, entity: 'contact', entityId: existing.id, entityName: existing.name, req: c.req })
  return c.body(null, 204)
})

app.post('/:id/convert', requirePermission('contacts:update'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const [existing] = await db.select().from(contact).where(and(eq(contact.id, id), eq(contact.companyId, currentUser.companyId))).limit(1)
  if (!existing) return c.json({ error: 'Contact not found' }, 404)
  if (existing.type !== 'lead') return c.json({ error: 'Only leads can be converted' }, 400)

  const [updated] = await db.update(contact).set({ type: 'client', updatedAt: new Date() }).where(eq(contact.id, id)).returning()
  emitToCompany(currentUser.companyId, EVENTS.CONTACT_UPDATED, updated)
  audit.log({ action: audit.ACTIONS.STATUS_CHANGE, entity: 'contact', entityId: updated.id, entityName: updated.name, changes: { type: { old: 'lead', new: 'client' } }, req: c.req })
  return c.json(updated)
})

export default app
