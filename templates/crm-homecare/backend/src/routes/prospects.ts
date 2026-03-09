import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { lead, clients, agencies } from '../../db/schema.ts'
import { eq, desc } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'

const app = new Hono()
app.use('*', authenticate)

// GET /api/prospects — list all leads
app.get('/', async (c) => {
  const rows = await db
    .select()
    .from(lead)
    .orderBy(desc(lead.receivedAt))

  return c.json(rows)
})

// POST /api/prospects — insert new lead with sourcePlatform='manual'
app.post('/', async (c) => {
  const user = c.get('user')
  const body = await c.req.json()

  // Get user's company id for the lead
  const { users } = await import('../../db/schema.ts')
  const [currentUser] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, user.userId))
    .limit(1)

  // Get the first agency as companyId
  const [agency] = await db.select({ id: agencies.id }).from(agencies).limit(1)
  const companyId = agency?.id || ''

  const [newLead] = await db
    .insert(lead)
    .values({
      sourcePlatform: 'manual',
      homeownerName: body.homeownerName || body.name || '',
      email: body.email,
      phone: body.phone,
      jobType: body.jobType,
      location: body.location,
      budget: body.budget,
      description: body.description,
      status: 'new',
      companyId,
    })
    .returning()

  return c.json(newLead, 201)
})

// POST /api/prospects/:id/convert — convert lead to client
app.post('/:id/convert', async (c) => {
  const id = c.req.param('id')

  // Get the lead
  const [prospect] = await db
    .select()
    .from(lead)
    .where(eq(lead.id, id))
    .limit(1)

  if (!prospect) return c.json({ error: 'Prospect not found' }, 404)

  if (prospect.status === 'converted') {
    return c.json({ error: 'Prospect already converted' }, 400)
  }

  // Parse name into first/last
  const nameParts = (prospect.homeownerName || '').trim().split(/\s+/)
  const firstName = nameParts[0] || 'Unknown'
  const lastName = nameParts.slice(1).join(' ') || 'Unknown'

  // Create client from lead data
  const [client] = await db
    .insert(clients)
    .values({
      firstName,
      lastName,
      email: prospect.email,
      phone: prospect.phone,
      address: prospect.location,
      notes: prospect.description,
    })
    .returning()

  // Update lead status
  const [updated] = await db
    .update(lead)
    .set({
      status: 'converted',
      convertedContactId: client.id,
      updatedAt: new Date(),
    })
    .where(eq(lead.id, id))
    .returning()

  return c.json({ success: true, lead: updated, client })
})

export default app
