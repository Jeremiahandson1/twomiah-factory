// The sales pipeline: a lead per customer and unit of interest, by stage and salesperson; closing a deal sells the
// unit; the desked deal (Desking, read back by F&I); the ADF/XML marketplace lead import. Moved from
// templates/crm-rv/backend/src/routes/salesLeads.ts.
import { Hono } from 'hono'
import { eq, and, count, desc, ne } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import { salesLead, contact, unit, user } from '../../db/schema/index.ts'
import { advisoryLock, openLeadOnUnit, lockLeadIdentity, findLeadContact, availableUnitByModel, recentOpenLead } from '../../data/rvDealership.ts'
import type { AppEnv } from '../../http/env.ts'
import { done, fail, list, one } from '../../http/reply.ts'
import type { CrmDeps } from '../deps.ts'
import { dealInput } from './deal.ts'

// A unit is sold by closing its deal (stage closed_won, shown as "Sold"). Closing marks the unit sold, which also takes
// it off the syndication feed. A unit already sold on another deal can't be sold again. Reopening the deal, or moving
// it to a different unit, puts the unit back on sale unless another sold deal still holds it. (RV T19 B1)
const SOLD = 'closed_won'

// A lead's stage is one of the pipeline stages (RV T19 M2).
export const LEAD_STAGES = ['new', 'contacted', 'demo', 'desking', 'closed_won', 'closed_lost'] as const
const isOpenStage = (s: string) => s !== 'closed_won' && s !== 'closed_lost'

/** A refusal decided inside a transaction: the status and the sentence. (The template also sent the other lead's id; no screen read it.) */
type Refusal = { status: 400 | 404 | 409; error: string; code?: string }

async function sellUnit(tx: any, companyId: string, unitId: string, leadId: string | null | undefined): Promise<Refusal | null> {
  const [u] = await tx.select({ id: unit.id }).from(unit)
    .where(and(eq(unit.id, unitId), eq(unit.companyId, companyId))).limit(1).for('update')
  if (!u) return { status: 404, error: 'Unit not found' }
  const [other] = await tx.select({ id: salesLead.id, contactName: contact.name }).from(salesLead)
    .leftJoin(contact, eq(salesLead.contactId, contact.id))
    .where(and(eq(salesLead.companyId, companyId), eq(salesLead.unitId, unitId), eq(salesLead.stage, SOLD), leadId ? ne(salesLead.id, leadId) : undefined))
    .limit(1)
  if (other) return { status: 409, error: other.contactName ? `This unit is already sold to ${other.contactName}.` : 'This unit is already sold on another deal.', code: 'unit_sold' }
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

// Its contact, unit and salesperson belong to the company; a contact can't hold two open leads on the same unit (or
// two open leads with no unit). Checked under a lock on the contact so two identical leads can't both be saved.
async function leadRefusal(tx: any, companyId: string, next: { contactId: unknown; unitId: string | null; assignedTo: unknown; stage: unknown }, check: { refs: boolean; duplicate: boolean }, selfId: string | null | undefined): Promise<Refusal | null> {
  if (!(LEAD_STAGES as readonly string[]).includes(next.stage as string)) return { status: 400, error: `Stage must be one of: ${LEAD_STAGES.join(', ')}` }
  if (!check.refs && !check.duplicate) return null
  if (typeof next.contactId !== 'string' || !next.contactId) return { status: 400, error: 'Contact is required' }
  await advisoryLock(tx, `lead:${companyId}:${next.contactId}`)
  const [ct] = await tx.select({ id: contact.id, name: contact.name }).from(contact).where(and(eq(contact.id, next.contactId), eq(contact.companyId, companyId))).limit(1)
  if (!ct) return { status: 404, error: 'Contact not found' }
  if (next.unitId) {
    const [u] = await tx.select({ id: unit.id }).from(unit).where(and(eq(unit.id, next.unitId), eq(unit.companyId, companyId))).limit(1)
    if (!u) return { status: 404, error: 'Unit not found' }
  }
  if (next.assignedTo) {
    const [rep] = await tx.select({ id: user.id }).from(user).where(and(eq(user.id, String(next.assignedTo)), eq(user.companyId, companyId))).limit(1)
    if (!rep) return { status: 404, error: 'Salesperson not found' }
  }
  if (check.duplicate && isOpenStage(next.stage as string)) {
    const dupe = await openLeadOnUnit(tx, { companyId, contactId: next.contactId, unitId: next.unitId, selfId })
    if (dupe) return { status: 409, error: `${ct.name} already has an open lead ${next.unitId ? 'on this unit' : 'with no unit'}.`, code: 'duplicate_lead' }
  }
  return null
}

// A desk saved by the old Pipeline "Deal Desk" modal lives as JSON in the lead's notes ({ dealDesk: {...} }). Offered
// as the starting point so no desked numbers are lost; it becomes the lead's deal once saved.
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

// ADF/XML: only a real ADF lead is imported — an <adf> document with a <prospect> whose <customer> has a name, email
// or phone; a re-send of an open lead from the last 30 days returns that lead (RV T19 H6).
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

export function createSalesLeadRoutes(d: CrmDeps) {
  const { db } = d
  const { requirePermission } = d.permissions
  const refresh = (companyId: string) => d.realtime.emitToCompany(companyId, d.realtime.EVENTS.REFRESH, { entity: 'sales_lead' })
  const refuse = (c: any, r: Refusal) => fail(c, r.status, r.error, r.code)
  const app = new Hono<AppEnv>()

  app.get('/', requirePermission('contacts:read'), async (c) => {
    const currentUser = c.get('user')
    const stage = c.req.query('stage')
    const assignedTo = c.req.query('assignedTo')
    const page = +(c.req.query('page') || '1')
    const limit = +(c.req.query('limit') || '50')
    const conditions = [eq(salesLead.companyId, currentUser.companyId)]
    if (stage) conditions.push(eq(salesLead.stage, stage))
    if (assignedTo) conditions.push(eq(salesLead.assignedTo, assignedTo))
    const where = and(...conditions)
    const data = await db.select({
      lead: salesLead,
      contactName: contact.name, contactEmail: contact.email, contactPhone: contact.phone,
      unitYear: unit.year, unitMake: unit.make, unitModelName: unit.modelName, unitTrim: unit.trim, unitStockNumber: unit.stockNumber, unitStatus: unit.status,
      salespersonFirstName: user.firstName, salespersonLastName: user.lastName,
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
    return list(c, data, { page, limit, total: Number(total) })
  })

  app.get('/stats', requirePermission('contacts:read'), async (c) => {
    const currentUser = c.get('user')
    const leads = await db.select({ stage: salesLead.stage, source: salesLead.source }).from(salesLead).where(eq(salesLead.companyId, currentUser.companyId))
    const byStage: Record<string, number> = {}
    const bySource: Record<string, number> = {}
    for (const l of leads) {
      byStage[l.stage] = (byStage[l.stage] || 0) + 1
      bySource[l.source] = (bySource[l.source] || 0) + 1
    }
    return one(c, { total: leads.length, byStage, bySource })
  })

  app.post('/', requirePermission('contacts:create'), async (c) => {
    const currentUser = c.get('user')
    const body = await c.req.json()
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
        id: createId(),
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
    if (outcome.refusal) return refuse(c, outcome.refusal)
    const created = outcome.created
    await d.audit.log({ action: 'create', entity: 'sales_lead', entityId: created.id, metadata: created, req: { user: currentUser } })
    refresh(currentUser.companyId)
    return one(c, created, 201)
  })

  app.put('/:id', requirePermission('contacts:update'), async (c) => {
    const currentUser = c.get('user')
    const id = c.req.param('id')
    const body = await c.req.json()
    const [existing] = await db.select().from(salesLead).where(and(eq(salesLead.id, id), eq(salesLead.companyId, currentUser.companyId))).limit(1)
    if (!existing) return fail(c, 404, 'Lead not found')

    // Only the editable columns — never companyId or id from the body.
    const EDITABLE = ['source', 'stage', 'notes', 'tradeInInfo', 'followUpDate', 'contactId', 'unitId', 'assignedTo'] as const
    const updates: any = { updatedAt: new Date() }
    for (const k of EDITABLE) if (k in body) updates[k] = body[k]
    if (body.stage === 'closed_won' || body.stage === 'closed_lost') updates.closedAt = new Date()

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
    if (outcome.refusal) return refuse(c, outcome.refusal)
    const updated = outcome.updated
    await d.audit.log({ action: 'update', entity: 'sales_lead', entityId: id, changes: d.audit.diff(existing, updated), req: { user: currentUser } })
    refresh(currentUser.companyId)
    return one(c, updated)
  })

  /**
   * A lead entered by mistake can be taken off the pipeline (T58j). A SOLD lead is not deleted: it is the record of
   * that sale (the unit's sold status, F&I's desk and title & registration hang off it) — reopen it first.
   */
  app.delete('/:id', requirePermission('contacts:delete'), async (c) => {
    const currentUser = c.get('user')
    const id = c.req.param('id')
    const [existing] = await db.select({
      id: salesLead.id, stage: salesLead.stage, unitId: salesLead.unitId, contactId: salesLead.contactId, contactName: contact.name,
    }).from(salesLead)
      .leftJoin(contact, eq(salesLead.contactId, contact.id))
      .where(and(eq(salesLead.id, id), eq(salesLead.companyId, currentUser.companyId)))
      .limit(1)
    if (!existing) return fail(c, 404, 'Lead not found')
    if (existing.stage === SOLD) {
      return fail(c, 409, 'This deal is closed as sold, so it is the record of that sale and cannot be deleted. Reopen the deal first — that also puts the unit back on sale — and then delete it.')
    }
    const [removed] = await db.delete(salesLead).where(and(eq(salesLead.id, id), eq(salesLead.companyId, currentUser.companyId))).returning()
    // Gone between the read and the delete: say so rather than reporting a success that did nothing.
    if (!removed) return fail(c, 404, 'Lead not found')
    await d.audit.log({
      action: 'delete', entity: 'sales_lead', entityId: id, entityName: existing.contactName || null,
      metadata: { stage: removed.stage, unitId: removed.unitId, source: removed.source }, req: c,
    })
    refresh(currentUser.companyId)
    return done(c)
  })

  // GET /:id/deal — the lead, its unit and its saved deal (null until desked)
  app.get('/:id/deal', requirePermission('contacts:read'), async (c) => {
    const currentUser = c.get('user')
    const [row] = await db.select({
      lead: salesLead,
      contactName: contact.name, contactEmail: contact.email, contactPhone: contact.phone,
      unitYear: unit.year, unitMake: unit.make, unitModelName: unit.modelName, unitStockNumber: unit.stockNumber,
      unitStatus: unit.status, unitInternetPrice: unit.internetPrice, unitListedPrice: unit.listedPrice,
    })
      .from(salesLead)
      .leftJoin(contact, eq(salesLead.contactId, contact.id))
      .leftJoin(unit, eq(salesLead.unitId, unit.id))
      .where(and(eq(salesLead.id, c.req.param('id')), eq(salesLead.companyId, currentUser.companyId)))
      .limit(1)
    if (!row) return fail(c, 404, 'Lead not found')
    const saved = (row.lead.deal as Record<string, number> | null) || null
    const legacy = saved ? null : dealFromNotes(row.lead.notes)
    return one(c, {
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

  // PUT /:id/deal — save the desked deal. A refusal names every bad field (`fields`), so the form marks them all.
  app.put('/:id/deal', requirePermission('contacts:update'), async (c) => {
    const currentUser = c.get('user')
    const parsed = dealInput(await c.req.json().catch(() => null))
    if ('error' in parsed) return fail(c, 400, parsed.error, 'validation_failed', parsed.fields)
    const [existing] = await db.select().from(salesLead).where(and(eq(salesLead.id, c.req.param('id')), eq(salesLead.companyId, currentUser.companyId))).limit(1)
    if (!existing) return fail(c, 404, 'Lead not found')
    const deal = { ...parsed.deal, savedAt: new Date().toISOString() }
    const [updated] = await db.update(salesLead).set({ deal, updatedAt: new Date() })
      .where(and(eq(salesLead.id, existing.id), eq(salesLead.companyId, currentUser.companyId))).returning()
    await d.audit.log({ action: 'update', entity: 'sales_lead', entityId: existing.id, changes: d.audit.diff({ deal: existing.deal }, { deal: updated.deal }), req: { user: currentUser } })
    refresh(currentUser.companyId)
    return one(c, { id: updated.id, deal: updated.deal })
  })

  app.post('/import-adf', requirePermission('contacts:create'), async (c) => {
    const currentUser = c.get('user')
    const companyId = currentUser.companyId
    const contentType = c.req.header('content-type') || ''
    let xmlText: string
    if (contentType.includes('xml') || contentType.includes('text/plain')) {
      xmlText = await c.req.text()
    } else {
      const body = await c.req.json().catch(() => ({} as any))
      xmlText = typeof body.xml === 'string' ? body.xml : typeof body.adf === 'string' ? body.adf : ''
    }
    if (!xmlText) return fail(c, 400, 'No ADF/XML content provided')
    const adf = parseAdf(xmlText)
    if ('error' in adf) return fail(c, 400, adf.error!)
    const { name, email, phone, phoneDigits, year, make, model } = adf
    const interest = `ADF import: interested in ${year || ''} ${make} ${model}`.replace(/\s+/g, ' ').trim()

    const outcome = await db.transaction(async (tx: any) => {
      // One import at a time per customer identity, and the existing contact by email or an uncontradicted phone —
      // the same rule the website enquiry uses (data/rvDealership.ts).
      await lockLeadIdentity(tx, companyId, { name, email, phoneDigits })
      let contactRecord: any = await findLeadContact(tx, companyId, { name, email, phoneDigits })
      let contactCreated = false
      if (!contactRecord) {
        ;[contactRecord] = await tx.insert(contact).values({
          id: createId(), name: name || email || phone, email: email || undefined, phone: phone || undefined,
          type: 'lead', source: 'adf_xml', companyId,
        }).returning()
        contactCreated = true
      }
      // An available unit of the year, make and model asked about
      let unitId: string | null = null
      if (year && make && model) unitId = (await availableUnitByModel(tx, companyId, year, make, model))?.id ?? null
      // the same lead sent again: an open ADF lead for this contact and this interest, imported recently
      if (!contactCreated) {
        const existing = await recentOpenLead(tx, { companyId, contactId: contactRecord.id, source: 'adf_xml', days: ADF_DUPLICATE_DAYS, unitId, notes: interest })
        if (existing) return { duplicate: true, contactRecord, lead: existing, unitId }
      }
      const [lead] = await tx.insert(salesLead).values({
        id: createId(), contactId: contactRecord.id, unitId, source: 'adf_xml', stage: 'new', notes: interest, companyId,
      }).returning()
      return { duplicate: false, contactRecord, lead, unitId }
    })

    if (outcome.duplicate) {
      return one(c, { success: true, duplicate: true, message: 'This ADF lead was already imported — the existing lead was kept.', contact: outcome.contactRecord, lead: outcome.lead, unitMatched: !!outcome.unitId })
    }
    await d.audit.log({ action: 'create', entity: 'sales_lead', entityId: outcome.lead.id, metadata: { source: 'adf_xml', contact: outcome.contactRecord.name }, req: { user: currentUser } })
    refresh(companyId)
    return one(c, { success: true, contact: outcome.contactRecord, lead: outcome.lead, unitMatched: !!outcome.unitId }, 201)
  })

  return app
}
