import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { clients, portalMessageThreads, portalMessages } from '../../db/schema.ts'
import { eq, desc, isNotNull } from 'drizzle-orm'
import { authenticate, requireAdmin } from '../middleware/auth.ts'
import { createId } from '@paralleldrive/cuid2'

const app = new Hono()
app.use('*', authenticate)

// GET /api/family-portal/admin/members — list portal-enabled clients
app.get('/admin/members', async (c) => {
  // List everyone who has ever had portal access set up (by email), so a
  // member whose access was turned off is still visible to re-enable. The
  // screen's "active" state reflects portal access, not the client's care status.
  const rows = await db
    .select({
      id: clients.id,
      firstName: clients.firstName,
      lastName: clients.lastName,
      portalEmail: clients.portalEmail,
      lastPortalVisit: clients.lastPortalVisit,
      isActive: clients.portalEnabled,
      portalEnabled: clients.portalEnabled,
    })
    .from(clients)
    .where(isNotNull(clients.portalEmail))
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

  // The form sends `email`; older callers sent `portalEmail`. Accept both.
  const portalEmail = (body.portalEmail || body.email || '').trim().toLowerCase()
  if (!body.clientId || !portalEmail) {
    return c.json({ error: 'clientId and email are required' }, 400)
  }

  // Portal login verifies against portalPasswordHash, so a member enabled
  // without a hash could never sign in. Hash the admin-set password here.
  const updates: any = {
    portalEnabled: true,
    portalEmail,
    updatedAt: new Date(),
  }
  if (body.password) {
    if (String(body.password).length < 8) {
      return c.json({ error: 'Password must be at least 8 characters' }, 400)
    }
    updates.portalPasswordHash = await Bun.password.hash(String(body.password), 'bcrypt')
  }

  const [row] = await db
    .update(clients)
    .set(updates)
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

  // Toggle portal ACCESS, not the client's care-active flag — flipping isActive
  // here would silently soft-delete the client from the entire CRM.
  const [row] = await db
    .update(clients)
    .set({
      portalEnabled: body.isActive,
      updatedAt: new Date(),
    })
    .where(eq(clients.id, id))
    .returning({
      id: clients.id,
      firstName: clients.firstName,
      lastName: clients.lastName,
      isActive: clients.portalEnabled,
      portalEnabled: clients.portalEnabled,
    })

  if (!row) return c.json({ error: 'Client not found' }, 404)
  return c.json(row)
})

// PUT/POST /api/family-portal/admin/members/:id/reset-password
// The frontend sends the admin-chosen password via PUT; honor it, and fall back
// to a random temporary password when none is supplied.
const resetPassword = async (c: any) => {
  const id = c.req.param('id')
  let provided = ''
  try { provided = (await c.req.json())?.password || '' } catch { /* no body */ }

  if (provided && String(provided).length < 8) {
    return c.json({ error: 'Password must be at least 8 characters' }, 400)
  }

  const password = provided || createId()
  const hash = await Bun.password.hash(String(password), 'bcrypt')

  const [row] = await db
    .update(clients)
    .set({
      portalPasswordHash: hash,
      updatedAt: new Date(),
    })
    .where(eq(clients.id, id))
    .returning({ id: clients.id })

  if (!row) return c.json({ error: 'Client not found' }, 404)
  return c.json({ success: true, ...(provided ? {} : { temporaryPassword: password }) })
}
app.post('/admin/members/:id/reset-password', resetPassword)
app.put('/admin/members/:id/reset-password', resetPassword)

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
