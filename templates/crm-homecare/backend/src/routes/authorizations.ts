import { Hono } from 'hono'
import { eq, and, asc } from 'drizzle-orm'
import { db } from '../../db/index.ts'
import { authorizations, clients, referralSources } from '../../db/schema.ts'
import { authenticate, requireAdmin } from '../middleware/auth.ts'

const app = new Hono()
app.use('*', authenticate)
app.use('*', requireAdmin)

// GET /
app.get('/', async (c) => {
  const clientId = c.req.query('clientId')
  const status = c.req.query('status')
  const payerId = c.req.query('payerId')

  const conditions = []
  if (clientId) conditions.push(eq(authorizations.clientId, clientId))
  if (status) conditions.push(eq(authorizations.status, status))
  if (payerId) conditions.push(eq(authorizations.payerId, payerId))

  const auths = await db
    .select({
      id: authorizations.id,
      clientId: authorizations.clientId,
      payerId: authorizations.payerId,
      authNumber: authorizations.authNumber,
      midasAuthId: authorizations.midasAuthId,
      procedureCode: authorizations.procedureCode,
      modifier: authorizations.modifier,
      authorizedUnits: authorizations.authorizedUnits,
      unitType: authorizations.unitType,
      usedUnits: authorizations.usedUnits,
      startDate: authorizations.startDate,
      endDate: authorizations.endDate,
      status: authorizations.status,
      lowUnitsAlertThreshold: authorizations.lowUnitsAlertThreshold,
      notes: authorizations.notes,
      importedFrom: authorizations.importedFrom,
      createdById: authorizations.createdById,
      createdAt: authorizations.createdAt,
      updatedAt: authorizations.updatedAt,
      clientFirstName: clients.firstName,
      clientLastName: clients.lastName,
      payerName: referralSources.name,
    })
    .from(authorizations)
    .leftJoin(clients, eq(authorizations.clientId, clients.id))
    .leftJoin(referralSources, eq(authorizations.payerId, referralSources.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(asc(authorizations.endDate))

  // Reshape to match original include structure
  const result = auths.map(({ clientFirstName, clientLastName, payerName, ...auth }) => ({
    ...auth,
    client: { firstName: clientFirstName, lastName: clientLastName },
    payer: { name: payerName },
  }))

  return c.json(result)
})

// POST /
app.post('/', async (c) => {
  const body = await c.req.json()
  const user = c.get('user') as any
  const [auth] = await db.insert(authorizations).values({ ...body, createdById: user.userId }).returning()
  return c.json(auth, 201)
})

// PUT /:id
app.put('/:id', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json()
  const [auth] = await db.update(authorizations).set({ ...body, updatedAt: new Date() }).where(eq(authorizations.id, id)).returning()
  return c.json(auth)
})

// DELETE /:id (soft delete - sets status to cancelled)
app.delete('/:id', async (c) => {
  const id = c.req.param('id')
  await db.update(authorizations).set({ status: 'cancelled', updatedAt: new Date() }).where(eq(authorizations.id, id))
  return c.json({ message: 'Cancelled' })
})

export default app
