import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { insuranceClaim, supplement, adjusterContact, claimActivity, job, measurementReport, company } from '../../db/schema.ts'
import { eq, and, desc, sql } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { generateXactimateScopeDocument } from '../services/xactimate.ts'
import logger from '../services/logger.ts'

const app = new Hono()
app.use('*', authenticate)

// ══════════════════════════════════════════════════════
// CLAIMS
// ══════════════════════════════════════════════════════

// Create claim for a job
app.post('/claims', async (c) => {
  const currentUser = c.get('user') as any
  const schema = z.object({
    jobId: z.string().min(1),
    claimNumber: z.string().min(1),
    insuranceCompany: z.string().min(1),
    policyNumber: z.string().optional(),
    adjusterName: z.string().optional(),
    adjusterPhone: z.string().optional(),
    adjusterEmail: z.string().optional(),
    adjusterCompany: z.string().optional(),
    dateOfLoss: z.string().optional(),
    causeOfLoss: z.enum(['hail', 'wind', 'fire', 'water', 'other']).optional(),
    deductible: z.string().optional(),
  })
  const data = schema.parse(await c.req.json())

  // Verify job exists, is insurance type, and belongs to this company
  const [j] = await db.select().from(job)
    .where(and(eq(job.id, data.jobId), eq(job.companyId, currentUser.companyId)))
    .limit(1)
  if (!j) return c.json({ error: 'Job not found' }, 404)
  if (j.jobType !== 'insurance') return c.json({ error: 'Job must be insurance type' }, 400)

  // Check for existing claim
  const [existing] = await db.select().from(insuranceClaim)
    .where(eq(insuranceClaim.jobId, data.jobId)).limit(1)
  if (existing) return c.json({ error: 'Claim already exists for this job' }, 409)

  const [claim] = await db.insert(insuranceClaim).values({
    companyId: currentUser.companyId,
    jobId: data.jobId,
    claimNumber: data.claimNumber,
    insuranceCompany: data.insuranceCompany,
    policyNumber: data.policyNumber || null,
    adjusterName: data.adjusterName || null,
    adjusterPhone: data.adjusterPhone || null,
    adjusterEmail: data.adjusterEmail || null,
    adjusterCompany: data.adjusterCompany || null,
    dateOfLoss: data.dateOfLoss ? new Date(data.dateOfLoss) : null,
    causeOfLoss: data.causeOfLoss || null,
    deductible: data.deductible || null,
    claimStatus: 'filed',
    claimFiledDate: new Date(),
  }).returning()

  // Log activity
  await db.insert(claimActivity).values({
    companyId: currentUser.companyId,
    jobId: data.jobId,
    claimId: claim.id,
    userId: currentUser.id,
    activityType: 'status_change',
    body: `Insurance claim filed with ${data.insuranceCompany} — Claim #${data.claimNumber}`,
  })

  return c.json(claim, 201)
})

// Get claim for a job
app.get('/claims/:jobId', async (c) => {
  const currentUser = c.get('user') as any
  const jobId = c.req.param('jobId')

  const [claim] = await db.select().from(insuranceClaim)
    .where(and(eq(insuranceClaim.jobId, jobId), eq(insuranceClaim.companyId, currentUser.companyId)))
    .limit(1)

  if (!claim) return c.json({ error: 'No claim found for this job' }, 404)
  return c.json(claim)
})

// Update claim
app.put('/claims/:id', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const schema = z.object({
    claimNumber: z.string().optional(),
    insuranceCompany: z.string().optional(),
    policyNumber: z.string().optional(),
    adjusterName: z.string().optional(),
    adjusterPhone: z.string().optional(),
    adjusterEmail: z.string().optional(),
    adjusterCompany: z.string().optional(),
    dateOfLoss: z.string().optional(),
    causeOfLoss: z.string().optional(),
    deductible: z.string().optional(),
    rcv: z.string().optional(),
    acv: z.string().optional(),
    depreciationHeld: z.string().optional(),
    finalApprovedAmount: z.string().optional(),
    denialReason: z.string().optional(),
    internalNotes: z.string().optional(),
    adjusterInspectionDate: z.string().optional(),
  })
  const data = schema.parse(await c.req.json())

  const [claim] = await db.select().from(insuranceClaim)
    .where(and(eq(insuranceClaim.id, id), eq(insuranceClaim.companyId, currentUser.companyId)))
    .limit(1)
  if (!claim) return c.json({ error: 'Claim not found' }, 404)

  const updates: any = { updatedAt: new Date() }
  for (const [key, val] of Object.entries(data)) {
    if (val === undefined) continue
    if (['dateOfLoss', 'adjusterInspectionDate'].includes(key) && val) {
      updates[key] = new Date(val)
    } else {
      updates[key] = val || null
    }
  }

  await db.update(insuranceClaim).set(updates).where(eq(insuranceClaim.id, id))

  const [updated] = await db.select().from(insuranceClaim).where(eq(insuranceClaim.id, id)).limit(1)
  return c.json(updated)
})

// Update claim status
app.post('/claims/:id/status', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const schema = z.object({
    status: z.enum(['filed', 'adjuster_assigned', 'inspection_scheduled', 'inspected', 'approved', 'supplemented', 'denied', 'closed']),
    note: z.string().optional(),
  })
  const { status, note } = schema.parse(await c.req.json())

  const [claim] = await db.select().from(insuranceClaim)
    .where(and(eq(insuranceClaim.id, id), eq(insuranceClaim.companyId, currentUser.companyId)))
    .limit(1)
  if (!claim) return c.json({ error: 'Claim not found' }, 404)

  const updates: any = { claimStatus: status, updatedAt: new Date() }
  if (status === 'approved') updates.approvalDate = new Date()

  await db.update(insuranceClaim).set(updates).where(eq(insuranceClaim.id, id))

  // Log activity
  const statusLabels: Record<string, string> = {
    filed: 'Claim filed',
    adjuster_assigned: 'Adjuster assigned',
    inspection_scheduled: 'Adjuster inspection scheduled',
    inspected: 'Property inspected by adjuster',
    approved: 'Claim approved',
    supplemented: 'Supplement submitted',
    denied: 'Claim denied',
    closed: 'Claim closed',
  }

  await db.insert(claimActivity).values({
    companyId: currentUser.companyId,
    jobId: claim.jobId,
    claimId: claim.id,
    userId: currentUser.id,
    activityType: 'status_change',
    body: `${statusLabels[status] || status}${note ? ` — ${note}` : ''}`,
  })

  const [updated] = await db.select().from(insuranceClaim).where(eq(insuranceClaim.id, id)).limit(1)
  return c.json(updated)
})

// ══════════════════════════════════════════════════════
// SUPPLEMENTS
// ══════════════════════════════════════════════════════

// List supplements for a claim
app.get('/claims/:claimId/supplements', async (c) => {
  const currentUser = c.get('user') as any
  const claimId = c.req.param('claimId')

  const supplements = await db.select().from(supplement)
    .where(and(eq(supplement.claimId, claimId), eq(supplement.companyId, currentUser.companyId)))
    .orderBy(supplement.createdAt)

  return c.json(supplements)
})

// Create supplement
app.post('/claims/:claimId/supplements', async (c) => {
  const currentUser = c.get('user') as any
  const claimId = c.req.param('claimId')

  const schema = z.object({
    reason: z.string().min(1),
    lineItems: z.array(z.object({
      code: z.string().optional(),
      description: z.string(),
      qty: z.number(),
      unit: z.string(),
      unitPrice: z.number(),
      total: z.number(),
    })),
    totalAmount: z.string(),
    notes: z.string().optional(),
  })
  const data = schema.parse(await c.req.json())

  const [claim] = await db.select().from(insuranceClaim)
    .where(and(eq(insuranceClaim.id, claimId), eq(insuranceClaim.companyId, currentUser.companyId)))
    .limit(1)
  if (!claim) return c.json({ error: 'Claim not found' }, 404)

  // Auto-number
  const existing = await db.select().from(supplement)
    .where(eq(supplement.claimId, claimId))
  const num = existing.length + 1
  const supplementNumber = `SUP-${String(num).padStart(3, '0')}`

  const [sup] = await db.insert(supplement).values({
    companyId: currentUser.companyId,
    jobId: claim.jobId,
    claimId,
    supplementNumber,
    reason: data.reason,
    lineItems: data.lineItems,
    totalAmount: data.totalAmount,
    notes: data.notes || null,
    status: 'draft',
  }).returning()

  return c.json(sup, 201)
})

// Update supplement
app.put('/supplements/:id', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const schema = z.object({
    reason: z.string().optional(),
    lineItems: z.array(z.any()).optional(),
    totalAmount: z.string().optional(),
    notes: z.string().optional(),
  })
  const data = schema.parse(await c.req.json())

  const [sup] = await db.select().from(supplement)
    .where(and(eq(supplement.id, id), eq(supplement.companyId, currentUser.companyId)))
    .limit(1)
  if (!sup) return c.json({ error: 'Supplement not found' }, 404)
  if (sup.status !== 'draft') return c.json({ error: 'Can only edit draft supplements' }, 400)

  await db.update(supplement).set({ ...data, updatedAt: new Date() }).where(eq(supplement.id, id))

  const [updated] = await db.select().from(supplement).where(eq(supplement.id, id)).limit(1)
  return c.json(updated)
})

// Submit supplement
app.post('/supplements/:id/submit', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const [sup] = await db.select().from(supplement)
    .where(and(eq(supplement.id, id), eq(supplement.companyId, currentUser.companyId)))
    .limit(1)
  if (!sup) return c.json({ error: 'Supplement not found' }, 404)

  await db.update(supplement).set({
    status: 'submitted',
    submittedAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(supplement.id, id))

  // Log activity
  await db.insert(claimActivity).values({
    companyId: currentUser.companyId,
    jobId: sup.jobId,
    claimId: sup.claimId,
    userId: currentUser.id,
    activityType: 'supplement',
    body: `Supplement ${sup.supplementNumber} submitted — $${Number(sup.totalAmount).toLocaleString()} — ${sup.reason}`,
  })

  const [updated] = await db.select().from(supplement).where(eq(supplement.id, id)).limit(1)
  return c.json(updated)
})

// Approve supplement
app.post('/supplements/:id/approve', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const schema = z.object({ approvedAmount: z.string() })
  const { approvedAmount } = schema.parse(await c.req.json())

  const [sup] = await db.select().from(supplement)
    .where(and(eq(supplement.id, id), eq(supplement.companyId, currentUser.companyId)))
    .limit(1)
  if (!sup) return c.json({ error: 'Supplement not found' }, 404)

  await db.update(supplement).set({
    status: 'approved',
    approvedAmount,
    respondedAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(supplement.id, id))

  // Update claim supplement total
  const allSups = await db.select().from(supplement)
    .where(and(eq(supplement.claimId, sup.claimId), eq(supplement.status, 'approved')))
  // Include this one since we just updated it
  const supTotal = allSups.reduce((sum, s) => sum + Number(s.approvedAmount || 0), 0) +
    (sup.status !== 'approved' ? Number(approvedAmount) : 0)

  await db.update(insuranceClaim).set({
    supplementAmount: String(supTotal),
    updatedAt: new Date(),
  }).where(eq(insuranceClaim.id, sup.claimId))

  await db.insert(claimActivity).values({
    companyId: currentUser.companyId,
    jobId: sup.jobId,
    claimId: sup.claimId,
    userId: currentUser.id,
    activityType: 'approval',
    body: `Supplement ${sup.supplementNumber} approved — $${Number(approvedAmount).toLocaleString()}`,
  })

  const [updated] = await db.select().from(supplement).where(eq(supplement.id, id)).limit(1)
  return c.json(updated)
})

// Deny supplement
app.post('/supplements/:id/deny', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const schema = z.object({ denialReason: z.string().min(1) })
  const { denialReason } = schema.parse(await c.req.json())

  const [sup] = await db.select().from(supplement)
    .where(and(eq(supplement.id, id), eq(supplement.companyId, currentUser.companyId)))
    .limit(1)
  if (!sup) return c.json({ error: 'Supplement not found' }, 404)

  await db.update(supplement).set({
    status: 'denied',
    denialReason,
    respondedAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(supplement.id, id))

  await db.insert(claimActivity).values({
    companyId: currentUser.companyId,
    jobId: sup.jobId,
    claimId: sup.claimId,
    userId: currentUser.id,
    activityType: 'denial',
    body: `Supplement ${sup.supplementNumber} denied — ${denialReason}`,
  })

  const [updated] = await db.select().from(supplement).where(eq(supplement.id, id)).limit(1)
  return c.json(updated)
})

// ══════════════════════════════════════════════════════
// ADJUSTER CONTACTS
// ══════════════════════════════════════════════════════

app.get('/adjusters', async (c) => {
  const currentUser = c.get('user') as any
  const adjusters = await db.select().from(adjusterContact)
    .where(eq(adjusterContact.companyId, currentUser.companyId))
    .orderBy(desc(adjusterContact.jobsWorkedTogether))
  return c.json(adjusters)
})

app.post('/adjusters', async (c) => {
  const currentUser = c.get('user') as any
  const schema = z.object({
    name: z.string().min(1),
    phone: z.string().optional(),
    email: z.string().optional(),
    adjusterCompany: z.string().optional(),
    insuranceCarrier: z.string().min(1),
    territory: z.string().optional(),
    notes: z.string().optional(),
  })
  const data = schema.parse(await c.req.json())

  const [adj] = await db.insert(adjusterContact).values({
    companyId: currentUser.companyId,
    name: data.name,
    phone: data.phone || null,
    email: data.email || null,
    adjusterCompany: data.adjusterCompany || null,
    insuranceCarrier: data.insuranceCarrier,
    territory: data.territory || null,
    notes: data.notes || null,
  }).returning()

  return c.json(adj, 201)
})

app.put('/adjusters/:id', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const data = await c.req.json()
  const [adj] = await db.select().from(adjusterContact)
    .where(and(eq(adjusterContact.id, id), eq(adjusterContact.companyId, currentUser.companyId)))
    .limit(1)
  if (!adj) return c.json({ error: 'Adjuster not found' }, 404)

  await db.update(adjusterContact).set({ ...data, updatedAt: new Date() }).where(eq(adjusterContact.id, id))

  const [updated] = await db.select().from(adjusterContact).where(eq(adjusterContact.id, id)).limit(1)
  return c.json(updated)
})

// ══════════════════════════════════════════════════════
// ACTIVITY LOG
// ══════════════════════════════════════════════════════

app.get('/claims/:claimId/activity', async (c) => {
  const currentUser = c.get('user') as any
  const claimId = c.req.param('claimId')

  const activities = await db.select().from(claimActivity)
    .where(and(eq(claimActivity.claimId, claimId), eq(claimActivity.companyId, currentUser.companyId)))
    .orderBy(desc(claimActivity.createdAt))

  return c.json(activities)
})

app.post('/claims/:claimId/activity', async (c) => {
  const currentUser = c.get('user') as any
  const claimId = c.req.param('claimId')

  const schema = z.object({
    activityType: z.enum(['note', 'call', 'email', 'inspection', 'document_uploaded']),
    body: z.string().min(1),
    metadata: z.record(z.any()).optional(),
  })
  const data = schema.parse(await c.req.json())

  const [claim] = await db.select().from(insuranceClaim)
    .where(and(eq(insuranceClaim.id, claimId), eq(insuranceClaim.companyId, currentUser.companyId)))
    .limit(1)
  if (!claim) return c.json({ error: 'Claim not found' }, 404)

  const [activity] = await db.insert(claimActivity).values({
    companyId: currentUser.companyId,
    jobId: claim.jobId,
    claimId,
    userId: currentUser.id,
    activityType: data.activityType,
    body: data.body,
    metadata: data.metadata || null,
  }).returning()

  return c.json(activity, 201)
})

// ══════════════════════════════════════════════════════
// XACTIMATE EXPORT
// ══════════════════════════════════════════════════════

app.post('/claims/:claimId/xactimate-export', async (c) => {
  const currentUser = c.get('user') as any
  const claimId = c.req.param('claimId')

  const [claim] = await db.select().from(insuranceClaim)
    .where(and(eq(insuranceClaim.id, claimId), eq(insuranceClaim.companyId, currentUser.companyId)))
    .limit(1)
  if (!claim) return c.json({ error: 'Claim not found' }, 404)

  const [j] = await db.select().from(job).where(eq(job.id, claim.jobId)).limit(1)
  if (!j) return c.json({ error: 'Job not found' }, 404)

  const [comp] = await db.select().from(company).where(eq(company.id, currentUser.companyId)).limit(1)

  // Get measurement report if linked
  let measurement = null
  if (j.measurementReportId) {
    const [m] = await db.select().from(measurementReport)
      .where(eq(measurementReport.id, j.measurementReportId)).limit(1)
    measurement = m
  }

  // Get supplements
  const supplements = await db.select().from(supplement)
    .where(and(eq(supplement.claimId, claimId), eq(supplement.companyId, currentUser.companyId)))

  try {
    const result = await generateXactimateScopeDocument(claim, j, comp, measurement, supplements)

    // Update claim with URLs
    await db.update(insuranceClaim).set({
      xactimateScopeUrl: result.pdfUrl,
      xactimateExportUrl: result.csvUrl,
      updatedAt: new Date(),
    }).where(eq(insuranceClaim.id, claimId))

    // Log activity
    await db.insert(claimActivity).values({
      companyId: currentUser.companyId,
      jobId: claim.jobId,
      claimId,
      userId: currentUser.id,
      activityType: 'xactimate_export',
      body: 'Xactimate scope document generated',
    })

    return c.json(result)
  } catch (err: any) {
    logger.error('Xactimate export failed', { claimId, error: err.message })
    return c.json({ error: 'Failed to generate Xactimate export' }, 500)
  }
})

app.get('/claims/:claimId/xactimate-export', async (c) => {
  const currentUser = c.get('user') as any
  const claimId = c.req.param('claimId')

  const [claim] = await db.select().from(insuranceClaim)
    .where(and(eq(insuranceClaim.id, claimId), eq(insuranceClaim.companyId, currentUser.companyId)))
    .limit(1)
  if (!claim) return c.json({ error: 'Claim not found' }, 404)

  return c.json({
    pdfUrl: claim.xactimateScopeUrl,
    csvUrl: claim.xactimateExportUrl,
  })
})

export default app
