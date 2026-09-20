import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { company, contact, measurementReport } from '../../db/schema.ts'
import { eq } from 'drizzle-orm'
import { geocodeAddress, getBuildingInsights, processRoofData } from '../services/googleSolar.ts'
import logger from '../services/logger.ts'

const app = new Hono()

// Public: get estimator config for a company
app.get('/config/:slug', async (c) => {
  const slug = c.req.param('slug')
  const [comp] = await db.select({
    name: company.name,
    slug: company.slug,
    primaryColor: company.primaryColor,
    estimatorEnabled: company.estimatorEnabled,
    pricePerSquareLow: company.pricePerSquareLow,
    pricePerSquareHigh: company.pricePerSquareHigh,
    estimatorHeadline: company.estimatorHeadline,
    estimatorDisclaimer: company.estimatorDisclaimer,
    phone: company.phone,
    email: company.email,
  }).from(company).where(eq(company.slug, slug)).limit(1)

  if (!comp) return c.json({ error: 'Company not found' }, 404)
  if (!comp.estimatorEnabled) return c.json({ error: 'Estimator not enabled' }, 403)

  return c.json(comp)
})

// Public: get instant estimate
app.post('/estimate/:slug', async (c) => {
  const slug = c.req.param('slug')

  const schema = z.object({
    address: z.string().min(1),
    city: z.string().min(1),
    state: z.string().min(1),
    zip: z.string().min(1),
    name: z.string().optional(),
    email: z.string().email().optional(),
    phone: z.string().optional(),
  })

  const estBody = await c.req.json()
  if (typeof estBody.email === 'string') { estBody.email = estBody.email.toLowerCase().trim(); if (!estBody.email) delete estBody.email }
  const data = schema.parse(estBody)

  const [comp] = await db.select().from(company).where(eq(company.slug, slug)).limit(1)
  if (!comp) return c.json({ error: 'Company not found' }, 404)
  if (!comp.estimatorEnabled) return c.json({ error: 'Estimator not enabled' }, 403)

  try {
    const geo = await geocodeAddress(data.address, data.city, data.state, data.zip)
    const insights = await getBuildingInsights(geo.lat, geo.lng)
    const roofData = processRoofData(insights)

    const priceLow = roofData.totalSquares * Number(comp.pricePerSquareLow)
    const priceHigh = roofData.totalSquares * Number(comp.pricePerSquareHigh)

    // Capture lead if contact info provided
    let leadContactId: string | null = null
    if (data.name || data.email || data.phone) {
      const nameParts = (data.name || '').split(' ')
      const firstName = nameParts[0] || 'Website'
      const lastName = nameParts.slice(1).join(' ') || 'Lead'
      try {
        const [created] = await db.insert(contact).values({
          companyId: comp.id,
          firstName,
          lastName,
          email: data.email || null,
          phone: data.phone || null,
          address: data.address,
          city: data.city,
          state: data.state,
          zip: data.zip,
          leadSource: 'instant_estimator',
          propertyType: 'residential',
        }).returning()
        leadContactId = created?.id ?? null
      } catch {
        // Duplicate or other insert error — not critical
      }
    }

    /**
     * M8: the estimate was computed, returned to the visitor, and then thrown away.
     *
     * A lead arrived saying only "Website Lead, instant_estimator" — no squares, no price range, no
     * measurement — so the rep who called them back had less information than the homeowner did. The
     * roof was measured; the measurement is worth keeping.
     *
     * It is stored with jobId null, which the column allows, so it is already there to attach when the
     * lead becomes a job. cost is 0.00 because the public estimator burns no measurement credit —
     * that is verified separately and must stay true.
     */
    try {
      await db.insert(measurementReport).values({
        companyId: comp.id,
        jobId: null,
        address: data.address,
        city: data.city,
        state: data.state,
        zip: data.zip,
        provider: 'google_solar',
        status: 'complete',
        totalSquares: String(roofData.totalSquares),
        totalArea: String(roofData.totalAreaSqft),
        segments: roofData.segments,
        imageryQuality: roofData.imageryQuality,
        center: geo.lat && geo.lng ? { lat: geo.lat, lng: geo.lng } : null,
        cost: '0.00',
        rawData: {
          source: 'instant_estimator',
          estimateLow: Math.round(priceLow),
          estimateHigh: Math.round(priceHigh),
          pricePerSquareLow: Number(comp.pricePerSquareLow),
          pricePerSquareHigh: Number(comp.pricePerSquareHigh),
          contactId: leadContactId,
          servedAt: new Date().toISOString(),
        },
      } as any)
    } catch (e: any) {
      // the visitor still gets their estimate if this fails; it is a record, not the answer
      logger.error('Could not record the instant estimate', { slug, message: e?.message })
    }

    logger.info('Instant estimate served', { slug, squares: roofData.totalSquares })

    return c.json({
      totalSquares: roofData.totalSquares,
      totalAreaSqft: roofData.totalAreaSqft,
      segments: roofData.segments.length,
      imageryQuality: roofData.imageryQuality,
      estimateLow: Math.round(priceLow),
      estimateHigh: Math.round(priceHigh),
      disclaimer: comp.estimatorDisclaimer,
      companyName: comp.name,
      companyPhone: comp.phone,
      companyEmail: comp.email,
    })
  } catch (err: any) {
    logger.error('Instant estimate failed', { slug, error: err.message })
    return c.json({ error: 'Unable to generate estimate for this address. Please try again or contact us directly.' }, 422)
  }
})

export default app
