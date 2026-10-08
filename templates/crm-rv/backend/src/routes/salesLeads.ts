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
import { dealInput } from '../services/deal.ts'
import { lockLeadIdentity, findLeadContact } from '../services/leadContact.ts'

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

// ---- Lead stage, references and duplicates (RV T19 M2) ----
// A lead's stage is one of the pipeline stages; its contact, unit and salesperson belong to the company; and a
// contact can't hold two open leads on the same unit (or two open leads with no unit). Checked under a lock on the
// contact so two identical leads created together can't both be saved. (T19: stage "banana" was saved; the same
// contact + unit could be added again; another company's unit id was accepted)
export const LEAD_STAGES = ['new', 'contacted', 'demo', 'desking', 'closed_won', 'closed_lost'] as const
const isOpenStage = (s: string) => s !== 'closed_won' && s !== 'closed_lost'

async function leadRefusal(tx: any, companyId: string, next: { contactId: unknown; unitId: string | null; assignedTo: unknown; stage: unknown }, check: { refs: boolean; duplicate: boolean }, selfId: string | null | undefined) {
  if (!(LEAD_STAGES as readonly string[]).includes(next.stage as string)) return { status: 400 as const, error: `Stage must be one of: ${LEAD_STAGES.join(', ')}` }
  if (!check.refs && !check.duplicate) return null
  if (typeof next.contactId !== 'string' || !next.contactId) return { status: 400 as const, error: 'Contact is required' }
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`lead:${companyId}:${next.contactId}`}))`)
  const [ct] = await tx.select({ id: contact.id, name: contact.name }).from(contact).where(and(eq(contact.id, next.contactId), eq(contact.companyId, companyId))).limit(1)
  if (!ct) return { status: 404 as const, error: 'Contact not found' }
  if (next.unitId) {
    const [u] = await tx.select({ id: unit.id }).from(unit).where(and(eq(unit.id, next.unitId), eq(unit.companyId, companyId))).limit(1)
    if (!u) return { status: 404 as const, error: 'Unit not found' }
  }
  if (next.assignedTo) {
    const [rep] = await tx.select({ id: user.id }).from(user).where(and(eq(user.id, String(next.assignedTo)), eq(user.companyId, companyId))).limit(1)
    if (!rep) return { status: 404 as const, error: 'Salesperson not found' }
  }
  if (check.duplicate && isOpenStage(next.stage as string)) {
    const [dupe] = await tx.select({ id: salesLead.id }).from(salesLead).where(and(
      eq(salesLead.companyId, companyId),
      eq(salesLead.contactId, next.contactId),
      next.unitId ? eq(salesLead.unitId, next.unitId) : sql`${salesLead.unitId} is null`,
      sql`${salesLead.stage} not in ('closed_won', 'closed_lost')`,
      selfId ? ne(salesLead.id, selfId) : undefined,
    )).limit(1)
    if (dupe) return { status: 409 as const, error: `${ct.name} already has an open lead ${next.unitId ? 'on this unit' : 'with no unit'}.`, existingLeadId: dupe.id }
  }
  return null
}

// POST /sales-leads
app.post('/', requirePermission('contacts:create'), async (c) => {
  const currentUser = c.get('user') as any
  const body = await c.req.json()

  const id = createId()
  const stage = body.stage || 'new'
  const unitId = body.unitId || null
  const outcome = await db.transaction(async (tx: any) => {
    const invalid = await leadRefusal(tx, currentUser.companyId, { contactId: body.contactId, unitId, assignedTo: body.assignedTo, stage }, { refs: true, duplicate: true }, null)
    if (invalid) return { refusal: invalid }
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

  const nextContactId = 'contactId' in body ? body.contactId : existing.contactId
  const nextAssignedTo = 'assignedTo' in body ? body.assignedTo || null : existing.assignedTo
  // an empty picker value clears the link (it was written as "" and failed as a foreign key)
  if ('unitId' in body) updates.unitId = nextUnitId
  if ('assignedTo' in body) updates.assignedTo = nextAssignedTo
  const refsChanged = ('contactId' in body && body.contactId !== existing.contactId) || ('unitId' in body && nextUnitId !== existing.unitId) || ('assignedTo' in body && nextAssignedTo !== existing.assignedTo)
  // an existing duplicate can still move between open stages; only a new contact/unit or reopening a closed lead is checked
  const duplicateCheck = refsChanged || (!isOpenStage(existing.stage) && isOpenStage(nextStage))

  const outcome = await db.transaction(async (tx: any) => {
    const invalid = await leadRefusal(tx, currentUser.companyId, { contactId: nextContactId, unitId: nextUnitId, assignedTo: nextAssignedTo, stage: nextStage }, { refs: refsChanged, duplicate: duplicateCheck }, id)
    if (invalid) return { refusal: invalid }
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

/**
 * DELETE /sales-leads/:id — a lead entered by mistake can be taken off the pipeline. (T58j)
 *
 *   Owner: "there is no API way to delete a sales lead, and deleting the contact 409s."
 *
 * Both true, and together they meant a lead typed against the wrong customer was permanent. This
 * route had GET, POST and PUT and no DELETE, and the contact behind it cannot be removed either —
 * correctly, since `sales_lead.contact_id` cascades and deleting the person to remove the lead would
 * take their whole history with them. So the pipeline accumulated rows nobody could clear.
 *
 * A SOLD LEAD IS NOT DELETED. `closed_won` is the record of a sale: the unit's sold status is derived
 * from it, F&I reads the desked deal off it, and title & registration is filed against it. Deleting
 * one would erase a sale and silently return the unit to the lot. Reopening the deal first is the
 * honest path, and the refusal says so rather than just saying no.
 *
 * `closed_lost` IS deletable — a lost lead is a prospect who did not buy, not a transaction.
 *
 * Nothing is orphaned: `service_sales_alert.sales_lead_id` is the only reference to a lead and is
 * ON DELETE SET NULL, so a service-to-sales alert survives with its link cleared. The unit needs no
 * release because only a sold lead marks one sold, and a sold lead is refused above.
 */
app.delete('/:id', requirePermission('contacts:delete'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const [existing] = await db.select({
    id: salesLead.id, stage: salesLead.stage, unitId: salesLead.unitId,
    contactId: salesLead.contactId, contactName: contact.name,
  }).from(salesLead)
    .leftJoin(contact, eq(salesLead.contactId, contact.id))
    .where(and(eq(salesLead.id, id), eq(salesLead.companyId, currentUser.companyId)))
    .limit(1)
  if (!existing) return c.json({ error: 'Lead not found' }, 404)

  if (existing.stage === SOLD) {
    return c.json({
      error: 'This deal is closed as sold, so it is the record of that sale and cannot be deleted. Reopen the deal first — that also puts the unit back on sale — and then delete it.',
    }, 409)
  }

  const [removed] = await db.delete(salesLead)
    .where(and(eq(salesLead.id, id), eq(salesLead.companyId, currentUser.companyId)))
    .returning()
  // Gone between the read and the delete: say so rather than reporting a success that did nothing.
  if (!removed) return c.json({ error: 'Lead not found' }, 404)

  await audit.log({
    action: 'delete', entity: 'sales_lead', entityId: id,
    // The name, because an id tells the reader nothing about which lead left the pipeline.
    entityName: existing.contactName || null,
    metadata: { stage: removed.stage, unitId: removed.unitId, source: removed.source },
    req: c,
  })
  emitToCompany(currentUser.companyId, EVENTS.REFRESH, { entity: 'sales_lead' })
  return c.json({ success: true })
})

// ---- Desked deal (RV T19 H1) ----
// Desking saves the deal's inputs on the lead, and F&I reads them back, so the numbers a salesperson
// desks are the numbers F&I finances. The RULES now live in services/deal.ts rather than inline here:
// the screen has its own copy (frontend/src/lib/deal.ts), the two disagreed about the down payment
// and about reporting more than one bad field, and a guard can only compare them if the server's
// half is importable without dragging in the database. (T58d)

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
  // The whole map, so a form can highlight every bad input at once instead of one per round trip.
  if ('error' in parsed) return c.json({ error: parsed.error, field: parsed.field, fields: parsed.fields }, 400)

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
    // One import at a time per customer identity, and the existing contact by email or an
    // uncontradicted phone — the same rule the website form uses (services/leadContact.ts).
    await lockLeadIdentity(tx, companyId, { name, email, phoneDigits })
    let contactRecord: any = await findLeadContact(tx, companyId, { name, email, phoneDigits })
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
