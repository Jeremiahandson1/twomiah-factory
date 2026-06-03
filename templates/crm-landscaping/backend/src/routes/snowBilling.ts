import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { snowContract, snowEvent, site } from '../../db/schema.ts'
import { eq, and, desc } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'
import audit from '../services/audit.ts'

const app = new Hono()
app.use('*', authenticate)

const BILLING_MODES = ['per_push', 'per_event', 'per_inch', 'seasonal'] as const

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
    perPushRate: String(body.perPushRate ?? '0'),
    perEventRate: String(body.perEventRate ?? '0'),
    perInchRate: String(body.perInchRate ?? '0'),
    seasonalRate: String(body.seasonalRate ?? '0'),
    triggerDepthInches: String(body.triggerDepthInches ?? '2'),
    saltRate: String(body.saltRate ?? '0'),
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
    if (body[k] != null) patch[k] = String(body[k])
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
