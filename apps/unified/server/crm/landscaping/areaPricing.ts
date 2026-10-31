// Area-based pricing: a per-company rate card priced per 1,000 sq ft of a property's measured area, the property's
// measurements, and a quote for one service at one property. Moved from
// templates/crm-landscaping/backend/src/routes/areaPricing.ts. The registry signs the person in and applies the
// 'area_pricing' gate.
import { Hono } from 'hono'
import { eq, and, sql } from 'drizzle-orm'
import { serviceRate, site, quote, quoteLineItem } from '../../db/schema/index.ts'
import { retotalQuote } from '@twomiah/tenant-backend'
import { readShapes, replaceShapes, shapesOf } from '../../data/siteShapes.ts'
import type { CrmDeps } from '../deps.ts'
import type { AppEnv } from '../../http/env.ts'
import { readNumber, type NumberRule } from '../../http/numberInput.ts'
import { fail, one, listAll } from '../../http/reply.ts'

// Site columns that can drive area-based pricing
const AREA_FIELDS = ['lawnSqft', 'bedSqft', 'hardscapeSqft', 'lotSqft', 'drivewaySqft'] as const
type AreaField = (typeof AREA_FIELDS)[number]
const isAreaField = (v: unknown): v is AreaField => typeof v === 'string' && (AREA_FIELDS as readonly string[]).includes(v)
const AREA_LABELS: Record<AreaField, string> = { lawnSqft: 'Lawn area', bedSqft: 'Bed area', hardscapeSqft: 'Hardscape area', lotSqft: 'Lot size', drivewaySqft: 'Driveway area' }
/** The rate card's two numbers: the rate is required, the minimum charge is $0 when left blank. */
const RATE: NumberRule = { label: 'Rate per 1,000 sq ft', min: 0, max: 1_000_000, example: '12.50' }
const MIN_CHARGE: NumberRule = { label: 'Minimum charge', blank: 0, min: 0, max: 1_000_000, example: '45' }

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
    if (!body.serviceType || String(body.serviceType).trim() === '') return fail(c, 400, 'Name the service this rate is for.', undefined, { serviceType: 'Name the service this rate is for.' })
    // A blank or non-number box is refused by name, not passed to the numeric column (http/numberInput.ts).
    const ratePer = readNumber(body.ratePer1000Sqft, RATE)
    if (ratePer.error) return fail(c, 400, ratePer.error, undefined, { ratePer1000Sqft: ratePer.error })
    const min = readNumber(body.minCharge, MIN_CHARGE)
    if (min.error) return fail(c, 400, min.error, undefined, { minCharge: min.error })
    const areaField: AreaField = isAreaField(body.areaField) ? body.areaField : 'lawnSqft'
    const [rate] = await db.insert(serviceRate).values({
      companyId: u.companyId,
      serviceType: String(body.serviceType),
      areaField,
      ratePer1000Sqft: String(ratePer.value),
      minCharge: String(min.value ?? 0),
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
    if (body.ratePer1000Sqft !== undefined) {
      const ratePer = readNumber(body.ratePer1000Sqft, RATE)
      if (ratePer.error) return fail(c, 400, ratePer.error, undefined, { ratePer1000Sqft: ratePer.error })
      patch.ratePer1000Sqft = String(ratePer.value)
    }
    if (body.minCharge !== undefined) {
      const min = readNumber(body.minCharge, MIN_CHARGE)
      if (min.error) return fail(c, 400, min.error, undefined, { minCharge: min.error })
      patch.minCharge = String(min.value ?? 0)
    }
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
    // A blank box leaves the measurement alone; anything else must be whole square feet ('abc' was parseInt'd to NaN
    // and refused by the database as "not in a valid format").
    for (const f of AREA_FIELDS) {
      if (body[f] === undefined || body[f] === null || String(body[f]).trim() === '') continue
      const area = readNumber(body[f], { label: AREA_LABELS[f], min: 0, max: 100_000_000, example: '4500' })
      if (area.error) return fail(c, 400, area.error, undefined, { [f]: area.error })
      patch[f] = Math.round(area.value as number)
    }
    if (body.measurementSource) patch.measurementSource = String(body.measurementSource)
    const [updated] = await db.update(site).set(patch)
      .where(and(eq(site.id, siteId), eq(site.companyId, u.companyId)))
      .returning()
    if (!updated) return fail(c, 404, 'Site not found')
    return one(c, updated)
  })

  // ---- Shapes drawn on the satellite map ----

  // GET /api/area-pricing/sites/:siteId/shapes — what is drawn on the property, with the area of each
  app.get('/sites/:siteId/shapes', requirePermission('contacts:read'), async (c) => {
    const u = c.get('user')
    const [s] = await db.select({ id: site.id }).from(site).where(and(eq(site.id, c.req.param('siteId')), eq(site.companyId, u.companyId))).limit(1)
    if (!s) return fail(c, 404, 'Site not found')
    return listAll(c, await shapesOf(db, u.companyId, s.id))
  })

  // PUT /api/area-pricing/sites/:siteId/shapes { shapes: [{ areaType, mode?, label?, path: [[lat, lng], …] }] } — the whole set. The
  // server measures each shape and sets the property's lawn/bed/… columns to the sum, which is what the rate card prices.
  app.put('/sites/:siteId/shapes', requirePermission('contacts:update'), async (c) => {
    const u = c.get('user')
    const body: any = await c.req.json().catch(() => ({}))
    const read = readShapes(body?.shapes)
    if ('error' in read) return fail(c, 400, read.error, undefined, { shapes: read.error })
    const updated = await replaceShapes(db, u.companyId, c.req.param('siteId'), read.shapes)
    if (!updated) return fail(c, 404, 'Site not found')
    audit.log({ req: c, action: audit.ACTIONS.UPDATE, entity: 'site_measurements', entityId: updated.id, entityName: updated.name, userId: u.userId, companyId: u.companyId, metadata: { shapes: read.shapes.length, source: 'map' } })
    return one(c, { site: updated, shapes: await shapesOf(db, u.companyId, updated.id) })
  })

  // ---- Quote a service for a site from its measured area ----

  // The price of one service at one property — the line a quote takes. Shared by the calculator and "Add to quote".
  const priceFor = async (companyId: string, siteId: string, serviceType: string) => {
    const [s] = await db.select().from(site).where(and(eq(site.id, siteId), eq(site.companyId, companyId)))
    if (!s) return { status: 404 as const, error: 'Site not found' }
    const [rate] = await db.select().from(serviceRate)
      .where(and(eq(serviceRate.companyId, companyId), eq(serviceRate.serviceType, serviceType), eq(serviceRate.active, true)))
    if (!rate) return { status: 404 as const, error: `No active rate for service "${serviceType}"` }
    const areaField: AreaField = isAreaField(rate.areaField) ? rate.areaField : 'lawnSqft'
    const areaSqft = Number((s as Record<string, unknown>)[areaField] ?? 0)
    if (!areaSqft) return { status: 422 as const, error: `Site has no ${areaField} measurement`, code: 'NEEDS_MEASUREMENT' }
    const price = computeAreaPrice(areaSqft, Number(rate.ratePer1000Sqft), Number(rate.minCharge))
    const lineDescription = `${serviceType} — ${areaSqft.toLocaleString()} sq ft @ $${rate.ratePer1000Sqft}/1,000 sq ft (${rate.unitLabel})`
    return { s, rate, areaField, areaSqft, price, lineDescription }
  }

  // POST /api/area-pricing/quote/add { quoteId, siteId, serviceType, optional? } — the service's price for the property as a new
  // line on an open quote (draft or sent), the totals worked out again. The price is the rate card's, never the screen's.
  app.post('/quote/add', requirePermission('quotes:update'), async (c) => {
    const u = c.get('user')
    const b: any = await c.req.json().catch(() => ({}))
    if (!b?.quoteId || !b?.siteId || !b?.serviceType) return fail(c, 400, 'Choose the quote, the property and the service.')
    const [q] = await db.select().from(quote).where(and(eq(quote.id, String(b.quoteId)), eq(quote.companyId, u.companyId))).limit(1)
    if (!q) return fail(c, 404, 'Quote not found')
    if (!['draft', 'sent'].includes(q.status)) return fail(c, 409, `This quote is ${q.status}: its lines can no longer change.`)
    const priced: any = await priceFor(u.companyId, String(b.siteId), String(b.serviceType))
    if ('status' in priced) return fail(c, priced.status, priced.error, priced.code)
    const optional = b.optional === true
    const out = await db.transaction(async (tx: any) => {
      const [{ next }] = await tx.select({ next: sql<number>`COALESCE(MAX(${quoteLineItem.sortOrder}), -1) + 1` }).from(quoteLineItem).where(eq(quoteLineItem.quoteId, q.id))
      const [line] = await tx.insert(quoteLineItem).values({
        quoteId: q.id, description: priced.lineDescription, type: 'service', quantity: '1', unitPrice: String(priced.price), total: String(priced.price),
        sortOrder: Number(next), optional, selected: !optional,
      }).returning()
      const re = await retotalQuote(tx, { quote, quoteLineItem }, u.companyId, q.id)
      return { line, quote: re?.quote }
    })
    d.realtime.emitToCompany(u.companyId, d.realtime.EVENTS.QUOTE_UPDATED, { id: q.id })
    audit.log({ req: c, action: audit.ACTIONS.UPDATE, entity: 'quote', entityId: q.id, entityName: q.number, userId: u.userId, companyId: u.companyId, metadata: { added: priced.lineDescription, optional } })
    return one(c, { line: out.line, quote: out.quote }, 201)
  })

  app.get('/quote', requirePermission('quotes:read'), async (c) => {
    const u = c.get('user')
    const siteId = c.req.query('siteId')
    const serviceType = c.req.query('serviceType')
    if (!siteId || !serviceType) return fail(c, 400, 'siteId and serviceType are required')
    const p: any = await priceFor(u.companyId, siteId, serviceType)
    // The reply also carried { areaField, needsMeasurement: true } in the template; no screen read them (the page shows the
    // sentence), so the field is named in the sentence and the case has a code (RULEBOOK §3).
    if ('status' in p) return fail(c, p.status, p.error, p.code)
    return one(c, {
      siteId, serviceType, areaField: p.areaField, areaSqft: p.areaSqft,
      ratePer1000Sqft: Number(p.rate.ratePer1000Sqft),
      minCharge: Number(p.rate.minCharge),
      minChargeApplied: p.price <= Number(p.rate.minCharge),
      price: p.price,
      lineItem: { description: p.lineDescription, quantity: 1, unitPrice: p.price, total: p.price },
    })
  })

  return app
}
