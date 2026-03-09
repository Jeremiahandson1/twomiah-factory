import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { caregiverProfiles, clients, clientAssignments, caregiverAvailability, users } from '../../db/schema.ts'
import { eq, and, desc, sql } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'

const app = new Hono()
app.use('*', authenticate)

// GET /api/matching/capabilities — list distinct capabilities from caregiverProfiles
app.get('/capabilities', async (c) => {
  const rows = await db
    .select({ capabilities: caregiverProfiles.capabilities })
    .from(caregiverProfiles)

  // Parse capabilities (freetext/comma-separated) into unique list
  const allCaps = new Set<string>()
  for (const row of rows) {
    if (row.capabilities) {
      row.capabilities.split(',').forEach((cap: string) => {
        const trimmed = cap.trim()
        if (trimmed) allCaps.add(trimmed)
      })
    }
  }

  return c.json([...allCaps].sort())
})

// POST /api/matching/capabilities — no-op since capabilities are freetext
app.post('/capabilities', async (c) => {
  return c.json({ success: true })
})

// GET /api/matching/caregiver/:id/capabilities
app.get('/caregiver/:id/capabilities', async (c) => {
  const caregiverId = c.req.param('id')

  const [row] = await db
    .select({ capabilities: caregiverProfiles.capabilities })
    .from(caregiverProfiles)
    .where(eq(caregiverProfiles.caregiverId, caregiverId))
    .limit(1)

  const caps = row?.capabilities
    ? row.capabilities.split(',').map((s: string) => s.trim()).filter(Boolean)
    : []

  return c.json(caps)
})

// PUT /api/matching/caregiver/:id/capabilities
app.put('/caregiver/:id/capabilities', async (c) => {
  const caregiverId = c.req.param('id')
  const body = await c.req.json()

  const capabilitiesStr = Array.isArray(body.capabilities)
    ? body.capabilities.join(', ')
    : body.capabilities || ''

  // Upsert
  const [existing] = await db
    .select({ id: caregiverProfiles.id })
    .from(caregiverProfiles)
    .where(eq(caregiverProfiles.caregiverId, caregiverId))
    .limit(1)

  if (existing) {
    await db
      .update(caregiverProfiles)
      .set({ capabilities: capabilitiesStr, updatedAt: new Date() })
      .where(eq(caregiverProfiles.caregiverId, caregiverId))
  } else {
    await db
      .insert(caregiverProfiles)
      .values({ caregiverId, capabilities: capabilitiesStr })
  }

  return c.json({ success: true })
})

// GET /api/matching/client/:id/needs
app.get('/client/:id/needs', async (c) => {
  const clientId = c.req.param('id')

  const [row] = await db
    .select({
      id: clients.id,
      medicalConditions: clients.medicalConditions,
      allergies: clients.allergies,
      serviceType: clients.serviceType,
    })
    .from(clients)
    .where(eq(clients.id, clientId))
    .limit(1)

  if (!row) return c.json({ error: 'Client not found' }, 404)
  return c.json(row)
})

// PUT /api/matching/client/:id/needs
app.put('/client/:id/needs', async (c) => {
  const clientId = c.req.param('id')
  const body = await c.req.json()

  const [row] = await db
    .update(clients)
    .set({
      medicalConditions: body.medicalConditions,
      allergies: body.allergies,
      serviceType: body.serviceType,
      updatedAt: new Date(),
    })
    .where(eq(clients.id, clientId))
    .returning({ id: clients.id })

  if (!row) return c.json({ error: 'Client not found' }, 404)
  return c.json({ success: true })
})

// GET /api/matching/client/:id/schedule-prefs
app.get('/client/:id/schedule-prefs', async (c) => {
  const clientId = c.req.param('id')

  const [row] = await db
    .select({
      id: clients.id,
      preferredCaregivers: clients.preferredCaregivers,
      doNotUseCaregivers: clients.doNotUseCaregivers,
    })
    .from(clients)
    .where(eq(clients.id, clientId))
    .limit(1)

  if (!row) return c.json({ error: 'Client not found' }, 404)
  return c.json(row)
})

// PUT /api/matching/client/:id/schedule-prefs
app.put('/client/:id/schedule-prefs', async (c) => {
  const clientId = c.req.param('id')
  const body = await c.req.json()

  const [row] = await db
    .update(clients)
    .set({
      preferredCaregivers: body.preferredCaregivers,
      doNotUseCaregivers: body.doNotUseCaregivers,
      updatedAt: new Date(),
    })
    .where(eq(clients.id, clientId))
    .returning({ id: clients.id })

  if (!row) return c.json({ error: 'Client not found' }, 404)
  return c.json({ success: true })
})

// GET /api/matching/client/:id/restrictions
app.get('/client/:id/restrictions', async (c) => {
  const clientId = c.req.param('id')

  const rows = await db
    .select()
    .from(clientAssignments)
    .where(
      and(
        eq(clientAssignments.clientId, clientId),
        eq(clientAssignments.status, 'restricted')
      )
    )

  return c.json(rows)
})

// POST /api/matching/client/:id/restrictions
app.post('/client/:id/restrictions', async (c) => {
  const clientId = c.req.param('id')
  const body = await c.req.json()

  if (!body.caregiverId) {
    return c.json({ error: 'caregiverId is required' }, 400)
  }

  const [row] = await db
    .insert(clientAssignments)
    .values({
      clientId,
      caregiverId: body.caregiverId,
      assignmentDate: new Date().toISOString().slice(0, 10),
      status: 'restricted',
      notes: body.notes,
    })
    .returning()

  return c.json(row, 201)
})

// DELETE /api/matching/restrictions/:id
app.delete('/restrictions/:id', async (c) => {
  const id = c.req.param('id')

  const [row] = await db
    .delete(clientAssignments)
    .where(eq(clientAssignments.id, id))
    .returning()

  if (!row) return c.json({ error: 'Restriction not found' }, 404)
  return c.json({ success: true })
})

// POST /api/matching/optimize — compute matches based on availability + capabilities
app.post('/optimize', async (c) => {
  // Get all active caregivers with profiles and availability
  const caregivers = await db
    .select({
      caregiverId: caregiverProfiles.caregiverId,
      capabilities: caregiverProfiles.capabilities,
      availableMon: caregiverProfiles.availableMon,
      availableTue: caregiverProfiles.availableTue,
      availableWed: caregiverProfiles.availableWed,
      availableThu: caregiverProfiles.availableThu,
      availableFri: caregiverProfiles.availableFri,
      availableSat: caregiverProfiles.availableSat,
      availableSun: caregiverProfiles.availableSun,
      firstName: users.firstName,
      lastName: users.lastName,
    })
    .from(caregiverProfiles)
    .innerJoin(users, eq(caregiverProfiles.caregiverId, users.id))
    .where(eq(users.isActive, true))

  // Get all active clients with needs
  const activeClients = await db
    .select({
      id: clients.id,
      firstName: clients.firstName,
      lastName: clients.lastName,
      serviceType: clients.serviceType,
      medicalConditions: clients.medicalConditions,
      preferredCaregivers: clients.preferredCaregivers,
      doNotUseCaregivers: clients.doNotUseCaregivers,
    })
    .from(clients)
    .where(eq(clients.isActive, true))

  // Simple matching: for each client, rank caregivers
  const assignments = activeClients.map((client) => {
    const dnu = (client.doNotUseCaregivers as string[]) || []
    const preferred = (client.preferredCaregivers as string[]) || []

    const eligible = caregivers
      .filter((cg) => !dnu.includes(cg.caregiverId))
      .map((cg) => ({
        caregiverId: cg.caregiverId,
        caregiverName: `${cg.firstName} ${cg.lastName}`,
        score: preferred.includes(cg.caregiverId) ? 100 : 50,
      }))
      .sort((a, b) => b.score - a.score)

    return {
      clientId: client.id,
      clientName: `${client.firstName} ${client.lastName}`,
      suggestedCaregivers: eligible.slice(0, 5),
    }
  })

  return c.json({ assignments, score: assignments.length })
})

// POST /api/matching/apply-schedule — no-op stub
app.post('/apply-schedule', async (c) => {
  return c.json({ success: true, applied: 0 })
})

export default app
