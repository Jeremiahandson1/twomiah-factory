import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'

import { db } from '../../db/index.ts'
import {
  users,
  caregiverProfiles,
  caregiverAvailability,
  clientAssignments,
  clients,
  backgroundChecks,
  notificationPreferences,
} from '../../db/schema.ts'
import { eq, and, or, ilike, count, desc, asc } from 'drizzle-orm'
import { authenticate, requireAdmin } from '../middleware/auth.ts'

const app = new Hono()
app.use('*', authenticate)

// GET /api/caregivers
app.get('/', async (c) => {
  const { search, isActive = 'true', page = '1', limit = '50' } = c.req.query()
  const skip = (parseInt(page) - 1) * parseInt(limit)

  const conditions: any[] = [eq(users.role, 'caregiver')]
  if (isActive !== 'all') conditions.push(eq(users.isActive, isActive === 'true'))
  if (search) {
    conditions.push(
      or(
        ilike(users.firstName, '%' + search + '%'),
        ilike(users.lastName, '%' + search + '%'),
        ilike(users.email, '%' + search + '%'),
        ilike(users.phone, '%' + search + '%'),
      )
    )
  }

  const whereClause = and(...conditions)

  const [userRows, [{ value: total }]] = await Promise.all([
    db
      .select({
        id: users.id,
        firstName: users.firstName,
        lastName: users.lastName,
        email: users.email,
        phone: users.phone,
        isActive: users.isActive,
        hireDate: users.hireDate,
        defaultPayRate: users.defaultPayRate,
        certifications: users.certifications,
        certificationsExpiry: users.certificationsExpiry,
      })
      .from(users)
      .where(whereClause)
      .orderBy(desc(users.isActive), asc(users.lastName))
      .offset(skip)
      .limit(parseInt(limit)),
    db.select({ value: count() }).from(users).where(whereClause),
  ])

  const { inArray } = await import('drizzle-orm')
  const userIds = userRows.map((u) => u.id)

  let profileMap: Record<string, any> = {}
  let availabilityMap: Record<string, any> = {}

  if (userIds.length > 0) {
    const [profileRows, availabilityRows] = await Promise.all([
      db
        .select({
          caregiverId: caregiverProfiles.caregiverId,
          npiNumber: caregiverProfiles.npiNumber,
          evvWorkerId: caregiverProfiles.evvWorkerId,
          availableMon: caregiverProfiles.availableMon,
          availableTue: caregiverProfiles.availableTue,
          availableWed: caregiverProfiles.availableWed,
          availableThu: caregiverProfiles.availableThu,
          availableFri: caregiverProfiles.availableFri,
          availableSat: caregiverProfiles.availableSat,
          availableSun: caregiverProfiles.availableSun,
        })
        .from(caregiverProfiles)
        .where(inArray(caregiverProfiles.caregiverId, userIds)),
      db
        .select({
          caregiverId: caregiverAvailability.caregiverId,
          status: caregiverAvailability.status,
          maxHoursPerWeek: caregiverAvailability.maxHoursPerWeek,
        })
        .from(caregiverAvailability)
        .where(inArray(caregiverAvailability.caregiverId, userIds)),
    ])

    for (const p of profileRows) {
      profileMap[p.caregiverId] = p
    }
    for (const a of availabilityRows) {
      availabilityMap[a.caregiverId] = a
    }
  }

  const caregivers = userRows.map((u) => ({
    ...u,
    profile: profileMap[u.id] || null,
    availability: availabilityMap[u.id] || null,
  }))

  return c.json({ caregivers, total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) })
})

// GET /api/caregivers/:id
app.get('/:id', async (c) => {
  const id = c.req.param('id')

  const [user] = await db
    .select({
      id: users.id,
      email: users.email,
      firstName: users.firstName,
      lastName: users.lastName,
      phone: users.phone,
      isActive: users.isActive,
      hireDate: users.hireDate,
      defaultPayRate: users.defaultPayRate,
      address: users.address,
      city: users.city,
      state: users.state,
      zip: users.zip,
      latitude: users.latitude,
      longitude: users.longitude,
      certifications: users.certifications,
      certificationsExpiry: users.certificationsExpiry,
      emergencyContactName: users.emergencyContactName,
      emergencyContactPhone: users.emergencyContactPhone,
    })
    .from(users)
    .where(eq(users.id, id))
    .limit(1)

  if (!user) throw new HTTPException(404, { message: 'Caregiver not found' })

  const [profileRows, availabilityRows, assignRows, bgRows] = await Promise.all([
    db.select().from(caregiverProfiles).where(eq(caregiverProfiles.caregiverId, id)).limit(1),
    db.select().from(caregiverAvailability).where(eq(caregiverAvailability.caregiverId, id)).limit(1),
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
        clientFirstName: clients.firstName,
        clientLastName: clients.lastName,
        clientAddress: clients.address,
        clientCity: clients.city,
      })
      .from(clientAssignments)
      .leftJoin(clients, eq(clientAssignments.clientId, clients.id))
      .where(and(eq(clientAssignments.caregiverId, id), eq(clientAssignments.status, 'active'))),
    db
      .select()
      .from(backgroundChecks)
      .where(eq(backgroundChecks.caregiverId, id))
      .orderBy(desc(backgroundChecks.createdAt))
      .limit(5),
  ])

  const assignments = assignRows.map(({ clientFirstName, clientLastName, clientAddress, clientCity, ...a }) => ({
    ...a,
    client: { firstName: clientFirstName, lastName: clientLastName, address: clientAddress, city: clientCity },
  }))

  return c.json({
    ...user,
    profile: profileRows[0] || null,
    availability: availabilityRows[0] || null,
    assignments,
    backgroundChecks: bgRows,
  })
})

// POST /api/caregivers
app.post('/', requireAdmin, async (c) => {
  const { password = 'Welcome1!', profile, ...data } = await c.req.json()
  const passwordHash = await Bun.password.hash(password, 'bcrypt')

  const [caregiver] = await db
    .insert(users)
    .values({
      ...data,
      email: data.email.toLowerCase().trim(),
      passwordHash,
      role: 'caregiver',
    })
    .returning()

  // Create related records
  const [profileRecord] = await db
    .insert(caregiverProfiles)
    .values({ ...(profile || {}), caregiverId: caregiver.id })
    .returning()

  const [availabilityRecord] = await db
    .insert(caregiverAvailability)
    .values({ caregiverId: caregiver.id })
    .returning()

  await db.insert(notificationPreferences).values({ userId: caregiver.id })

  return c.json(
    {
      id: caregiver.id,
      email: caregiver.email,
      firstName: caregiver.firstName,
      lastName: caregiver.lastName,
      phone: caregiver.phone,
      isActive: caregiver.isActive,
      role: caregiver.role,
      profile: profileRecord,
      availability: availabilityRecord,
    },
    201
  )
})

// PUT /api/caregivers/:id
app.put('/:id', requireAdmin, async (c) => {
  const id = c.req.param('id')
  const { profile, availability, password, ...data } = await c.req.json()

  const updates: Promise<any>[] = [
    db.update(users).set({ ...data, updatedAt: new Date() }).where(eq(users.id, id)),
  ]

  if (profile) {
    // Upsert profile: try update, if no rows affected then insert
    updates.push(
      (async () => {
        const [existing] = await db
          .select({ id: caregiverProfiles.id })
          .from(caregiverProfiles)
          .where(eq(caregiverProfiles.caregiverId, id))
          .limit(1)
        if (existing) {
          await db
            .update(caregiverProfiles)
            .set({ ...profile, updatedAt: new Date() })
            .where(eq(caregiverProfiles.caregiverId, id))
        } else {
          await db.insert(caregiverProfiles).values({ ...profile, caregiverId: id })
        }
      })()
    )
  }

  if (availability) {
    updates.push(
      (async () => {
        const [existing] = await db
          .select({ id: caregiverAvailability.id })
          .from(caregiverAvailability)
          .where(eq(caregiverAvailability.caregiverId, id))
          .limit(1)
        if (existing) {
          await db
            .update(caregiverAvailability)
            .set({ ...availability, updatedAt: new Date() })
            .where(eq(caregiverAvailability.caregiverId, id))
        } else {
          await db.insert(caregiverAvailability).values({ ...availability, caregiverId: id })
        }
      })()
    )
  }

  if (password) {
    const passwordHash = await Bun.password.hash(password, 'bcrypt')
    updates.push(db.update(users).set({ passwordHash, updatedAt: new Date() }).where(eq(users.id, id)))
  }

  await Promise.all(updates)

  const [updated] = await db
    .select({
      id: users.id,
      email: users.email,
      firstName: users.firstName,
      lastName: users.lastName,
      isActive: users.isActive,
    })
    .from(users)
    .where(eq(users.id, id))
    .limit(1)

  const [profileRow] = await db
    .select()
    .from(caregiverProfiles)
    .where(eq(caregiverProfiles.caregiverId, id))
    .limit(1)

  const [availabilityRow] = await db
    .select()
    .from(caregiverAvailability)
    .where(eq(caregiverAvailability.caregiverId, id))
    .limit(1)

  return c.json({ ...updated, profile: profileRow || null, availability: availabilityRow || null })
})

// GET /api/caregivers/:id/background-checks
app.get('/:id/background-checks', requireAdmin, async (c) => {
  const id = c.req.param('id')

  const checks = await db
    .select()
    .from(backgroundChecks)
    .where(eq(backgroundChecks.caregiverId, id))
    .orderBy(desc(backgroundChecks.createdAt))

  // Strip encrypted fields
  const safe = checks.map(({ ssnEncrypted: _, driversLicenseEncrypted: __, ...ch }) => ch)
  return c.json(safe)
})

// POST /api/caregivers/:id/background-checks
app.post('/:id/background-checks', requireAdmin, async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json()
  const user = c.get('user')

  const [check] = await db
    .insert(backgroundChecks)
    .values({ ...body, caregiverId: id, createdById: user.userId })
    .returning()

  const { ssnEncrypted: _, driversLicenseEncrypted: __, ...safe } = check
  return c.json(safe, 201)
})

// GET /api/users/caregivers — list users with role=caregiver (alias-only route)
app.get('/caregivers', async (c) => {
  const { search, isActive = 'true', page = '1', limit = '50' } = c.req.query()
  const skip = (parseInt(page) - 1) * parseInt(limit)
  const conditions: any[] = [eq(users.role, 'caregiver')]
  if (isActive !== 'all') conditions.push(eq(users.isActive, isActive === 'true'))
  if (search) {
    conditions.push(
      or(
        ilike(users.firstName, '%' + search + '%'),
        ilike(users.lastName, '%' + search + '%'),
        ilike(users.email, '%' + search + '%'),
      )
    )
  }
  const whereClause = and(...conditions)
  const [rows, [{ value: total }]] = await Promise.all([
    db.select({ id: users.id, firstName: users.firstName, lastName: users.lastName, email: users.email, phone: users.phone, isActive: users.isActive, role: users.role })
      .from(users).where(whereClause).orderBy(asc(users.lastName)).offset(skip).limit(parseInt(limit)),
    db.select({ value: count() }).from(users).where(whereClause),
  ])
  return c.json({ users: rows, total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) })
})

// GET /api/users/admins — list users with role=admin
app.get('/admins', async (c) => {
  const { page = '1', limit = '50' } = c.req.query()
  const skip = (parseInt(page) - 1) * parseInt(limit)
  const whereClause = or(eq(users.role, 'admin'), eq(users.role, 'owner'))
  const [rows, [{ value: total }]] = await Promise.all([
    db.select({ id: users.id, firstName: users.firstName, lastName: users.lastName, email: users.email, phone: users.phone, isActive: users.isActive, role: users.role })
      .from(users).where(whereClause).orderBy(asc(users.lastName)).offset(skip).limit(parseInt(limit)),
    db.select({ value: count() }).from(users).where(whereClause),
  ])
  return c.json({ users: rows, total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) })
})

// PUT /api/users/:id/reset-password
app.put('/:id/reset-password', requireAdmin, async (c) => {
  const id = c.req.param('id')
  const { password } = await c.req.json()
  if (!password || password.length < 8) return c.json({ error: 'Password must be at least 8 characters' }, 400)
  const passwordHash = await Bun.password.hash(password, 'bcrypt')
  await db.update(users).set({ passwordHash, updatedAt: new Date() }).where(eq(users.id, id))
  return c.json({ success: true })
})

// POST /api/users/convert-to-admin
app.post('/convert-to-admin', requireAdmin, async (c) => {
  const { userId } = await c.req.json()
  if (!userId) return c.json({ error: 'userId required' }, 400)
  const [updated] = await db.update(users)
    .set({ role: 'admin', updatedAt: new Date() })
    .where(eq(users.id, userId))
    .returning()
  if (!updated) return c.json({ error: 'User not found' }, 404)
  return c.json({ id: updated.id, role: updated.role })
})

// PATCH /api/caregivers/:id/toggle-active
app.patch('/:id/toggle-active', requireAdmin, async (c) => {
  const id = c.req.param('id')

  const [user] = await db
    .select({ isActive: users.isActive })
    .from(users)
    .where(eq(users.id, id))
    .limit(1)

  if (!user) throw new HTTPException(404, { message: 'Caregiver not found' })

  const [updated] = await db
    .update(users)
    .set({ isActive: !user.isActive, updatedAt: new Date() })
    .where(eq(users.id, id))
    .returning()

  return c.json({ isActive: updated.isActive })
})

export default app
