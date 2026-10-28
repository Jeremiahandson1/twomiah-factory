// Roofing's insurance claims at /api/insurance: the claim on an insurance job, its supplements through submit /
// approve / deny, the adjuster directory, the claim's activity trail and the Xactimate scope export. Moved from
// templates/crm-roof/backend/src/routes/insurance.ts. The registry signs the person in and applies the
// 'insurance_workflow' gate (the template's index.ts gated /api/insurance with it).
//
// Kept as the template had it: every write's permission; the reads' (none beyond sign-in — the crew reads the claim,
// T63); the supplement money computed from qty × unitPrice and the client's totals ignored (T17 H2); the claim's
// supplement total as the sum of approved supplements, counted once (T17 H1); which decision is possible from which
// state, over-approval allowed and said so, re-approval naming what it replaced (T41, T60); the export's ask / approved
// basis, refused without a measurement (T41); the money rule — a seat without invoices:read sees the claim without its
// figures (T63).
//
// Changes from the template:
//   · the job's property address is the CRM's `address` (docs/UNIFIED_ROOF_PLAN.md decision 2); no reply carries a job
//     row, and a supplement's approval writes only the claim's own supplement total — never a job's money, a quote or
//     an invoice (the template's didn't either);
//   · approve and deny ask `insurance:approve` instead of the template's requireManager (a rank list: owner, admin,
//     manager — RULEBOOK: permissions, never rank). The shared matrix gives `insurance:*` to exactly manager and admin
//     and '*' to the owner, so the same three seats hold it, and an owner can now grant it to one person by name;
//   · the money rule is applied to every reply that carries a claim, a supplement or the priced export, not only the
//     reads: a seat that may write a claim but not see the books (a per-person grant) got the figures back in the reply;
//   · lists (supplements, adjusters, activity) are { data, pagination };
//   · the wrong-state refusal is { error, code: 'supplement_wrong_status' } — the status and allowedFrom keys are gone
//     (the sentence names both; no screen read them);
//   · the scope's PDF and CSV are served by this module (GET /claims/:claimId/files/:file, invoices:read, the claim's
//     own company) — the template's /media/insurance/… route is not in this app; a store that isn't set up is a 503
//     before anything is built (the template built the PDF, then 500'd on the upload);
//   · validation that 500'd is a 400 naming the box: a date that isn't one, a claim figure that isn't an amount (or is
//     negative), a blank claim number or carrier on edit (both NOT NULL), a cause of loss outside the list on edit (the
//     create already refused it);
//   · an adjuster edit is validated as a create is, field by field — the template spread the raw body into the row, so
//     an edit could move an adjuster to another company (companyId), or store the phone "abcdefghij" the create refuses;
//   · supplement numbering and the claim's supplement total are worked out with the claim row locked, so two at once
//     can't both be SUP-002, or write a total that misses the other's approval.
import { Hono } from 'hono'
import { z } from 'zod'
import { and, asc, desc, eq, ne } from 'drizzle-orm'
import { companyRowTimeZone } from '@twomiah/tenant-backend'
import { adjusterContact, claimActivity, company, insuranceClaim, job, measurementReport, supplement } from '../../../db/schema/index.ts'
import { invalid } from '../../../http/errors.ts'
import type { AppEnv } from '../../../http/env.ts'
import { fail, one, listAll } from '../../../http/reply.ts'
import type { CrmDeps } from '../../deps.ts'
import { canSeeWith } from '../../deps.ts'
import { email as emailField, money, optional, phone as phoneField } from '../validation.ts'
import { SCOPE_FILES, generateXactimateScopeDocument, scopeKey, type ScopeFile } from './xactimate.ts'

/**
 * WHAT THE CARRIER PAYS IS THE BOOKS. (T63; owner's decision 2026-10-09.) invoices:read, the rule /api/jobs applies to
 * the same job. The crew keeps the claim — carrier, number, status, dates, adjuster, the scope's codes and quantities —
 * and loses the figures: the claim's six money fields, a supplement's totals and its line prices, dollar amounts in the
 * activity text, and the priced export. Absent, not zero, with moneyWithheld so the page draws no $0.
 */
const CLAIM_MONEY = ['deductible', 'rcv', 'acv', 'depreciationHeld', 'supplementAmount', 'finalApprovedAmount'] as const
const LINE_MONEY = ['unitPrice', 'unitCost', 'price', 'total', 'amount'] as const
const drop = (row: any, keys: readonly string[]) => { const out = { ...(row || {}) }; for (const k of keys) delete out[k]; return out }
const claimWithoutMoney = (claim: any) => ({ ...drop(claim, CLAIM_MONEY), moneyWithheld: true })
const supplementWithoutMoney = (sup: any) => ({
  ...drop(sup, ['totalAmount', 'approvedAmount']),
  lineItems: Array.isArray(sup?.lineItems) ? sup.lineItems.map((li: any) => drop(li, LINE_MONEY)) : sup?.lineItems,
  moneyWithheld: true,
})
/** A dollar figure inside free text — "submitted — $4,210.50 — hail" — read by a seat that may not see money. */
const withoutDollarFigures = (text: any) => typeof text === 'string' ? text.replace(/-?\$\s?\d[\d,]*(\.\d+)?/g, '(amount hidden)') : text

const usd = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** A claim figure as the form sends it (a string): an amount of 0 or more that fits the column, or '' to clear it. */
const claimMoney = z.string().trim().refine(
  (v) => v === '' || (/^\d+(\.\d+)?$/.test(v) && Number(v) < 1e8),
  { message: 'must be an amount of 0 or more' },
)
const CAUSES = ['hail', 'wind', 'fire', 'water', 'other'] as const
const CLAIM_STATUSES = ['filed', 'adjuster_assigned', 'inspection_scheduled', 'inspected', 'approved', 'supplemented', 'denied', 'closed'] as const

/** A date field: undefined when not sent, null when cleared (''), a Date, or an error naming the box. */
function dateField(name: string, v: unknown): { value?: Date | null; error?: string } {
  if (v === undefined) return {}
  if (v === null || v === '') return { value: null }
  const d = new Date(String(v))
  return isNaN(d.getTime()) ? { error: `${name}: enter a valid date.` } : { value: d }
}

const supplementLine = z.object({
  code: z.string().optional(),
  description: z.string(),
  qty: money,
  unit: z.string(),
  unitPrice: money,
  // What the CLIENT thinks the arithmetic is: accepted so existing callers keep working, then ignored. (roof T17 H2)
  total: z.number().optional(),
})
const priced = (lines: z.infer<typeof supplementLine>[]) => {
  const lineItems = lines.map((li) => ({ ...li, total: Number((li.qty * li.unitPrice).toFixed(2)) }))
  return { lineItems, totalAmount: lineItems.reduce((s, li) => s + li.total, 0).toFixed(2) }
}

/**
 * WHICH DECISION IS POSSIBLE FROM WHICH STATE. (T41)
 *   submit   draft or denied → sent to the carrier (a denial can be reworked and re-sent)
 *   approve  submitted, approved or denied → the carrier's decision, including a revised one
 *   deny     submitted, approved or denied → likewise
 * A draft is in neither decision list: nobody sent it, so there is nothing to decide.
 */
const SUBMITTABLE = ['draft', 'denied']
const DECIDABLE = ['submitted', 'approved', 'denied']
const wrongStateMessage = (sup: { supplementNumber: string; status: string }, verb: string, allowed: string[]) =>
  sup.status === 'draft' && verb !== 'submitted'
    ? `${sup.supplementNumber} is still a draft — it has not been sent to the carrier, so there is no decision to record. Submit it first.`
    : `${sup.supplementNumber} is ${sup.status}, and only a supplement that is ${allowed.join(' or ')} can be ${verb}.`

const adjusterSchema = z.object({
  name: z.string().trim().min(1),
  // M2: phone "abcdefghij" and any string as an email were accepted. A claim is worked by calling the adjuster.
  phone: optional(phoneField),
  email: optional(emailField),
  adjusterCompany: z.string().optional(),
  insuranceCarrier: z.string().trim().min(1),
  territory: z.string().optional(),
  notes: z.string().optional(),
})
const ADJUSTER_CLEARABLE = ['phone', 'email', 'adjusterCompany', 'territory', 'notes'] as const

export function createInsuranceRoutes(d: CrmDeps) {
  const { db } = d
  const { requirePermission } = d.permissions
  const canSee = canSeeWith(d.permissions)
  const app = new Hono<AppEnv>()

  const maySeeClaimMoney = async (c: any): Promise<boolean> => {
    const u = c.get('user')
    try { return !!(await canSee(u?.role, 'invoices:read', u?.userId)) } catch { return false }
  }
  const claimFor = (sees: boolean) => (claim: any) => (sees ? claim : claimWithoutMoney(claim))
  const supplementFor = (sees: boolean) => (sup: any) => (sees ? sup : supplementWithoutMoney(sup))
  const ownClaim = async (companyId: string, id: string) =>
    (await db.select().from(insuranceClaim).where(and(eq(insuranceClaim.id, id), eq(insuranceClaim.companyId, companyId))).limit(1))[0]
  const ownSupplement = async (companyId: string, id: string) =>
    (await db.select().from(supplement).where(and(eq(supplement.id, id), eq(supplement.companyId, companyId))).limit(1))[0]
  /** The claim's supplement total: the sum of what is approved — nothing more (T17 H1). Read with the claim locked. */
  const approvedTotal = async (tx: any, claimId: string) => {
    const rows = await tx.select({ approvedAmount: supplement.approvedAmount }).from(supplement)
      .where(and(eq(supplement.claimId, claimId), eq(supplement.status, 'approved')))
    return rows.reduce((sum: number, s: any) => sum + Number(s.approvedAmount || 0), 0)
  }
  const lockClaim = (tx: any, claimId: string) =>
    tx.select({ id: insuranceClaim.id }).from(insuranceClaim).where(eq(insuranceClaim.id, claimId)).for('update')

  // ══════════════════════════════════════════════════════
  // CLAIMS
  // ══════════════════════════════════════════════════════

  // Create the claim for an insurance job — one per job.
  app.post('/claims', requirePermission('insurance:create'), async (c) => {
    const me = c.get('user')
    const parsed = z.object({
      jobId: z.string().min(1),
      claimNumber: z.string().min(1),
      insuranceCompany: z.string().min(1),
      policyNumber: z.string().optional(),
      adjusterName: z.string().optional(),
      adjusterPhone: z.string().optional(),
      adjusterEmail: z.string().optional(),
      adjusterCompany: z.string().optional(),
      dateOfLoss: z.string().optional(),
      causeOfLoss: z.enum(CAUSES).optional(),
      deductible: claimMoney.optional(),
    }).safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return invalid(c, parsed.error)
    const data = parsed.data
    const loss = dateField('dateOfLoss', data.dateOfLoss)
    if (loss.error) return fail(c, 400, loss.error)

    const [j] = await db.select({ id: job.id, jobType: job.jobType }).from(job)
      .where(and(eq(job.id, data.jobId), eq(job.companyId, me.companyId))).limit(1)
    if (!j) return fail(c, 404, 'Job not found')
    if (j.jobType !== 'insurance') return fail(c, 400, 'Job must be insurance type')

    const [existing] = await db.select({ id: insuranceClaim.id }).from(insuranceClaim).where(eq(insuranceClaim.jobId, data.jobId)).limit(1)
    if (existing) return fail(c, 409, 'Claim already exists for this job')

    const [claim] = await db.insert(insuranceClaim).values({
      companyId: me.companyId,
      jobId: data.jobId,
      claimNumber: data.claimNumber,
      insuranceCompany: data.insuranceCompany,
      policyNumber: data.policyNumber || null,
      adjusterName: data.adjusterName || null,
      adjusterPhone: data.adjusterPhone || null,
      adjusterEmail: data.adjusterEmail || null,
      adjusterCompany: data.adjusterCompany || null,
      dateOfLoss: loss.value ?? null,
      causeOfLoss: data.causeOfLoss || null,
      deductible: data.deductible || null,
      claimStatus: 'filed',
      claimFiledDate: new Date(),
    }).returning()

    await db.insert(claimActivity).values({
      companyId: me.companyId, jobId: data.jobId, claimId: claim.id, userId: me.userId, activityType: 'status_change',
      body: `Insurance claim filed with ${data.insuranceCompany} — Claim #${data.claimNumber}`,
    })
    // Mirror the claim number onto the job so both screens agree from the start.
    await db.update(job).set({ claimNumber: data.claimNumber, updatedAt: new Date() } as any)
      .where(and(eq(job.id, data.jobId), eq(job.companyId, me.companyId)))

    return one(c, claimFor(await maySeeClaimMoney(c))(claim), 201)
  })

  // The claim on a job (by the JOB's id — the job page opens it).
  app.get('/claims/:jobId', async (c) => {
    const me = c.get('user')
    const [claim] = await db.select().from(insuranceClaim)
      .where(and(eq(insuranceClaim.jobId, c.req.param('jobId')), eq(insuranceClaim.companyId, me.companyId))).limit(1)
    if (!claim) return fail(c, 404, 'No claim found for this job')
    return one(c, claimFor(await maySeeClaimMoney(c))(claim))
  })

  // Edit the claim. '' clears an optional field; the claim number and carrier can't be blanked (both are required).
  app.put('/claims/:id', requirePermission('insurance:update'), async (c) => {
    const me = c.get('user')
    const id = c.req.param('id')
    const parsed = z.object({
      claimNumber: z.string().trim().min(1, 'is required').optional(),
      insuranceCompany: z.string().trim().min(1, 'is required').optional(),
      policyNumber: z.string().optional(),
      adjusterName: z.string().optional(),
      adjusterPhone: z.string().optional(),
      adjusterEmail: z.string().optional(),
      adjusterCompany: z.string().optional(),
      dateOfLoss: z.string().optional(),
      causeOfLoss: z.union([z.enum(CAUSES), z.literal('')]).optional(),
      deductible: claimMoney.optional(),
      rcv: claimMoney.optional(),
      acv: claimMoney.optional(),
      depreciationHeld: claimMoney.optional(),
      finalApprovedAmount: claimMoney.optional(),
      denialReason: z.string().optional(),
      internalNotes: z.string().optional(),
      adjusterInspectionDate: z.string().optional(),
    }).safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return invalid(c, parsed.error)
    const data = parsed.data

    const claim = await ownClaim(me.companyId, id)
    if (!claim) return fail(c, 404, 'Claim not found')

    const updates: Record<string, unknown> = { updatedAt: new Date() }
    for (const [key, val] of Object.entries(data)) {
      if (val === undefined) continue
      if (key === 'dateOfLoss' || key === 'adjusterInspectionDate') {
        const r = dateField(key, val)
        if (r.error) return fail(c, 400, r.error)
        updates[key] = r.value
      } else {
        updates[key] = val || null
      }
    }
    const [updated] = await db.update(insuranceClaim).set(updates as any)
      .where(and(eq(insuranceClaim.id, id), eq(insuranceClaim.companyId, me.companyId))).returning()

    // Keep the job's own claimNumber in sync with the claim — otherwise the job page and the claim page show two
    // different claim numbers for one job.
    if (data.claimNumber !== undefined && claim.jobId) {
      await db.update(job).set({ claimNumber: data.claimNumber || null, updatedAt: new Date() } as any)
        .where(and(eq(job.id, claim.jobId), eq(job.companyId, me.companyId)))
    }
    return one(c, claimFor(await maySeeClaimMoney(c))(updated))
  })

  // Move the claim along, with a line in its trail.
  app.post('/claims/:id/status', requirePermission('insurance:create'), async (c) => {
    const me = c.get('user')
    const id = c.req.param('id')
    const parsed = z.object({ status: z.enum(CLAIM_STATUSES), note: z.string().optional() }).safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return invalid(c, parsed.error)
    const { status, note } = parsed.data

    const claim = await ownClaim(me.companyId, id)
    if (!claim) return fail(c, 404, 'Claim not found')

    const updates: Record<string, unknown> = { claimStatus: status, updatedAt: new Date() }
    if (status === 'approved') updates.approvalDate = new Date()
    const [updated] = await db.update(insuranceClaim).set(updates as any)
      .where(and(eq(insuranceClaim.id, id), eq(insuranceClaim.companyId, me.companyId))).returning()

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
      companyId: me.companyId, jobId: claim.jobId, claimId: claim.id, userId: me.userId, activityType: 'status_change',
      body: `${statusLabels[status] || status}${note ? ` — ${note}` : ''}`,
    })
    return one(c, claimFor(await maySeeClaimMoney(c))(updated))
  })

  // ══════════════════════════════════════════════════════
  // SUPPLEMENTS
  // ══════════════════════════════════════════════════════

  app.get('/claims/:claimId/supplements', async (c) => {
    const me = c.get('user')
    const rows = await db.select().from(supplement)
      .where(and(eq(supplement.claimId, c.req.param('claimId')), eq(supplement.companyId, me.companyId)))
      .orderBy(asc(supplement.createdAt), asc(supplement.id))
    const data = rows.map(supplementFor(await maySeeClaimMoney(c)))
    return listAll(c, data)
  })

  // A supplement, numbered SUP-001, SUP-002… within its claim, its money computed from its lines.
  app.post('/claims/:claimId/supplements', requirePermission('insurance:create'), async (c) => {
    const me = c.get('user')
    const claimId = c.req.param('claimId')
    const parsed = z.object({
      reason: z.string().min(1),
      lineItems: z.array(supplementLine).min(1),
      totalAmount: z.string().optional(),
      notes: z.string().optional(),
    }).safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return invalid(c, parsed.error)
    const data = parsed.data
    const { lineItems, totalAmount } = priced(data.lineItems)

    const claim = await ownClaim(me.companyId, claimId)
    if (!claim) return fail(c, 404, 'Claim not found')

    const sup = await db.transaction(async (tx: any) => {
      await lockClaim(tx, claimId)
      const existing = await tx.select({ id: supplement.id }).from(supplement).where(eq(supplement.claimId, claimId))
      const supplementNumber = `SUP-${String(existing.length + 1).padStart(3, '0')}`
      const [row] = await tx.insert(supplement).values({
        companyId: me.companyId, jobId: claim.jobId, claimId, supplementNumber, reason: data.reason, lineItems, totalAmount,
        notes: data.notes || null, status: 'draft',
      }).returning()
      return row
    })
    return one(c, supplementFor(await maySeeClaimMoney(c))(sup), 201)
  })

  // Edit a draft. The line items are the money; a `totalAmount` from the client is ignored.
  app.put('/supplements/:id', requirePermission('insurance:update'), async (c) => {
    const me = c.get('user')
    const id = c.req.param('id')
    const parsed = z.object({
      reason: z.string().optional(),
      lineItems: z.array(supplementLine).min(1).optional(),
      totalAmount: z.string().optional(),
      notes: z.string().optional(),
    }).safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return invalid(c, parsed.error)

    const sup = await ownSupplement(me.companyId, id)
    if (!sup) return fail(c, 404, 'Supplement not found')
    if (sup.status !== 'draft') return fail(c, 400, 'Can only edit draft supplements')

    const { totalAmount: _ignored, lineItems: incoming, ...rest } = parsed.data
    const update: Record<string, unknown> = { ...rest, updatedAt: new Date() }
    if (incoming) Object.assign(update, priced(incoming))
    const [updated] = await db.update(supplement).set(update as any)
      .where(and(eq(supplement.id, id), eq(supplement.companyId, me.companyId))).returning()
    return one(c, supplementFor(await maySeeClaimMoney(c))(updated))
  })

  app.post('/supplements/:id/submit', requirePermission('insurance:create'), async (c) => {
    const me = c.get('user')
    const id = c.req.param('id')
    const sup = await ownSupplement(me.companyId, id)
    if (!sup) return fail(c, 404, 'Supplement not found')
    if (!SUBMITTABLE.includes(sup.status)) return fail(c, 400, wrongStateMessage(sup, 'submitted', SUBMITTABLE), 'supplement_wrong_status')

    const [updated] = await db.update(supplement).set({ status: 'submitted', submittedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(supplement.id, id), eq(supplement.companyId, me.companyId))).returning()
    await db.insert(claimActivity).values({
      companyId: me.companyId, jobId: sup.jobId, claimId: sup.claimId, userId: me.userId, activityType: 'supplement',
      body: `Supplement ${sup.supplementNumber} submitted — ${usd(Number(sup.totalAmount))} — ${sup.reason}`,
    })
    return one(c, supplementFor(await maySeeClaimMoney(c))(updated))
  })

  /**
   * Record the carrier's approval. It moves money on the claim, so it asks insurance:approve (the template's
   * requireManager). Approving MORE than was asked is allowed — an adjuster adds scope and the letter comes back
   * higher — and the trail says so, with both figures (T41). A re-approval names the amount it replaced, a reversal of a
   * denial says so (T42/T60).
   */
  app.post('/supplements/:id/approve', requirePermission('insurance:approve'), async (c) => {
    const me = c.get('user')
    const id = c.req.param('id')
    const parsed = z.object({ approvedAmount: z.string() }).safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return invalid(c, parsed.error)
    const { approvedAmount } = parsed.data
    // An approved amount is money: finite, not negative, and not a string that silently becomes NaN.
    const approved = Number(approvedAmount)
    if (approvedAmount.trim() === '' || !Number.isFinite(approved) || approved < 0) return fail(c, 400, 'approvedAmount must be a number of 0 or more')

    const found = await ownSupplement(me.companyId, id)
    if (!found) return fail(c, 404, 'Supplement not found')

    const result = await db.transaction(async (tx: any) => {
      await lockClaim(tx, found.claimId)
      // Re-read under the lock: the state and the prior amount are what this decision replaces.
      const [sup] = await tx.select().from(supplement).where(and(eq(supplement.id, id), eq(supplement.companyId, me.companyId))).limit(1)
      if (!sup) return { missing: true }
      if (!DECIDABLE.includes(sup.status)) return { refused: wrongStateMessage(sup, 'approved', DECIDABLE) }

      const requested = Number(sup.totalAmount || 0)
      const overAsk = approved > requested + 0.005
      const priorApproved = sup.status === 'approved' && sup.approvedAmount != null ? Number(sup.approvedAmount) : null
      const replacing = priorApproved !== null
        ? (Math.abs(priorApproved - approved) < 0.005 ? ` (confirming the ${usd(priorApproved)} approved earlier)` : ` (replacing the ${usd(priorApproved)} approved earlier)`)
        : sup.status === 'denied' ? ' (reversing the earlier denial)' : ''

      const [updated] = await tx.update(supplement).set({
        status: 'approved',
        approvedAmount: approved.toFixed(2),
        // A re-approval after a denial clears the old refusal.
        denialReason: null,
        respondedAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(supplement.id, id)).returning()

      await tx.update(insuranceClaim).set({ supplementAmount: String(await approvedTotal(tx, sup.claimId)), updatedAt: new Date() })
        .where(eq(insuranceClaim.id, sup.claimId))

      await tx.insert(claimActivity).values({
        companyId: me.companyId, jobId: sup.jobId, claimId: sup.claimId, userId: me.userId, activityType: 'approval',
        body: overAsk
          ? `Supplement ${sup.supplementNumber} approved — ${usd(approved)}, which is ABOVE the ${usd(requested)} asked for${replacing}`
          : `Supplement ${sup.supplementNumber} approved — ${usd(approved)}${replacing}`,
      })
      return { updated }
    })
    if ('missing' in result) return fail(c, 404, 'Supplement not found')
    if ('refused' in result) return fail(c, 400, result.refused as string, 'supplement_wrong_status')
    return one(c, supplementFor(await maySeeClaimMoney(c))(result.updated))
  })

  // Record the carrier's denial — same permission as approve: it takes money back off the claim.
  app.post('/supplements/:id/deny', requirePermission('insurance:approve'), async (c) => {
    const me = c.get('user')
    const id = c.req.param('id')
    const parsed = z.object({ denialReason: z.string().min(1) }).safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return invalid(c, parsed.error)
    const { denialReason } = parsed.data

    const found = await ownSupplement(me.companyId, id)
    if (!found) return fail(c, 404, 'Supplement not found')

    const result = await db.transaction(async (tx: any) => {
      await lockClaim(tx, found.claimId)
      const [sup] = await tx.select().from(supplement).where(and(eq(supplement.id, id), eq(supplement.companyId, me.companyId))).limit(1)
      if (!sup) return { missing: true }
      if (!DECIDABLE.includes(sup.status)) return { refused: wrongStateMessage(sup, 'denied', DECIDABLE) }

      const [updated] = await tx.update(supplement).set({
        status: 'denied',
        denialReason,
        // A denied supplement is not still worth what it was approved for (T41).
        approvedAmount: null,
        respondedAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(supplement.id, id)).returning()

      // Denying one that had been approved takes its money back off the claim.
      await tx.update(insuranceClaim).set({ supplementAmount: String(await approvedTotal(tx, sup.claimId)), updatedAt: new Date() })
        .where(eq(insuranceClaim.id, sup.claimId))

      await tx.insert(claimActivity).values({
        companyId: me.companyId, jobId: sup.jobId, claimId: sup.claimId, userId: me.userId, activityType: 'denial',
        // A denial of an APPROVED supplement withdraws money from the claim — it says how much (T60).
        body: sup.status === 'approved' && sup.approvedAmount != null
          ? `Supplement ${sup.supplementNumber} denied — ${denialReason} (withdrawing the ${usd(Number(sup.approvedAmount))} approved earlier)`
          : `Supplement ${sup.supplementNumber} denied — ${denialReason}`,
      })
      return { updated }
    })
    if ('missing' in result) return fail(c, 404, 'Supplement not found')
    if ('refused' in result) return fail(c, 400, result.refused as string, 'supplement_wrong_status')
    return one(c, supplementFor(await maySeeClaimMoney(c))(result.updated))
  })

  // ══════════════════════════════════════════════════════
  // ADJUSTER CONTACTS
  // ══════════════════════════════════════════════════════

  app.get('/adjusters', async (c) => {
    const me = c.get('user')
    const rows = await db.select().from(adjusterContact)
      .where(eq(adjusterContact.companyId, me.companyId))
      .orderBy(desc(adjusterContact.jobsWorkedTogether), asc(adjusterContact.id))
    return listAll(c, rows)
  })

  app.post('/adjusters', requirePermission('insurance:create'), async (c) => {
    const me = c.get('user')
    const parsed = adjusterSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return invalid(c, parsed.error)
    const data = parsed.data
    const [adj] = await db.insert(adjusterContact).values({
      companyId: me.companyId,
      name: data.name,
      phone: data.phone || null,
      email: data.email || null,
      adjusterCompany: data.adjusterCompany || null,
      insuranceCarrier: data.insuranceCarrier,
      territory: data.territory || null,
      notes: data.notes || null,
    }).returning()
    return one(c, adj, 201)
  })

  // Edit an adjuster: the create's rules, field by field. '' (or null) clears an optional field.
  app.put('/adjusters/:id', requirePermission('insurance:update'), async (c) => {
    const me = c.get('user')
    const id = c.req.param('id')
    const raw = (await c.req.json().catch(() => null)) ?? {}
    if (typeof raw !== 'object' || Array.isArray(raw)) return fail(c, 400, 'Send the adjuster as an object.')
    const cleaned = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, v === null ? undefined : v]))
    const parsed = adjusterSchema.partial().safeParse(cleaned)
    if (!parsed.success) return invalid(c, parsed.error)

    const [adj] = await db.select({ id: adjusterContact.id }).from(adjusterContact)
      .where(and(eq(adjusterContact.id, id), eq(adjusterContact.companyId, me.companyId))).limit(1)
    if (!adj) return fail(c, 404, 'Adjuster not found')

    const set: Record<string, unknown> = { updatedAt: new Date() }
    for (const [k, v] of Object.entries(parsed.data)) if (v !== undefined) set[k] = v
    for (const k of ADJUSTER_CLEARABLE) if (k in raw && (raw[k] === '' || raw[k] === null)) set[k] = null
    const [updated] = await db.update(adjusterContact).set(set as any)
      .where(and(eq(adjusterContact.id, id), eq(adjusterContact.companyId, me.companyId))).returning()
    return one(c, updated)
  })

  // ══════════════════════════════════════════════════════
  // ACTIVITY LOG
  // ══════════════════════════════════════════════════════

  app.get('/claims/:claimId/activity', async (c) => {
    const me = c.get('user')
    const rows = await db.select().from(claimActivity)
      .where(and(eq(claimActivity.claimId, c.req.param('claimId')), eq(claimActivity.companyId, me.companyId)))
      .orderBy(desc(claimActivity.createdAt), desc(claimActivity.id))
    const data = (await maySeeClaimMoney(c)) ? rows : rows.map((a: any) => ({ ...a, body: withoutDollarFigures(a.body) }))
    return listAll(c, data)
  })

  app.post('/claims/:claimId/activity', requirePermission('insurance:create'), async (c) => {
    const me = c.get('user')
    const claimId = c.req.param('claimId')
    const parsed = z.object({
      activityType: z.enum(['note', 'call', 'email', 'inspection', 'document_uploaded']),
      body: z.string().min(1),
      metadata: z.record(z.any()).optional(),
    }).safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return invalid(c, parsed.error)
    const data = parsed.data

    const claim = await ownClaim(me.companyId, claimId)
    if (!claim) return fail(c, 404, 'Claim not found')

    const [activity] = await db.insert(claimActivity).values({
      companyId: me.companyId, jobId: claim.jobId, claimId, userId: me.userId,
      activityType: data.activityType, body: data.body, metadata: data.metadata || null,
    }).returning()
    return one(c, activity, 201)
  })

  // ══════════════════════════════════════════════════════
  // XACTIMATE EXPORT
  // ══════════════════════════════════════════════════════

  /**
   * Build the scope. ?basis=approved is the settled scope; anything else is the ask sent to the carrier (the default,
   * roof T18 D3). A job with no measurement is refused: every quantity derives from the squares, so the document would
   * be seven lines of zero (T41). Denied supplements are not part of either scope (T18 D3); drafts are dropped by
   * buildSupplementItems.
   */
  app.post('/claims/:claimId/xactimate-export', requirePermission('insurance:create'), async (c) => {
    const me = c.get('user')
    const claimId = c.req.param('claimId')
    const claim = await ownClaim(me.companyId, claimId)
    if (!claim) return fail(c, 404, 'Claim not found')

    const [j] = await db.select().from(job).where(and(eq(job.id, claim.jobId), eq(job.companyId, me.companyId))).limit(1)
    if (!j) return fail(c, 404, 'Job not found')
    const [comp] = await db.select().from(company).where(eq(company.id, me.companyId)).limit(1)
    let measurement: any = null
    if (j.measurementReportId) {
      const [m] = await db.select().from(measurementReport)
        .where(and(eq(measurementReport.id, j.measurementReportId), eq(measurementReport.companyId, me.companyId))).limit(1)
      measurement = m || null
    }

    const basis = c.req.query('basis') === 'approved' ? 'approved' as const : 'ask' as const

    const squaresForScope = Number(measurement?.totalSquares || j.totalSquares || 0)
    if (!Number.isFinite(squaresForScope) || squaresForScope <= 0) {
      return fail(c, 400, 'This job has no roof measurement, so every line of the scope would be zero. Add the total '
        + 'squares to the job, or link a measurement report, and then build the scope.', 'no_measurement')
    }

    const storage = d.services.storage
    if (storage.storageConfigured && !storage.storageConfigured()) return fail(c, 503, 'Document storage is not set up yet.', 'storage_not_configured')

    const supplements = await db.select().from(supplement)
      .where(and(eq(supplement.claimId, claimId), eq(supplement.companyId, me.companyId), ne(supplement.status, 'denied')))
      .orderBy(asc(supplement.createdAt), asc(supplement.id))

    let result: Awaited<ReturnType<typeof generateXactimateScopeDocument>>
    try {
      result = await generateXactimateScopeDocument(claim, j, comp, measurement, supplements, basis, {
        put: (key, body, type) => storage.put(key, body, type),
        timeZone: companyRowTimeZone(comp),
      })
    } catch (err: any) {
      d.logger.error('Xactimate export failed', { claimId, error: err?.message })
      return fail(c, 500, 'Failed to generate Xactimate export')
    }

    await db.update(insuranceClaim).set({ xactimateScopeUrl: result.pdfUrl, xactimateExportUrl: result.csvUrl, updatedAt: new Date() })
      .where(and(eq(insuranceClaim.id, claimId), eq(insuranceClaim.companyId, me.companyId)))
    await db.insert(claimActivity).values({
      companyId: me.companyId, jobId: claim.jobId, claimId, userId: me.userId, activityType: 'xactimate_export',
      // Which document was produced: the ask and the settlement are different numbers. (T41)
      body: basis === 'approved'
        ? `Xactimate scope generated — APPROVED basis (${result.supplementsIncluded} approved supplement${result.supplementsIncluded === 1 ? '' : 's'})`
        : 'Xactimate scope generated — as requested (the ask sent to the carrier)',
    })

    if (await maySeeClaimMoney(c)) return one(c, result)
    // The priced scope is the money rule, whole (T63): codes and quantities, no prices or totals.
    const { totals: _t, ...rest } = result
    return one(c, {
      ...rest,
      lineItems: result.lineItems.map((li) => drop(li, LINE_MONEY)),
      supplementItems: result.supplementItems.map((li) => drop(li, LINE_MONEY)),
      moneyWithheld: true,
    })
  })

  // The links to the latest scope. The export IS the priced scope, so it is the money rule, whole. (T63)
  app.get('/claims/:claimId/xactimate-export', requirePermission('invoices:read'), async (c) => {
    const claim = await ownClaim(c.get('user').companyId, c.req.param('claimId'))
    if (!claim) return fail(c, 404, 'Claim not found')
    return one(c, { pdfUrl: claim.xactimateScopeUrl, csvUrl: claim.xactimateExportUrl })
  })

  /**
   * One of the claim's scope documents. NOT public (T41: the links "open without signing in"): signed in, the claim's own
   * company (another company's claim is a 404 — whether a document exists is its owner's business), and invoices:read,
   * because the document is the priced scope. The key is built here from the claim row and a fixed file name, so
   * nothing a caller sends reaches the store's path. Generated by this module from the tenant's own records, so the PDF
   * previews inline; the CSV is handed over as a file (inline text/csv is where spreadsheet-formula injection starts).
   */
  app.get('/claims/:claimId/files/:file', requirePermission('invoices:read'), async (c) => {
    const me = c.get('user')
    const file = c.req.param('file') as ScopeFile
    if (!(SCOPE_FILES as readonly string[]).includes(file)) return fail(c, 404, 'Not found')
    const claim = await ownClaim(me.companyId, c.req.param('claimId'))
    if (!claim) return fail(c, 404, 'Not found')
    const storage = d.services.storage
    if (storage.storageConfigured && !storage.storageConfigured()) return fail(c, 503, 'Document storage is not set up yet.', 'storage_not_configured')
    const obj = await storage.getObject(scopeKey(claim.companyId, claim.id, file))
    if (!obj) return fail(c, 404, 'Not found')
    const isPdf = file.endsWith('.pdf')
    return c.body(obj.body as any, 200, {
      'Content-Type': isPdf ? 'application/pdf' : 'text/csv',
      'X-Content-Type-Options': 'nosniff',
      ...(isPdf ? {} : { 'Content-Disposition': `attachment; filename="${file}"` }),
      // Private: a shared cache must not keep one tenant's scope and hand it to the next request for the same address.
      'Cache-Control': 'private, max-age=0, no-store',
    })
  })

  return app
}
