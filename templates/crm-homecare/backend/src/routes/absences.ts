import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { absences, users, clients } from '../../db/schema.ts'
import { eq, desc } from 'drizzle-orm'
import { authenticate, requireAdmin } from '../middleware/auth.ts'
import { selfSubject } from '../helpers/selfService.ts'

const app = new Hono()
app.use('*', authenticate)

// GET / — list all absences, optional ?caregiverId filter, join users+clients for names. The office's
// list (CVHC: requireAdmin); a caregiver reads their own through GET /my.
app.get('/', requireAdmin, async (c) => {
  try {
    const caregiverId = c.req.query('caregiverId')

    let query = db
      .select({
        id: absences.id,
        caregiverId: absences.caregiverId,
        clientId: absences.clientId,
        date: absences.date,
        type: absences.type,
        reason: absences.reason,
        reportedById: absences.reportedById,
        coverageNeeded: absences.coverageNeeded,
        coverageAssignedTo: absences.coverageAssignedTo,
        createdAt: absences.createdAt,
        caregiverFirstName: users.firstName,
        caregiverLastName: users.lastName,
        clientFirstName: clients.firstName,
        clientLastName: clients.lastName,
      })
      .from(absences)
      .leftJoin(users, eq(absences.caregiverId, users.id))
      .leftJoin(clients, eq(absences.clientId, clients.id))
      .orderBy(desc(absences.date))

    if (caregiverId) {
      query = query.where(eq(absences.caregiverId, caregiverId))
    }

    const rows = await query
    return c.json(rows)
  } catch (error: any) {
    return c.json({ error: error.message }, 500)
  }
})

// GET /my — get absences for current authenticated user
app.get('/my', async (c) => {
  try {
    const user = c.get('user' as any)
    const rows = await db
      .select({
        id: absences.id,
        caregiverId: absences.caregiverId,
        clientId: absences.clientId,
        date: absences.date,
        type: absences.type,
        reason: absences.reason,
        reportedById: absences.reportedById,
        coverageNeeded: absences.coverageNeeded,
        coverageAssignedTo: absences.coverageAssignedTo,
        createdAt: absences.createdAt,
        clientFirstName: clients.firstName,
        clientLastName: clients.lastName,
      })
      .from(absences)
      .leftJoin(clients, eq(absences.clientId, clients.id))
      .where(eq(absences.caregiverId, user.userId))
      .orderBy(desc(absences.date))

    return c.json(rows)
  } catch (error: any) {
    return c.json({ error: error.message }, 500)
  }
})

// POST / — report an absence. The office records one for any caregiver; a caregiver reports their
// OWN — a caregiverId naming anyone else is a 403 (CVHC let any signed-in user name any caregiver).
// Who covers it is the office's to arrange, so only the office sets the coverage fields.
app.post('/', async (c) => {
  try {
    const user = c.get('user' as any)
    const body = await c.req.json().catch(() => ({})) as any
    const who = selfSubject(c, body.caregiverId)
    if ('refusal' in who) return who.refusal
    if (!body.date || !body.type) return c.json({ error: 'caregiverId, date, and type are required' }, 400)
    const [row] = await db
      .insert(absences)
      .values({
        caregiverId: who.id,
        clientId: body.clientId || null,
        date: body.date,
        type: body.type,
        reason: body.reason || null,
        notes: body.notes || null,
        reportedById: user.userId,
        ...(who.office && body.coverageAssignedTo ? { coverageAssignedTo: body.coverageAssignedTo } : {}),
        ...(who.office && typeof body.coverageNeeded === 'boolean' ? { coverageNeeded: body.coverageNeeded } : {}),
      })
      .returning()
    return c.json(row, 201)
  } catch (error: any) {
    return c.json({ error: error.message }, 500)
  }
})

// DELETE /:id — the office's (CVHC: requireAdmin)
app.delete('/:id', requireAdmin, async (c) => {
  try {
    const id = c.req.param('id')
    await db.delete(absences).where(eq(absences.id, id))
    return c.json({ success: true })
  } catch (error: any) {
    return c.json({ error: error.message }, 500)
  }
})

export default app
