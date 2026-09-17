import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { salesLead, contact, unit, user } from '../../db/schema.ts'
import { eq, and, or, ilike, count, desc, sql, ne } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'
import { emitToCompany, EVENTS } from '../services/socket.ts'
import audit from '../services/audit.ts'
import { createId } from '@paralleldrive/cuid2'

const app = new Hono()
app.use('*', authenticate)

// A unit is sold by closing its deal (stage closed_won, shown as "Sold"). Closing marks the unit sold, which also
// takes it off the syndication feed. A unit already sold on another deal can't be sold again. Reopening the deal,
// or moving it to a different unit, puts the unit back on sale unless another sold deal still holds it. Other
// customers' open leads on a sold unit stay open; the pipeline flags them "Unit sold". (RV T19 B1)
const SOLD = 'closed_won'

async function sellUnit(tx: any, companyId: string, unitId: string, leadId: string | null | undefined) {
  const [u] = await tx.select({ id: unit.id }).from(unit)
    .where(and(eq(unit.id, unitId), eq(unit.companyId, companyId))).limit(1).for('update')
  if (!u) return { status: 404 as const, error: 'Unit not found' }
  const [other] = await tx.select({ id: salesLead.id, contactName: contact.name }).from(salesLead)
    .leftJoin(contact, eq(salesLead.contactId, contact.id))
    .where(and(eq(salesLead.companyId, companyId), eq(salesLead.unitId, unitId), eq(salesLead.stage, SOLD), leadId ? ne(salesLead.id, leadId) : undefined))
    .limit(1)
  if (other) return { status: 409 as const, error: other.contactName ? `This unit is already sold to ${other.contactName}.` : 'This unit is already sold on another deal.', soldLeadId: other.id }
  await tx.update(unit).set({ status: 'sold', updatedAt: new Date() }).where(eq(unit.id, unitId))
  return null
}

async function releaseUnit(tx: any, companyId: string, unitId: string | null, leadId: string | undefined) {
  if (!unitId || !leadId) return
  const [u] = await tx.select({ id: unit.id, status: unit.status }).from(unit)
    .where(and(eq(unit.id, unitId), eq(unit.companyId, companyId))).limit(1).for('update')
  if (!u || u.status !== 'sold') return
  const [other] = await tx.select({ id: salesLead.id }).from(salesLead)
    .where(and(eq(salesLead.companyId, companyId), eq(salesLead.unitId, unitId), eq(salesLead.stage, SOLD), ne(salesLead.id, leadId)))
    .limit(1)
  if (!other) await tx.update(unit).set({ status: 'available', updatedAt: new Date() }).where(eq(unit.id, unitId))
}

// GET /sales-leads — pipeline list
app.get('/', requirePermission('contacts:read'), async (c) => {
  const currentUser = c.get('user') as any
  const stage = c.req.query('stage')
  const assignedTo = c.req.query('assignedTo')
  const search = c.req.query('search')
  const page = +(c.req.query('page') || '1')
  const limit = +(c.req.query('limit') || '50')

  const conditions = [eq(salesLead.companyId, currentUser.companyId)]
  if (stage) conditions.push(eq(salesLead.stage, stage))
  if (assignedTo) conditions.push(eq(salesLead.assignedTo, assignedTo))

  const where = and(...conditions)

  const data = await db.select({
    lead: salesLead,
    contactName: contact.name,
    contactEmail: contact.email,
    contactPhone: contact.phone,
    unitYear: unit.year,
    unitMake: unit.make,
    unitModelName: unit.modelName,
    unitTrim: unit.trim,
    unitStockNumber: unit.stockNumber,
    unitStatus: unit.status,
    salespersonFirstName: user.firstName,
    salespersonLastName: user.lastName,
  })
    .from(salesLead)
    .leftJoin(contact, eq(salesLead.contactId, contact.id))
    .leftJoin(unit, eq(salesLead.unitId, unit.id))
    .leftJoin(user, eq(salesLead.assignedTo, user.id))
    .where(where)
    .orderBy(desc(salesLead.createdAt))
    .offset((page - 1) * limit)
    .limit(limit)

  const [{ value: total }] = await db.select({ value: count() }).from(salesLead).where(where)

  return c.json({ data, pagination: { page, limit, total: Number(total), pages: Math.ceil(Number(total) / limit) } })
})

// GET /sales-leads/stats
app.get('/stats', requirePermission('contacts:read'), async (c) => {
  const currentUser = c.get('user') as any
  const leads = await db.select({ stage: salesLead.stage, source: salesLead.source })
    .from(salesLead)
    .where(eq(salesLead.companyId, currentUser.companyId))

  const byStage: Record<string, number> = {}
  const bySource: Record<string, number> = {}
  for (const l of leads) {
    byStage[l.stage] = (byStage[l.stage] || 0) + 1
    bySource[l.source] = (bySource[l.source] || 0) + 1
  }
  return c.json({ total: leads.length, byStage, bySource })
})

// POST /sales-leads
app.post('/', requirePermission('contacts:create'), async (c) => {
  const currentUser = c.get('user') as any
  const body = await c.req.json()

  const id = createId()
  const stage = body.stage || 'new'
  const unitId = body.unitId || null
  const outcome = await db.transaction(async (tx: any) => {
    if (stage === SOLD && unitId) {
      const refusal = await sellUnit(tx, currentUser.companyId, unitId, null)
      if (refusal) return { refusal }
    }
    const [created] = await tx.insert(salesLead).values({
      id,
      contactId: body.contactId,
      unitId,
      source: body.source || 'web',
      stage,
      assignedTo: body.assignedTo || null,
      notes: body.notes || null,
      tradeInInfo: body.tradeInInfo || null,
      followUpDate: body.followUpDate ? new Date(body.followUpDate) : null,
      companyId: currentUser.companyId,
    }).returning()
    return { created }
  })
  if (outcome.refusal) {
    const { status, ...rest } = outcome.refusal
    return c.json(rest, status)
  }
  const created = outcome.created

  await audit.log({ action: 'create', entity: 'sales_lead', entityId: created.id, metadata: created, req: { user: currentUser } })
  emitToCompany(currentUser.companyId, EVENTS.REFRESH, { entity: 'sales_lead' })
  return c.json(created, 201)
})

// PUT /sales-leads/:id — update stage, assignment, etc.
app.put('/:id', requirePermission('contacts:update'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')
  const body = await c.req.json()

  const [existing] = await db.select().from(salesLead).where(and(eq(salesLead.id, id), eq(salesLead.companyId, currentUser.companyId))).limit(1)
  if (!existing) return c.json({ error: 'Lead not found' }, 404)

  // Whitelist editable columns — never let companyId/id be reassigned from the body.
  const EDITABLE = ['source','stage','notes','tradeInInfo','followUpDate','contactId','unitId','assignedTo'] as const
  const updates: any = { updatedAt: new Date() }
  for (const k of EDITABLE) if (k in body) updates[k] = body[k]
  if (body.stage === 'closed_won' || body.stage === 'closed_lost') {
    updates.closedAt = new Date()
  }

  const nextStage = 'stage' in body ? body.stage : existing.stage
  const nextUnitId = 'unitId' in body ? body.unitId || null : existing.unitId
  const wasSold = existing.stage === SOLD && !!existing.unitId
  const isSold = nextStage === SOLD && !!nextUnitId
  const sameSale = wasSold && isSold && nextUnitId === existing.unitId

  const outcome = await db.transaction(async (tx: any) => {
    // sell first: a refusal returns before anything is written
    if (isSold && !sameSale) {
      const refusal = await sellUnit(tx, currentUser.companyId, nextUnitId, id)
      if (refusal) return { refusal }
    }
    if (wasSold && !sameSale) await releaseUnit(tx, currentUser.companyId, existing.unitId, id)
    const [row] = await tx.update(salesLead).set(updates).where(eq(salesLead.id, id)).returning()
    return { updated: row }
  })
  if (outcome.refusal) {
    const { status, ...rest } = outcome.refusal
    return c.json(rest, status)
  }
  const updated = outcome.updated
  await audit.log({ action: 'update', entity: 'sales_lead', entityId: id, changes: audit.diff(existing, updated), req: { user: currentUser } })
  emitToCompany(currentUser.companyId, EVENTS.REFRESH, { entity: 'sales_lead' })
  return c.json(updated)
})

// ---- Desked deal (RV T19 H1) ----
// Desking saves the deal's inputs on the lead, and F&I reads them back, so the numbers a salesperson desks are the
// numbers F&I finances. The math lives in one place (frontend/src/lib/deal.ts); the server keeps the inputs sane:
// no negative amounts, tax rate 0–25%, discount no larger than the selling price. (M5: a typed -5% tax became 5%)
const DEAL_LABELS: Record<string, string> = {
  price: 'Selling price', discount: 'Discount', accessories: 'Accessories / add-ons', tradeAllow: 'Trade allowance',
  tradePayoff: 'Trade payoff', doc: 'Doc fee', freight: 'Freight / setup', titleReg: 'Title & reg', prep: 'Dealer prep',
  down: 'Down payment', taxRate: 'Tax rate',
}
const DEAL_MONEY = ['price', 'discount', 'accessories', 'tradeAllow', 'tradePayoff', 'doc', 'freight', 'titleReg', 'prep', 'down']
const DEAL_MAX = 10_000_000

function dealInput(body: any): { deal: Record<string, number> } | { error: string } {
  if (!body || typeof body !== 'object') return { error: 'Deal is required' }
  const deal: Record<string, number> = {}
  for (const k of [...DEAL_MONEY, 'taxRate']) {
    const v = body[k]
    if (typeof v !== 'number' || !Number.isFinite(v)) return { error: `${DEAL_LABELS[k]} must be a number` }
    deal[k] = k === 'taxRate' ? Math.round(v * 1000) / 1000 : Math.round(v * 100) / 100
  }
  for (const k of DEAL_MONEY) {
    if (deal[k] < 0) return { error: `${DEAL_LABELS[k]} can't be negative` }
    if (deal[k] > DEAL_MAX) return { error: `${DEAL_LABELS[k]} is too large` }
  }
  if (deal.taxRate < 0 || deal.taxRate > 25) return { error: 'Tax rate must be between 0% and 25%' }
  if (deal.discount > deal.price) return { error: "Discount can't be more than the selling price" }
  return { deal }
}

// A desk saved by the old Pipeline "Deal Desk" modal lives as JSON in the lead's notes ({ dealDesk: {...} }).
// Offer it as the starting point so no desked numbers are lost; it becomes the lead's deal once saved.
function dealFromNotes(notes: string | null): Record<string, number> | null {
  if (!notes) return null
  let desk: any
  try { desk = JSON.parse(notes)?.dealDesk } catch { return null }
  if (!desk || typeof desk !== 'object') return null
  const n = (v: unknown) => { const x = parseFloat(String(v ?? '')); return Number.isFinite(x) && x >= 0 ? x : 0 }
  return {
    price: n(desk.unitPrice), discount: 0, accessories: 0, tradeAllow: n(desk.tradeAllowance), tradePayoff: n(desk.tradePayoff),
    doc: n(desk.docFees), freight: 0, titleReg: n(desk.titleFees), prep: 0, taxRate: Math.min(25, n(desk.taxRate)), down: n(desk.downPayment),
  }
}

// GET /sales-leads/:id/deal — the lead, its unit and its saved deal (null until desked)
app.get('/:id/deal', requirePermission('contacts:read'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')
  const [row] = await db.select({
    lead: salesLead,
    contactName: contact.name, contactEmail: contact.email, contactPhone: contact.phone,
    unitYear: unit.year, unitMake: unit.make, unitModelName: unit.modelName, unitStockNumber: unit.stockNumber,
    unitStatus: unit.status, unitInternetPrice: unit.internetPrice, unitListedPrice: unit.listedPrice,
  })
    .from(salesLead)
    .leftJoin(contact, eq(salesLead.contactId, contact.id))
    .leftJoin(unit, eq(salesLead.unitId, unit.id))
    .where(and(eq(salesLead.id, id), eq(salesLead.companyId, currentUser.companyId)))
    .limit(1)
  if (!row) return c.json({ error: 'Lead not found' }, 404)
  const saved = (row.lead.deal as Record<string, number> | null) || null
  const legacy = saved ? null : dealFromNotes(row.lead.notes)
  return c.json({
    leadId: row.lead.id,
    stage: row.lead.stage,
    customerName: row.contactName,
    email: row.contactEmail,
    phone: row.contactPhone,
    unit: row.lead.unitId ? {
      id: row.lead.unitId, year: row.unitYear, make: row.unitMake, modelName: row.unitModelName, stockNumber: row.unitStockNumber,
      status: row.unitStatus, price: Number(row.unitInternetPrice ?? row.unitListedPrice ?? 0) || 0,
    } : null,
    deal: saved || legacy,
    dealSaved: !!saved,
  })
})

// PUT /sales-leads/:id/deal — save the desked deal
app.put('/:id/deal', requirePermission('contacts:update'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')
  const parsed = dealInput(await c.req.json().catch(() => null))
  if ('error' in parsed) return c.json({ error: parsed.error }, 400)

  const [existing] = await db.select().from(salesLead).where(and(eq(salesLead.id, id), eq(salesLead.companyId, currentUser.companyId))).limit(1)
  if (!existing) return c.json({ error: 'Lead not found' }, 404)

  const deal = { ...parsed.deal, savedAt: new Date().toISOString() }
  const [updated] = await db.update(salesLead).set({ deal, updatedAt: new Date() })
    .where(and(eq(salesLead.id, existing.id), eq(salesLead.companyId, currentUser.companyId))).returning()
  await audit.log({ action: 'update', entity: 'sales_lead', entityId: existing.id, changes: audit.diff({ deal: existing.deal }, { deal: updated.deal }), req: { user: currentUser } })
  emitToCompany(currentUser.companyId, EVENTS.REFRESH, { entity: 'sales_lead' })
  return c.json({ id: updated.id, deal: updated.deal })
})

// POST /sales-leads/import-adf — parse ADF/XML lead
// Only a real ADF lead is imported: an <adf> document with a <prospect> whose <customer> has a name, email or phone.
// Customer and vehicle fields are read from their own <customer> / <vehicle> blocks (not from the dealer's <vendor>
// contact). Marketplaces resend ADF: a lead for the same contact and the same vehicle interest that is still open
// and was imported in the last 30 days is returned as the existing lead (200, duplicate: true) instead of a second
// lead. The import runs under a lock on the customer's identity, so two copies arriving together can't both create.
// (RV T19 H6: the text "garbage" created an "Unknown" contact and lead; the same ADF twice created two leads)
const ADF_DUPLICATE_DAYS = 30

function parseAdf(xmlText: string) {
  const decode = (s: string) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&').trim()
  const block = (xml: string, tag: string) => xml.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'i'))?.[1] ?? ''
  const blocks = (xml: string, tag: string) => [...xml.matchAll(new RegExp(`<${tag}\\b([^>]*)>([\\s\\S]*?)</${tag}>`, 'gi'))].map((m) => ({ attrs: m[1], body: m[2] }))
  const text = (xml: string, tag: string, attr?: string) => {
    const m = xml.match(new RegExp(`<${tag}\\b[^>]*${attr ? `${attr}[^>]*` : ''}>([\\s\\S]*?)</${tag}>`, 'i'))
    return m ? decode(m[1]) : ''
  }

  if (!/<adf\b/i.test(xmlText) || !/<prospect\b/i.test(xmlText)) return { error: "This isn't an ADF lead — expected an <adf> document with a <prospect>." }
  const customer = block(xmlText, 'customer')
  if (!customer) return { error: 'The ADF lead has no <customer>.' }

  const first = text(customer, 'name', `part=["']first["']`)
  const last = text(customer, 'name', `part=["']last["']`)
  const full = text(customer, 'name', `part=["']full["']`) || (!first && !last ? text(customer, 'name') : '')
  const name = [first, last].filter(Boolean).join(' ') || full
  const emailRaw = text(customer, 'email').toLowerCase()
  const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRaw) ? emailRaw : ''
  const phone = text(customer, 'phone')
  const phoneDigits = phone.replace(/\D/g, '').slice(-10)
  if (!name && !email && phoneDigits.length < 10) return { error: 'The ADF lead has no customer name, email or phone.' }

  // the vehicle the customer wants (a trade-in vehicle is not the interest)
  const vehicles = blocks(xmlText, 'vehicle')
  const wanted = vehicles.find((v) => /interest=["'](buy|lease|test-drive)["']/i.test(v.attrs)) || vehicles.find((v) => !/interest=["']trade-in["']/i.test(v.attrs))
  const yearText = wanted ? text(wanted.body, 'year') : ''
  const year = /^\d{4}$/.test(yearText) ? Number(yearText) : null
  const make = wanted ? text(wanted.body, 'make') : ''
  const model = wanted ? text(wanted.body, 'model') : ''
  return { name, email, phone, phoneDigits, year, make, model }
}

app.post('/import-adf', requirePermission('contacts:create'), async (c) => {
  const currentUser = c.get('user') as any
  const companyId = currentUser.companyId
  const contentType = c.req.header('content-type') || ''

  let xmlText: string
  if (contentType.includes('xml') || contentType.includes('text/plain')) {
    xmlText = await c.req.text()
  } else {
    const body = await c.req.json().catch(() => ({} as any))
    xmlText = typeof body.xml === 'string' ? body.xml : typeof body.adf === 'string' ? body.adf : ''
  }

  if (!xmlText) return c.json({ error: 'No ADF/XML content provided' }, 400)
  const adf = parseAdf(xmlText)
  if ('error' in adf) return c.json({ error: adf.error }, 400)
  const { name, email, phone, phoneDigits, year, make, model } = adf
  const interest = `ADF import: interested in ${year || ''} ${make} ${model}`.replace(/\s+/g, ' ').trim()

  const outcome = await db.transaction(async (tx: any) => {
    // one import at a time per customer identity in this company
    const identity = email || (phoneDigits.length === 10 ? phoneDigits : '') || name.toLowerCase()
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`adf:${companyId}:${identity}`}))`)

    let contactRecord: any = null
    if (email) {
      ;[contactRecord] = await tx.select().from(contact)
        .where(and(eq(contact.companyId, companyId), sql`lower(${contact.email}) = ${email}`)).limit(1)
    }
    if (!contactRecord && phoneDigits.length === 10) {
      ;[contactRecord] = await tx.select().from(contact)
        .where(and(eq(contact.companyId, companyId), sql`right(regexp_replace(coalesce(${contact.phone}, ''), '\\D', '', 'g'), 10) = ${phoneDigits}`)).limit(1)
    }
    let contactCreated = false
    if (!contactRecord) {
      ;[contactRecord] = await tx.insert(contact).values({
        id: createId(),
        name: name || email || phone,
        email: email || undefined,
        phone: phone || undefined,
        type: 'lead',
        source: 'adf_xml',
        companyId,
      }).returning()
      contactCreated = true
    }

    // Try to match an available unit by year/make/model
    let unitId: string | null = null
    if (year && make && model) {
      const [matched] = await tx.select().from(unit)
        .where(and(eq(unit.companyId, companyId), eq(unit.year, year), sql`lower(${unit.make}) = ${make.toLowerCase()}`, sql`lower(${unit.modelName}) = ${model.toLowerCase()}`, eq(unit.status, 'available')))
        .limit(1)
      if (matched) unitId = matched.id
    }

    // the same lead sent again: an open ADF lead for this contact and this interest, imported recently
    if (!contactCreated) {
      const [existing] = await tx.select().from(salesLead).where(and(
        eq(salesLead.companyId, companyId),
        eq(salesLead.contactId, contactRecord.id),
        eq(salesLead.source, 'adf_xml'),
        sql`${salesLead.stage} not in ('closed_won', 'closed_lost')`,
        sql`${salesLead.createdAt} > now() - make_interval(days => ${ADF_DUPLICATE_DAYS})`,
        unitId ? eq(salesLead.unitId, unitId) : eq(salesLead.notes, interest),
      )).limit(1)
      if (existing) return { duplicate: true, contactRecord, lead: existing, unitId }
    }

    const [lead] = await tx.insert(salesLead).values({
      id: createId(),
      contactId: contactRecord.id,
      unitId,
      source: 'adf_xml',
      stage: 'new',
      notes: interest,
      companyId,
    }).returning()
    return { duplicate: false, contactRecord, lead, unitId }
  })

  if (outcome.duplicate) {
    return c.json({ success: true, duplicate: true, message: 'This ADF lead was already imported — the existing lead was kept.', contact: outcome.contactRecord, lead: outcome.lead, unitMatched: !!outcome.unitId })
  }
  await audit.log({ action: 'create', entity: 'sales_lead', entityId: outcome.lead.id, metadata: { source: 'adf_xml', contact: outcome.contactRecord.name }, req: { user: currentUser } })
  emitToCompany(companyId, EVENTS.REFRESH, { entity: 'sales_lead' })

  return c.json({ success: true, contact: outcome.contactRecord, lead: outcome.lead, unitMatched: !!outcome.unitId }, 201)
})

export default app
