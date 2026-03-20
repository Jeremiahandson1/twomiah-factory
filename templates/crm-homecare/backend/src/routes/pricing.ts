import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { servicePricing, careTypes, caregiverCareTypeRates, users } from '../../db/schema.ts'
import { eq, and, desc } from 'drizzle-orm'
import { authenticate, requireAdmin } from '../middleware/auth.ts'

const app = new Hono()
app.use('*', authenticate, requireAdmin)

// ── SERVICE PRICING ────────────────────────────────────────────────

app.get('/', async (c) => {
  const rows = await db.select()
    .from(servicePricing)
    .where(eq(servicePricing.isActive, true))
    .orderBy(desc(servicePricing.createdAt))

  return c.json(rows)
})

app.post('/', async (c) => {
  const body = await c.req.json()
  const [pricing] = await db.insert(servicePricing).values(body).returning()
  return c.json(pricing, 201)
})

app.put('/:id', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json()
  const [pricing] = await db.update(servicePricing)
    .set({ ...body, updatedAt: new Date() })
    .where(eq(servicePricing.id, id))
    .returning()

  return c.json(pricing)
})

app.delete('/:id', async (c) => {
  const id = c.req.param('id')
  const [pricing] = await db.update(servicePricing)
    .set({ isActive: false, updatedAt: new Date() })
    .where(eq(servicePricing.id, id))
    .returning()

  return c.json(pricing)
})

// ── MARGIN ANALYSIS ─────────────────────────────────────────────

app.get('/margins', async (c) => {
  const rows = await db.select()
    .from(servicePricing)
    .where(eq(servicePricing.isActive, true))

  const margins = rows.map(p => {
    const clientRate = parseFloat(p.clientHourlyRate || '0')
    const caregiverRate = parseFloat(p.caregiverHourlyRate || '0')
    const margin = clientRate > 0 ? ((clientRate - caregiverRate) / clientRate * 100) : 0

    return {
      id: p.id,
      serviceType: p.serviceType,
      clientHourlyRate: clientRate,
      caregiverHourlyRate: caregiverRate,
      marginDollars: clientRate - caregiverRate,
      marginPercent: margin.toFixed(1),
    }
  })

  return c.json(margins)
})

// ── CARE TYPE RATES ─────────────────────────────────────────────

app.get('/care-type-rates', async (c) => {
  const { caregiverId, careTypeId } = c.req.query()
  const conditions = []
  if (caregiverId) conditions.push(eq(caregiverCareTypeRates.caregiverId, caregiverId))
  if (careTypeId) conditions.push(eq(caregiverCareTypeRates.careTypeId, careTypeId))

  const where = conditions.length > 0 ? and(...conditions) : undefined

  const rows = await db.select({
    rate: caregiverCareTypeRates,
    careTypeName: careTypes.name,
    caregiverFirstName: users.firstName,
    caregiverLastName: users.lastName,
  })
    .from(caregiverCareTypeRates)
    .leftJoin(careTypes, eq(caregiverCareTypeRates.careTypeId, careTypes.id))
    .leftJoin(users, eq(caregiverCareTypeRates.caregiverId, users.id))
    .where(where)

  return c.json(rows.map(r => ({
    ...r.rate,
    careTypeName: r.careTypeName,
    caregiverName: r.caregiverFirstName ? `${r.caregiverFirstName} ${r.caregiverLastName}` : null,
  })))
})

app.post('/care-type-rates', async (c) => {
  const body = await c.req.json()
  const [rate] = await db.insert(caregiverCareTypeRates).values(body).returning()
  return c.json(rate, 201)
})

app.put('/care-type-rates/:id', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json()
  const [rate] = await db.update(caregiverCareTypeRates)
    .set({ ...body, updatedAt: new Date() })
    .where(eq(caregiverCareTypeRates.id, id))
    .returning()

  return c.json(rate)
})

export default app
