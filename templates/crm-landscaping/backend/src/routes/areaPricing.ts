import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { serviceRate, site } from '../../db/schema.ts'
import { eq, and } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'
import audit from '../services/audit.ts'

const app = new Hono()
app.use('*', authenticate)

// Site columns that can drive area-based pricing
const AREA_FIELDS = ['lawnSqft', 'bedSqft', 'hardscapeSqft', 'lotSqft', 'drivewaySqft'] as const
type AreaField = (typeof AREA_FIELDS)[number]

/** price = max(minCharge, (areaSqft / 1000) * ratePer1000Sqft), rounded to cents */
export function computeAreaPrice(areaSqft: number, ratePer1000Sqft: number, minCharge: number) {
  const raw = (Number(areaSqft) / 1000) * Number(ratePer1000Sqft)
  return Math.round(Math.max(Number(minCharge) || 0, raw) * 100) / 100
}

// ---- Rate card ----

app.get('/rates', requirePermission('quotes:read'), async (c) => {
  const user = c.get('user') as any
  const rates = await db.select().from(serviceRate)
    .where(eq(serviceRate.companyId, user.companyId))
    .orderBy(serviceRate.serviceType)
  return c.json({ data: rates })
})

app.post('/rates', requirePermission('quotes:create'), async (c) => {
  const user = c.get('user') as any
  const body = await c.req.json()
  if (!body.serviceType || body.ratePer1000Sqft == null) {
    return c.json({ error: 'serviceType and ratePer1000Sqft are required' }, 400)
  }
  const areaField: AreaField = AREA_FIELDS.includes(body.areaField) ? body.areaField : 'lawnSqft'
  const [rate] = await db.insert(serviceRate).values({
    companyId: user.companyId,
    serviceType: String(body.serviceType),
    areaField,
    ratePer1000Sqft: String(body.ratePer1000Sqft),
    minCharge: String(body.minCharge ?? '0'),
    unitLabel: body.unitLabel ?? 'per visit',
    active: body.active !== false,
  }).returning()
  audit.log({ action: audit.ACTIONS.CREATE, entity: 'service_rate', entityId: rate.id, entityName: rate.serviceType, userId: user.userId, companyId: user.companyId })
  return c.json(rate, 201)
})

app.put('/rates/:id', requirePermission('quotes:update'), async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')
  const body = await c.req.json()
  const patch: Record<string, unknown> = { updatedAt: new Date() }
  if (body.serviceType != null) patch.serviceType = String(body.serviceType)
  if (body.areaField && AREA_FIELDS.includes(body.areaField)) patch.areaField = body.areaField
  if (body.ratePer1000Sqft != null) patch.ratePer1000Sqft = String(body.ratePer1000Sqft)
  if (body.minCharge != null) patch.minCharge = String(body.minCharge)
  if (body.unitLabel != null) patch.unitLabel = body.unitLabel
  if (body.active != null) patch.active = !!body.active
  const [rate] = await db.update(serviceRate).set(patch)
    .where(and(eq(serviceRate.id, id), eq(serviceRate.companyId, user.companyId)))
    .returning()
  if (!rate) return c.json({ error: 'Rate not found' }, 404)
  return c.json(rate)
})

app.delete('/rates/:id', requirePermission('quotes:delete'), async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')
  await db.delete(serviceRate)
    .where(and(eq(serviceRate.id, id), eq(serviceRate.companyId, user.companyId)))
  return c.body(null, 204)
})

// ---- Site measurements ----

app.put('/sites/:siteId/measurements', requirePermission('contacts:update'), async (c) => {
  const user = c.get('user') as any
  const siteId = c.req.param('siteId')
  const body = await c.req.json()
  const patch: Record<string, unknown> = { updatedAt: new Date(), measuredAt: new Date() }
  for (const f of AREA_FIELDS) {
    if (body[f] != null && body[f] !== '') patch[f] = parseInt(body[f], 10)
  }
  if (body.measurementSource) patch.measurementSource = String(body.measurementSource)
  const [updated] = await db.update(site).set(patch)
    .where(and(eq(site.id, siteId), eq(site.companyId, user.companyId)))
    .returning()
  if (!updated) return c.json({ error: 'Site not found' }, 404)
  return c.json(updated)
})

// ---- Quote a service for a site from its measured area ----

app.get('/quote', requirePermission('quotes:read'), async (c) => {
  const user = c.get('user') as any
  const siteId = c.req.query('siteId')
  const serviceType = c.req.query('serviceType')
  if (!siteId || !serviceType) return c.json({ error: 'siteId and serviceType are required' }, 400)

  const [s] = await db.select().from(site)
    .where(and(eq(site.id, siteId), eq(site.companyId, user.companyId)))
  if (!s) return c.json({ error: 'Site not found' }, 404)

  const [rate] = await db.select().from(serviceRate)
    .where(and(
      eq(serviceRate.companyId, user.companyId),
      eq(serviceRate.serviceType, serviceType),
      eq(serviceRate.active, true),
    ))
  if (!rate) return c.json({ error: `No active rate for service "${serviceType}"` }, 404)

  const areaField = (rate.areaField as AreaField) || 'lawnSqft'
  const areaSqft = Number((s as any)[areaField] ?? 0)
  if (!areaSqft) {
    return c.json({
      error: `Site has no ${areaField} measurement`,
      areaField, needsMeasurement: true,
    }, 422)
  }
  const price = computeAreaPrice(areaSqft, Number(rate.ratePer1000Sqft), Number(rate.minCharge))
  const lineDescription = `${serviceType} — ${areaSqft.toLocaleString()} sq ft @ $${rate.ratePer1000Sqft}/1,000 sq ft (${rate.unitLabel})`
  return c.json({
    siteId, serviceType, areaField, areaSqft,
    ratePer1000Sqft: Number(rate.ratePer1000Sqft),
    minCharge: Number(rate.minCharge),
    minChargeApplied: price <= Number(rate.minCharge),
    price,
    lineItem: { description: lineDescription, quantity: 1, unitPrice: price, total: price },
  })
})

export default app
