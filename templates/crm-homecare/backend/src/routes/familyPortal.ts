import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { clients, portalMessageThreads, portalMessages } from '../../db/schema.ts'
import { eq, desc } from 'drizzle-orm'
import { authenticate, requireAdmin } from '../middleware/auth.ts'
import { createId } from '@paralleldrive/cuid2'

const app = new Hono()
app.use('*', authenticate)

// GET /api/family-portal/admin/members — list portal-enabled clients
app.get('/admin/members', async (c) => {
  const rows = await db
    .select({
      id: clients.id,
      firstName: clients.firstName,
      lastName: clients.lastName,
      portalEmail: clients.portalEmail,
      lastPortalVisit: clients.lastPortalVisit,
      isActive: clients.isActive,
    })
    .from(clients)
    .where(eq(clients.portalEnabled, true))
    .orderBy(desc(clients.updatedAt))

  return c.json(rows)
})

// GET /api/family-portal/admin/messages — list threads with latest message
app.get('/admin/messages', async (c) => {
  const threads = await db
    .select({
      id: portalMessageThreads.id,
      clientId: portalMessageThreads.clientId,
      subject: portalMessageThreads.subject,
      status: portalMessageThreads.status,
      lastMessageAt: portalMessageThreads.lastMessageAt,
      clientLastReadAt: portalMessageThreads.clientLastReadAt,
      staffLastReadAt: portalMessageThreads.staffLastReadAt,
      createdAt: portalMessageThreads.createdAt,
      clientFirstName: clients.firstName,
      clientLastName: clients.lastName,
    })
    .from(portalMessageThreads)
    .leftJoin(clients, eq(portalMessageThreads.clientId, clients.id))
    .orderBy(desc(portalMessageThreads.lastMessageAt))
    .limit(200)

  return c.json(threads)
})

// POST /api/family-portal/admin/members — enable portal for a client
app.post('/admin/members', async (c) => {
  const body = await c.req.json()

  if (!body.clientId || !body.portalEmail) {
    return c.json({ error: 'clientId and portalEmail are required' }, 400)
  }

  const [row] = await db
    .update(clients)
    .set({
      portalEnabled: true,
      portalEmail: body.portalEmail,
      updatedAt: new Date(),
    })
    .where(eq(clients.id, body.clientId))
    .returning({
      id: clients.id,
      firstName: clients.firstName,
      lastName: clients.lastName,
      portalEmail: clients.portalEmail,
      portalEnabled: clients.portalEnabled,
      isActive: clients.isActive,
    })

  if (!row) return c.json({ error: 'Client not found' }, 404)
  return c.json(row, 201)
})

// PUT /api/family-portal/admin/members/:id/status
app.put('/admin/members/:id/status', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json()

  const [row] = await db
    .update(clients)
    .set({
      isActive: body.isActive,
      updatedAt: new Date(),
    })
    .where(eq(clients.id, id))
    .returning({
      id: clients.id,
      firstName: clients.firstName,
      lastName: clients.lastName,
      isActive: clients.isActive,
    })

  if (!row) return c.json({ error: 'Client not found' }, 404)
  return c.json(row)
})

// POST /api/family-portal/admin/members/:id/reset-password
app.post('/admin/members/:id/reset-password', async (c) => {
  const id = c.req.param('id')

  // Generate a random temporary password hash
  const tempPassword = createId()
  const hash = await Bun.password.hash(tempPassword, 'bcrypt')

  const [row] = await db
    .update(clients)
    .set({
      portalPasswordHash: hash,
      updatedAt: new Date(),
    })
    .where(eq(clients.id, id))
    .returning({ id: clients.id })

  if (!row) return c.json({ error: 'Client not found' }, 404)
  return c.json({ success: true, temporaryPassword: tempPassword })
})

// POST /api/family-portal/admin/messages/:id/reply
app.post('/admin/messages/:id/reply', async (c) => {
  const threadId = c.req.param('id')
  const user = c.get('user') as any
  const body = await c.req.json()

  if (!body.body) {
    return c.json({ error: 'body is required' }, 400)
  }

  const [message] = await db
    .insert(portalMessages)
    .values({
      threadId,
      senderType: 'staff',
      senderName: user.firstName ? `${user.firstName} ${user.lastName || ''}`.trim() : 'Staff',
      body: body.body,
    })
    .returning()

  // Update thread lastMessageAt and staffLastReadAt
  await db
    .update(portalMessageThreads)
    .set({
      lastMessageAt: new Date(),
      staffLastReadAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(portalMessageThreads.id, threadId))

  return c.json(message, 201)
})

export default app
