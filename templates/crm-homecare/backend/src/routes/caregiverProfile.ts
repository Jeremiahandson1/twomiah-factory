import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { caregiverProfiles } from '../../db/schema.ts'
import { eq } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'

const app = new Hono()
app.use('*', authenticate)

// GET /api/caregiver-profile/:id — get by caregiverId
app.get('/:id', async (c) => {
  const caregiverId = c.req.param('id')

  const [row] = await db
    .select()
    .from(caregiverProfiles)
    .where(eq(caregiverProfiles.caregiverId, caregiverId))
    .limit(1)

  if (!row) return c.json(null)
  return c.json(row)
})

// PUT /api/caregiver-profile/:id — upsert by caregiverId
app.put('/:id', async (c) => {
  const caregiverId = c.req.param('id')
  const body = await c.req.json()

  const [existing] = await db
    .select({ id: caregiverProfiles.id })
    .from(caregiverProfiles)
    .where(eq(caregiverProfiles.caregiverId, caregiverId))
    .limit(1)

  if (existing) {
    const [row] = await db
      .update(caregiverProfiles)
      .set({
        notes: body.notes,
        capabilities: body.capabilities,
        limitations: body.limitations,
        preferredHours: body.preferredHours,
        availableMon: body.availableMon,
        availableTue: body.availableTue,
        availableWed: body.availableWed,
        availableThu: body.availableThu,
        availableFri: body.availableFri,
        availableSat: body.availableSat,
        availableSun: body.availableSun,
        npiNumber: body.npiNumber,
        taxonomyCode: body.taxonomyCode,
        evvWorkerId: body.evvWorkerId,
        medicaidProviderId: body.medicaidProviderId,
        updatedAt: new Date(),
      })
      .where(eq(caregiverProfiles.caregiverId, caregiverId))
      .returning()

    return c.json(row)
  } else {
    const [row] = await db
      .insert(caregiverProfiles)
      .values({
        caregiverId,
        notes: body.notes,
        capabilities: body.capabilities,
        limitations: body.limitations,
        preferredHours: body.preferredHours,
        availableMon: body.availableMon,
        availableTue: body.availableTue,
        availableWed: body.availableWed,
        availableThu: body.availableThu,
        availableFri: body.availableFri,
        availableSat: body.availableSat,
        availableSun: body.availableSun,
        npiNumber: body.npiNumber,
        taxonomyCode: body.taxonomyCode,
        evvWorkerId: body.evvWorkerId,
        medicaidProviderId: body.medicaidProviderId,
      })
      .returning()

    return c.json(row, 201)
  }
})

export default app
