import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { sequence, sequenceStep, sequenceEnrollment, contact as contactTable } from '../../db/schema.ts'
import { eq, and, asc, count, desc } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'
import { createId } from '@paralleldrive/cuid2'

/**
 * Follow-up sequences — author multi-step SMS/email cadences and enroll
 * contacts. The background sequenceRunner sends due steps and advances
 * enrollments; these routes just author sequences and manage enrollments.
 */

const app = new Hono()
app.use('*', authenticate)

// GET /sequences — list with step + active-enrollment counts
app.get('/', requirePermission('contacts:read'), async (c) => {
  const user = c.get('user') as any
  const seqs = await db.select().from(sequence)
    .where(eq(sequence.companyId, user.companyId))
    .orderBy(desc(sequence.createdAt))

  const withCounts = await Promise.all(seqs.map(async (s) => {
    const [[{ value: stepCount }], [{ value: activeCount }]] = await Promise.all([
      db.select({ value: count() }).from(sequenceStep).where(eq(sequenceStep.sequenceId, s.id)),
      db.select({ value: count() }).from(sequenceEnrollment).where(and(eq(sequenceEnrollment.sequenceId, s.id), eq(sequenceEnrollment.status, 'active'))),
    ])
    return { ...s, stepCount: Number(stepCount), activeEnrollments: Number(activeCount) }
  }))
  return c.json({ sequences: withCounts })
})

// GET /sequences/:id — sequence + ordered steps
app.get('/:id', requirePermission('contacts:read'), async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')
  const [s] = await db.select().from(sequence).where(and(eq(sequence.id, id), eq(sequence.companyId, user.companyId))).limit(1)
  if (!s) return c.json({ error: 'Sequence not found' }, 404)
  const steps = await db.select().from(sequenceStep).where(eq(sequenceStep.sequenceId, id)).orderBy(asc(sequenceStep.stepOrder))
  return c.json({ ...s, steps })
})

async function replaceSteps(sequenceId: string, steps: any[]) {
  await db.delete(sequenceStep).where(eq(sequenceStep.sequenceId, sequenceId))
  if (Array.isArray(steps) && steps.length) {
    await db.insert(sequenceStep).values(steps.map((st, i) => ({
      id: createId(),
      sequenceId,
      stepOrder: i,
      delayHours: Number(st.delayHours) || 0,
      channel: st.channel === 'email' ? 'email' : 'sms',
      subject: st.subject || null,
      body: String(st.body || ''),
    })))
  }
}

// POST /sequences — create
app.post('/', requirePermission('contacts:update'), async (c) => {
  const user = c.get('user') as any
  const { name, description, trigger, active, steps } = await c.req.json()
  if (!name) return c.json({ error: 'Name is required' }, 400)

  const [created] = await db.insert(sequence).values({
    id: createId(),
    name,
    description: description || null,
    trigger: trigger || 'manual',
    active: active !== false,
    companyId: user.companyId,
  }).returning()

  await replaceSteps(created.id, steps || [])
  return c.json(created, 201)
})

// PUT /sequences/:id — update sequence + replace steps
app.put('/:id', requirePermission('contacts:update'), async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')
  const [existing] = await db.select().from(sequence).where(and(eq(sequence.id, id), eq(sequence.companyId, user.companyId))).limit(1)
  if (!existing) return c.json({ error: 'Sequence not found' }, 404)

  const { name, description, trigger, active, steps } = await c.req.json()
  const [updated] = await db.update(sequence).set({
    name: name ?? existing.name,
    description: description ?? existing.description,
    trigger: trigger ?? existing.trigger,
    active: active ?? existing.active,
    updatedAt: new Date(),
  }).where(eq(sequence.id, id)).returning()

  if (steps !== undefined) await replaceSteps(id, steps)
  return c.json(updated)
})

// DELETE /sequences/:id
app.delete('/:id', requirePermission('contacts:delete'), async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')
  const [existing] = await db.select().from(sequence).where(and(eq(sequence.id, id), eq(sequence.companyId, user.companyId))).limit(1)
  if (!existing) return c.json({ error: 'Sequence not found' }, 404)
  await db.delete(sequence).where(eq(sequence.id, id))
  return c.json({ success: true })
})

// POST /sequences/:id/enroll — enroll a contact; schedules step 0
app.post('/:id/enroll', requirePermission('contacts:update'), async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')
  const { contactId } = await c.req.json()
  if (!contactId) return c.json({ error: 'contactId is required' }, 400)

  const [s] = await db.select().from(sequence).where(and(eq(sequence.id, id), eq(sequence.companyId, user.companyId))).limit(1)
  if (!s) return c.json({ error: 'Sequence not found' }, 404)
  const [ct] = await db.select().from(contactTable).where(and(eq(contactTable.id, contactId), eq(contactTable.companyId, user.companyId))).limit(1)
  if (!ct) return c.json({ error: 'Contact not found' }, 404)

  // Avoid duplicate active enrollment in the same sequence.
  const [dupe] = await db.select().from(sequenceEnrollment)
    .where(and(eq(sequenceEnrollment.sequenceId, id), eq(sequenceEnrollment.contactId, contactId), eq(sequenceEnrollment.status, 'active'))).limit(1)
  if (dupe) return c.json({ error: 'Contact is already enrolled in this sequence' }, 409)

  const steps = await db.select().from(sequenceStep).where(eq(sequenceStep.sequenceId, id)).orderBy(asc(sequenceStep.stepOrder))
  if (!steps.length) return c.json({ error: 'Sequence has no steps' }, 400)

  const nextRunAt = new Date(Date.now() + (steps[0].delayHours || 0) * 3600_000)
  const [enr] = await db.insert(sequenceEnrollment).values({
    id: createId(),
    sequenceId: id,
    contactId,
    status: 'active',
    currentStep: 0,
    nextRunAt,
    companyId: user.companyId,
  }).returning()
  return c.json(enr, 201)
})

// GET /sequences/:id/enrollments
app.get('/:id/enrollments', requirePermission('contacts:read'), async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')
  const rows = await db.select({
    enrollment: sequenceEnrollment,
    contactName: contactTable.name,
  })
    .from(sequenceEnrollment)
    .leftJoin(contactTable, eq(sequenceEnrollment.contactId, contactTable.id))
    .where(and(eq(sequenceEnrollment.sequenceId, id), eq(sequenceEnrollment.companyId, user.companyId)))
    .orderBy(desc(sequenceEnrollment.enrolledAt))
  return c.json({ enrollments: rows })
})

// POST /sequences/enrollments/:enrollmentId/cancel
app.post('/enrollments/:enrollmentId/cancel', requirePermission('contacts:update'), async (c) => {
  const user = c.get('user') as any
  const enrollmentId = c.req.param('enrollmentId')
  const [existing] = await db.select().from(sequenceEnrollment).where(and(eq(sequenceEnrollment.id, enrollmentId), eq(sequenceEnrollment.companyId, user.companyId))).limit(1)
  if (!existing) return c.json({ error: 'Enrollment not found' }, 404)
  await db.update(sequenceEnrollment).set({ status: 'cancelled' }).where(eq(sequenceEnrollment.id, enrollmentId))
  return c.json({ success: true })
})

export default app
