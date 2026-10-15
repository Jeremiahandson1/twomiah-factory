import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { caregiverTimeOff, users } from '../../db/schema.ts'
import { eq, and, inArray, desc } from 'drizzle-orm'
import { authenticate, requireAdmin } from '../middleware/auth.ts'
import { selfSubject } from '../helpers/selfService.ts'

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

// POST /api/pto — insert PTO request. The office records one for any caregiver (Payroll, PTO &
// Time Off); a caregiver requests their own — a caregiverId naming anyone else is a 403.
app.post('/', async (c) => {
  const body = await c.req.json().catch(() => ({})) as any
  const who = selfSubject(c, body.caregiverId)
  if ('refusal' in who) return who.refusal

  const type = body.type || 'pto'
  if (!PTO_TYPES.includes(type)) {
    return c.json({ error: 'Invalid type. Must be pto, vacation, or sick' }, 400)
  }
  if (!body.startDate || !body.endDate) return c.json({ error: 'startDate and endDate are required' }, 400)

  const [entry] = await db
    .insert(caregiverTimeOff)
    .values({
      caregiverId: who.id,
      startDate: body.startDate,
      endDate: body.endDate,
      type,
      reason: body.reason || body.notes || null,
      status: 'pending',
    })
    .returning()

  return c.json(entry, 201)
})

// POST /api/pto/:id/approve | /:id/deny — the office answers a request (PTO & Time Off's ✓ / ✕).
const answer = (status: 'approved' | 'denied') => async (c: any) => {
  const user = c.get('user') as any
  const [row] = await db.update(caregiverTimeOff)
    .set({ status, approvedById: status === 'approved' ? user.userId : null })
    .where(and(eq(caregiverTimeOff.id, c.req.param('id')), inArray(caregiverTimeOff.type, PTO_TYPES)))
    .returning()
  if (!row) return c.json({ error: 'Time-off request not found' }, 404)
  return c.json(row)
}
app.post('/:id/approve', requireAdmin, answer('approved'))
app.post('/:id/deny', requireAdmin, answer('denied'))

export default app
