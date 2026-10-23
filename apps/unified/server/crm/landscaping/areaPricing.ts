// Area-based pricing: a per-company rate card priced per 1,000 sq ft of a property's measured area, the property's
// measurements, and a quote for one service at one property. Moved from
// templates/crm-landscaping/backend/src/routes/areaPricing.ts. The registry signs the person in and applies the
// 'area_pricing' gate.
import { Hono } from 'hono'
import { eq, and } from 'drizzle-orm'
import { serviceRate, site } from '../../db/schema/index.ts'
import type { CrmDeps } from '../deps.ts'
import type { AppEnv } from '../../http/env.ts'
import { fail, one, listAll } from '../../http/reply.ts'

// Site columns that can drive area-based pricing
const AREA_FIELDS = ['lawnSqft', 'bedSqft', 'hardscapeSqft', 'lotSqft', 'drivewaySqft'] as const
type AreaField = (typeof AREA_FIELDS)[number]
const isAreaField = (v: unknown): v is AreaField => typeof v === 'string' && (AREA_FIELDS as readonly string[]).includes(v)

/** price = max(minCharge, (areaSqft / 1000) * ratePer1000Sqft), rounded to cents */
export function computeAreaPrice(areaSqft: number, ratePer1000Sqft: number, minCharge: number) {
  const raw = (Number(areaSqft) / 1000) * Number(ratePer1000Sqft)
  return Math.round(Math.max(Number(minCharge) || 0, raw) * 100) / 100
}

export function createAreaPricingRoutes(d: CrmDeps) {
  const { db, audit } = d
  const { requirePermission } = d.permissions
  const app = new Hono<AppEnv>()

  // ---- Rate card ----

  app.get('/rates', requirePermission('quotes:read'), async (c) => {
    const u = c.get('user')
    const rates = await db.select().from(serviceRate).where(eq(serviceRate.companyId, u.companyId)).orderBy(serviceRate.serviceType)
    return listAll(c, rates)
  })

  app.post('/rates', requirePermission('quotes:create'), async (c) => {
    const u = c.get('user')
    const body = await c.req.json()
    if (!body.serviceType || body.ratePer1000Sqft == null) return fail(c, 400, 'serviceType and ratePer1000Sqft are required')
    const areaField: AreaField = isAreaField(body.areaField) ? body.areaField : 'lawnSqft'
    const [rate] = await db.insert(serviceRate).values({
      companyId: u.companyId,
      serviceType: String(body.serviceType),
      areaField,
      ratePer1000Sqft: String(body.ratePer1000Sqft),
      minCharge: String(body.minCharge ?? '0'),
      unitLabel: body.unitLabel ?? 'per visit',
      active: body.active !== false,
    }).returning()
    audit.log({ req: c, action: audit.ACTIONS.CREATE, entity: 'service_rate', entityId: rate.id, entityName: rate.serviceType, userId: u.userId, companyId: u.companyId })
    return one(c, rate, 201)
  })

  app.put('/rates/:id', requirePermission('quotes:update'), async (c) => {
    const u = c.get('user')
    const id = c.req.param('id')
    const body = await c.req.json()
    const patch: Record<string, unknown> = { updatedAt: new Date() }
    if (body.serviceType != null) patch.serviceType = String(body.serviceType)
    if (isAreaField(body.areaField)) patch.areaField = body.areaField
    if (body.ratePer1000Sqft != null) patch.ratePer1000Sqft = String(body.ratePer1000Sqft)
    if (body.minCharge != null) patch.minCharge = String(body.minCharge)
    if (body.unitLabel != null) patch.unitLabel = body.unitLabel
    if (body.active != null) patch.active = !!body.active
    const [rate] = await db.update(serviceRate).set(patch)
      .where(and(eq(serviceRate.id, id), eq(serviceRate.companyId, u.companyId)))
      .returning()
    if (!rate) return fail(c, 404, 'Rate not found')
    // A rate prices every quote made from it; the template logged its creation only.
    audit.log({ req: c, action: audit.ACTIONS.UPDATE, entity: 'service_rate', entityId: rate.id, entityName: rate.serviceType, userId: u.userId, companyId: u.companyId })
    return one(c, rate)
  })

  app.delete('/rates/:id', requirePermission('quotes:delete'), async (c) => {
    const u = c.get('user')
    const [gone] = await db.delete(serviceRate).where(and(eq(serviceRate.id, c.req.param('id')), eq(serviceRate.companyId, u.companyId))).returning()
    if (!gone) return fail(c, 404, 'Rate not found')
    audit.log({ req: c, action: audit.ACTIONS.DELETE, entity: 'service_rate', entityId: gone.id, entityName: gone.serviceType, userId: u.userId, companyId: u.companyId })
    return c.body(null, 204)
  })

  // ---- Site measurements ----

  app.put('/sites/:siteId/measurements', requirePermission('contacts:update'), async (c) => {
    const u = c.get('user')
    const siteId = c.req.param('siteId')
    const body = await c.req.json()
    const patch: Record<string, unknown> = { updatedAt: new Date(), measuredAt: new Date() }
    for (const f of AREA_FIELDS) {
      if (body[f] != null && body[f] !== '') patch[f] = parseInt(body[f], 10)
    }
    if (body.measurementSource) patch.measurementSource = String(body.measurementSource)
    const [updated] = await db.update(site).set(patch)
      .where(and(eq(site.id, siteId), eq(site.companyId, u.companyId)))
      .returning()
    if (!updated) return fail(c, 404, 'Site not found')
    return one(c, updated)
  })

  // ---- Quote a service for a site from its measured area ----

  app.get('/quote', requirePermission('quotes:read'), async (c) => {
    const u = c.get('user')
    const siteId = c.req.query('siteId')
    const serviceType = c.req.query('serviceType')
    if (!siteId || !serviceType) return fail(c, 400, 'siteId and serviceType are required')

    const [s] = await db.select().from(site).where(and(eq(site.id, siteId), eq(site.companyId, u.companyId)))
    if (!s) return fail(c, 404, 'Site not found')

    const [rate] = await db.select().from(serviceRate)
      .where(and(eq(serviceRate.companyId, u.companyId), eq(serviceRate.serviceType, serviceType), eq(serviceRate.active, true)))
    if (!rate) return fail(c, 404, `No active rate for service "${serviceType}"`)

    const areaField: AreaField = isAreaField(rate.areaField) ? rate.areaField : 'lawnSqft'
    const areaSqft = Number((s as Record<string, unknown>)[areaField] ?? 0)
    // The template's reply also carried { areaField, needsMeasurement: true }; no screen read them (the page shows the
    // sentence), so the field is named in the sentence and the case has a code (RULEBOOK §3).
    if (!areaSqft) return fail(c, 422, `Site has no ${areaField} measurement`, 'NEEDS_MEASUREMENT')
    const price = computeAreaPrice(areaSqft, Number(rate.ratePer1000Sqft), Number(rate.minCharge))
    const lineDescription = `${serviceType} — ${areaSqft.toLocaleString()} sq ft @ $${rate.ratePer1000Sqft}/1,000 sq ft (${rate.unitLabel})`
    return one(c, {
      siteId, serviceType, areaField, areaSqft,
      ratePer1000Sqft: Number(rate.ratePer1000Sqft),
      minCharge: Number(rate.minCharge),
      minChargeApplied: price <= Number(rate.minCharge),
      price,
      lineItem: { description: lineDescription, quantity: 1, unitPrice: price, total: price },
    })
  })

  return app
}
