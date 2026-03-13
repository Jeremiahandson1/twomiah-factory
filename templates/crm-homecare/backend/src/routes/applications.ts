import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { applications, users, caregiverProfiles } from '../../db/schema.ts'
import { eq, desc } from 'drizzle-orm'
import { authenticate, requireAdmin } from '../middleware/auth.ts'
import { createId } from '@paralleldrive/cuid2'

const app = new Hono()
app.use('*', authenticate)

// GET /api/applications
app.get('/', async (c) => {
  const rows = await db
    .select()
    .from(applications)
    .orderBy(desc(applications.createdAt))

  return c.json(rows)
})

// GET /api/applications/:id
app.get('/:id', async (c) => {
  const { id } = c.req.param()

  const [row] = await db
    .select()
    .from(applications)
    .where(eq(applications.id, id))

  if (!row) return c.json({ error: 'Application not found' }, 404)
  return c.json(row)
})

// POST /api/applications (create new application - could be public or admin)
app.post('/', async (c) => {
  const body = await c.req.json()
  if (typeof body.email === 'string') { body.email = body.email.toLowerCase().trim(); if (!body.email) delete body.email }

  const [row] = await db.insert(applications).values({
    firstName: body.firstName,
    lastName: body.lastName,
    email: body.email,
    phone: body.phone,
    address: body.address,
    city: body.city,
    state: body.state,
    zip: body.zip,
    desiredPosition: body.desiredPosition,
    desiredPayRate: body.desiredPayRate,
    availableStartDate: body.availableStartDate,
    experience: body.experience,
    hasCna: body.hasCna || false,
    hasLpn: body.hasLpn || false,
    hasRn: body.hasRn || false,
    hasCpr: body.hasCpr || false,
    hasFirstAid: body.hasFirstAid || false,
    references: body.references || [],
    notes: body.notes,
  }).returning()

  return c.json(row, 201)
})

// PUT /api/applications/:id/status
app.put('/:id/status', requireAdmin, async (c) => {
  const { id } = c.req.param()
  const body = await c.req.json()

  const [row] = await db.update(applications)
    .set({
      status: body.status,
      notes: body.notes !== undefined ? body.notes : undefined,
      updatedAt: new Date(),
    })
    .where(eq(applications.id, id))
    .returning()

  if (!row) return c.json({ error: 'Application not found' }, 404)
  return c.json(row)
})

// POST /api/applications/:id/notes
app.post('/:id/notes', requireAdmin, async (c) => {
  const { id } = c.req.param()
  const body = await c.req.json()

  const [row] = await db.update(applications)
    .set({
      interviewNotes: body.notes,
      updatedAt: new Date(),
    })
    .where(eq(applications.id, id))
    .returning()

  if (!row) return c.json({ error: 'Application not found' }, 404)
  return c.json(row)
})

// POST /api/applications/:id/hire — convert applicant to caregiver
app.post('/:id/hire', requireAdmin, async (c) => {
  const { id } = c.req.param()
  const body = await c.req.json()

  // Get the application
  const [application] = await db.select().from(applications).where(eq(applications.id, id))
  if (!application) return c.json({ error: 'Application not found' }, 404)
  if (application.status === 'hired') return c.json({ error: 'Already hired' }, 400)

  // Generate email/password if not provided
  const email = body.email || application.email
  if (!email) return c.json({ error: 'Email is required to create a user account' }, 400)

  const password = body.password || `Welcome${createId().slice(0, 8)}!`
  const passwordHash = await Bun.password.hash(password, 'bcrypt')

  // Create the user
  const [newUser] = await db.insert(users).values({
    email,
    passwordHash,
    firstName: application.firstName,
    lastName: application.lastName,
    phone: application.phone,
    role: 'caregiver',
    address: application.address,
    city: application.city,
    state: application.state,
    zip: application.zip,
    certifications: [
      ...(application.hasCna ? ['CNA'] : []),
      ...(application.hasLpn ? ['LPN'] : []),
      ...(application.hasRn ? ['RN'] : []),
      ...(application.hasCpr ? ['CPR'] : []),
      ...(application.hasFirstAid ? ['First Aid'] : []),
    ],
    defaultPayRate: body.hourlyRate || application.desiredPayRate,
    hireDate: new Date().toISOString().split('T')[0],
  }).returning()

  // Create caregiver profile
  await db.insert(caregiverProfiles).values({
    caregiverId: newUser.id,
    notes: application.interviewNotes || application.notes,
  })

  // Update application status
  await db.update(applications)
    .set({ status: 'hired', hiredUserId: newUser.id, updatedAt: new Date() })
    .where(eq(applications.id, id))

  return c.json({
    ok: true,
    userId: newUser.id,
    email: newUser.email,
    temporaryPassword: password,
  })
})

export default app
