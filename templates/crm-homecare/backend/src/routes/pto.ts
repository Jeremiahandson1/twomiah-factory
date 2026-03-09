import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { caregiverTimeOff, users } from '../../db/schema.ts'
import { eq, and, inArray, desc } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'

const app = new Hono()
app.use('*', authenticate)

const PTO_TYPES = ['pto', 'vacation', 'sick']

// GET /api/pto — list PTO requests (all if admin, own if caregiver)
app.get('/', async (c) => {
  const user = c.get('user')
  const isAdmin = user.role === 'admin' || user.role === 'owner'

  const conditions: any[] = [inArray(caregiverTimeOff.type, PTO_TYPES)]
  if (!isAdmin) {
    conditions.push(eq(caregiverTimeOff.caregiverId, user.userId))
  }

  const rows = await db
    .select({
      id: caregiverTimeOff.id,
      caregiverId: caregiverTimeOff.caregiverId,
      startDate: caregiverTimeOff.startDate,
      endDate: caregiverTimeOff.endDate,
      type: caregiverTimeOff.type,
      reason: caregiverTimeOff.reason,
      approvedById: caregiverTimeOff.approvedById,
      status: caregiverTimeOff.status,
      createdAt: caregiverTimeOff.createdAt,
      caregiverFirstName: users.firstName,
      caregiverLastName: users.lastName,
    })
    .from(caregiverTimeOff)
    .leftJoin(users, eq(caregiverTimeOff.caregiverId, users.id))
    .where(and(...conditions))
    .orderBy(desc(caregiverTimeOff.startDate))

  const entries = rows.map(({ caregiverFirstName, caregiverLastName, ...entry }) => ({
    ...entry,
    caregiverName: caregiverFirstName ? `${caregiverFirstName} ${caregiverLastName}` : null,
  }))

  return c.json(entries)
})

// POST /api/pto — insert PTO request
app.post('/', async (c) => {
  const user = c.get('user')
  const body = await c.req.json()

  const type = body.type || 'pto'
  if (!PTO_TYPES.includes(type)) {
    return c.json({ error: 'Invalid type. Must be pto, vacation, or sick' }, 400)
  }

  const [entry] = await db
    .insert(caregiverTimeOff)
    .values({
      caregiverId: body.caregiverId || user.userId,
      startDate: body.startDate,
      endDate: body.endDate,
      type,
      reason: body.reason,
      status: 'pending',
    })
    .returning()

  return c.json(entry, 201)
})

export default app
