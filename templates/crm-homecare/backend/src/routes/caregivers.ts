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
  certificationRecords,
  trainingRecords,
} from '../../db/schema.ts'
import { eq, and, or, ilike, count, desc, asc, sql } from 'drizzle-orm'
import { authenticate, requireAdmin } from '../middleware/auth.ts'
import { requireAdminOrSelf } from '../helpers/selfService.ts'
import { createId } from '@paralleldrive/cuid2'
import { DEFAULT_WORKING_DAY } from '../services/workingDay.ts'

const app = new Hono()

// Pay is the office's: default_pay_rate (and an assignment's pay_rate) go to admin/owner only — a
// caregiver sees their own record's pay, never a colleague's.
const PAY_KEY = /(^|_)pay_?rate$|^payRate$|^defaultPayRate$/i
function hidePay(user: any, data: any, ownId?: string): any {
  if (user?.role === 'admin' || user?.role === 'owner') return data
  if (ownId && (user?.userId || user?.id) === ownId) return data
  const strip = (v: any): any => Array.isArray(v) ? v.map(strip)
    : v && typeof v === 'object' && !(v instanceof Date) ? Object.fromEntries(Object.entries(v).filter(([k]) => !PAY_KEY.test(k)).map(([k, x]) => [k, strip(x)]))
    : v
  return strip(data)
}
app.use('*', authenticate)

/**
 * The account owner's login is the owner's (Run 4): it holds the subscription (billing:manage — restart, the Stripe
 * portal), so an office admin may not reset its password, deactivate it, demote it to admin or rewrite it. Before the
 * sign-up login was seeded as the owner these doors were harmless; now they would hand an admin the owner's billing.
 * An owner may change any login, their own included.
 */
async function refuseOwnerTarget(c: any, targetId: string | null | undefined): Promise<Response | null> {
  const actor = c.get('user') as any
  if (actor?.role === 'owner' || !targetId) return null
  const [target] = await db.select({ role: users.role }).from(users).where(eq(users.id, targetId)).limit(1)
  if (target?.role !== 'owner') return null
  return c.json({ error: "The account owner's login can only be changed by the owner.", code: 'owner_only' }, 403)
}

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
        // Home address + coordinates: the route optimizer plans each day from the caregiver's home
        // and says "not geocoded yet" when these are missing.
        address: users.address,
        city: users.city,
        state: users.state,
        zip: users.zip,
        latitude: users.latitude,
        longitude: users.longitude,
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

  return c.json({ caregivers: hidePay(c.get('user'), toSnake(caregivers)), total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) })
})

// GET /api/users/caregivers — list users with role=caregiver
// MUST be before /:id to avoid being caught by the wildcard param
app.get('/caregivers', async (c) => {
  const { search, isActive = 'true' } = c.req.query()
  const conditions: any[] = [eq(users.role, 'caregiver')]
  if (isActive !== 'all') conditions.push(eq(users.isActive, isActive === 'true'))
  if (search) {
    conditions.push(or(
      ilike(users.firstName, '%' + search + '%'),
      ilike(users.lastName, '%' + search + '%'),
      ilike(users.email, '%' + search + '%'),
    ))
  }
  const rows = await db.select({
    id: users.id, firstName: users.firstName, lastName: users.lastName,
    email: users.email, phone: users.phone, isActive: users.isActive, role: users.role,
  }).from(users).where(and(...conditions)).orderBy(asc(users.lastName))
  return c.json(rows.map((r) => ({
    id: r.id, first_name: r.firstName, last_name: r.lastName,
    email: r.email, phone: r.phone, role: r.role, is_active: r.isActive,
  })))
})

// GET /api/users/caregivers/:id — single caregiver summary for the profile page.
// The profile header fetched this and 404'd (only the /caregivers LIST existed),
// leaving the page blank with an "Inactive" badge on active caregivers.
app.get('/caregivers/:id', async (c) => {
  const id = c.req.param('id')
  const [user] = await db.select({
    id: users.id, firstName: users.firstName, lastName: users.lastName,
    email: users.email, phone: users.phone, isActive: users.isActive, role: users.role,
    address: users.address, city: users.city, state: users.state, zip: users.zip,
    createdAt: users.createdAt,
  }).from(users).where(eq(users.id, id)).limit(1)
  if (!user) return c.json({ error: 'Caregiver not found' }, 404)

  const [{ value: activeClients }] = await db
    .select({ value: count() })
    .from(clientAssignments)
    .where(and(eq(clientAssignments.caregiverId, id), eq(clientAssignments.status, 'active')))

  return c.json(toSnake({ ...user, activeClients: Number(activeClients) }))
})

// GET /api/users/admins — list users with role=admin
// MUST be before /:id
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

// POST /api/users/admins — create an office/admin user (no caregiver records)
app.post('/admins', requireAdmin, async (c) => {
  // An office seat is always an admin. The body's `role` used to be honoured, so any admin could mint an owner;
  // and a missing password fell back to a fixed 'Welcome1!' that every such account shared.
  const { firstName, lastName, email, phone, password } = await c.req.json()
  if (!firstName || !lastName || !email) {
    return c.json({ error: 'firstName, lastName and email are required' }, 400)
  }
  if (!password || String(password).length < 8) {
    return c.json({ error: 'Password must be at least 8 characters' }, 400)
  }
  const normalizedEmail = String(email).toLowerCase().trim()
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, normalizedEmail)).limit(1)
  if (existing) return c.json({ error: 'A user with that email already exists' }, 409)

  const passwordHash = await Bun.password.hash(String(password), 'bcrypt')
  const [user] = await db.insert(users).values({
    firstName, lastName, email: normalizedEmail, phone: phone || null,
    passwordHash,
    role: 'admin',
  }).returning({
    id: users.id, firstName: users.firstName, lastName: users.lastName,
    email: users.email, phone: users.phone, role: users.role, isActive: users.isActive,
  })
  return c.json(user, 201)
})

// GET /api/caregivers/:id
app.get('/:id', async (c) => {
  const id = c.req.param('id')
  // The full record (assignments, background checks, pay) is the office's and the person's own.
  const viewer = c.get('user') as any
  if (viewer?.role !== 'admin' && viewer?.role !== 'owner' && (viewer?.userId || viewer?.id) !== id) return c.json({ error: 'Admin access required' }, 403)

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
      ivrPin: users.ivrPin,
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

  return c.json(hidePay(c.get('user'), toSnake({
    ...user,
    profile: profileRows[0] || null,
    availability: availabilityRows[0] || null,
    assignments,
    backgroundChecks: bgRows,
  }), id))
})

// POST /api/caregivers
app.post('/', requireAdmin, async (c) => {
  // No fallback password: a shared default ('Welcome1!') was a known login on every account created without one.
  // The row's identity and secrets are never the body's to set.
  const { password, profile, id: _id, passwordHash: _ph, role: _role, createdAt: _ca, updatedAt: _ua, ...data } = await c.req.json()

  // H-01: this is a login into a PHI system — enforce a real password minimum.
  if (!password || String(password).length < 8) {
    return c.json({ error: 'Password must be at least 8 characters' }, 400)
  }
  // H-11: return usable 400/409 instead of a bare 500 on missing/duplicate email.
  if (!data.firstName || !data.lastName || !data.email) {
    return c.json({ error: 'First name, last name and email are required' }, 400)
  }
  const email = String(data.email).toLowerCase().trim()
  const [dupe] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1)
  if (dupe) return c.json({ error: 'A user with that email already exists' }, 409)

  const passwordHash = await Bun.password.hash(String(password), 'bcrypt')

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

  return c.json(toSnake({
      id: caregiver.id,
      email: caregiver.email,
      firstName: caregiver.firstName,
      lastName: caregiver.lastName,
      phone: caregiver.phone,
      isActive: caregiver.isActive,
      role: caregiver.role,
      defaultPayRate: String(profile?.defaultPayRate || data.defaultPayRate || '0'),
      profile: profileRecord,
      availability: availabilityRecord,
    }), 201)
})

// PUT /api/caregivers/:id
app.put('/:id', requireAdmin, async (c) => {
  const id = c.req.param('id')
  const ownerOnly = await refuseOwnerTarget(c, id)
  if (ownerOnly) return ownerOnly
  // role, the password hash and the row's identity are never written from the body (as POST / does): a role change is
  // convert-to-admin's, a password is `password` below — and `role: 'owner'` here would mint an owner.
  const { profile, availability, password, payRate, role: _role, passwordHash: _ph, id: _id, createdAt: _ca, updatedAt: _ua, ...data } = await c.req.json()
  // Map frontend alias payRate → defaultPayRate
  if (payRate !== undefined && data.defaultPayRate === undefined) {
    data.defaultPayRate = String(payRate)
  }

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

  return c.json(toSnake({ ...updated, profile: profileRow || null, availability: availabilityRow || null }))
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

// ── Certifications, training records and the latest background check, per caregiver ──────────
// The paths the caregiver profile and Compliance screens call (CVHC caregiverRoutes.js). Stored in
// the template's certification_records / training_records / background_checks, and answered with
// the CVHC field names those screens read. Reads: the office, or the caregiver themself. Writes: the
// office.
const adminOrSelf = (c: any) => {
  const u = c.get('user') as any
  return u && (u.role === 'admin' || u.role === 'owner' || u.userId === c.req.param('id'))
}
const certView = (r: typeof certificationRecords.$inferSelect) => ({
  ...r,
  certificationName: r.certificationType, issuer: r.issuingBody, issuedDate: r.issueDate, expirationDate: r.expiryDate,
})
const trainingView = (r: typeof trainingRecords.$inferSelect) => ({
  ...r,
  trainingType: r.trainingName, completionDate: r.completedDate, expirationDate: r.expiryDate,
})
const dayOrNull = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null)

app.get('/:id/certifications', async (c) => {
  if (!adminOrSelf(c)) return c.json({ error: 'Admin access required' }, 403)
  const rows = await db.select().from(certificationRecords)
    .where(eq(certificationRecords.caregiverId, c.req.param('id')))
    .orderBy(desc(certificationRecords.expiryDate))
  return c.json(rows.map(certView))
})

app.post('/:id/certifications', requireAdmin, async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json().catch(() => ({})) as any
  const name = typeof body.certificationName === 'string' ? body.certificationName.trim() : ''
  if (!name) return c.json({ error: 'Certification name is required' }, 400)
  for (const k of ['issuedDate', 'expirationDate']) {
    if (body[k] && !dayOrNull(body[k])) return c.json({ error: 'One of the dates is not a valid date.' }, 400)
  }
  const [cg] = await db.select({ id: users.id }).from(users).where(eq(users.id, id))
  if (!cg) return c.json({ error: 'Caregiver not found' }, 404)
  const [row] = await db.insert(certificationRecords).values({
    caregiverId: id,
    certificationType: name,
    certificationNumber: body.certificationNumber || null,
    issuingBody: body.issuer || null,
    issueDate: dayOrNull(body.issuedDate),
    expiryDate: dayOrNull(body.expirationDate),
  }).returning()
  return c.json(certView(row), 201)
})

app.get('/:id/training-records', async (c) => {
  if (!adminOrSelf(c)) return c.json({ error: 'Admin access required' }, 403)
  const rows = await db.select().from(trainingRecords)
    .where(eq(trainingRecords.caregiverId, c.req.param('id')))
    .orderBy(desc(trainingRecords.completedDate))
  return c.json(rows.map(trainingView))
})

app.post('/:id/training-records', requireAdmin, async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json().catch(() => ({})) as any
  const type = typeof body.trainingType === 'string' ? body.trainingType.trim() : ''
  if (!type || !body.completionDate) return c.json({ error: 'Training type and completion date are required' }, 400)
  if (!dayOrNull(body.completionDate) || (body.expirationDate && !dayOrNull(body.expirationDate))) {
    return c.json({ error: 'One of the dates is not a valid date.' }, 400)
  }
  const [cg] = await db.select({ id: users.id }).from(users).where(eq(users.id, id))
  if (!cg) return c.json({ error: 'Caregiver not found' }, 404)
  const user = c.get('user') as any
  const [row] = await db.insert(trainingRecords).values({
    caregiverId: id,
    trainingName: type,
    completedDate: body.completionDate,
    expiryDate: dayOrNull(body.expirationDate),
    certificationNumber: body.certificationNumber || null,
    provider: body.provider || null,
    status: body.status || 'completed',
    recordedById: user?.userId || null,
  }).returning()
  return c.json(trainingView(row), 201)
})

// GET /api/caregivers/:id/background-check — the latest check, or null
app.get('/:id/background-check', async (c) => {
  if (!adminOrSelf(c)) return c.json({ error: 'Admin access required' }, 403)
  const [row] = await db.select().from(backgroundChecks)
    .where(eq(backgroundChecks.caregiverId, c.req.param('id')))
    .orderBy(sql`${backgroundChecks.initiatedDate} DESC NULLS LAST`)
    .limit(1)
  if (!row) return c.json(null)
  const { ssnEncrypted: _, driversLicenseEncrypted: __, ...safe } = row
  return c.json({ ...safe, checkDate: safe.initiatedDate, clearanceNumber: safe.referenceNumber })
})

// POST /api/caregivers/:id/background-check { checkDate, expirationDate, status, clearanceNumber, notes }
app.post('/:id/background-check', requireAdmin, async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json().catch(() => ({})) as any
  if (!body.checkDate || !body.status) return c.json({ error: 'Check date and status are required' }, 400)
  if (!dayOrNull(body.checkDate) || (body.expirationDate && !dayOrNull(body.expirationDate))) {
    return c.json({ error: 'One of the dates is not a valid date.' }, 400)
  }
  const [cg] = await db.select({ id: users.id }).from(users).where(eq(users.id, id))
  if (!cg) return c.json({ error: 'Caregiver not found' }, 404)
  const user = c.get('user') as any
  const [row] = await db.insert(backgroundChecks).values({
    caregiverId: id,
    initiatedDate: body.checkDate,
    expirationDate: dayOrNull(body.expirationDate),
    status: String(body.status),
    referenceNumber: body.clearanceNumber || null,
    notes: body.notes || null,
    createdById: user?.userId || null,
  }).returning()
  const { ssnEncrypted: _, driversLicenseEncrypted: __, ...safe } = row
  return c.json(safe, 201)
})

// ── Availability and blackout dates (CVHC caregiverRoutes.js, requireAdminOrSelf) ─────────────────
// The office's Caregiver Availability screen and Schedule Hub, and the caregiver's own dashboard,
// call these. The office edits anyone's; a caregiver only their own (403 otherwise). Rows come back
// snake_case, as those screens read them. Blackout dates live in caregiver_time_off (type 'blackout'),
// the table /api/blackout-dates already reads and deletes from.
const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const
const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/
const rowsOfExec = (r: any): any[] => r?.rows ?? r ?? []

app.get('/:id/availability', requireAdminOrSelf('id'), async (c) => {
  const id = c.req.param('id')
  const [cg] = await db.select({ id: users.id }).from(users).where(eq(users.id, id))
  if (!cg) return c.json({ error: 'Caregiver not found' }, 404)
  // First read creates the default week (Mon–Fri 08:00–17:00, weekends off), as CVHC does.
  await db.insert(caregiverAvailability).values({
    caregiverId: id, status: 'available', maxHoursPerWeek: 40,
    ...Object.fromEntries(DAYS.slice(0, 5).flatMap((d) => [[`${d}Available`, true], [`${d}StartTime`, DEFAULT_WORKING_DAY.start], [`${d}EndTime`, DEFAULT_WORKING_DAY.end]])),
    saturdayAvailable: false, sundayAvailable: false,
  } as any).onConflictDoNothing({ target: caregiverAvailability.caregiverId })
  const [row] = rowsOfExec(await db.execute(sql`SELECT * FROM caregiver_availability WHERE caregiver_id = ${id}`))
  return c.json(row)
})

app.put('/:id/availability', requireAdminOrSelf('id'), async (c) => {
  const id = c.req.param('id')
  const b = await c.req.json().catch(() => ({})) as any
  const [cg] = await db.select({ id: users.id }).from(users).where(eq(users.id, id))
  if (!cg) return c.json({ error: 'Caregiver not found' }, 404)
  const set: Record<string, unknown> = {}
  if (b.status !== undefined && b.status !== null && b.status !== '') set.status = String(b.status)
  if (b.maxHoursPerWeek !== undefined && b.maxHoursPerWeek !== null && String(b.maxHoursPerWeek).trim() !== '') {
    const h = Number(b.maxHoursPerWeek)
    if (!Number.isFinite(h) || h < 0 || h > 168) return c.json({ error: 'Max hours per week must be a number from 0 to 168' }, 400)
    set.maxHoursPerWeek = Math.round(h)
  }
  for (const d of DAYS) {
    if (typeof b[`${d}Available`] === 'boolean') set[`${d}Available`] = b[`${d}Available`]
    for (const k of ['StartTime', 'EndTime', 'PreferredStart', 'PreferredEnd']) {
      const key = `${d}${k}`
      if (!(key in b)) continue
      const v = b[key] === null || b[key] === undefined ? '' : String(b[key]).trim()
      if (v === '') { if (k.startsWith('Preferred')) set[key] = null; continue }
      if (!HHMM_RE.test(v)) return c.json({ error: `${d[0].toUpperCase()}${d.slice(1)} times must look like 08:00` }, 400)
      set[key] = v
    }
  }
  await db.insert(caregiverAvailability).values({ caregiverId: id } as any).onConflictDoNothing({ target: caregiverAvailability.caregiverId })
  if (Object.keys(set).length) {
    await db.update(caregiverAvailability).set({ ...set, updatedAt: new Date() } as any).where(eq(caregiverAvailability.caregiverId, id))
  }
  const [row] = rowsOfExec(await db.execute(sql`SELECT * FROM caregiver_availability WHERE caregiver_id = ${id}`))
  return c.json(row)
})

app.get('/:id/blackout-dates', requireAdminOrSelf('id'), async (c) => {
  const rows = rowsOfExec(await db.execute(sql`
    SELECT id, caregiver_id, to_char(start_date, 'YYYY-MM-DD') AS start_date, to_char(end_date, 'YYYY-MM-DD') AS end_date,
           reason, status, created_at
      FROM caregiver_time_off WHERE caregiver_id = ${c.req.param('id')} AND type = 'blackout' ORDER BY start_date DESC`))
  return c.json(rows)
})

app.post('/:id/blackout-dates', requireAdminOrSelf('id'), async (c) => {
  const id = c.req.param('id')
  const b = await c.req.json().catch(() => ({})) as any
  if (!b.startDate || !b.endDate) return c.json({ error: 'startDate and endDate are required' }, 400)
  if (!dayOrNull(b.startDate) || !dayOrNull(b.endDate)) return c.json({ error: 'Dates must be YYYY-MM-DD' }, 400)
  if (b.endDate < b.startDate) return c.json({ error: 'The end date is before the start date' }, 400)
  const [cg] = await db.select({ id: users.id }).from(users).where(eq(users.id, id))
  if (!cg) return c.json({ error: 'Caregiver not found' }, 404)
  const [row] = rowsOfExec(await db.execute(sql`
    INSERT INTO caregiver_time_off (id, caregiver_id, start_date, end_date, type, reason)
    VALUES (${createId()}, ${id}, ${b.startDate}::date, ${b.endDate}::date, 'blackout', ${b.reason || null})
    RETURNING id, caregiver_id, to_char(start_date, 'YYYY-MM-DD') AS start_date, to_char(end_date, 'YYYY-MM-DD') AS end_date, reason, status, created_at`))
  return c.json(row, 201)
})

// /caregivers and /admins routes moved above /:id to prevent wildcard param conflict

// PUT /api/users/:id/reset-password
// PUT/POST /:id/reset-password — the UI calls both shapes across screens.
const resetUserPassword = async (c: any) => {
  const id = c.req.param('id')
  const ownerOnly = await refuseOwnerTarget(c, id)
  if (ownerOnly) return ownerOnly
  const { password } = await c.req.json()
  if (!password || password.length < 8) return c.json({ error: 'Password must be at least 8 characters' }, 400)
  const passwordHash = await Bun.password.hash(password, 'bcrypt')
  await db.update(users).set({ passwordHash, updatedAt: new Date() }).where(eq(users.id, id))
  return c.json({ success: true })
}
app.put('/:id/reset-password', requireAdmin, resetUserPassword)
app.post('/:id/reset-password', requireAdmin, resetUserPassword)

// POST /api/users/convert-to-admin
app.post('/convert-to-admin', requireAdmin, async (c) => {
  const { userId } = await c.req.json()
  if (!userId) return c.json({ error: 'userId required' }, 400)
  // "Make Admin" is for a caregiver; on the owner it would be a demotion (and the agency would lose its owner).
  const [target] = await db.select({ role: users.role }).from(users).where(eq(users.id, userId)).limit(1)
  if (target?.role === 'owner') return c.json({ error: 'The account owner is already in the office — they cannot be made an admin.', code: 'owner_only' }, 403)
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
  const ownerOnly = await refuseOwnerTarget(c, id)
  if (ownerOnly) return ownerOnly

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

// POST /api/caregivers/:id/generate-ivr-pin — generate a unique 4-digit PIN
app.post('/:id/generate-ivr-pin', requireAdmin, async (c) => {
  const id = c.req.param('id')

  // Verify caregiver exists
  const [cg] = await db.select({ id: users.id }).from(users).where(eq(users.id, id)).limit(1)
  if (!cg) return c.json({ error: 'Caregiver not found' }, 404)

  // Get all existing PINs to avoid collisions
  const existingPins = await db.select({ ivrPin: users.ivrPin }).from(users)
  const pinSet = new Set(existingPins.map(u => u.ivrPin).filter(Boolean))

  // Generate unique 4-digit PIN
  let pin: string
  let attempts = 0
  do {
    pin = String(Math.floor(Math.random() * 9000 + 1000))
    attempts++
    if (attempts > 100) return c.json({ error: 'Unable to generate unique PIN' }, 500)
  } while (pinSet.has(pin))

  const [updated] = await db.update(users)
    .set({ ivrPin: pin, updatedAt: new Date() })
    .where(eq(users.id, id))
    .returning()

  return c.json({ ivrPin: updated.ivrPin })
})

// DELETE /api/caregivers/:id/ivr-pin — clear IVR PIN
app.delete('/:id/ivr-pin', requireAdmin, async (c) => {
  const id = c.req.param('id')

  const [updated] = await db.update(users)
    .set({ ivrPin: null, updatedAt: new Date() })
    .where(eq(users.id, id))
    .returning()

  if (!updated) return c.json({ error: 'Caregiver not found' }, 404)
  return c.json({ success: true })
})

export default app
