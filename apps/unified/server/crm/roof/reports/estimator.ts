// The instant estimator: a homeowner types an address on the roofer's website and gets a price range from the roof's
// measured squares and the company's own price per square. Moved from templates/crm-roof/backend/src/routes/
// estimator.ts (public, no sign-in) and the estimator part of routes/settings.ts (PUT /api/settings/estimator). The
// measuring is packages/roof-core's.
//
// Changes from the template:
//   · the lead it captures is a CRM contact with one `name` (decision 3; "Website Lead" when none is given) and
//     roofing's lead_source is the CRM's `source`;
//   · the public estimator is mounted behind instant_estimator — the menu's switch for it — so a business without the
//     feature has no public estimator (404); the company's own "estimator enabled" setting still refuses with 403;
//   · the settings write asks company:update (owner and admin — the rank the template's requireAdmin named), validates
//     the prices as money, and replies { success, message };
//   · a bad body is the rulebook's validation reply (400, `fields`).
//
// /api/settings' /company and /branding are not moved: they are the CRM's own company record, GET and PUT /api/company
// (server/modules/company.ts, the shared createCompanyRoutes), which reads the whole company — the estimator columns and
// slug included — and writes the name, contact details, address and brand colour (admin; a hex colour checked).
import { Hono } from 'hono'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { geocodeAddress, getBuildingInsights, processRoofData } from '@twomiah/roof-core'
import { normaliseZip, ZIP_ERROR } from '@twomiah/tenant-backend'
import { company, contact, measurementReport } from '../../../db/schema/index.ts'
import { invalid } from '../../../http/errors.ts'
import type { AppEnv } from '../../../http/env.ts'
import { fail, one, done } from '../../../http/reply.ts'
import type { CrmDeps } from '../../deps.ts'
import { email as emailShape, optional } from '../validation.ts'
import { recordConsent } from '../../../site/smsConsent.ts'

const estimateSchema = z.object({
  address: z.string().min(1),
  city: z.string().min(1),
  state: z.string().min(1),
  zip: z.string().min(1).refine((v) => normaliseZip(v) !== null, { message: ZIP_ERROR }),
  name: z.string().optional(),
  email: optional(emailShape),
  phone: z.string().optional(),
})

/** A price per square as the column stores it: a decimal string, not negative. */
const pricePerSquare = z.union([z.string(), z.number()]).transform((v) => String(v).trim())
  .refine((v) => /^\d+(\.\d{1,2})?$/.test(v), { message: 'must be an amount like 350.00' })

const settingsSchema = z.object({
  estimatorEnabled: z.boolean(),
  pricePerSquareLow: pricePerSquare,
  pricePerSquareHigh: pricePerSquare,
  estimatorHeadline: z.string(),
  estimatorDisclaimer: z.string(),
})

/** /api/estimator — public. */
export function createEstimatorRoutes(d: CrmDeps) {
  const { db, logger } = d
  const app = new Hono<AppEnv>()

  // GET /config/:slug — what the widget shows: the company's name, colour, headline, disclaimer and price per square.
  app.get('/config/:slug', async (c) => {
    const [comp] = await db.select({
      name: company.name, slug: company.slug, primaryColor: company.primaryColor, estimatorEnabled: company.estimatorEnabled,
      pricePerSquareLow: company.pricePerSquareLow, pricePerSquareHigh: company.pricePerSquareHigh,
      estimatorHeadline: company.estimatorHeadline, estimatorDisclaimer: company.estimatorDisclaimer,
      phone: company.phone, email: company.email,
    }).from(company).where(eq(company.slug, c.req.param('slug'))).limit(1)
    if (!comp) return fail(c, 404, 'Company not found')
    if (!comp.estimatorEnabled) return fail(c, 403, 'Estimator not enabled')
    return one(c, comp)
  })

  // POST /estimate/:slug — measure the roof, price it at the company's own low and high per square, keep the lead.
  app.post('/estimate/:slug', async (c) => {
    const slug = c.req.param('slug')
    const body: any = (await c.req.json().catch(() => null)) ?? {}
    if (typeof body.email === 'string') body.email = body.email.toLowerCase().trim()
    const parsed = estimateSchema.safeParse(body)
    if (!parsed.success) return invalid(c, parsed.error)
    const data = parsed.data
    const [comp] = await db.select().from(company).where(eq(company.slug, slug)).limit(1)
    if (!comp) return fail(c, 404, 'Company not found')
    if (!comp.estimatorEnabled) return fail(c, 403, 'Estimator not enabled')

    try {
      const geo = await geocodeAddress(data.address, data.city, data.state, data.zip)
      const insights = await getBuildingInsights(geo.lat, geo.lng)
      const roofData = processRoofData(insights)
      const priceLow = roofData.totalSquares * Number(comp.pricePerSquareLow)
      const priceHigh = roofData.totalSquares * Number(comp.pricePerSquareHigh)

      // The visitor who left a way to reach them is a lead.
      let leadContactId: string | null = null
      if (data.name || data.email || data.phone) {
        try {
          const [created] = await db.insert(contact).values({
            companyId: comp.id, type: 'lead', name: data.name?.trim() || 'Website Lead',
            email: data.email || null, phone: data.phone || null,
            address: data.address, city: data.city, state: data.state, zip: data.zip,
            source: 'instant_estimator', propertyType: 'residential',
          } as any).returning()
          leadContactId = created?.id ?? null
        } catch { /* a duplicate or other insert error — the estimate still goes back */ }
      }
      // The widget's "Text me about my estimate" (site/smsConsent.ts; the box is in site/public/scripts/estimator.ts).
      if (data.phone && body.smsConsent === true) {
        await recordConsent(db, comp.id, { phone: data.phone, source: 'website_form', topic: 'estimate', page: c.req.header('referer') || null, ip: c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || null })
          .catch(() => { /* the estimate still goes back */ })
      }

      // M8: the measurement is kept (no job yet, no credit spent — cost 0.00), so the rep who calls back has the squares
      // and the range the homeowner was shown.
      try {
        await db.insert(measurementReport).values({
          companyId: comp.id, jobId: null, address: data.address, city: data.city, state: data.state, zip: data.zip,
          provider: 'google_solar', status: 'complete',
          totalSquares: String(roofData.totalSquares), totalArea: String(roofData.totalAreaSqft),
          segments: roofData.segments, imageryQuality: roofData.imageryQuality,
          center: geo.lat && geo.lng ? { lat: geo.lat, lng: geo.lng } : null,
          cost: '0.00',
          rawData: {
            source: 'instant_estimator', estimateLow: Math.round(priceLow), estimateHigh: Math.round(priceHigh),
            pricePerSquareLow: Number(comp.pricePerSquareLow), pricePerSquareHigh: Number(comp.pricePerSquareHigh),
            contactId: leadContactId, servedAt: new Date().toISOString(),
          },
        } as any)
      } catch (e: any) {
        logger.error('Could not record the instant estimate', { slug, message: e?.message })
      }

      logger.info('Instant estimate served', { slug, squares: roofData.totalSquares })
      return one(c, {
        totalSquares: roofData.totalSquares, totalAreaSqft: roofData.totalAreaSqft, segments: roofData.segments.length,
        imageryQuality: roofData.imageryQuality, estimateLow: Math.round(priceLow), estimateHigh: Math.round(priceHigh),
        disclaimer: comp.estimatorDisclaimer, companyName: comp.name, companyPhone: comp.phone, companyEmail: comp.email,
      })
    } catch (err: any) {
      logger.error('Instant estimate failed', { slug, error: err?.message })
      return fail(c, 422, 'Unable to generate estimate for this address. Please try again or contact us directly.')
    }
  })

  return app
}

/** /api/settings — the estimator's settings (the template's settings router's PUT /estimator). */
export function createEstimatorSettingsRoutes(d: CrmDeps) {
  const { db } = d
  const app = new Hono<AppEnv>()
  app.put('/estimator', d.permissions.requirePermission('company:update'), async (c) => {
    const parsed = settingsSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return invalid(c, parsed.error)
    await db.update(company).set({ ...parsed.data, updatedAt: new Date() } as any).where(eq(company.id, c.get('user').companyId))
    return done(c, 'Saved')
  })
  return app
}
