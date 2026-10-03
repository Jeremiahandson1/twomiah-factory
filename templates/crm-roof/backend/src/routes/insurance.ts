import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { insuranceClaim, supplement, adjusterContact, claimActivity, job, measurementReport, company } from '../../db/schema.ts'
import { eq, and, ne, desc, sql } from 'drizzle-orm'
import { authenticate, requireManager } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'
import { phone as phoneField, email as emailField, optional } from '../lib/validation.ts'
import { generateXactimateScopeDocument } from '../services/xactimate.ts'
import logger from '../services/logger.ts'

const app = new Hono()
app.use('*', authenticate)

// ══════════════════════════════════════════════════════
// CLAIMS
// ══════════════════════════════════════════════════════

// Create claim for a job
app.post('/claims', requirePermission('insurance:create'), async (c) => {
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
    userId: currentUser.userId,
    activityType: 'status_change',
    body: `Insurance claim filed with ${data.insuranceCompany} — Claim #${data.claimNumber}`,
  })

  // Mirror the claim number onto the job so both screens agree from the start.
  await db.update(job).set({ claimNumber: data.claimNumber, updatedAt: new Date() })
    .where(and(eq(job.id, data.jobId), eq(job.companyId, currentUser.companyId)))

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
app.put('/claims/:id', requirePermission('insurance:update'), async (c) => {
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

  // Keep the job's own claimNumber in sync with the claim record — otherwise the
  // job page and the claim page show two different claim numbers for one job.
  if (data.claimNumber !== undefined && claim.jobId) {
    await db.update(job).set({ claimNumber: data.claimNumber || null, updatedAt: new Date() })
      .where(and(eq(job.id, claim.jobId), eq(job.companyId, currentUser.companyId)))
  }

  const [updated] = await db.select().from(insuranceClaim).where(eq(insuranceClaim.id, id)).limit(1)
  return c.json(updated)
})

// Update claim status
app.post('/claims/:id/status', requirePermission('insurance:create'), async (c) => {
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
    userId: currentUser.userId,
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
app.post('/claims/:claimId/supplements', requirePermission('insurance:create'), async (c) => {
  const currentUser = c.get('user') as any
  const claimId = c.req.param('claimId')

  // `total` and `totalAmount` are what the CLIENT thinks the arithmetic is. They are accepted so the
  // existing callers keep working, and then ignored: the money is computed here from qty × unitPrice,
  // the way quotes.ts already does it. Before this, SUP-001 stored a header total of $77,777.00 above
  // a single $200.00 line item, and an approved supplement for -$600 was accepted. (roof T17 H2)
  const money = z.number().finite().nonnegative()
  const schema = z.object({
    reason: z.string().min(1),
    lineItems: z.array(z.object({
      code: z.string().optional(),
      description: z.string(),
      qty: money,
      unit: z.string(),
      unitPrice: money,
      total: z.number().optional(),
    })).min(1),
    totalAmount: z.string().optional(),
    notes: z.string().optional(),
  })
  const data = schema.parse(await c.req.json())

  const lineItems = data.lineItems.map((li) => ({ ...li, total: Number((li.qty * li.unitPrice).toFixed(2)) }))
  const totalAmount = lineItems.reduce((s, li) => s + li.total, 0).toFixed(2)

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
    lineItems,
    totalAmount,
    notes: data.notes || null,
    status: 'draft',
  }).returning()

  return c.json(sup, 201)
})

// Update supplement
app.put('/supplements/:id', requirePermission('insurance:update'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  // Same rule as create: line items are the money, and `totalAmount` from the client is ignored.
  // `z.any()` here also meant an edit could replace the line items with anything at all.
  const editMoney = z.number().finite().nonnegative()
  const schema = z.object({
    reason: z.string().optional(),
    lineItems: z.array(z.object({
      code: z.string().optional(),
      description: z.string(),
      qty: editMoney,
      unit: z.string(),
      unitPrice: editMoney,
      total: z.number().optional(),
    })).min(1).optional(),
    totalAmount: z.string().optional(),
    notes: z.string().optional(),
  })
  const data = schema.parse(await c.req.json())

  const [sup] = await db.select().from(supplement)
    .where(and(eq(supplement.id, id), eq(supplement.companyId, currentUser.companyId)))
    .limit(1)
  if (!sup) return c.json({ error: 'Supplement not found' }, 404)
  if (sup.status !== 'draft') return c.json({ error: 'Can only edit draft supplements' }, 400)

  const { totalAmount: _ignored, lineItems: incoming, ...rest } = data
  const update: Record<string, unknown> = { ...rest, updatedAt: new Date() }
  if (incoming) {
    const lineItems = incoming.map((li) => ({ ...li, total: Number((li.qty * li.unitPrice).toFixed(2)) }))
    update.lineItems = lineItems
    update.totalAmount = lineItems.reduce((s, li) => s + li.total, 0).toFixed(2)
  }

  await db.update(supplement).set(update).where(eq(supplement.id, id))

  const [updated] = await db.select().from(supplement).where(eq(supplement.id, id)).limit(1)
  return c.json(updated)
})

// Submit supplement
/**
 * WHICH DECISION IS POSSIBLE FROM WHICH STATE. (T41)
 *
 *   "The API approves a supplement that was never submitted, and approves above the requested
 *    amount."
 *   "No on-screen way to change an approved supplement: once approved it shows only 'Approved: $X',
 *    so re-approve and deny work only through the API."
 *
 * Those two findings pull in opposite directions and the lists below are how both are satisfied.
 * Nothing checked the status at all, so a DRAFT — a supplement the office is still writing, never
 * sent to anybody — could be recorded as approved by the carrier. That is not a decision; there was
 * nothing to decide on. But an approved supplement must stay changeable, because carriers do change
 * their minds: they come back with a different number, or deny what they had allowed, and the claim
 * has to be able to say so.
 *
 * So:
 *   submit   draft or denied → sent to the carrier (a denial can be reworked and re-sent)
 *   approve  submitted, approved or denied → the carrier's decision, including a revised one
 *   deny     submitted, approved or denied → likewise
 *
 * A draft is in none of the decision lists, and that is the whole first finding.
 */
const SUBMITTABLE = ['draft', 'denied']
const DECIDABLE = ['submitted', 'approved', 'denied']
/** One wording for all three refusals, naming the state and what it allows. */
const wrongState = (c: any, sup: { supplementNumber: string; status: string }, verb: string, allowed: string[]) =>
  c.json({
    error: sup.status === 'draft' && verb !== 'submitted'
      ? `${sup.supplementNumber} is still a draft — it has not been sent to the carrier, so there is no decision to record. Submit it first.`
      : `${sup.supplementNumber} is ${sup.status}, and only a supplement that is ${allowed.join(' or ')} can be ${verb}.`,
    code: 'supplement_wrong_status',
    status: sup.status,
    allowedFrom: allowed,
  }, 400)

app.post('/supplements/:id/submit', requirePermission('insurance:create'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const [sup] = await db.select().from(supplement)
    .where(and(eq(supplement.id, id), eq(supplement.companyId, currentUser.companyId)))
    .limit(1)
  if (!sup) return c.json({ error: 'Supplement not found' }, 404)
  if (!SUBMITTABLE.includes(sup.status)) return wrongState(c, sup, 'submitted', SUBMITTABLE)

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
    userId: currentUser.userId,
    activityType: 'supplement',
    body: `Supplement ${sup.supplementNumber} submitted — $${Number(sup.totalAmount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} — ${sup.reason}`,
  })

  const [updated] = await db.select().from(supplement).where(eq(supplement.id, id)).limit(1)
  return c.json(updated)
})

// Approve supplement
// Recording the carrier's decision moves money on the claim, so it is not something every signed-in
// user may do. requireManager is the same gate account.ts and billing.ts already use. (There was no
// role check anywhere in this module: a staff login could approve supplements.)
app.post('/supplements/:id/approve', requireManager, async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  // An approved amount is money: finite, not negative, and not a string that silently becomes NaN.
  // A supplement was accepted at -$600 before this.
  const schema = z.object({ approvedAmount: z.string() })
  const { approvedAmount } = schema.parse(await c.req.json())
  const approved = Number(approvedAmount)
  if (!Number.isFinite(approved) || approved < 0) return c.json({ error: 'approvedAmount must be a number of 0 or more' }, 400)

  const [sup] = await db.select().from(supplement)
    .where(and(eq(supplement.id, id), eq(supplement.companyId, currentUser.companyId)))
    .limit(1)
  if (!sup) return c.json({ error: 'Supplement not found' }, 404)
  if (!DECIDABLE.includes(sup.status)) return wrongState(c, sup, 'approved', DECIDABLE)

  /**
   * APPROVING MORE THAN WAS ASKED IS ALLOWED, AND IS NO LONGER SILENT. (T41)
   *
   *   "The API approves a supplement that was never submitted, and approves above the requested
   *    amount."
   *
   * The first half of that is the state rule above, and it is a clear fault — a supplement nobody
   * sent has no decision to record. The second half I first implemented as a refusal and then
   * REVERTED, and the reason is worth writing down.
   *
   * A carrier genuinely can allow more than was asked: an adjuster adds scope at the inspection and
   * the letter comes back higher. The report's own evidence shows exactly that on the live tenant —
   * SUP-001 asked $200 and was approved at $1,100 — so this is not a hypothetical, it is how shops
   * use it. Refusing it would force the office to rewrite the supplement's line items to match a
   * letter they already hold, and a refused real need stops the work, which this campaign has
   * repeatedly found to be the worse failure.
   *
   * The actual harm the report describes is a DOCUMENT one: "the scope reads RCV $780 against an
   * approved $1,100". That is fixed where it happens — services/xactimate.ts builds the approved
   * basis with one reconciling ADJ line, which exists precisely to carry an approval the line items
   * do not add up to, and checks against the carrier's letter.
   *
   * What was wrong here was the SILENCE. The claim total moved and nothing said the carrier had
   * allowed more than was asked, so an over-approval and a mistyped one looked identical in the
   * record. The activity line below now says which.
   */
  const requested = Number(sup.totalAmount || 0)
  const overAsk = approved > requested + 0.005

  await db.update(supplement).set({
    status: 'approved',
    approvedAmount: approved.toFixed(2),
    // A re-approval after a denial clears the old refusal: the claim must not show a supplement that
    // is approved AND carries the reason it was turned down.
    denialReason: null,
    respondedAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(supplement.id, id))

  // The claim's supplement total is the sum of what is approved — nothing more.
  //
  // This read happens AFTER the update above, so the row just approved is already in it. The previous
  // version added `approvedAmount` a second time on top ("include this one since we just updated it"),
  // which double-counted whichever supplement was approved most recently: three approvals of 1,100 /
  // 77,777 / -600 summing to 78,277 reported 77,677. The stale `sup.status` made the condition always
  // true, so it was never a no-op. (roof T17 H1)
  const allSups = await db.select().from(supplement)
    .where(and(eq(supplement.claimId, sup.claimId), eq(supplement.status, 'approved')))
  const supTotal = allSups.reduce((sum, s) => sum + Number(s.approvedAmount || 0), 0)

  await db.update(insuranceClaim).set({
    supplementAmount: String(supTotal),
    updatedAt: new Date(),
  }).where(eq(insuranceClaim.id, sup.claimId))

  await db.insert(claimActivity).values({
    companyId: currentUser.companyId,
    jobId: sup.jobId,
    claimId: sup.claimId,
    userId: currentUser.userId,
    activityType: 'approval',
    // …and when the carrier allowed MORE than was asked, the line says so. Both figures, so the
    // entry can be checked against the carrier's letter without opening anything else. (T41)
    body: overAsk
      ? `Supplement ${sup.supplementNumber} approved — $${Number(approvedAmount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}, which is ABOVE the $${requested.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} asked for`
      : `Supplement ${sup.supplementNumber} approved — $${Number(approvedAmount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
  })

  const [updated] = await db.select().from(supplement).where(eq(supplement.id, id)).limit(1)
  return c.json(updated)
})

// Deny supplement
// Same gate as approve — a denial moves money off the claim just as an approval moves it on.
app.post('/supplements/:id/deny', requireManager, async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const schema = z.object({ denialReason: z.string().min(1) })
  const { denialReason } = schema.parse(await c.req.json())

  const [sup] = await db.select().from(supplement)
    .where(and(eq(supplement.id, id), eq(supplement.companyId, currentUser.companyId)))
    .limit(1)
  if (!sup) return c.json({ error: 'Supplement not found' }, 404)
  if (!DECIDABLE.includes(sup.status)) return wrongState(c, sup, 'denied', DECIDABLE)

  await db.update(supplement).set({
    status: 'denied',
    denialReason,
    /**
     * A DENIED SUPPLEMENT IS NOT STILL WORTH WHAT IT WAS APPROVED FOR. (T41)
     *
     *   "A denied supplement keeps its old approvedAmount (the total correctly excludes it)."
     *
     * The claim's supplementAmount was right — it sums only approved rows — but the supplement
     * itself went on reading "Approved: $1,100" with a denial reason beside it. Two contradictory
     * facts on one record, and the one a person reads off the screen was the wrong one. Whatever
     * reads the row later (a report, an export, a carrier letter) has no way to know which to
     * believe. The decision is the denial, so the approved figure goes with it.
     */
    approvedAmount: null,
    respondedAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(supplement.id, id))

  // Denying one that had been approved has to take its money back off the claim. Without this the
  // amount stayed in supplementAmount for ever, so a reversed decision left the claim overstated —
  // the mirror of the double-count on approve, and the reason both paths now derive the total the
  // same way rather than adjusting it.
  const stillApproved = await db.select().from(supplement)
    .where(and(eq(supplement.claimId, sup.claimId), eq(supplement.status, 'approved')))
  await db.update(insuranceClaim).set({
    supplementAmount: String(stillApproved.reduce((sum, s) => sum + Number(s.approvedAmount || 0), 0)),
    updatedAt: new Date(),
  }).where(eq(insuranceClaim.id, sup.claimId))

  await db.insert(claimActivity).values({
    companyId: currentUser.companyId,
    jobId: sup.jobId,
    claimId: sup.claimId,
    userId: currentUser.userId,
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

app.post('/adjusters', requirePermission('insurance:create'), async (c) => {
  const currentUser = c.get('user') as any
  // M2: this accepted phone "abcdefghij" and any string as an email, with a 201. An adjuster's
  // contact details are the whole point of the record — a claim is worked by calling them.
  const schema = z.object({
    name: z.string().min(1),
    phone: optional(phoneField),
    email: optional(emailField),
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

app.put('/adjusters/:id', requirePermission('insurance:update'), async (c) => {
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

app.post('/claims/:claimId/activity', requirePermission('insurance:create'), async (c) => {
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
    userId: currentUser.userId,
    activityType: data.activityType,
    body: data.body,
    metadata: data.metadata || null,
  }).returning()

  return c.json(activity, 201)
})

// ══════════════════════════════════════════════════════
// XACTIMATE EXPORT
// ══════════════════════════════════════════════════════

app.post('/claims/:claimId/xactimate-export', requirePermission('insurance:create'), async (c) => {
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

  /**
   * WHICH DOCUMENT. ?basis=approved for the settled scope; anything else is the ask. (T41)
   *
   * The default is deliberately unchanged, because the ask is what this endpoint has always built
   * and what gets sent to a carrier (roof T18 D3). T41 asked for the other one — the scope as
   * approved — which a contractor needs once the carrier has responded, and which asking for the
   * ask overstated. Both are legitimate; the caller now says which.
   */
  const basis = c.req.query('basis') === 'approved' ? 'approved' as const : 'ask' as const

  /**
   * A SCOPE WITH NO MEASUREMENT IS SEVEN LINES OF ZERO. (T41)
   *
   *   "It also emits 7 measurement lines at quantity 0 instead of warning that there's no
   *    measurement."
   *
   * Every quantity in generateLineItems is derived from totalSquares — the squares, the waste
   * factor, the perimeter and from it the ridge, eave, ice-and-water and flashing. With no
   * measurement that is 0, and the export produced a PDF and a CSV that are worth $0.00 on every
   * line. A contractor can send that to a carrier without noticing; what comes back is a claim
   * argued at nothing.
   *
   * So the export is REFUSED and says which of the two numbers is missing. It is not a warning
   * buried in a document nobody re-reads — there is nothing useful to build.
   */
  const squaresForScope = Number(measurement?.totalSquares || j.totalSquares || 0)
  if (!Number.isFinite(squaresForScope) || squaresForScope <= 0) {
    return c.json({
      error: 'This job has no roof measurement, so every line of the scope would be zero. Add the total '
        + 'squares to the job, or link a measurement report, and then build the scope.',
      code: 'no_measurement',
    }, 400)
  }

  // Get supplements. A DENIED one is not part of the scope: its line items were refused, and adding
  // them back into the subtotal overstated the RCV Total printed on the PDF that goes to the carrier —
  // the mirror of the panel that left APPROVED ones out. (roof T18 D3)
  //
  // DRAFTS are excluded too, in buildSupplementItems — T41: "it includes three never-submitted
  // drafts ($450)". This document is the ask, and a draft has not been asked for. Submitted ones
  // stay: they are exactly what was asked.
  //
  // On ?basis=approved the service narrows this further to approved supplements only; the query stays
  // the same so the two documents are built from one read.
  const supplements = await db.select().from(supplement)
    .where(and(eq(supplement.claimId, claimId), eq(supplement.companyId, currentUser.companyId), ne(supplement.status, 'denied')))

  try {
    const result = await generateXactimateScopeDocument(claim, j, comp, measurement, supplements, basis)

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
      userId: currentUser.userId,
      activityType: 'xactimate_export',
      // Which document was produced, because "a scope was generated" does not say whether the
      // figures were the ask or the settlement — and the two are different numbers. (T41)
      body: basis === 'approved'
        ? `Xactimate scope generated — APPROVED basis (${result.supplementsIncluded} approved supplement${result.supplementsIncluded === 1 ? '' : 's'})`
        : 'Xactimate scope generated — as requested (the ask sent to the carrier)',
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
