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

// Convert camelCase keys to snake_case for frontend compatibility
function toSnake(obj: any): any {
  if (Array.isArray(obj)) return obj.map(toSnake)
  if (obj === null || obj === undefined || typeof obj !== 'object' || obj instanceof Date) return obj
  const result: any = {}
  for (const [key, val] of Object.entries(obj)) {
    const snakeKey = key.replace(/([A-Z])/g, '_$1').toLowerCase()
    result[snakeKey] = toSnake(val)
  }
  return result
}

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
  const safeClients = clientRows.map(({ ssnEncrypted: _, portalPasswordHash: _ph, portalToken: _pt, ...cl }) => ({
    ...cl,
    emergencyContacts: emergencyContactsMap[cl.id] || [],
    onboarding: onboardingMap[cl.id] || null,
    assignments: assignmentsMap[cl.id] || [],
  }))

  return c.json({ clients: toSnake(safeClients), total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) })
})

// GET /api/clients/:id/onboarding (must be before /:id catch-all)
app.get('/:id/onboarding', async (c) => {
  const id = c.req.param('id')
  const [onboarding] = await db.select().from(clientOnboarding).where(eq(clientOnboarding.clientId, id)).limit(1)
  if (!onboarding) return c.json({ error: 'Onboarding record not found' }, 404)
  return c.json(onboarding)
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

  const { ssnEncrypted: _, portalPasswordHash: _ph, portalToken: _pt, ...safeClient } = client
  return c.json(toSnake({
    ...safeClient,
    emergencyContacts: ecRows,
    onboarding: obRows[0] || null,
    assignments: assignmentsWithCaregiver,
    referredBy: refRows[0] || null,
    geofence: geoRows[0] || null,
    authorizations: authRows,
  }))
})

// POST /api/clients
app.post('/', requireAdmin, async (c) => {
  const { emergencyContacts: ecInput, emergencyContactName, emergencyContactPhone, emergencyContactRelationship, ...body } = await c.req.json()

  // Support both formats: array of contacts OR flat fields from frontend form
  let emergencyContacts = ecInput
  if (!emergencyContacts?.length && emergencyContactName) {
    emergencyContacts = [{
      name: emergencyContactName,
      phone: emergencyContactPhone || null,
      relationship: emergencyContactRelationship || null,
      isPrimary: true,
    }]
  }

  const data: Record<string, any> = {}
  const allowedClientFields = [
    'firstName', 'lastName', 'dateOfBirth', 'gender', 'address', 'city', 'state', 'zip',
    'phone', 'email', 'referredById', 'referralDate', 'startDate', 'isActive', 'serviceType',
    'insuranceProvider', 'insuranceId', 'insuranceGroup', 'medicalConditions', 'allergies',
    'medications', 'preferredCaregivers', 'doNotUseCaregivers', 'notes',
    'evvClientId', 'mcoMemberId', 'primaryDiagnosisCode', 'secondaryDiagnosisCode',
    'careTypeId', 'isPrivatePay', 'privatePayRate', 'privatePayRateType',
    'weeklyAuthorizedUnits', 'serviceDaysPerWeek', 'serviceAllowedDays',
    'assistanceNeeds', 'billingNotes', 'latitude', 'longitude', 'medicaidId', 'ivrCode',
  ]
  for (const key of allowedClientFields) {
    if (body[key] !== undefined) {
      // Convert empty strings to null for date/numeric fields
      if (['dateOfBirth', 'referralDate', 'startDate'].includes(key) && body[key] === '') {
        data[key] = null
      } else {
        data[key] = body[key]
      }
    }
  }
  // Accept frontend alias: referralSourceId -> referredById
  if (body.referralSourceId !== undefined && data.referredById === undefined) {
    data.referredById = body.referralSourceId || null
  }

  const [client] = await db.insert(clients).values(data).returning()

  // Create onboarding record
  const [onboardingRecord] = await db.insert(clientOnboarding).values({ clientId: client.id }).returning()

  // Create emergency contacts if provided
  let ecRows: any[] = []
  if (emergencyContacts?.length) {
    ecRows = await db
      .insert(clientEmergencyContacts)
      .values(emergencyContacts.map((ec: any) => ({
        clientId: client.id,
        name: ec.name,
        relationship: ec.relationship,
        phone: ec.phone,
        email: ec.email,
        isPrimary: ec.isPrimary ?? false,
      })))
      .returning()
  }

  const { ssnEncrypted: _, portalPasswordHash: _ph, portalToken: _pt, ...safeClient } = client
  return c.json(toSnake({ ...safeClient, emergencyContacts: ecRows, onboarding: onboardingRecord }), 201)
})

// PUT /api/clients/:id
app.put('/:id', requireAdmin, async (c) => {
  const id = c.req.param('id')
  const { emergencyContacts, onboarding, ...body } = await c.req.json()

  const data: Record<string, any> = {}
  const allowedClientUpdateFields = [
    'firstName', 'lastName', 'dateOfBirth', 'gender', 'address', 'city', 'state', 'zip',
    'phone', 'email', 'referredById', 'referralDate', 'startDate', 'isActive', 'serviceType',
    'insuranceProvider', 'insuranceId', 'insuranceGroup', 'medicalConditions', 'allergies',
    'medications', 'preferredCaregivers', 'doNotUseCaregivers', 'notes',
    'evvClientId', 'mcoMemberId', 'primaryDiagnosisCode', 'secondaryDiagnosisCode',
    'careTypeId', 'isPrivatePay', 'privatePayRate', 'privatePayRateType',
    'weeklyAuthorizedUnits', 'serviceDaysPerWeek', 'serviceAllowedDays',
    'assistanceNeeds', 'billingNotes', 'latitude', 'longitude', 'medicaidId', 'ivrCode',
    'portalEnabled', 'portalEmail',
  ]
  for (const key of allowedClientUpdateFields) {
    if (body[key] !== undefined) {
      if (['dateOfBirth', 'referralDate', 'startDate'].includes(key) && body[key] === '') {
        data[key] = null
      } else {
        data[key] = body[key]
      }
    }
  }
  // Accept frontend alias: referralSourceId -> referredById
  if (body.referralSourceId !== undefined && data.referredById === undefined) {
    data.referredById = body.referralSourceId || null
  }

  const [client] = await db
    .update(clients)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(clients.id, id))
    .returning()

  if (!client) return c.json({ error: 'Client not found' }, 404)

  const [ecRows, obRows] = await Promise.all([
    db.select().from(clientEmergencyContacts).where(eq(clientEmergencyContacts.clientId, id)),
    db.select().from(clientOnboarding).where(eq(clientOnboarding.clientId, id)).limit(1),
  ])

  const { ssnEncrypted: _s, portalPasswordHash: _ph2, portalToken: _pt2, ...safeUpdatedClient } = client
  return c.json(toSnake({ ...safeUpdatedClient, emergencyContacts: ecRows, onboarding: obRows[0] || null }))
})

// PATCH /api/clients/:id/onboarding
app.patch('/:id/onboarding', requireAdmin, async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json()

  // Fetch existing onboarding record to support incremental updates
  const [existing] = await db.select().from(clientOnboarding).where(eq(clientOnboarding.clientId, id)).limit(1)
  if (!existing) return c.json({ error: 'Onboarding record not found' }, 404)

  const allowedOnboardingFields = [
    'emergencyContactsCompleted',
    'medicalHistoryCompleted',
    'insuranceInfoCompleted',
    'carePreferencesCompleted',
    'familyCommunicationCompleted',
    'initialAssessmentCompleted',
  ] as const
  const data: Record<string, any> = {}
  for (const key of allowedOnboardingFields) {
    if (body[key] !== undefined) data[key] = body[key]
  }

  // Merge with existing values to support partial updates
  const merged = { ...existing, ...data }
  const allCompleted = allowedOnboardingFields.every((f) => merged[f] === true)
  data.allCompleted = allCompleted
  data.completedAt = allCompleted ? new Date() : null
  data.updatedAt = new Date()

  const [updated] = await db
    .update(clientOnboarding)
    .set(data)
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
    .values({
      clientId: id,
      name: body.name,
      relationship: body.relationship,
      phone: body.phone,
      email: body.email,
      isPrimary: body.isPrimary ?? false,
    })
    .returning()

  return c.json(contact, 201)
})

// DELETE /api/clients/:id/emergency-contacts/:contactId
app.delete('/:id/emergency-contacts/:contactId', requireAdmin, async (c) => {
  const id = c.req.param('id')
  const contactId = c.req.param('contactId')
  const [deleted] = await db.delete(clientEmergencyContacts)
    .where(and(eq(clientEmergencyContacts.id, contactId), eq(clientEmergencyContacts.clientId, id)))
    .returning()
  if (!deleted) return c.json({ error: 'Emergency contact not found' }, 404)
  return c.json({ message: 'Deleted' })
})

// POST /api/clients/:id/assignments
app.post('/:id/assignments', requireAdmin, async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json()

  const [assignment] = await db
    .insert(clientAssignments)
    .values({
      clientId: id,
      caregiverId: body.caregiverId,
      assignmentDate: body.assignmentDate,
      hoursPerWeek: body.hoursPerWeek,
      payRate: body.payRate,
      status: body.status || 'active',
      notes: body.notes,
    })
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

  const updates: Record<string, any> = { updatedAt: new Date() }
  const allowedAssignmentFields = ['caregiverId', 'assignmentDate', 'hoursPerWeek', 'payRate', 'status', 'notes']
  for (const key of allowedAssignmentFields) {
    if (body[key] !== undefined) updates[key] = body[key]
  }

  const [assignment] = await db
    .update(clientAssignments)
    .set(updates)
    .where(eq(clientAssignments.id, assignmentId))
    .returning()

  if (!assignment) return c.json({ error: 'Assignment not found' }, 404)
  return c.json(assignment)
})

// POST /api/clients/bulk-assign-medicaid-ids — bulk update Medicaid IDs from CSV
app.post('/bulk-assign-medicaid-ids', requireAdmin, async (c) => {
  try {
    const body = await c.req.json()
    const { rows: csvRows } = body // expects { rows: [{ name: "Last, First", medicaidId: "12345" }, ...] }

    if (!Array.isArray(csvRows) || csvRows.length === 0) {
      return c.json({ error: 'No rows provided' }, 400)
    }

    // Fetch all active clients for matching
    const allClients = await db.select({
      id: clients.id,
      firstName: clients.firstName,
      lastName: clients.lastName,
      medicaidId: clients.medicaidId,
    })
      .from(clients)
      .where(eq(clients.isActive, true))

    const results: any[] = []
    let matched = 0
    let updated = 0
    let skipped = 0
    let noMatch = 0

    for (const row of csvRows) {
      const csvName = (row.name || '').trim()
      const csvMedicaidId = (row.medicaidId || '').trim()

      if (!csvName || !csvMedicaidId) {
        results.push({ name: csvName, medicaidId: csvMedicaidId, status: 'skipped', reason: 'Missing name or ID' })
        skipped++
        continue
      }

      // Try "Last, First" format first, then "First Last"
      let searchFirst = ''
      let searchLast = ''
      if (csvName.includes(',')) {
        const parts = csvName.split(',').map(s => s.trim())
        searchLast = parts[0]
        searchFirst = parts[1] || ''
      } else {
        const parts = csvName.split(/\s+/)
        searchFirst = parts[0] || ''
        searchLast = parts.slice(1).join(' ')
      }

      // Find matching client(s) (case-insensitive)
      const matches = allClients.filter(cl =>
        cl.firstName.toLowerCase() === searchFirst.toLowerCase() &&
        cl.lastName.toLowerCase() === searchLast.toLowerCase()
      )

      if (matches.length === 0) {
        results.push({ name: csvName, medicaidId: csvMedicaidId, status: 'no_match', reason: 'No matching client found' })
        noMatch++
        continue
      }

      if (matches.length > 1) {
        results.push({ name: csvName, medicaidId: csvMedicaidId, status: 'multiple_matches', reason: `${matches.length} clients with this name`, clientIds: matches.map(m => m.id) })
        skipped++
        continue
      }

      const match = matches[0]
      matched++

      // Update Medicaid ID
      if (match.medicaidId === csvMedicaidId) {
        results.push({ name: csvName, medicaidId: csvMedicaidId, status: 'already_set', clientId: match.id })
        skipped++
      } else if (match.medicaidId && match.medicaidId !== csvMedicaidId) {
        // Existing Medicaid ID differs — flag for review rather than silently overwriting
        results.push({ name: csvName, medicaidId: csvMedicaidId, status: 'conflict', reason: `Existing Medicaid ID: ${match.medicaidId}`, clientId: match.id, existingMedicaidId: match.medicaidId })
        skipped++
      } else {
        await db.update(clients)
          .set({ medicaidId: csvMedicaidId, updatedAt: new Date() })
          .where(eq(clients.id, match.id))
        results.push({ name: csvName, medicaidId: csvMedicaidId, status: 'updated', clientId: match.id })
        updated++
      }
    }

    return c.json({ total: csvRows.length, matched, updated, skipped, noMatch, results })
  } catch (error: any) {
    return c.json({ error: error.message }, 500)
  }
})

// DELETE /api/clients/:id
app.delete('/:id', requireAdmin, async (c) => {
  const id = c.req.param('id')
  const [client] = await db.update(clients).set({ isActive: false, updatedAt: new Date() }).where(eq(clients.id, id)).returning()
  if (!client) return c.json({ error: 'Client not found' }, 404)
  return c.json({ message: 'Client deactivated' })
})

export default app
