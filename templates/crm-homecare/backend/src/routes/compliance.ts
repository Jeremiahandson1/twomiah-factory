import { Hono } from 'hono'
import { eq, and, lte, desc, count, avg, sql } from 'drizzle-orm'
import { db } from '../../db/index.ts'
import { users, backgroundChecks, performanceRatings, loginActivity, clients } from '../../db/schema.ts'
import { authenticate, requireAdmin } from '../middleware/auth.ts'

const app = new Hono()
app.use('*', authenticate)
app.use('*', requireAdmin)

// Compliance dashboard - certifications expiring, background checks, etc.
app.get('/dashboard', async (c) => {
  const soon = new Date()
  soon.setDate(soon.getDate() + 60)
  const soonStr = soon.toISOString().split('T')[0]

  const [
    [{ value: activeCaregiversCount }],
    caregivers,
    recentBackgroundChecks,
    performanceRatingRows,
  ] = await Promise.all([
    db.select({ value: count() }).from(users).where(and(eq(users.role, 'caregiver'), eq(users.isActive, true))),
    db.select({
      id: users.id,
      firstName: users.firstName,
      lastName: users.lastName,
      certifications: users.certifications,
      certificationsExpiry: users.certificationsExpiry,
    }).from(users).where(and(eq(users.role, 'caregiver'), eq(users.isActive, true))),
    db.select({
      id: backgroundChecks.id,
      caregiverId: backgroundChecks.caregiverId,
      checkType: backgroundChecks.checkType,
      provider: backgroundChecks.provider,
      status: backgroundChecks.status,
      initiatedDate: backgroundChecks.initiatedDate,
      expirationDate: backgroundChecks.expirationDate,
      notes: backgroundChecks.notes,
      createdAt: backgroundChecks.createdAt,
      updatedAt: backgroundChecks.updatedAt,
      caregiverFirstName: users.firstName,
      caregiverLastName: users.lastName,
    })
      .from(backgroundChecks)
      .leftJoin(users, eq(backgroundChecks.caregiverId, users.id))
      .where(lte(backgroundChecks.expirationDate, soonStr))
      .orderBy(backgroundChecks.expirationDate)
      .limit(20),
    db.select({
      caregiverId: performanceRatings.caregiverId,
      avgSatisfaction: avg(performanceRatings.satisfactionScore),
      avgPunctuality: avg(performanceRatings.punctualityScore),
      count: count(),
    })
      .from(performanceRatings)
      .groupBy(performanceRatings.caregiverId),
  ])

  const formattedBgChecks = recentBackgroundChecks.map(({ caregiverFirstName, caregiverLastName, ...rest }) => ({
    ...rest,
    caregiver: { firstName: caregiverFirstName, lastName: caregiverLastName },
  }))

  // Identify caregivers with expiring certs
  const expiringCerts = caregivers.flatMap((cg: any) =>
    (cg.certificationsExpiry || []).map((exp: any, i: number) => ({
      caregiverId: cg.id,
      name: `${cg.firstName} ${cg.lastName}`,
      cert: (cg.certifications as any[])[i],
      expiry: exp,
    })).filter((x: any) => x.expiry && new Date(x.expiry) <= soon)
  )

  const performanceRatingsFormatted = performanceRatingRows.map(r => ({
    caregiverId: r.caregiverId,
    _avg: { satisfactionScore: r.avgSatisfaction ? Number(r.avgSatisfaction) : null, punctualityScore: r.avgPunctuality ? Number(r.avgPunctuality) : null },
    _count: r.count,
  }))

  return c.json({
    activeCaregiversCount,
    expiringCerts,
    recentBackgroundChecks: formattedBgChecks,
    performanceRatings: performanceRatingsFormatted,
  })
})

// Performance ratings
app.get('/ratings', async (c) => {
  const caregiverId = c.req.query('caregiverId')
  const where = caregiverId ? eq(performanceRatings.caregiverId, caregiverId) : undefined

  const rows = await db.select({
    id: performanceRatings.id,
    caregiverId: performanceRatings.caregiverId,
    clientId: performanceRatings.clientId,
    ratingDate: performanceRatings.ratingDate,
    satisfactionScore: performanceRatings.satisfactionScore,
    punctualityScore: performanceRatings.punctualityScore,
    professionalismScore: performanceRatings.professionalismScore,
    careQualityScore: performanceRatings.careQualityScore,
    comments: performanceRatings.comments,
    noShows: performanceRatings.noShows,
    lateArrivals: performanceRatings.lateArrivals,
    createdAt: performanceRatings.createdAt,
    updatedAt: performanceRatings.updatedAt,
    caregiverFirstName: users.firstName,
    caregiverLastName: users.lastName,
  })
    .from(performanceRatings)
    .leftJoin(users, eq(performanceRatings.caregiverId, users.id))
    .where(where)
    .orderBy(desc(performanceRatings.ratingDate))

  // Get client names separately
  const clientIds = [...new Set(rows.map(r => r.clientId).filter(Boolean))]
  const clientMap: Record<string, { firstName: string; lastName: string }> = {}
  if (clientIds.length > 0) {
    const clientRows = await db.select({ id: clients.id, firstName: clients.firstName, lastName: clients.lastName })
      .from(clients)
      .where(sql`${clients.id} IN (${sql.join(clientIds.map(id => sql`${id}`), sql`, `)})`)
    for (const cr of clientRows) {
      clientMap[cr.id] = { firstName: cr.firstName, lastName: cr.lastName }
    }
  }

  const formatted = rows.map(({ caregiverFirstName, caregiverLastName, ...rest }) => ({
    ...rest,
    caregiver: { firstName: caregiverFirstName, lastName: caregiverLastName },
    client: clientMap[rest.clientId] || null,
  }))

  return c.json(formatted)
})

app.post('/ratings', async (c) => {
  const body = await c.req.json()
  const [rating] = await db.insert(performanceRatings).values(body).returning()
  return c.json(rating, 201)
})

// Login activity monitor
app.get('/login-activity', async (c) => {
  const rows = await db.select({
    id: loginActivity.id,
    email: loginActivity.email,
    userId: loginActivity.userId,
    success: loginActivity.success,
    ipAddress: loginActivity.ipAddress,
    userAgent: loginActivity.userAgent,
    failReason: loginActivity.failReason,
    createdAt: loginActivity.createdAt,
    userFirstName: users.firstName,
    userLastName: users.lastName,
    userRole: users.role,
  })
    .from(loginActivity)
    .leftJoin(users, eq(loginActivity.userId, users.id))
    .orderBy(desc(loginActivity.createdAt))
    .limit(100)

  const formatted = rows.map(({ userFirstName, userLastName, userRole, ...rest }) => ({
    ...rest,
    user: userFirstName ? { firstName: userFirstName, lastName: userLastName, role: userRole } : null,
  }))

  return c.json(formatted)
})

export default app
