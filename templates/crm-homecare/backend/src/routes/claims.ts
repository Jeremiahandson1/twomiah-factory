import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { claims, ediBatches, evvVisits, claimStatusHistory } from '../../db/schema.ts'
import { eq, and, count, desc } from 'drizzle-orm'
import { authenticate, requireAdmin } from '../middleware/auth.ts'
import { createId } from '@paralleldrive/cuid2'
import {
  generateClaimFromEVV,
  batchGenerateClaims,
  checkAuthorizationForSubmission,
  deductAuthorizationUnits,
} from '../services/claimsEngine.ts'

const app = new Hono()
app.use('*', authenticate, requireAdmin)

app.get('/', async (c) => {
  const { status, page = '1', limit = '50' } = c.req.query()
  const skip = (parseInt(page) - 1) * parseInt(limit)

  const where = status ? eq(claims.status, status) : undefined

  const [rows, [{ value: total }]] = await Promise.all([
    db.select({
      claim: claims,
      batchNumber: ediBatches.batchNumber,
      serviceDate: evvVisits.serviceDate,
    })
      .from(claims)
      .leftJoin(ediBatches, eq(claims.ediBatchId, ediBatches.id))
      .leftJoin(evvVisits, eq(claims.evvVisitId, evvVisits.id))
      .where(where)
      .orderBy(desc(claims.createdAt))
      .offset(skip)
      .limit(parseInt(limit)),
    db.select({ value: count() }).from(claims).where(where),
  ])

  const result = rows.map(r => ({
    ...r.claim,
    ediBatch: r.batchNumber ? { batchNumber: r.batchNumber } : null,
    evvVisit: r.serviceDate ? { serviceDate: r.serviceDate } : null,
  }))

  return c.json({ claims: result, total })
})

app.post('/', async (c) => {
  const body = await c.req.json()
  const [claim] = await db.insert(claims).values(body).returning()
  return c.json(claim, 201)
})

app.patch('/:id', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json()
  const user = c.get('user')

  const [claim] = await db.update(claims)
    .set({ ...body, updatedAt: new Date() })
    .where(eq(claims.id, id))
    .returning()

  // Log status change if status was updated
  if (body.status) {
    await db.insert(claimStatusHistory).values({
      id: createId(),
      claimId: id,
      status: body.status,
      notes: body.statusNotes || `Status changed to ${body.status}`,
      createdBy: user.userId,
    })
  }

  return c.json(claim)
})

// Generate claim from EVV visit
app.post('/generate-from-evv', async (c) => {
  const { evvVisitId } = await c.req.json()
  const user = c.get('user')

  if (!evvVisitId) {
    return c.json({ error: 'EVV visit ID is required' }, 400)
  }

  try {
    const result = await generateClaimFromEVV(evvVisitId, user.userId)
    return c.json(result, 201)
  } catch (e: any) {
    return c.json({ error: e.message }, 400)
  }
})

// Batch generate claims from date range
app.post('/batch-generate', async (c) => {
  const { startDate, endDate } = await c.req.json()
  const user = c.get('user')

  if (!startDate || !endDate) {
    return c.json({ error: 'Start date and end date are required' }, 400)
  }

  const results = await batchGenerateClaims(startDate, endDate, user.userId)
  return c.json(results)
})

// Check authorization before submission
app.get('/:id/auth-check', async (c) => {
  const id = c.req.param('id')
  const result = await checkAuthorizationForSubmission(id)
  return c.json(result)
})

// Submit claim (deducts auth units)
app.post('/:id/submit', async (c) => {
  const id = c.req.param('id')
  const user = c.get('user')

  // Check auth first
  const check = await checkAuthorizationForSubmission(id)
  if (!check.canSubmit) {
    return c.json({ error: 'Cannot submit claim', blockers: check.blockers }, 400)
  }

  // Update claim status
  const [claim] = await db.update(claims)
    .set({ status: 'submitted', submissionDate: new Date().toISOString().split('T')[0], updatedAt: new Date() })
    .where(eq(claims.id, id))
    .returning()

  // Deduct authorization units
  await deductAuthorizationUnits(id)

  // Log status
  await db.insert(claimStatusHistory).values({
    id: createId(),
    claimId: id,
    status: 'submitted',
    notes: check.warnings.length ? `Submitted with warnings: ${check.warnings.join('; ')}` : 'Claim submitted',
    createdBy: user.userId,
  })

  return c.json({ claim, warnings: check.warnings })
})

// Get claim status history
app.get('/:id/history', async (c) => {
  const id = c.req.param('id')
  const history = await db
    .select()
    .from(claimStatusHistory)
    .where(eq(claimStatusHistory.claimId, id))
    .orderBy(desc(claimStatusHistory.createdAt))

  return c.json(history)
})

export default app
