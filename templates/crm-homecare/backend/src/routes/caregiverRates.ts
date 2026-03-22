import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { caregiverRates, users } from '../../db/schema.ts'
import { eq, and, desc, isNull, or, lte } from 'drizzle-orm'
import { authenticate, requireAdmin } from '../middleware/auth.ts'

const app = new Hono()
app.use('*', authenticate)

// GET /api/caregiver-rates/:caregiverId — get current effective rates
app.get('/:caregiverId', async (c) => {
  const caregiverId = c.req.param('caregiverId')

  const today = new Date().toISOString().split('T')[0]

  const rows = await db.select()
    .from(caregiverRates)
    .where(and(
      eq(caregiverRates.caregiverId, caregiverId),
      lte(caregiverRates.effectiveDate, today),
      or(isNull(caregiverRates.endDate), lte(today, caregiverRates.endDate)),
    ))
    .orderBy(desc(caregiverRates.effectiveDate))

  // Group by rateType, take most recent for each
  const currentRates: Record<string, any> = {}
  for (const r of rows) {
    if (!currentRates[r.rateType]) {
      currentRates[r.rateType] = r
    }
  }

  return c.json({
    caregiverId,
    base: currentRates['base'] || null,
    overtime: currentRates['overtime'] || null,
    premium: currentRates['premium'] || null,
  })
})

// GET /api/caregiver-rates/:caregiverId/history — full rate history
app.get('/:caregiverId/history', async (c) => {
  const caregiverId = c.req.param('caregiverId')

  const rows = await db.select()
    .from(caregiverRates)
    .where(eq(caregiverRates.caregiverId, caregiverId))
    .orderBy(desc(caregiverRates.effectiveDate))
    .limit(100)

  return c.json(rows)
})

// PUT /api/caregiver-rates/:caregiverId — set/update rates
app.put('/:caregiverId', requireAdmin, async (c) => {
  const caregiverId = c.req.param('caregiverId')
  const user = c.get('user' as any)
  const body = await c.req.json()

  // Verify caregiver exists
  const [cg] = await db.select({ id: users.id }).from(users).where(eq(users.id, caregiverId)).limit(1)
  if (!cg) return c.json({ error: 'Caregiver not found' }, 404)

  const today = new Date().toISOString().split('T')[0]
  const results: any[] = []

  // Process each rate type: base, overtime, premium
  for (const rateType of ['base', 'overtime', 'premium'] as const) {
    const rateValue = body[rateType]
    if (rateValue === undefined || rateValue === null) continue

    const hourlyRate = String(rateValue)
    const effectiveDate = body.effectiveDate || today

    // End-date any existing active rate of this type
    await db.update(caregiverRates)
      .set({ endDate: effectiveDate, updatedAt: new Date() })
      .where(and(
        eq(caregiverRates.caregiverId, caregiverId),
        eq(caregiverRates.rateType, rateType),
        isNull(caregiverRates.endDate),
      ))

    // Insert new rate
    const [newRate] = await db.insert(caregiverRates).values({
      caregiverId,
      rateType,
      hourlyRate,
      effectiveDate,
      notes: body.notes || null,
      createdById: user.userId,
    }).returning()

    results.push(newRate)
  }

  return c.json(results)
})

export default app
