import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { caregiverTimeOff, users } from '../../db/schema.ts'
import { eq, and } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { isOfficeUser, userIdOf } from '../helpers/caregiverAccess.ts'
import { selfSubject, ownsRow } from '../helpers/selfService.ts'

// A caregiver's blackout dates are their own: the office sees and edits everyone's, a caregiver
// only theirs. (CVHC's DELETE /blackout-dates/:dateId had verifyToken only — any signed-in user could
// delete anyone's. Here deleting another person's is a 403: a deliberate difference.)
const app = new Hono()
app.use('*', authenticate)

// GET / — list where type='blackout', join users for caregiver name (a caregiver: their own)
app.get('/', async (c) => {
  try {
    const user = c.get('user' as any)
    const mine = isOfficeUser(user) ? undefined : eq(caregiverTimeOff.caregiverId, userIdOf(user))
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
      .where(and(eq(caregiverTimeOff.type, 'blackout'), mine))

    return c.json(rows)
  } catch (error: any) {
    return c.json({ error: error.message }, 500)
  }
})

// POST / — a blackout date. The office names the caregiver; a caregiver adds their own (a
// caregiverId for anyone else is a 403).
app.post('/', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({})) as any
    const who = selfSubject(c, body.caregiverId)
    if ('refusal' in who) return who.refusal
    if (!body.startDate || !body.endDate) return c.json({ error: 'startDate and endDate are required' }, 400)
    const [row] = await db
      .insert(caregiverTimeOff)
      .values({ caregiverId: who.id, startDate: body.startDate, endDate: body.endDate, reason: body.reason || null, type: 'blackout' })
      .returning()
    return c.json(row, 201)
  } catch (error: any) {
    return c.json({ error: error.message }, 500)
  }
})

// DELETE /:id — the office any; a caregiver only their own
app.delete('/:id', async (c) => {
  try {
    const id = c.req.param('id')
    const [row] = await db.select({ caregiverId: caregiverTimeOff.caregiverId }).from(caregiverTimeOff)
      .where(and(eq(caregiverTimeOff.id, id), eq(caregiverTimeOff.type, 'blackout'))).limit(1)
    if (!row) return c.json({ error: 'Blackout date not found' }, 404)
    if (!ownsRow(c, row.caregiverId)) return c.json({ error: 'You can only remove your own blackout dates.' }, 403)
    await db
      .delete(caregiverTimeOff)
      .where(and(eq(caregiverTimeOff.id, id), eq(caregiverTimeOff.type, 'blackout')))
    return c.json({ success: true })
  } catch (error: any) {
    return c.json({ error: error.message }, 500)
  }
})

export default app
