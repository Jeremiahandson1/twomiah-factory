import { Hono } from 'hono'
import jwt from 'jsonwebtoken'
import { eq, and, desc } from 'drizzle-orm'
import { db } from '../../db/index.ts'
import { schedules, timeEntries, invoices, invoiceLineItems, clientAssignments, users } from '../../db/schema.ts'
import type { Context, Next } from 'hono'

const app = new Hono()

// Portal uses its own lightweight auth (token-based, no password)
const portalAuth = async (c: Context, next: Next) => {
  const token = c.req.header('x-portal-token')
  if (!token) return c.json({ error: 'Portal token required' }, 401)
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as any
    c.set('portalClientId', decoded.clientId)
    await next()
  } catch {
    return c.json({ error: 'Invalid portal token' }, 401)
  }
}

// Generate portal access link (admin only)
app.post('/generate-link', async (c) => {
  const { clientId } = await c.req.json()
  const token = jwt.sign({ clientId, type: 'portal' }, process.env.JWT_SECRET!, { expiresIn: '30d' })
  return c.json({ token, url: `${process.env.FRONTEND_URL}/portal?token=${token}` })
})

// Portal endpoints (family-facing)
app.get('/schedule', portalAuth, async (c) => {
  const clientId = c.get('portalClientId') as string
  const rows = await db.select()
    .from(schedules)
    .where(and(eq(schedules.clientId, clientId), eq(schedules.isActive, true)))
    .orderBy(schedules.effectiveDate)
  return c.json(rows)
})

app.get('/visits', portalAuth, async (c) => {
  const clientId = c.get('portalClientId') as string
  const rows = await db.select({
    id: timeEntries.id,
    caregiverId: timeEntries.caregiverId,
    clientId: timeEntries.clientId,
    assignmentId: timeEntries.assignmentId,
    scheduleId: timeEntries.scheduleId,
    startTime: timeEntries.startTime,
    endTime: timeEntries.endTime,
    durationMinutes: timeEntries.durationMinutes,
    allottedMinutes: timeEntries.allottedMinutes,
    billableMinutes: timeEntries.billableMinutes,
    discrepancyMinutes: timeEntries.discrepancyMinutes,
    clockInLocation: timeEntries.clockInLocation,
    clockOutLocation: timeEntries.clockOutLocation,
    isComplete: timeEntries.isComplete,
    notes: timeEntries.notes,
    createdAt: timeEntries.createdAt,
    updatedAt: timeEntries.updatedAt,
    caregiverFirstName: users.firstName,
    caregiverLastName: users.lastName,
  })
    .from(timeEntries)
    .leftJoin(users, eq(timeEntries.caregiverId, users.id))
    .where(and(eq(timeEntries.clientId, clientId), eq(timeEntries.isComplete, true)))
    .orderBy(desc(timeEntries.startTime))
    .limit(30)

  const formatted = rows.map(({ caregiverFirstName, caregiverLastName, ...rest }) => ({
    ...rest,
    caregiver: { firstName: caregiverFirstName, lastName: caregiverLastName },
  }))

  return c.json(formatted)
})

app.get('/invoices', portalAuth, async (c) => {
  const clientId = c.get('portalClientId') as string
  const invoiceRows = await db.select()
    .from(invoices)
    .where(eq(invoices.clientId, clientId))
    .orderBy(desc(invoices.createdAt))
    .limit(20)

  // Fetch line items for each invoice
  const results = await Promise.all(invoiceRows.map(async (inv) => {
    const lineItems = await db.select()
      .from(invoiceLineItems)
      .where(eq(invoiceLineItems.invoiceId, inv.id))
    return { ...inv, lineItems }
  }))

  return c.json(results)
})

app.get('/caregivers', portalAuth, async (c) => {
  const clientId = c.get('portalClientId') as string
  const rows = await db.select({
    firstName: users.firstName,
    lastName: users.lastName,
    phone: users.phone,
    certifications: users.certifications,
  })
    .from(clientAssignments)
    .innerJoin(users, eq(clientAssignments.caregiverId, users.id))
    .where(and(eq(clientAssignments.clientId, clientId), eq(clientAssignments.status, 'active')))

  return c.json(rows)
})

export default app
