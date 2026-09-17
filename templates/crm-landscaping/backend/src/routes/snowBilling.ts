import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { snowContract, snowEvent, site, invoice, invoiceLineItem, company } from '../../db/schema.ts'
import { eq, and, desc, asc, isNull, inArray } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'
import audit from '../services/audit.ts'
import { insertInvoice, defaultTaxRateFrom, dueDateFromTerms } from '../shared/index.ts'

// The same numbering as this CRM's invoices (routes/invoices.ts sets no numbering → the shared default INV-00001).
const INVOICE_NUMBERING = { prefix: 'INV', pad: 5, seed: 0 }

const app = new Hono()
app.use('*', authenticate)

const BILLING_MODES = ['per_push', 'per_event', 'per_inch', 'seasonal'] as const

// A rate/decimal column, coerced for storage. Blank optional fields arrive from the form as '' — which
// `?? default` does NOT catch, so it used to reach the numeric column verbatim and 500 the whole save
// with no field named. Treat ''/whitespace/non-numeric/negative as the default; otherwise store the
// number. A per_push contract legitimately leaves per_event/per_inch/seasonal/salt blank → they become 0.
const rate = (v: unknown, dflt = '0'): string => {
  const s = String(v ?? '').trim()
  if (s === '') return dflt
  const num = Number(s)
  return Number.isFinite(num) && num >= 0 ? String(num) : dflt
}

interface ContractRates {
  billingMode: string
  perPushRate: string | number
  perEventRate: string | number
  perInchRate: string | number
  seasonalRate: string | number
  saltRate: string | number
}

/**
 * Bill a single logged snow event against its contract.
 * per_push: pushes * perPushRate. per_event: flat perEventRate.
 * per_inch: snowfallInches * perInchRate. seasonal: 0 (covered by the seasonal contract fee).
 * Salt is added on top in every mode when applied.
 */
export function computeSnowEventCharge(
  contract: ContractRates,
  ev: { pushes: number; snowfallInches: number; saltApplied: boolean },
) {
  const n = (v: string | number) => Number(v) || 0
  let base = 0
  switch (contract.billingMode) {
    case 'per_push': base = n(ev.pushes) * n(contract.perPushRate); break
    case 'per_event': base = n(contract.perEventRate); break
    case 'per_inch': base = n(ev.snowfallInches) * n(contract.perInchRate); break
    case 'seasonal': base = 0; break
  }
  const salt = ev.saltApplied ? n(contract.saltRate) : 0
  return Math.round((base + salt) * 100) / 100
}

// ---- Contracts ----

app.get('/contracts', requirePermission('invoices:read'), async (c) => {
  const user = c.get('user') as any
  const rows = await db.select({
    contract: snowContract,
    siteName: site.name,
    siteAddress: site.address,
  })
    .from(snowContract)
    .leftJoin(site, eq(snowContract.siteId, site.id))
    .where(eq(snowContract.companyId, user.companyId))
    .orderBy(desc(snowContract.createdAt))
  return c.json({ data: rows.map(r => ({ ...r.contract, siteName: r.siteName, siteAddress: r.siteAddress })) })
})

app.post('/contracts', requirePermission('invoices:create'), async (c) => {
  const user = c.get('user') as any
  const body = await c.req.json()
  if (!body.siteId) return c.json({ error: 'siteId is required' }, 400)
  const billingMode = BILLING_MODES.includes(body.billingMode) ? body.billingMode : 'per_push'
  const [contract] = await db.insert(snowContract).values({
    companyId: user.companyId,
    siteId: String(body.siteId),
    contactId: body.contactId ?? null,
    billingMode,
    perPushRate: rate(body.perPushRate),
    perEventRate: rate(body.perEventRate),
    perInchRate: rate(body.perInchRate),
    seasonalRate: rate(body.seasonalRate),
    triggerDepthInches: rate(body.triggerDepthInches, '2'),
    saltRate: rate(body.saltRate),
    status: body.status ?? 'active',
    notes: body.notes ?? null,
  }).returning()
  audit.log({ action: audit.ACTIONS.CREATE, entity: 'snow_contract', entityId: contract.id, entityName: `${billingMode} contract`, userId: user.userId, companyId: user.companyId })
  return c.json(contract, 201)
})

app.put('/contracts/:id', requirePermission('invoices:update'), async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')
  const body = await c.req.json()
  const patch: Record<string, unknown> = { updatedAt: new Date() }
  for (const k of ['perPushRate', 'perEventRate', 'perInchRate', 'seasonalRate', 'triggerDepthInches', 'saltRate']) {
    if (body[k] !== undefined) patch[k] = rate(body[k], k === 'triggerDepthInches' ? '2' : '0')
  }
  if (body.billingMode && BILLING_MODES.includes(body.billingMode)) patch.billingMode = body.billingMode
  if (body.status) patch.status = body.status
  if (body.notes != null) patch.notes = body.notes
  const [contract] = await db.update(snowContract).set(patch)
    .where(and(eq(snowContract.id, id), eq(snowContract.companyId, user.companyId)))
    .returning()
  if (!contract) return c.json({ error: 'Contract not found' }, 404)
  return c.json(contract)
})

app.delete('/contracts/:id', requirePermission('invoices:delete'), async (c) => {
  const user = c.get('user') as any
  await db.delete(snowContract)
    .where(and(eq(snowContract.id, c.req.param('id')), eq(snowContract.companyId, user.companyId)))
  return c.body(null, 204)
})

// ---- Events ----

app.get('/events', requirePermission('invoices:read'), async (c) => {
  const user = c.get('user') as any
  const contractId = c.req.query('contractId')
  const where = contractId
    ? and(eq(snowEvent.companyId, user.companyId), eq(snowEvent.snowContractId, contractId))
    : eq(snowEvent.companyId, user.companyId)
  const events = await db.select().from(snowEvent).where(where).orderBy(desc(snowEvent.servicedAt))
  return c.json({ data: events })
})

app.post('/events', requirePermission('invoices:create'), async (c) => {
  const user = c.get('user') as any
  const body = await c.req.json()
  if (!body.snowContractId) return c.json({ error: 'snowContractId is required' }, 400)

  const [contract] = await db.select().from(snowContract)
    .where(and(eq(snowContract.id, body.snowContractId), eq(snowContract.companyId, user.companyId)))
  if (!contract) return c.json({ error: 'Contract not found' }, 404)

  const ev = {
    pushes: parseInt(body.pushes ?? '1', 10),
    snowfallInches: Number(body.snowfallInches ?? 0),
    saltApplied: !!body.saltApplied,
  }
  const billableAmount = computeSnowEventCharge(contract as any, ev)

  const [event] = await db.insert(snowEvent).values({
    companyId: user.companyId,
    snowContractId: contract.id,
    siteId: contract.siteId,
    servicedAt: body.servicedAt ? new Date(body.servicedAt) : new Date(),
    pushes: ev.pushes,
    snowfallInches: String(ev.snowfallInches),
    saltApplied: ev.saltApplied,
    billableAmount: String(billableAmount),
    billingMode: contract.billingMode,
    assignedToId: body.assignedToId ?? user.userId ?? null,
    notes: body.notes ?? null,
  }).returning()
  audit.log({ action: audit.ACTIONS.CREATE, entity: 'snow_event', entityId: event.id, entityName: `$${billableAmount} (${contract.billingMode})`, userId: user.userId, companyId: user.companyId })
  return c.json(event, 201)
})

app.delete('/events/:id', requirePermission('invoices:delete'), async (c) => {
  const user = c.get('user') as any
  await db.delete(snowEvent)
    .where(and(eq(snowEvent.id, c.req.param('id')), eq(snowEvent.companyId, user.companyId)))
  return c.body(null, 204)
})

// ---- Billing: unbilled visits → one invoice ----

/** An invoice line for a logged visit: the date and what was charged for (pushes / event / inches, salt). */
export function snowEventLine(ev: { servicedAt: Date | string; pushes: number; snowfallInches: string | number; saltApplied: boolean; billingMode: string; billableAmount: string | number }) {
  const day = new Date(ev.servicedAt).toISOString().slice(0, 10)
  const work = ev.billingMode === 'per_push' ? `${ev.pushes} push${Number(ev.pushes) === 1 ? '' : 'es'}`
    : ev.billingMode === 'per_inch' ? `${Number(ev.snowfallInches)}" snowfall`
    : ev.billingMode === 'per_event' ? 'snow event' : 'seasonal visit'
  return { description: `Snow & ice service ${day} — ${work}${ev.saltApplied ? ' + salt' : ''}`, quantity: 1, unitPrice: Number(ev.billableAmount) }
}

// POST /contracts/:id/bill — puts every unbilled visit with a charge on ONE draft invoice to the contract's customer
// (the site's customer when the contract has none), with the company's default tax rate and payment terms, and marks
// those visits billed. The unbilled visits are locked while the invoice is created, so billing twice at once can't
// invoice a visit twice. Visits with no charge (covered by a seasonal fee) are left as they are.
// (Landscaping T14 H5: a logged storm visit sat "unbilled · $175" with no way to bill it)
app.post('/contracts/:id/bill', requirePermission('invoices:create'), async (c) => {
  const user = c.get('user') as any
  const cid = user.companyId
  const id = c.req.param('id')
  const [row] = await db.select({ contract: snowContract, siteName: site.name, siteContactId: site.contactId })
    .from(snowContract).leftJoin(site, eq(snowContract.siteId, site.id))
    .where(and(eq(snowContract.id, id), eq(snowContract.companyId, cid))).limit(1)
  if (!row) return c.json({ error: 'Contract not found' }, 404)
  const contactId = row.contract.contactId || row.siteContactId
  if (!contactId) return c.json({ error: 'This contract has no customer to bill — set one on the site first.' }, 400)
  const [co] = await db.select({ settings: company.settings }).from(company).where(eq(company.id, cid)).limit(1)
  const settings = (co?.settings as any) || {}

  const result = await db.transaction(async (tx: any) => {
    const unbilled = await tx.select().from(snowEvent)
      .where(and(eq(snowEvent.snowContractId, id), eq(snowEvent.companyId, cid), isNull(snowEvent.invoiceId)))
      .orderBy(asc(snowEvent.servicedAt)).for('update')
    const billable = unbilled.filter((e: any) => Number(e.billableAmount) > 0)
    if (!billable.length) {
      return { error: unbilled.length ? 'These visits have no charge (covered by the seasonal fee), so there is nothing to bill.' : 'There are no unbilled visits on this contract.' }
    }
    const created = await insertInvoice(tx, { invoice, invoiceLineItem } as any, INVOICE_NUMBERING, {
      companyId: cid, contactId, notes: `Snow & ice service — ${row.siteName || 'site'}`,
      dueDate: dueDateFromTerms(settings), issueDate: new Date(), taxRate: defaultTaxRateFrom(settings),
    }, billable.map(snowEventLine))
    await tx.update(snowEvent).set({ invoiceId: created.id }).where(inArray(snowEvent.id, billable.map((e: any) => e.id)))
    return { invoice: created, billedVisits: billable.length }
  })
  if ('error' in result) return c.json({ error: result.error }, 400)
  audit.log({ action: audit.ACTIONS.CREATE, entity: 'invoice', entityId: result.invoice.id, entityName: result.invoice.number, userId: user.userId, companyId: cid, metadata: { source: 'snow_contract', snowContractId: id, visits: result.billedVisits } })
  return c.json(result, 201)
})

// ---- Summary: unbilled totals per contract ----

app.get('/summary', requirePermission('invoices:read'), async (c) => {
  const user = c.get('user') as any
  const contracts = await db.select().from(snowContract)
    .where(eq(snowContract.companyId, user.companyId))
  const events = await db.select().from(snowEvent)
    .where(eq(snowEvent.companyId, user.companyId))
  const summary = contracts.map(ct => {
    const ev = events.filter(e => e.snowContractId === ct.id)
    const unbilled = ev.filter(e => !e.invoiceId)
    const sum = (arr: typeof ev) => arr.reduce((t, e) => t + Number(e.billableAmount), 0)
    return {
      contractId: ct.id, siteId: ct.siteId, billingMode: ct.billingMode,
      seasonalRate: Number(ct.seasonalRate),
      events: ev.length, unbilledEvents: unbilled.length,
      unbilledTotal: Math.round(sum(unbilled) * 100) / 100,
      lifetimeTotal: Math.round(sum(ev) * 100) / 100,
    }
  })
  return c.json({ data: summary })
})

export default app
