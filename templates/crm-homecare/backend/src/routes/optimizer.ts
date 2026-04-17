import { Hono } from 'hono'
import { eq, and, gte, lte, or, isNull, sql, sum } from 'drizzle-orm'
import { db } from '../../db/index.ts'
import { clients, clientAssignments, users, timeEntries, schedules } from '../../db/schema.ts'
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

// ── ROUTE OPTIMIZER — CONFIG STATUS ───────────────────────────────
// GET /config-status — reports whether Google Maps is configured
app.get('/config-status', async (c) => {
  const key = process.env.GOOGLE_MAPS_API_KEY
  if (key) {
    return c.json({
      configured: true,
      provider: 'google-maps',
      message: 'Route optimization is enabled.',
    })
  }
  return c.json({
    configured: false,
    provider: null,
    message:
      'Route optimization requires a Google Maps API key. Set GOOGLE_MAPS_API_KEY in environment variables.',
  })
})

// ── ROUTE OPTIMIZER — DAILY VIEW ──────────────────────────────────
// GET /daily/:date — shifts grouped by caregiver for a given date
app.get('/daily/:date', async (c) => {
  const dateParam = c.req.param('date')
  const d = new Date(dateParam + 'T00:00:00Z')
  if (Number.isNaN(d.getTime())) return c.json({ error: 'Invalid date' }, 400)
  const jsDay = d.getUTCDay()

  // Shifts for the date: one-off (schedules.date === dateParam) or recurring
  // where effectiveDate <= dateParam, (endDate IS NULL OR endDate >= dateParam),
  // and dayOfWeek matches.
  const rows = await db
    .select({
      scheduleId: schedules.id,
      caregiverId: schedules.caregiverId,
      clientId: schedules.clientId,
      startTime: schedules.startTime,
      endTime: schedules.endTime,
      scheduleDate: schedules.date,
      caregiverFirstName: users.firstName,
      caregiverLastName: users.lastName,
      clientFirstName: clients.firstName,
      clientLastName: clients.lastName,
      clientAddress: clients.address,
      clientCity: clients.city,
      clientState: clients.state,
      clientZip: clients.zip,
      clientLat: clients.latitude,
      clientLng: clients.longitude,
    })
    .from(schedules)
    .leftJoin(users, eq(schedules.caregiverId, users.id))
    .leftJoin(clients, eq(schedules.clientId, clients.id))
    .where(
      and(
        eq(schedules.isActive, true),
        or(
          eq(schedules.date, dateParam),
          and(
            lte(schedules.effectiveDate, dateParam),
            or(isNull(schedules.endDate), gte(schedules.endDate, dateParam)),
            eq(schedules.dayOfWeek, jsDay),
          ),
        ),
      ),
    )

  const toTimeStr = (t: any) =>
    t instanceof Date
      ? t.toISOString().slice(11, 16)
      : typeof t === 'string'
      ? t.slice(11, 16)
      : null

  const byCaregiver = new Map<string, any>()
  for (const r of rows) {
    if (!r.caregiverId) continue
    if (!byCaregiver.has(r.caregiverId)) {
      byCaregiver.set(r.caregiverId, {
        id: r.caregiverId,
        name: [r.caregiverFirstName, r.caregiverLastName].filter(Boolean).join(' ').trim(),
        shifts: [],
        totalMiles: null,
        optimizedOrder: null,
      })
    }
    byCaregiver.get(r.caregiverId).shifts.push({
      scheduleId: r.scheduleId,
      clientId: r.clientId,
      clientName: [r.clientFirstName, r.clientLastName].filter(Boolean).join(' ').trim(),
      address: [r.clientAddress, r.clientCity, r.clientState, r.clientZip].filter(Boolean).join(', '),
      startTime: toTimeStr(r.startTime),
      endTime: toTimeStr(r.endTime),
      lat: r.clientLat ? Number(r.clientLat) : null,
      lng: r.clientLng ? Number(r.clientLng) : null,
    })
  }

  // Sort each caregiver's shifts by startTime
  for (const cg of byCaregiver.values()) {
    cg.shifts.sort((a: any, b: any) => String(a.startTime || '').localeCompare(String(b.startTime || '')))
  }

  return c.json({
    date: dateParam,
    caregivers: Array.from(byCaregiver.values()),
  })
})

export default app
