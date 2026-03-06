import { Hono } from 'hono'
import { eq, and, gte, sql, sum } from 'drizzle-orm'
import { db } from '../../db/index.ts'
import { clients, clientAssignments, users, timeEntries } from '../../db/schema.ts'
import { authenticate, requireAdmin } from '../middleware/auth.ts'

const app = new Hono()
app.use('*', authenticate)
app.use('*', requireAdmin)

// Company-level efficiency analysis
app.get('/company', async (c) => {
  // Get active clients with their active assignments
  const activeClientRows = await db.select({
    clientId: clients.id,
    clientFirstName: clients.firstName,
    clientLastName: clients.lastName,
    assignmentId: clientAssignments.id,
    caregiverId: clientAssignments.caregiverId,
    caregiverFirstName: users.firstName,
    caregiverLastName: users.lastName,
  })
    .from(clients)
    .leftJoin(clientAssignments, and(eq(clientAssignments.clientId, clients.id), eq(clientAssignments.status, 'active')))
    .leftJoin(users, eq(clientAssignments.caregiverId, users.id))
    .where(eq(clients.isActive, true))

  // Group by client to find understaffed
  const clientMap = new Map<string, { clientId: string; name: string; assignments: any[] }>()
  for (const row of activeClientRows) {
    if (!clientMap.has(row.clientId)) {
      clientMap.set(row.clientId, {
        clientId: row.clientId,
        name: `${row.clientFirstName} ${row.clientLastName}`,
        assignments: [],
      })
    }
    if (row.assignmentId) {
      clientMap.get(row.clientId)!.assignments.push({
        id: row.assignmentId,
        caregiverId: row.caregiverId,
        caregiver: { id: row.caregiverId, firstName: row.caregiverFirstName, lastName: row.caregiverLastName },
      })
    }
  }

  const understaffed = Array.from(clientMap.values())
    .filter(c => c.assignments.length === 0)
    .map(c => ({ clientId: c.clientId, name: c.name, issue: 'No active caregiver assigned' }))

  // Caregiver hours in last 7 days
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  const caregiverHours = await db.select({
    caregiverId: timeEntries.caregiverId,
    totalMinutes: sum(timeEntries.durationMinutes),
  })
    .from(timeEntries)
    .where(and(gte(timeEntries.startTime, sevenDaysAgo), eq(timeEntries.isComplete, true)))
    .groupBy(timeEntries.caregiverId)

  const overscheduled = caregiverHours
    .filter(c => (Number(c.totalMinutes) || 0) > 40 * 60)
    .map(c => ({ caregiverId: c.caregiverId, weeklyMinutes: Number(c.totalMinutes), issue: 'Over 40 hours this week' }))

  return c.json({ understaffedClients: understaffed, overscheduledCaregivers: overscheduled })
})

// Route optimizer - find optimal caregiver order for multi-client days
app.get('/routes', async (c) => {
  const caregiverId = c.req.query('caregiverId')
  const date = c.req.query('date')
  const dateObj = date ? new Date(date) : new Date()

  const assignments = await db.select({
    firstName: clients.firstName,
    lastName: clients.lastName,
    address: clients.address,
    city: clients.city,
    latitude: clients.latitude,
    longitude: clients.longitude,
  })
    .from(clientAssignments)
    .innerJoin(clients, eq(clientAssignments.clientId, clients.id))
    .where(and(
      caregiverId ? eq(clientAssignments.caregiverId, caregiverId) : undefined,
      eq(clientAssignments.status, 'active'),
    ))

  return c.json({ caregiverId, date: dateObj.toISOString().split('T')[0], stops: assignments })
})

export default app
