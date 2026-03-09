import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { shiftSwaps, users, clients } from '../../db/schema.ts'
import { eq, desc } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { alias } from 'drizzle-orm/pg-core'

const app = new Hono()
app.use('*', authenticate)

const requester = alias(users, 'requester')
const target = alias(users, 'target')

// GET /api/shift-swaps
app.get('/', async (c) => {
  const { status } = c.req.query()

  const baseQuery = db
    .select({
      id: shiftSwaps.id,
      scheduleId: shiftSwaps.scheduleId,
      requesterId: shiftSwaps.requesterId,
      targetId: shiftSwaps.targetId,
      clientId: shiftSwaps.clientId,
      shiftDate: shiftSwaps.shiftDate,
      startTime: shiftSwaps.startTime,
      endTime: shiftSwaps.endTime,
      reason: shiftSwaps.reason,
      status: shiftSwaps.status,
      reviewedById: shiftSwaps.reviewedById,
      reviewedAt: shiftSwaps.reviewedAt,
      createdAt: shiftSwaps.createdAt,
      requesterFirstName: requester.firstName,
      requesterLastName: requester.lastName,
      targetFirstName: target.firstName,
      targetLastName: target.lastName,
      clientFirstName: clients.firstName,
      clientLastName: clients.lastName,
    })
    .from(shiftSwaps)
    .leftJoin(requester, eq(shiftSwaps.requesterId, requester.id))
    .leftJoin(target, eq(shiftSwaps.targetId, target.id))
    .leftJoin(clients, eq(shiftSwaps.clientId, clients.id))
    .orderBy(desc(shiftSwaps.createdAt))

  const rows = status
    ? await baseQuery.where(eq(shiftSwaps.status, status))
    : await baseQuery

  return c.json(rows)
})

// POST /api/shift-swaps
app.post('/', async (c) => {
  const user = c.get('user') as any
  const body = await c.req.json()
  const [row] = await db
    .insert(shiftSwaps)
    .values({ ...body, requesterId: user.userId })
    .returning()
  return c.json(row, 201)
})

// PUT /api/shift-swaps/:id/approve
app.put('/:id/approve', async (c) => {
  const id = c.req.param('id')
  const user = c.get('user') as any
  const [row] = await db
    .update(shiftSwaps)
    .set({ status: 'approved', reviewedById: user.userId, reviewedAt: new Date() })
    .where(eq(shiftSwaps.id, id))
    .returning()
  if (!row) return c.json({ error: 'Not found' }, 404)
  return c.json(row)
})

// PUT /api/shift-swaps/:id/reject
app.put('/:id/reject', async (c) => {
  const id = c.req.param('id')
  const user = c.get('user') as any
  const [row] = await db
    .update(shiftSwaps)
    .set({ status: 'rejected', reviewedById: user.userId, reviewedAt: new Date() })
    .where(eq(shiftSwaps.id, id))
    .returning()
  if (!row) return c.json({ error: 'Not found' }, 404)
  return c.json(row)
})

export default app
