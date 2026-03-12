import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { job, contact, crew, measurementReport, jobPhoto, jobNote, quote, invoice, smsMessage, company } from '../../db/schema.ts'
import { eq, and, desc, asc, like, or, count, sql } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { uploadFile, deleteFile } from '../services/storage.ts'
import { createId } from '@paralleldrive/cuid2'

const app = new Hono()
app.use('*', authenticate)

const PIPELINE_ORDER = [
  'lead',
  'inspection_scheduled',
  'inspected',
  'measurement_ordered',
  'proposal_sent',
  'signed',
  'material_ordered',
  'in_production',
  'final_inspection',
  'invoiced',
  'collected',
]

const AUTO_SMS_TEMPLATES: Record<string, string> = {
  inspection_scheduled: 'Hi [FirstName], your roof inspection is scheduled for [date]. – [CompanyName]',
  inspected: 'Hi [FirstName], your roof inspection is complete! We\'ll be preparing your estimate shortly. – [CompanyName]',
  measurement_ordered: 'Hi [FirstName], we\'ve ordered measurements for your roof. We\'ll have your proposal ready soon. – [CompanyName]',
  proposal_sent: 'Hi [FirstName], your roof proposal is ready for review. Check your email or view it at [portalLink]. – [CompanyName]',
  signed: 'Hi [FirstName], your contract is signed! We\'ll be in touch to schedule installation. – [CompanyName]',
  material_ordered: 'Hi [FirstName], materials for your roof have been ordered and are on the way. – [CompanyName]',
  in_production: 'Hi [FirstName], your roof installation has started today! Our crew is on-site. – [CompanyName]',
  final_inspection: 'Hi [FirstName], your new roof is complete! We\'ll be doing a final inspection. – [CompanyName]',
  invoiced: 'Hi [FirstName], your invoice is ready. Pay online at [portalLink]. – [CompanyName]',
  collected: 'Hi [FirstName], payment received — thank you! Your warranty info is at [portalLink]. – [CompanyName]',
  // Insurance-specific triggers
  insurance_claim_filed: 'Hi [FirstName], your insurance claim has been filed. We\'ll keep you updated on the process. – [CompanyName]',
  insurance_approved: 'Great news, [FirstName]! Your insurance claim has been approved. We\'ll schedule your roof replacement soon. – [CompanyName]',
  supplement_submitted: 'Hi [FirstName], we\'ve submitted a supplement to your insurance for additional work needed. We\'ll follow up. – [CompanyName]',
}

const jobSchema = z.object({
  contactId: z.string().min(1),
  jobType: z.string().min(1),
  propertyAddress: z.string().min(1),
  city: z.string().min(1),
  state: z.string().min(1),
  zip: z.string().min(1),
  assignedSalesRepId: z.string().optional().transform(v => v === '' ? undefined : v),
  assignedCrewId: z.string().optional().transform(v => v === '' ? undefined : v),
  status: z.string().optional(),
  roofAge: z.number().optional(),
  roofType: z.string().optional(),
  stories: z.number().optional(),
  claimNumber: z.string().optional(),
  insuranceCompany: z.string().optional(),
  adjusterName: z.string().optional(),
  adjusterPhone: z.string().optional(),
  dateOfLoss: z.string().optional(),
  deductible: z.number().optional(),
  rcv: z.number().optional(),
  acv: z.number().optional(),
  approvedScope: z.string().optional(),
  estimatedRevenue: z.number().optional(),
  inspectionDate: z.string().optional(),
  inspectionNotes: z.string().optional(),
  installDate: z.string().optional(),
  installEndDate: z.string().optional(),
  totalSquares: z.number().optional(),
  source: z.string().optional(),
  priority: z.string().optional(),
  notes: z.string().optional(),
})

// List jobs with filters
app.get('/', async (c) => {
  const currentUser = c.get('user') as any
  const status = c.req.query('status')
  const jobType = c.req.query('jobType')
  const assignedSalesRepId = c.req.query('assignedSalesRepId')
  const assignedCrewId = c.req.query('assignedCrewId')
  const search = c.req.query('search')
  const page = +(c.req.query('page') || '1')
  const limit = +(c.req.query('limit') || '50')

  const conditions: any[] = [eq(job.companyId, currentUser.companyId)]
  if (status) conditions.push(eq(job.status, status))
  if (jobType) conditions.push(eq(job.jobType, jobType))
  if (assignedSalesRepId) conditions.push(eq(job.assignedSalesRepId, assignedSalesRepId))
  if (assignedCrewId) conditions.push(eq(job.assignedCrewId, assignedCrewId))

  if (search) {
    const searchPattern = `%${search}%`
    conditions.push(
      or(
        like(job.jobNumber, searchPattern),
        like(job.propertyAddress, searchPattern),
        like(job.notes, searchPattern),
      )!
    )
  }

  const where = and(...conditions)
  const [data, [{ value: total }]] = await Promise.all([
    db.select().from(job).where(where).orderBy(desc(job.createdAt)).offset((page - 1) * limit).limit(limit),
    db.select({ value: count() }).from(job).where(where),
  ])

  // Fetch contact names
  const contactIds = [...new Set(data.filter(j => j.contactId).map(j => j.contactId))]
  const contacts = contactIds.length
    ? await db.select({ id: contact.id, firstName: contact.firstName, lastName: contact.lastName }).from(contact).where(eq(contact.companyId, currentUser.companyId))
    : []
  const contactMap = Object.fromEntries(contacts.map(ct => [ct.id, ct]))

  const dataWithRelations = data.map(j => ({
    ...j,
    contact: j.contactId ? contactMap[j.contactId] || null : null,
  }))

  return c.json({ data: dataWithRelations, pagination: { page, limit, total: Number(total), pages: Math.ceil(Number(total) / limit) } })
})

// Create job with auto-generated jobNumber
app.post('/', async (c) => {
  const currentUser = c.get('user') as any
  const data = jobSchema.parse(await c.req.json())

  // Auto-generate jobNumber: ROOF-0001
  const [maxResult] = await db
    .select({ maxNum: sql<string>`MAX(${job.jobNumber})` })
    .from(job)
    .where(eq(job.companyId, currentUser.companyId))

  let nextNum = 1
  if (maxResult?.maxNum) {
    const match = maxResult.maxNum.match(/ROOF-(\d+)/)
    if (match) nextNum = parseInt(match[1], 10) + 1
  }
  const jobNumber = `ROOF-${String(nextNum).padStart(4, '0')}`

  const [newJob] = await db.insert(job).values({
    ...data,
    jobNumber,
    source: data.source || 'manual',
    dateOfLoss: data.dateOfLoss ? new Date(data.dateOfLoss) : undefined,
    deductible: data.deductible?.toString(),
    rcv: data.rcv?.toString(),
    acv: data.acv?.toString(),
    estimatedRevenue: data.estimatedRevenue?.toString(),
    totalSquares: data.totalSquares?.toString(),
    inspectionDate: data.inspectionDate ? new Date(data.inspectionDate) : undefined,
    installDate: data.installDate ? new Date(data.installDate) : undefined,
    installEndDate: data.installEndDate ? new Date(data.installEndDate) : undefined,
    companyId: currentUser.companyId,
  }).returning()

  // Fetch contact for response
  const [jobContact] = data.contactId
    ? await db.select({ id: contact.id, firstName: contact.firstName, lastName: contact.lastName }).from(contact).where(eq(contact.id, data.contactId)).limit(1)
    : [null]

  return c.json({ ...newJob, contact: jobContact || null }, 201)
})

// Get job detail
app.get('/:id', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const [foundJob] = await db.select().from(job).where(and(eq(job.id, id), eq(job.companyId, currentUser.companyId))).limit(1)
  if (!foundJob) return c.json({ error: 'Job not found' }, 404)

  const [jobContact, jobCrew, measurement, photos, notes, jobQuotes, jobInvoices] = await Promise.all([
    foundJob.contactId ? db.select().from(contact).where(eq(contact.id, foundJob.contactId)).limit(1) : Promise.resolve([]),
    foundJob.assignedCrewId ? db.select().from(crew).where(eq(crew.id, foundJob.assignedCrewId)).limit(1) : Promise.resolve([]),
    foundJob.measurementReportId ? db.select().from(measurementReport).where(eq(measurementReport.id, foundJob.measurementReportId)).limit(1) : Promise.resolve([]),
    db.select().from(jobPhoto).where(and(eq(jobPhoto.jobId, id), eq(jobPhoto.companyId, currentUser.companyId))).orderBy(desc(jobPhoto.createdAt)),
    db.select().from(jobNote).where(and(eq(jobNote.jobId, id), eq(jobNote.companyId, currentUser.companyId))).orderBy(desc(jobNote.createdAt)),
    db.select().from(quote).where(and(eq(quote.jobId, id), eq(quote.companyId, currentUser.companyId))).orderBy(desc(quote.createdAt)),
    db.select().from(invoice).where(and(eq(invoice.jobId, id), eq(invoice.companyId, currentUser.companyId))).orderBy(desc(invoice.createdAt)),
  ])

  return c.json({
    ...foundJob,
    contact: jobContact[0] || null,
    crew: jobCrew[0] || null,
    measurementReport: measurement[0] || null,
    photos,
    notes,
    quotes: jobQuotes,
    invoices: jobInvoices,
  })
})

// Update job
app.put('/:id', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')
  const data = jobSchema.partial().parse(await c.req.json())

  const [existing] = await db.select().from(job).where(and(eq(job.id, id), eq(job.companyId, currentUser.companyId))).limit(1)
  if (!existing) return c.json({ error: 'Job not found' }, 404)

  const updateData: Record<string, any> = { ...data, updatedAt: new Date() }
  if (data.dateOfLoss) updateData.dateOfLoss = new Date(data.dateOfLoss)
  if (data.deductible !== undefined) updateData.deductible = data.deductible.toString()
  if (data.rcv !== undefined) updateData.rcv = data.rcv.toString()
  if (data.acv !== undefined) updateData.acv = data.acv.toString()
  if (data.estimatedRevenue !== undefined) updateData.estimatedRevenue = data.estimatedRevenue.toString()
  if (data.totalSquares !== undefined) updateData.totalSquares = data.totalSquares.toString()
  if (data.inspectionDate) updateData.inspectionDate = new Date(data.inspectionDate)
  if (data.installDate) updateData.installDate = new Date(data.installDate)
  if (data.installEndDate) updateData.installEndDate = new Date(data.installEndDate)

  const [updated] = await db.update(job).set(updateData).where(eq(job.id, id)).returning()
  return c.json(updated)
})

// Advance to next pipeline stage
app.post('/:id/advance', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const [existing] = await db.select().from(job).where(and(eq(job.id, id), eq(job.companyId, currentUser.companyId))).limit(1)
  if (!existing) return c.json({ error: 'Job not found' }, 404)

  const currentIndex = PIPELINE_ORDER.indexOf(existing.status)
  if (currentIndex === -1 || currentIndex >= PIPELINE_ORDER.length - 1) {
    return c.json({ error: 'Cannot advance from current status' }, 400)
  }

  const nextStatus = PIPELINE_ORDER[currentIndex + 1]
  const [updated] = await db.update(job).set({ status: nextStatus, updatedAt: new Date() }).where(eq(job.id, id)).returning()

  // Add a note for the status change
  await db.insert(jobNote).values({
    companyId: currentUser.companyId,
    jobId: id,
    userId: currentUser.userId,
    body: `Status changed: ${existing.status} → ${nextStatus}`,
    isInternal: true,
  })

  // Auto-SMS on certain transitions
  if (AUTO_SMS_TEMPLATES[nextStatus]) {
    try {
      await sendAutoSms(currentUser.companyId, existing, nextStatus)
    } catch {}
  }

  return c.json(updated)
})

// Helper: send auto-SMS on pipeline advance
async function sendAutoSms(companyId: string, jobRow: any, status: string) {
  const template = AUTO_SMS_TEMPLATES[status]
  if (!template) return

  // Check company has two_way_texting enabled
  const [companyRow] = await db.select().from(company).where(eq(company.id, companyId)).limit(1)
  if (!companyRow) return
  const features = companyRow.enabledFeatures as string[]
  if (!features.includes('two_way_texting') && !features.includes('all')) return

  // Get contact
  if (!jobRow.contactId) return
  const [contactRow] = await db.select().from(contact).where(eq(contact.id, jobRow.contactId)).limit(1)
  if (!contactRow?.mobilePhone) return
  if (contactRow.optedOutSms) return

  // Build message
  const portalLink = `${process.env.CUSTOMER_PORTAL_URL || ''}/portal`
  const inspectionDate = jobRow.inspectionDate ? new Date(jobRow.inspectionDate).toLocaleDateString() : 'TBD'
  const message = template
    .replace('[FirstName]', contactRow.firstName)
    .replace('[CompanyName]', companyRow.name)
    .replace('[date]', inspectionDate)
    .replace('[portalLink]', portalLink)

  // Import sendSms dynamically to avoid circular dependency
  const { sendSms } = await import('../services/sms.ts')
  await sendSms(companyId, contactRow.id, message, jobRow.id)
}

// Upload photos
app.post('/:id/photos', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const [existing] = await db.select().from(job).where(and(eq(job.id, id), eq(job.companyId, currentUser.companyId))).limit(1)
  if (!existing) return c.json({ error: 'Job not found' }, 404)

  const formData = await c.req.formData()
  const file = formData.get('photo') as File
  if (!file) return c.json({ error: 'No photo provided' }, 400)
  if (file.size > 10 * 1024 * 1024) return c.json({ error: 'Photo exceeds 10MB limit' }, 400)
  if (!file.type.startsWith('image/')) return c.json({ error: 'File must be an image' }, 400)

  const ext = file.type === 'image/png' ? 'png' : 'jpg'
  const key = `photos/${currentUser.companyId}/${id}/${createId()}.${ext}`
  const buffer = Buffer.from(await file.arrayBuffer())
  const url = await uploadFile(key, buffer, file.type)

  const photoType = (formData.get('photoType') as string) || 'general'
  const caption = (formData.get('caption') as string) || null

  const [photo] = await db.insert(jobPhoto).values({
    companyId: currentUser.companyId,
    jobId: id,
    uploadedBy: currentUser.userId,
    photoType,
    url,
    caption,
    takenAt: new Date(),
  }).returning()

  return c.json(photo, 201)
})

// List photos for job
app.get('/:id/photos', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const [existing] = await db.select().from(job).where(and(eq(job.id, id), eq(job.companyId, currentUser.companyId))).limit(1)
  if (!existing) return c.json({ error: 'Job not found' }, 404)

  const photos = await db.select().from(jobPhoto)
    .where(and(eq(jobPhoto.jobId, id), eq(jobPhoto.companyId, currentUser.companyId)))
    .orderBy(desc(jobPhoto.createdAt))

  return c.json(photos)
})

// Delete photo
app.delete('/:id/photos/:photoId', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')
  const photoId = c.req.param('photoId')

  const [existing] = await db.select().from(jobPhoto)
    .where(and(eq(jobPhoto.id, photoId), eq(jobPhoto.jobId, id), eq(jobPhoto.companyId, currentUser.companyId)))
    .limit(1)
  if (!existing) return c.json({ error: 'Photo not found' }, 404)

  // Extract key from URL
  const publicUrl = process.env.R2_PUBLIC_URL || ''
  const key = existing.url.replace(`${publicUrl}/`, '')
  try { await deleteFile(key) } catch {}

  await db.delete(jobPhoto).where(eq(jobPhoto.id, photoId))
  return c.body(null, 204)
})

// Add note to job
app.post('/:id/notes', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const [existing] = await db.select().from(job).where(and(eq(job.id, id), eq(job.companyId, currentUser.companyId))).limit(1)
  if (!existing) return c.json({ error: 'Job not found' }, 404)

  const noteSchema = z.object({ body: z.string().min(1), isInternal: z.boolean().default(true) })
  const data = noteSchema.parse(await c.req.json())

  const [note] = await db.insert(jobNote).values({
    companyId: currentUser.companyId,
    jobId: id,
    userId: currentUser.userId,
    body: data.body,
    isInternal: data.isInternal,
  }).returning()

  return c.json(note, 201)
})

// Timeline for job
app.get('/:id/timeline', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const [existing] = await db.select().from(job).where(and(eq(job.id, id), eq(job.companyId, currentUser.companyId))).limit(1)
  if (!existing) return c.json({ error: 'Job not found' }, 404)

  const [notes, photos, messages] = await Promise.all([
    db.select().from(jobNote).where(and(eq(jobNote.jobId, id), eq(jobNote.companyId, currentUser.companyId))),
    db.select().from(jobPhoto).where(and(eq(jobPhoto.jobId, id), eq(jobPhoto.companyId, currentUser.companyId))),
    db.select().from(smsMessage).where(and(eq(smsMessage.jobId, id), eq(smsMessage.companyId, currentUser.companyId))),
  ])

  const timeline: any[] = []

  for (const n of notes) {
    const isStatusChange = n.body.startsWith('Status changed:')
    timeline.push({
      type: isStatusChange ? 'status_change' : 'note',
      id: n.id,
      body: n.body,
      userId: n.userId,
      createdAt: n.createdAt,
    })
  }

  for (const p of photos) {
    timeline.push({
      type: 'photo',
      id: p.id,
      url: p.url,
      caption: p.caption,
      photoType: p.photoType,
      createdAt: p.createdAt,
    })
  }

  for (const m of messages) {
    timeline.push({
      type: 'sms',
      id: m.id,
      body: m.body,
      direction: m.direction,
      createdAt: m.createdAt,
    })
  }

  // Sort by createdAt desc
  timeline.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

  return c.json(timeline)
})

export default app
