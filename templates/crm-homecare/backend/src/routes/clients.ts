import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { db } from '../../db/index.ts'
import {
  clients,
  clientEmergencyContacts,
  clientOnboarding,
  clientAssignments,
  referralSources,
  geofenceSettings,
  authorizations,
  users,
} from '../../db/schema.ts'
import { eq, and, or, ilike, count, desc, asc } from 'drizzle-orm'
import { authenticate, requireAdmin } from '../middleware/auth.ts'

const app = new Hono()
app.use('*', authenticate)

// GET /api/clients
app.get('/', async (c) => {
  const { search, isActive, serviceType, page = '1', limit = '50' } = c.req.query()
  const skip = (parseInt(page) - 1) * parseInt(limit)

  const conditions: any[] = []
  if (isActive !== undefined) conditions.push(eq(clients.isActive, isActive === 'true'))
  if (serviceType) conditions.push(eq(clients.serviceType, serviceType))
  if (search) {
    conditions.push(
      or(
        ilike(clients.firstName, '%' + search + '%'),
        ilike(clients.lastName, '%' + search + '%'),
        ilike(clients.phone, '%' + search + '%'),
        ilike(clients.email, '%' + search + '%'),
      )
    )
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined

  const [clientRows, [{ value: total }]] = await Promise.all([
    db
      .select()
      .from(clients)
      .where(whereClause)
      .orderBy(desc(clients.isActive), asc(clients.lastName))
      .offset(skip)
      .limit(parseInt(limit)),
    db.select({ value: count() }).from(clients).where(whereClause),
  ])

  // Fetch related data for the client list
  const clientIds = clientRows.map((cl) => cl.id)

  let emergencyContactsMap: Record<string, any[]> = {}
  let onboardingMap: Record<string, any> = {}
  let assignmentsMap: Record<string, any[]> = {}

  if (clientIds.length > 0) {
    const { inArray } = await import('drizzle-orm')

    const [ecRows, obRows, assignRows] = await Promise.all([
      db
        .select()
        .from(clientEmergencyContacts)
        .where(and(inArray(clientEmergencyContacts.clientId, clientIds), eq(clientEmergencyContacts.isPrimary, true))),
      db
        .select({ clientId: clientOnboarding.clientId, allCompleted: clientOnboarding.allCompleted })
        .from(clientOnboarding)
        .where(inArray(clientOnboarding.clientId, clientIds)),
      db
        .select({
          id: clientAssignments.id,
          clientId: clientAssignments.clientId,
          caregiverId: clientAssignments.caregiverId,
          assignmentDate: clientAssignments.assignmentDate,
          hoursPerWeek: clientAssignments.hoursPerWeek,
          payRate: clientAssignments.payRate,
          status: clientAssignments.status,
          notes: clientAssignments.notes,
          createdAt: clientAssignments.createdAt,
          updatedAt: clientAssignments.updatedAt,
          caregiverFirstName: users.firstName,
          caregiverLastName: users.lastName,
        })
        .from(clientAssignments)
        .leftJoin(users, eq(clientAssignments.caregiverId, users.id))
        .where(and(inArray(clientAssignments.clientId, clientIds), eq(clientAssignments.status, 'active'))),
    ])

    for (const ec of ecRows) {
      if (!emergencyContactsMap[ec.clientId]) emergencyContactsMap[ec.clientId] = []
      emergencyContactsMap[ec.clientId].push(ec)
    }
    for (const ob of obRows) {
      onboardingMap[ob.clientId] = { allCompleted: ob.allCompleted }
    }
    for (const a of assignRows) {
      if (!assignmentsMap[a.clientId]) assignmentsMap[a.clientId] = []
      const { caregiverFirstName, caregiverLastName, ...assignment } = a
      assignmentsMap[a.clientId].push({
        ...assignment,
        caregiver: { firstName: caregiverFirstName, lastName: caregiverLastName },
      })
    }
  }

  // Strip SSN and attach relations
  const safeClients = clientRows.map(({ ssnEncrypted: _, ...cl }) => ({
    ...cl,
    emergencyContacts: emergencyContactsMap[cl.id] || [],
    onboarding: onboardingMap[cl.id] || null,
    assignments: assignmentsMap[cl.id] || [],
  }))

  return c.json({ clients: safeClients, total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) })
})

// GET /api/clients/:id
app.get('/:id', async (c) => {
  const id = c.req.param('id')

  const [client] = await db.select().from(clients).where(eq(clients.id, id)).limit(1)
  if (!client) throw new HTTPException(404, { message: 'Client not found' })

  const [ecRows, obRows, assignRows, refRows, geoRows, authRows] = await Promise.all([
    db.select().from(clientEmergencyContacts).where(eq(clientEmergencyContacts.clientId, id)),
    db.select().from(clientOnboarding).where(eq(clientOnboarding.clientId, id)).limit(1),
    db
      .select({
        id: clientAssignments.id,
        clientId: clientAssignments.clientId,
        caregiverId: clientAssignments.caregiverId,
        assignmentDate: clientAssignments.assignmentDate,
        hoursPerWeek: clientAssignments.hoursPerWeek,
        payRate: clientAssignments.payRate,
        status: clientAssignments.status,
        notes: clientAssignments.notes,
        createdAt: clientAssignments.createdAt,
        updatedAt: clientAssignments.updatedAt,
        caregiverFirstName: users.firstName,
        caregiverLastName: users.lastName,
        caregiverPhone: users.phone,
        caregiverIdField: users.id,
      })
      .from(clientAssignments)
      .leftJoin(users, eq(clientAssignments.caregiverId, users.id))
      .where(eq(clientAssignments.clientId, id)),
    client.referredById
      ? db
          .select({ id: referralSources.id, name: referralSources.name, type: referralSources.type })
          .from(referralSources)
          .where(eq(referralSources.id, client.referredById))
          .limit(1)
      : Promise.resolve([]),
    db.select().from(geofenceSettings).where(eq(geofenceSettings.clientId, id)).limit(1),
    db
      .select()
      .from(authorizations)
      .where(and(eq(authorizations.clientId, id), eq(authorizations.status, 'active')))
      .orderBy(asc(authorizations.endDate)),
  ])

  const assignmentsWithCaregiver = assignRows.map(({ caregiverFirstName, caregiverLastName, caregiverPhone, caregiverIdField, ...a }) => ({
    ...a,
    caregiver: { id: caregiverIdField, firstName: caregiverFirstName, lastName: caregiverLastName, phone: caregiverPhone },
  }))

  const { ssnEncrypted: _, ...safeClient } = client
  return c.json({
    ...safeClient,
    emergencyContacts: ecRows,
    onboarding: obRows[0] || null,
    assignments: assignmentsWithCaregiver,
    referredBy: refRows[0] || null,
    geofence: geoRows[0] || null,
    authorizations: authRows,
  })
})

// POST /api/clients
app.post('/', requireAdmin, async (c) => {
  const { emergencyContacts, ...data } = await c.req.json()

  const [client] = await db.insert(clients).values(data).returning()

  // Create onboarding record
  const [onboardingRecord] = await db.insert(clientOnboarding).values({ clientId: client.id }).returning()

  // Create emergency contacts if provided
  let ecRows: any[] = []
  if (emergencyContacts?.length) {
    ecRows = await db
      .insert(clientEmergencyContacts)
      .values(emergencyContacts.map((ec: any) => ({ ...ec, clientId: client.id })))
      .returning()
  }

  return c.json({ ...client, emergencyContacts: ecRows, onboarding: onboardingRecord }, 201)
})

// PUT /api/clients/:id
app.put('/:id', requireAdmin, async (c) => {
  const id = c.req.param('id')
  const { emergencyContacts, onboarding, ...data } = await c.req.json()

  const [client] = await db
    .update(clients)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(clients.id, id))
    .returning()

  const [ecRows, obRows] = await Promise.all([
    db.select().from(clientEmergencyContacts).where(eq(clientEmergencyContacts.clientId, id)),
    db.select().from(clientOnboarding).where(eq(clientOnboarding.clientId, id)).limit(1),
  ])

  return c.json({ ...client, emergencyContacts: ecRows, onboarding: obRows[0] || null })
})

// PATCH /api/clients/:id/onboarding
app.patch('/:id/onboarding', requireAdmin, async (c) => {
  const id = c.req.param('id')
  const data = await c.req.json()

  const allFields = [
    'emergencyContactsCompleted',
    'medicalHistoryCompleted',
    'insuranceInfoCompleted',
    'carePreferencesCompleted',
    'familyCommunicationCompleted',
    'initialAssessmentCompleted',
  ]
  const allCompleted = allFields.every((f) => data[f] === true)

  const [updated] = await db
    .update(clientOnboarding)
    .set({ ...data, allCompleted, completedAt: allCompleted ? new Date() : null, updatedAt: new Date() })
    .where(eq(clientOnboarding.clientId, id))
    .returning()

  return c.json(updated)
})

// POST /api/clients/:id/emergency-contacts
app.post('/:id/emergency-contacts', requireAdmin, async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json()

  const [contact] = await db
    .insert(clientEmergencyContacts)
    .values({ ...body, clientId: id })
    .returning()

  return c.json(contact, 201)
})

// DELETE /api/clients/:id/emergency-contacts/:contactId
app.delete('/:id/emergency-contacts/:contactId', requireAdmin, async (c) => {
  const contactId = c.req.param('contactId')
  await db.delete(clientEmergencyContacts).where(eq(clientEmergencyContacts.id, contactId))
  return c.json({ message: 'Deleted' })
})

// POST /api/clients/:id/assignments
app.post('/:id/assignments', requireAdmin, async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json()

  const [assignment] = await db
    .insert(clientAssignments)
    .values({ ...body, clientId: id })
    .returning()

  // Fetch caregiver info
  const [caregiver] = await db
    .select({ id: users.id, firstName: users.firstName, lastName: users.lastName })
    .from(users)
    .where(eq(users.id, assignment.caregiverId))
    .limit(1)

  return c.json({ ...assignment, caregiver }, 201)
})

// PATCH /api/clients/assignments/:assignmentId
app.patch('/assignments/:assignmentId', requireAdmin, async (c) => {
  const assignmentId = c.req.param('assignmentId')
  const body = await c.req.json()

  const [assignment] = await db
    .update(clientAssignments)
    .set({ ...body, updatedAt: new Date() })
    .where(eq(clientAssignments.id, assignmentId))
    .returning()

  return c.json(assignment)
})

// DELETE /api/clients/:id
app.delete('/:id', requireAdmin, async (c) => {
  const id = c.req.param('id')
  await db.update(clients).set({ isActive: false, updatedAt: new Date() }).where(eq(clients.id, id))
  return c.json({ message: 'Client deactivated' })
})

export default app
