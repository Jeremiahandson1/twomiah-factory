import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { performanceRatings, users, clients } from '../../db/schema.ts'
import { eq, desc } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'

const app = new Hono()
app.use('*', authenticate)

// GET /api/performance-reviews — list all, ?caregiverId filter
app.get('/', async (c) => {
  const { caregiverId } = c.req.query()

  const caregiverUser = db
    .select({
      id: users.id,
      firstName: users.firstName,
      lastName: users.lastName,
    })
    .from(users)
    .as('caregiver_user')

  const rows = await db
    .select({
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
      caregiverFirstName: caregiverUser.firstName,
      caregiverLastName: caregiverUser.lastName,
      clientFirstName: clients.firstName,
      clientLastName: clients.lastName,
    })
    .from(performanceRatings)
    .leftJoin(caregiverUser, eq(performanceRatings.caregiverId, caregiverUser.id))
    .leftJoin(clients, eq(performanceRatings.clientId, clients.id))
    .where(caregiverId ? eq(performanceRatings.caregiverId, caregiverId) : undefined)
    .orderBy(desc(performanceRatings.ratingDate))

  const reviews = rows.map(({ caregiverFirstName, caregiverLastName, clientFirstName, clientLastName, ...review }) => ({
    ...review,
    caregiverName: caregiverFirstName ? `${caregiverFirstName} ${caregiverLastName}` : null,
    clientName: clientFirstName ? `${clientFirstName} ${clientLastName}` : null,
  }))

  return c.json(reviews)
})

// POST /api/performance-reviews — insert
app.post('/', async (c) => {
  const body = await c.req.json()

  const [review] = await db
    .insert(performanceRatings)
    .values({
      caregiverId: body.caregiverId,
      clientId: body.clientId,
      ratingDate: body.ratingDate || new Date().toISOString().split('T')[0],
      satisfactionScore: body.satisfactionScore,
      punctualityScore: body.punctualityScore,
      professionalismScore: body.professionalismScore,
      careQualityScore: body.careQualityScore,
      comments: body.comments,
      noShows: body.noShows ?? 0,
      lateArrivals: body.lateArrivals ?? 0,
    })
    .returning()

  return c.json(review, 201)
})

// PUT /api/performance-reviews/:id — update
app.put('/:id', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json()

  const [updated] = await db
    .update(performanceRatings)
    .set({
      satisfactionScore: body.satisfactionScore,
      punctualityScore: body.punctualityScore,
      professionalismScore: body.professionalismScore,
      careQualityScore: body.careQualityScore,
      comments: body.comments,
      noShows: body.noShows,
      lateArrivals: body.lateArrivals,
      updatedAt: new Date(),
    })
    .where(eq(performanceRatings.id, id))
    .returning()

  if (!updated) return c.json({ error: 'Review not found' }, 404)

  return c.json(updated)
})

export default app
