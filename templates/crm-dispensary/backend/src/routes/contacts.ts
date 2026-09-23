import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { contact, order, loyaltyMember, loyaltyTransaction } from '../../db/schema.ts'
import { eq, and, or, ilike, count, desc, sql } from 'drizzle-orm'
import { settledSale, netExprBare } from '../utils/revenue.ts'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'
import { emitToCompany, EVENTS } from '../services/socket.ts'
import audit from '../services/audit.ts'
import { stripHtml } from '../utils/sanitize.ts'
import { isValidPhone } from '../shared/index.ts'

const app = new Hono()
app.use('*', authenticate)

// The portal token is a bearer credential — never in an API response or a socket broadcast (VET-29).
const stripPortal = (row: any) => { if (!row) return row; const { portalToken, portalTokenExp, ...rest } = row; return rest }

// Free-text fields are stored with markup stripped (QA F-09): a customer named `<script>`
// was persisted verbatim. React escapes it in the SPA, but receipts, labels, emails and CSV
// exports are not React. Strip on input; a name that is ONLY markup fails min(1).
const cleanText = (min = 0, max?: number) => z.string().transform(stripHtml).pipe(
  max != null
    ? (min > 0 ? z.string().min(min).max(max) : z.string().max(max))
    : (min > 0 ? z.string().min(min) : z.string()),
)

// A name is a label a person is known by, not a paragraph. The field had a floor and no ceiling, so a
// 404-character name was stored happily and then rendered in a table cell 2,437px wide, pushing every
// other column off the screen. The screen now wraps rather than stretching either way, but the record
// is where the absurd value has to stop. (T21 M1 / L8)
const NAME_MAX = 200

const contactSchema = z.object({
  name: cleanText(1, NAME_MAX),
  // A dispensary calls the people it serves CUSTOMERS — it is the word on the screen, in the nav and
  // in every toast. The stored vocabulary calls them clients, and the API refused "customer" outright,
  // so the one word the product uses everywhere was the one word its own API would not take. Accepted
  // now and normalised to the stored value, which leaves the data exactly as it was. (T21 L3)
  type: z.preprocess(
    (v) => (v === 'customer' ? 'client' : v),
    z.enum(['lead', 'client', 'patient', 'vendor']),
  ).default('lead'),
  company: cleanText().optional(),
  email: z.string().email().optional().or(z.literal('')),
  // Same phone rule as the shared contacts module: phone punctuation only and at least 7 digits.
  phone: cleanText().optional().refine(isValidPhone, { message: 'Enter a valid phone number (at least 7 digits)' }),
  mobile: cleanText().optional().refine(isValidPhone, { message: 'Enter a valid mobile number (at least 7 digits)' }),
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
    // Spend is what the customer actually spent: every SETTLED sale, NET of what was refunded.
    //
    // This was completed-only, to stop a refunded order counting at full value (retest#10) — but refunding
    // ten pounds flips an order to 'partially_refunded', which dropped it out of the sum entirely. A
    // customer with one order went to ZERO lifetime spend over a $10 refund (Dispensary T20), and their
    // order count and last visit went with it. Netting over the settled set fixes both at once: nothing is
    // banked from returned goods, and nothing disappears because part of it came back. Same definition as
    // utils/revenue.ts, which is where the reporting surfaces get it.
    db.execute(sql`SELECT contact_id,
        COALESCE(SUM(${netExprBare}), 0)::numeric as spent,
        COUNT(*)::int as order_count,
        MAX(created_at) as last_order
      FROM orders
      WHERE company_id = ${currentUser.companyId} AND status IN ${settledSale} AND contact_id IS NOT NULL
      GROUP BY contact_id`),
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

  // Age at creation (go-live QA L-2). A customer record with a 2012 DOB used to be created
  // silently; the register would refuse the sale later, but the record itself should not slip
  // in unnoticed. Under 18 is refused outright (no legal cannabis customer is a minor); 18–20
  // is allowed (medical patients) but the response carries a warning the UI surfaces.
  const warnings: string[] = []
  // Markup is stripped from free text on the way in (F-09) and that stays — but it used to happen in
  // silence, so "T29 <img src=x onerror=...>" came back saved as "T29" with nothing to say why. The
  // person typing it deserves to know their input was changed, even when the change was for their own
  // good. (Dispensary T29 L8)
  for (const [field, label] of [['name', 'name'], ['notes', 'notes'], ['address', 'address']] as const) {
    const sent = (cBody as any)?.[field]
    const stored = (data as any)?.[field]
    if (typeof sent === 'string' && typeof stored === 'string' && sent.trim() !== stored.trim()) {
      warnings.push(`The ${label} was saved as "${stored}" — formatting or markup was removed.`)
    }
  }
  if (data.dateOfBirth && data.type !== 'vendor') {
    // "1990-02-30" is not a real day, and `new Date` does not say so — it rolls quietly to 2 March and
    // the record is stored a couple of days off the card it was copied from. On a date of birth that
    // decides whether someone may be sold cannabis, a silent adjustment is the wrong answer. Check the
    // calendar before trusting the parse: the round-trip only survives if the day exists. The tester
    // got the generic "One of the values is not in a valid format" for this. (Dispensary T29 L8)
    const asDay = String(data.dateOfBirth).slice(0, 10)
    if (/^\d{4}-\d{2}-\d{2}$/.test(asDay)) {
      const [y, m, d] = asDay.split('-').map(Number)
      const probe = new Date(Date.UTC(y, m - 1, d))
      if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) {
        return c.json({ error: `${asDay} is not a real calendar date — check the day and month.`, code: 'BAD_DATE' }, 400)
      }
    }
    const dob = new Date(data.dateOfBirth)
    if (Number.isNaN(dob.getTime())) return c.json({ error: 'dateOfBirth is not a valid date' }, 400)
    const today = new Date()
    let age = today.getFullYear() - dob.getFullYear()
    const m = today.getMonth() - dob.getMonth()
    if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) age--
    if (dob > today) return c.json({ error: 'dateOfBirth cannot be in the future' }, 400)
    if (age < 18) return c.json({ error: `Customer would be ${age} years old — cannabis customers must be at least 18 (medical) or 21 (adult use)`, code: 'underage', age }, 400)
    if (age < 21) warnings.push(`Customer is ${age} — adult-use sales require 21+. Only medical sales with a valid card are permitted.`)
  }

  // Duplicate guard (S22, now the same rule as the shared contacts module): a create that matches an
  // existing customer's email or phone DIGITS is refused with 409 + existingId unless the body says
  // allowDuplicate, so the UI can offer "open the existing record" / "create anyway". The old check
  // compared the phone as typed, so "(614) 555-0100" slipped past "6145550100".
  if (!cBody.allowDuplicate) {
    const conds: any[] = []
    if (data.email) conds.push(sql`lower(${contact.email}) = ${data.email}`)
    const phones = [data.phone, data.mobile]
      .map((p) => String(p || '').replace(/\D/g, ''))
      .filter((p) => p.length >= 7)
      .map((p) => '%' + p.slice(-10))
    for (const p of phones) {
      conds.push(sql`regexp_replace(coalesce(${contact.phone}, ''), '\\D', '', 'g') like ${p}`)
      conds.push(sql`regexp_replace(coalesce(${contact.mobile}, ''), '\\D', '', 'g') like ${p}`)
    }
    if (conds.length) {
      const [dupe] = await db.select({ id: contact.id, name: contact.name }).from(contact)
        .where(and(eq(contact.companyId, currentUser.companyId), or(...conds)!))
        .limit(1)
      if (dupe) {
        return c.json({ error: `${dupe.name} already has this email or phone number. Open that record, or create this customer anyway.`, existingId: dupe.id, duplicate: true }, 409)
      }
    }
  }

  const [newContact] = await db.insert(contact).values({ ...data, companyId: currentUser.companyId }).returning()
  const safeNew = stripPortal(newContact)
  emitToCompany(currentUser.companyId, EVENTS.CONTACT_CREATED, safeNew)
  audit.log({ action: audit.ACTIONS.CREATE, entity: 'contact', entityId: newContact.id, entityName: newContact.name, metadata: warnings.length ? { warnings } : undefined, req: c })
  return c.json(warnings.length ? { ...safeNew, warnings } : safeNew, 201)
})

app.put('/:id', requirePermission('contacts:update'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')
  const uBody = await c.req.json()
  if (uBody.email && typeof uBody.email === 'string') uBody.email = uBody.email.toLowerCase().trim()
  const data = contactSchema.partial().parse(uBody)

  const [existing] = await db.select().from(contact).where(and(eq(contact.id, id), eq(contact.companyId, currentUser.companyId))).limit(1)
  if (!existing) return c.json({ error: 'Contact not found' }, 404)

  // The same notice the create path gives. T29 L8 put it on POST only, so editing a customer and
  // typing "T31 <i>it</i>" still saved "T31 it" in silence — the half of the screen most likely to
  // be used, since a customer is created once and edited for years. Markup still goes (F-09); what
  // changes is that the person who typed it is told. (Dispensary T31 L8)
  const warnings: string[] = []
  for (const [field, label] of [['name', 'name'], ['notes', 'notes'], ['address', 'address']] as const) {
    const sent = (uBody as any)?.[field]
    const stored = (data as any)?.[field]
    if (typeof sent === 'string' && typeof stored === 'string' && sent.trim() !== stored.trim()) {
      warnings.push(`The ${label} was saved as "${stored}" — formatting or markup was removed.`)
    }
  }

  const [updated] = await db.update(contact).set({ ...data, updatedAt: new Date() }).where(eq(contact.id, id)).returning()
  const safeUpdated = stripPortal(updated)
  emitToCompany(currentUser.companyId, EVENTS.CONTACT_UPDATED, safeUpdated)
  const changes = audit.diff(existing, updated)
  if (changes) audit.log({ action: audit.ACTIONS.UPDATE, entity: 'contact', entityId: updated.id, entityName: updated.name, changes, req: c })
  return c.json(warnings.length ? { ...safeUpdated, warnings } : safeUpdated)
})

app.delete('/:id', requirePermission('contacts:delete'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const [existing] = await db.select().from(contact).where(and(eq(contact.id, id), eq(contact.companyId, currentUser.companyId))).limit(1)
  if (!existing) return c.json({ error: 'Contact not found' }, 404)

  // A customer with sales or loyalty history is a record, not a row: deleting nulled every order's
  // customer (FK set null) and cascaded the loyalty member (points) away. Same 409 rule as the shared
  // contacts module — keep the record instead.
  const [[{ value: orderCount }], [member]] = await Promise.all([
    db.select({ value: count() }).from(order).where(eq(order.contactId, id)),
    db.select({ pointsBalance: loyaltyMember.pointsBalance, lifetimePoints: loyaltyMember.lifetimePoints }).from(loyaltyMember).where(eq(loyaltyMember.contactId, id)).limit(1),
  ])
  const reasons: string[] = []
  if (Number(orderCount) > 0) reasons.push(`${orderCount} order${Number(orderCount) === 1 ? '' : 's'}`)
  if (member && (Number(member.pointsBalance) > 0 || Number(member.lifetimePoints) > 0)) reasons.push('loyalty points history')
  if (reasons.length) return c.json({ error: `This customer has ${reasons.join(' and ')}. Customers with history can't be deleted — keep the record instead.` }, 409)

  await db.delete(contact).where(eq(contact.id, id))
  emitToCompany(currentUser.companyId, EVENTS.CONTACT_DELETED, { id })
  audit.log({ action: audit.ACTIONS.DELETE, entity: 'contact', entityId: existing.id, entityName: existing.name, req: c })
  return c.body(null, 204)
})

app.post('/:id/convert', requirePermission('contacts:update'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const [existing] = await db.select().from(contact).where(and(eq(contact.id, id), eq(contact.companyId, currentUser.companyId))).limit(1)
  if (!existing) return c.json({ error: 'Contact not found' }, 404)
  if (existing.type !== 'lead') return c.json({ error: 'Only leads can be converted' }, 400)

  const [updated] = await db.update(contact).set({ type: 'client', updatedAt: new Date() }).where(eq(contact.id, id)).returning()
  const safeConverted = stripPortal(updated)
  emitToCompany(currentUser.companyId, EVENTS.CONTACT_UPDATED, safeConverted)
  audit.log({ action: audit.ACTIONS.STATUS_CHANGE, entity: 'contact', entityId: updated.id, entityName: updated.name, changes: { type: { old: 'lead', new: 'client' } }, req: c })
  return c.json(safeConverted)
})

export default app
