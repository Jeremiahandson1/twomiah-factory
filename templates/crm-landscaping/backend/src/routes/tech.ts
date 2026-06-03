import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { job, contact, user, equipment, formSubmission } from '../../db/schema.ts'
import { eq, and, gte, lt, asc, desc, count } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { emitToCompany, EVENTS } from '../services/socket.ts'

const app = new Hono()
app.use('*', authenticate)

// ============================================
// MY JOBS — only jobs assigned to current user
// ============================================

app.get('/my-jobs', async (c) => {
  const currentUser = c.get('user') as any

  const jobs = await db.select().from(job)
    .where(and(
      eq(job.companyId, currentUser.companyId),
      eq(job.assignedToId, currentUser.userId),
    ))
    .orderBy(asc(job.scheduledDate), asc(job.scheduledTime))

  // Fetch related contacts and equipment
  const contactIds = [...new Set(jobs.filter(j => j.contactId).map(j => j.contactId!))]
  const equipmentIds = [...new Set(jobs.filter(j => j.equipmentId).map(j => j.equipmentId!))]

  const [contacts, equipmentList] = await Promise.all([
    contactIds.length
      ? db.select({ id: contact.id, name: contact.name, phone: contact.phone, email: contact.email, address: contact.address, city: contact.city, state: contact.state, zip: contact.zip })
          .from(contact).where(eq(contact.companyId, currentUser.companyId))
      : Promise.resolve([]),
    equipmentIds.length
      ? db.select({ id: equipment.id, name: equipment.name, manufacturer: equipment.manufacturer, model: equipment.model, serialNumber: equipment.serialNumber, location: equipment.location, warrantyExpiry: equipment.warrantyExpiry, purchaseDate: equipment.purchaseDate })
          .from(equipment).where(eq(equipment.companyId, currentUser.companyId))
      : Promise.resolve([]),
  ])

  const contactMap = Object.fromEntries(contacts.map(c => [c.id, c]))
  const equipmentMap = Object.fromEntries(equipmentList.map(e => [e.id, e]))

  const enriched = jobs.map(j => ({
    ...j,
    contact: j.contactId ? contactMap[j.contactId] || null : null,
    equipment: j.equipmentId ? equipmentMap[j.equipmentId] || null : null,
  }))

  return c.json(enriched)
})

// ============================================
// STATUS TRANSITIONS — tech field workflow
// ============================================

const statusSchema = z.object({
  notes: z.string().optional(),
})

// On My Way
app.post('/:id/on-my-way', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')
  const body = statusSchema.parse(await c.req.json().catch(() => ({})))

  const [existing] = await db.select().from(job)
    .where(and(eq(job.id, id), eq(job.companyId, currentUser.companyId)))
    .limit(1)
  if (!existing) return c.json({ error: 'Job not found' }, 404)

  const [updated] = await db.update(job).set({
    status: 'dispatched',
    internalNotes: [existing.internalNotes, `[${new Date().toISOString()}] Tech en route${body.notes ? ': ' + body.notes : ''}`].filter(Boolean).join('\n'),
    updatedAt: new Date(),
  }).where(eq(job.id, id)).returning()

  emitToCompany(currentUser.companyId, EVENTS.JOB_STATUS_CHANGED, { id: updated.id, status: 'dispatched' })

  // Send SMS if texting enabled — fire and forget
  try {
    const smsModule = await import('../services/sms.ts')
    await smsModule.sendJobUpdate(currentUser.companyId, id, 'on_way')
  } catch { /* SMS not configured or failed — non-blocking */ }

  return c.json(updated)
})

// On Site (arrived)
app.post('/:id/on-site', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const [existing] = await db.select().from(job)
    .where(and(eq(job.id, id), eq(job.companyId, currentUser.companyId)))
    .limit(1)
  if (!existing) return c.json({ error: 'Job not found' }, 404)

  const [updated] = await db.update(job).set({
    status: 'in_progress',
    internalNotes: [existing.internalNotes, `[${new Date().toISOString()}] Tech arrived on site`].filter(Boolean).join('\n'),
    updatedAt: new Date(),
  }).where(eq(job.id, id)).returning()

  emitToCompany(currentUser.companyId, EVENTS.JOB_STATUS_CHANGED, { id: updated.id, status: 'in_progress' })

  return c.json(updated)
})

// Complete Job
app.post('/:id/complete-job', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')
  const body = statusSchema.parse(await c.req.json().catch(() => ({})))

  const [existing] = await db.select().from(job)
    .where(and(eq(job.id, id), eq(job.companyId, currentUser.companyId)))
    .limit(1)
  if (!existing) return c.json({ error: 'Job not found' }, 404)

  const [updated] = await db.update(job).set({
    status: 'completed',
    completedAt: new Date(),
    internalNotes: [existing.internalNotes, `[${new Date().toISOString()}] Job completed by tech${body.notes ? ': ' + body.notes : ''}`].filter(Boolean).join('\n'),
    updatedAt: new Date(),
  }).where(eq(job.id, id)).returning()

  emitToCompany(currentUser.companyId, EVENTS.JOB_STATUS_CHANGED, { id: updated.id, status: 'completed' })

  // Send completion SMS — fire and forget
  try {
    const smsModule = await import('../services/sms.ts')
    await smsModule.sendJobUpdate(currentUser.companyId, id, 'completed')
  } catch { /* SMS not configured or failed — non-blocking */ }

  return c.json(updated)
})

// ============================================
// INSPECTION CHECKLIST — saves to formSubmission
// ============================================

const checklistSchema = z.object({
  items: z.array(z.object({
    id: z.string(),
    label: z.string(),
    status: z.enum(['pass', 'fail', 'attention']),
    notes: z.string().optional(),
  })),
  overallNotes: z.string().optional(),
})

app.post('/:id/checklist', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')
  const body = checklistSchema.parse(await c.req.json())

  const [existing] = await db.select().from(job)
    .where(and(eq(job.id, id), eq(job.companyId, currentUser.companyId)))
    .limit(1)
  if (!existing) return c.json({ error: 'Job not found' }, 404)

  // Save checklist as a form submission
  const [submission] = await db.insert(formSubmission).values({
    companyId: currentUser.companyId,
    jobId: id,
    submittedById: currentUser.userId,
    values: {
      type: 'hvac_inspection_checklist',
      items: body.items,
      overallNotes: body.overallNotes || '',
      completedAt: new Date().toISOString(),
    },
    status: 'submitted',
  }).returning()

  // Append to job notes
  const failCount = body.items.filter(i => i.status === 'fail').length
  const attentionCount = body.items.filter(i => i.status === 'attention').length
  const summary = `[${new Date().toISOString()}] Inspection: ${body.items.length - failCount - attentionCount} pass, ${attentionCount} attention, ${failCount} fail`

  await db.update(job).set({
    internalNotes: [existing.internalNotes, summary].filter(Boolean).join('\n'),
    updatedAt: new Date(),
  }).where(eq(job.id, id))

  return c.json(submission, 201)
})

// Get checklist for a job
app.get('/:id/checklist', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const submissions = await db.select().from(formSubmission)
    .where(and(
      eq(formSubmission.companyId, currentUser.companyId),
      eq(formSubmission.jobId, id),
    ))
    .orderBy(desc(formSubmission.createdAt))

  // Filter for inspection checklists
  const checklists = submissions.filter(s => (s.values as any)?.type === 'hvac_inspection_checklist')
  return c.json(checklists)
})

export default app
