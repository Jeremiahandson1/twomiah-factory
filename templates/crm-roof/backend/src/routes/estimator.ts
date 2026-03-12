import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { company, contact } from '../../db/schema.ts'
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
  if (estBody.email && typeof estBody.email === 'string') estBody.email = estBody.email.toLowerCase().trim()
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
    if (data.name || data.email || data.phone) {
      const nameParts = (data.name || '').split(' ')
      const firstName = nameParts[0] || 'Website'
      const lastName = nameParts.slice(1).join(' ') || 'Lead'
      try {
        await db.insert(contact).values({
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
        })
      } catch {
        // Duplicate or other insert error — not critical
      }
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
