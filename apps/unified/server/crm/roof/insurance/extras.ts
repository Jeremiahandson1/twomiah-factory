// Insurance follow-ups at /api/insurance-extras (roofing depth, gap 7; docs/parity/roof-insurance-extras.md). Behind the
// not-ready feature `insurance_extras`:
//
//   · HELD DEPRECIATION. A carrier pays a roof's ACV first and holds the depreciation back until it has the contractor's
//     certificate of completion. When the job is done (it reaches Final Inspection, or Invoiced or Collected without having
//     been through it) a reminder is made ONCE: a line in the claim's trail, a note on the job and a phone notice to the
//     sales rep (else the owner). The claim then shows whether the certificate went to the carrier and what came back.
//     The list at GET /depreciation is worked out from the job and the claim, not from the reminder, so a claim whose
//     depreciation was typed in after the job was done is on it too.
//   · MORTGAGE-COMPANY CHECKS. A carrier's cheque is made out to the homeowner and their lender; the lender endorses it
//     before it can be banked. Each one is tracked received → sent to the mortgage company → endorsed → deposited, with the
//     company, loan and check numbers, the amount, the send date and a tracking number.
//
// Same rules as the claim routes beside it (./insurance.ts): the writes ask insurance:create / update (the money decision,
// recording what the carrier released, asks insurance:approve); a figure is the books' (invoices:read) and a seat without
// it sees the claim without the amount, absent and flagged moneyWithheld; reads here ask insurance:read (the office's —
// the lists run across every claim).
import { Hono } from 'hono'
import { z } from 'zod'
import { and, asc, desc, eq, inArray, isNull, ne } from 'drizzle-orm'
import { claimActivity, insuranceClaim, job, jobNote, mortgageCheck, user } from '../../../db/schema/index.ts'
import { invalid } from '../../../http/errors.ts'
import type { AppEnv } from '../../../http/env.ts'
import { done, fail, listAll, one } from '../../../http/reply.ts'
import type { CrmDeps } from '../../deps.ts'
import { canSeeWith } from '../../deps.ts'

/** The stages at which the roof is built: the certificate of completion can go. */
export const COMPLETION_STAGES = ['final_inspection', 'invoiced', 'collected'] as const
export const MORTGAGE_STATUSES = ['received', 'sent_to_mortgage', 'endorsed', 'deposited'] as const
type MortgageStatus = (typeof MORTGAGE_STATUSES)[number]
/** The day each status is stamped on, so going back a step clears the days after it. */
const STATUS_DAY: Record<MortgageStatus, 'receivedAt' | 'sentAt' | 'endorsedAt' | 'depositedAt'> = {
  received: 'receivedAt', sent_to_mortgage: 'sentAt', endorsed: 'endorsedAt', deposited: 'depositedAt',
}
const STATUS_WORDS: Record<MortgageStatus, string> = {
  received: 'Received from the carrier', sent_to_mortgage: 'Sent to the mortgage company', endorsed: 'Endorsed by the mortgage company', deposited: 'Deposited',
}

const usd = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const withoutDollarFigures = (text: any) => typeof text === 'string' ? text.replace(/-?\$\s?\d[\d,]*(\.\d+)?/g, '(amount hidden)') : text
/** An amount as the form sends it: 0 or more, fits the column. */
const amountText = z.string().trim().refine((v) => /^\d+(\.\d+)?$/.test(v) && Number(v) < 1e8, { message: 'must be an amount of 0 or more' })
const text = (max = 200) => z.string().trim().max(max)

/** A day from a form: undefined when not sent, a Date, or an error naming the box. */
function dayField(name: string, v: unknown): { value?: Date; error?: string } {
  if (v === undefined || v === null || v === '') return {}
  const d = new Date(String(v))
  return Number.isNaN(d.getTime()) ? { error: `${name}: enter a valid date.` } : { value: d }
}

/**
 * What the carrier is holding back on a claim: the depreciation typed on it, else RCV less ACV when both are known and
 * RCV is the larger. 0 when nothing is held.
 */
export function depreciationHeldOf(claim: { depreciationHeld?: unknown; rcv?: unknown; acv?: unknown }): number {
  const held = Number(claim.depreciationHeld ?? 0)
  if (Number.isFinite(held) && held > 0) return held
  const rcv = claim.rcv == null || claim.rcv === '' ? NaN : Number(claim.rcv)
  const acv = claim.acv == null || claim.acv === '' ? NaN : Number(claim.acv)
  return Number.isFinite(rcv) && Number.isFinite(acv) && rcv > acv ? Number((rcv - acv).toFixed(2)) : 0
}

export function createInsuranceExtras(d: CrmDeps) {
  const { db } = d
  const { requirePermission } = d.permissions
  const canSee = canSeeWith(d.permissions)
  const app = new Hono<AppEnv>()

  const maySeeMoney = async (c: any): Promise<boolean> => {
    const u = c.get('user')
    try { return !!(await canSee(u?.role, 'invoices:read', u?.userId)) } catch { return false }
  }
  const ownClaim = async (companyId: string, id: string) =>
    (await db.select().from(insuranceClaim).where(and(eq(insuranceClaim.id, id), eq(insuranceClaim.companyId, companyId))).limit(1))[0]
  const ownCheck = async (companyId: string, id: string) =>
    (await db.select().from(mortgageCheck).where(and(eq(mortgageCheck.id, id), eq(mortgageCheck.companyId, companyId))).limit(1))[0]
  const checkFor = (sees: boolean) => (row: any) => {
    if (sees) return row
    const { amount: _a, ...rest } = row
    return { ...rest, moneyWithheld: true }
  }
  const trail = (companyId: string, claim: { id: string; jobId: string }, userId: string | null, activityType: string, body: string) =>
    db.insert(claimActivity).values({ companyId, jobId: claim.jobId, claimId: claim.id, userId, activityType, body })

  // ══════════════════════════════════════════════════════
  // HELD DEPRECIATION
  // ══════════════════════════════════════════════════════

  /** Where a claim's held depreciation stands. */
  function depreciationState(claim: any, jobStatus: string | null | undefined) {
    const held = depreciationHeldOf(claim)
    const jobIsDone = !!jobStatus && (COMPLETION_STAGES as readonly string[]).includes(jobStatus)
    const state = claim.depreciationRecoveredAt ? 'recovered'
      : held <= 0 ? 'none_held'
        : !jobIsDone ? 'job_not_done'
          : claim.completionCertificateSentAt ? 'waiting_on_carrier' : 'send_certificate'
    return {
      claimId: claim.id, jobId: claim.jobId, claimNumber: claim.claimNumber, insuranceCompany: claim.insuranceCompany,
      state, jobDone: jobIsDone, held,
      remindedAt: claim.depreciationRemindedAt ?? null,
      certificateSentAt: claim.completionCertificateSentAt ?? null,
      recoveredAmount: claim.depreciationRecoveredAmount != null ? Number(claim.depreciationRecoveredAmount) : null,
      recoveredAt: claim.depreciationRecoveredAt ?? null,
    }
  }
  const depreciationFor = (sees: boolean) => (row: any) => {
    if (sees) return row
    const { held: _h, recoveredAmount: _r, ...rest } = row
    return { ...rest, moneyWithheld: true }
  }

  // The claims whose held depreciation still has to be got: the job is done, something is held, nothing came back yet.
  app.get('/depreciation', requirePermission('insurance:read'), async (c) => {
    const me = c.get('user')
    const rows = await db.select({ claim: insuranceClaim, number: job.number, address: job.address, status: job.status, updatedAt: job.updatedAt })
      .from(insuranceClaim).innerJoin(job, eq(job.id, insuranceClaim.jobId))
      .where(and(eq(insuranceClaim.companyId, me.companyId), inArray(job.status, [...COMPLETION_STAGES]), isNull(insuranceClaim.depreciationRecoveredAt)))
      .orderBy(asc(job.updatedAt), asc(insuranceClaim.id))
    const sees = await maySeeMoney(c)
    const data = rows
      .map((r: any) => ({ ...depreciationState(r.claim, r.status), jobNumber: r.number, address: r.address, jobStatus: r.status }))
      .filter((r: any) => r.held > 0)
      .map(depreciationFor(sees))
    return listAll(c, data)
  })

  app.get('/claims/:claimId/depreciation', requirePermission('insurance:read'), async (c) => {
    const me = c.get('user')
    const claim = await ownClaim(me.companyId, c.req.param('claimId'))
    if (!claim) return fail(c, 404, 'Claim not found')
    const [j] = await db.select({ status: job.status }).from(job).where(eq(job.id, claim.jobId)).limit(1)
    return one(c, depreciationFor(await maySeeMoney(c))(depreciationState(claim, j?.status)))
  })

  // The certificate of completion went to the carrier.
  app.post('/claims/:claimId/completion-certificate', requirePermission('insurance:create'), async (c) => {
    const me = c.get('user')
    const parsed = z.object({ sentOn: z.string().optional(), note: text(500).optional() }).safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) return invalid(c, parsed.error)
    const day = dayField('sentOn', parsed.data.sentOn)
    if (day.error) return fail(c, 400, day.error)
    const claim = await ownClaim(me.companyId, c.req.param('claimId'))
    if (!claim) return fail(c, 404, 'Claim not found')
    if (claim.depreciationRecoveredAt) return fail(c, 409, 'The held depreciation on this claim has already been recovered.', 'already_recovered')
    const at = day.value ?? new Date()
    const [updated] = await db.update(insuranceClaim).set({ completionCertificateSentAt: at, updatedAt: new Date() } as any)
      .where(and(eq(insuranceClaim.id, claim.id), eq(insuranceClaim.companyId, me.companyId))).returning()
    await trail(me.companyId, claim, me.userId, 'document_uploaded', `Certificate of completion sent to ${claim.insuranceCompany}${parsed.data.note ? ` — ${parsed.data.note}` : ''}`)
    const [j] = await db.select({ status: job.status }).from(job).where(eq(job.id, claim.jobId)).limit(1)
    return one(c, depreciationFor(await maySeeMoney(c))(depreciationState(updated, j?.status)))
  })

  // The carrier released the held depreciation: it moves money on the claim, so it is the approver's.
  app.post('/claims/:claimId/depreciation-recovered', requirePermission('insurance:approve'), async (c) => {
    const me = c.get('user')
    const parsed = z.object({ amount: amountText, receivedOn: z.string().optional() }).safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return invalid(c, parsed.error)
    const day = dayField('receivedOn', parsed.data.receivedOn)
    if (day.error) return fail(c, 400, day.error)
    const claim = await ownClaim(me.companyId, c.req.param('claimId'))
    if (!claim) return fail(c, 404, 'Claim not found')
    const amount = Number(parsed.data.amount)
    const [updated] = await db.update(insuranceClaim).set({
      depreciationRecoveredAmount: amount.toFixed(2), depreciationRecoveredAt: day.value ?? new Date(), updatedAt: new Date(),
    } as any).where(and(eq(insuranceClaim.id, claim.id), eq(insuranceClaim.companyId, me.companyId))).returning()
    const held = depreciationHeldOf(claim)
    const short = held > 0 && amount + 0.005 < held ? ` — ${usd(held - amount)} less than the ${usd(held)} held` : ''
    await trail(me.companyId, claim, me.userId, 'approval', `Held depreciation released by ${claim.insuranceCompany} — ${usd(amount)}${short}`)
    const [j] = await db.select({ status: job.status }).from(job).where(eq(job.id, claim.jobId)).limit(1)
    return one(c, depreciationFor(await maySeeMoney(c))(depreciationState(updated, j?.status)))
  })

  // ══════════════════════════════════════════════════════
  // MORTGAGE-COMPANY CHECKS
  // ══════════════════════════════════════════════════════

  // Every check, or only those not yet deposited (?open=1), or one claim's (?claimId=).
  app.get('/mortgage-checks', requirePermission('insurance:read'), async (c) => {
    const me = c.get('user')
    const conditions = [eq(mortgageCheck.companyId, me.companyId)]
    if (c.req.query('open')) conditions.push(ne(mortgageCheck.status, 'deposited'))
    if (c.req.query('claimId')) conditions.push(eq(mortgageCheck.claimId, c.req.query('claimId')!))
    const rows = await db.select({ check: mortgageCheck, jobNumber: job.number, address: job.address, claimNumber: insuranceClaim.claimNumber })
      .from(mortgageCheck).innerJoin(job, eq(job.id, mortgageCheck.jobId)).innerJoin(insuranceClaim, eq(insuranceClaim.id, mortgageCheck.claimId))
      .where(and(...conditions)).orderBy(desc(mortgageCheck.createdAt), desc(mortgageCheck.id))
    const sees = await maySeeMoney(c)
    return listAll(c, rows.map((r: any) => ({ ...checkFor(sees)(r.check), jobNumber: r.jobNumber, address: r.address, claimNumber: r.claimNumber })))
  })

  const checkFacts = z.object({
    mortgageCompany: text().min(1, 'is required'),
    loanNumber: text().optional(),
    checkNumber: text().optional(),
    amount: amountText,
    receivedOn: z.string().optional(),
    notes: text(1000).optional(),
  })

  app.post('/claims/:claimId/mortgage-checks', requirePermission('insurance:create'), async (c) => {
    const me = c.get('user')
    const parsed = checkFacts.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return invalid(c, parsed.error)
    const data = parsed.data
    const day = dayField('receivedOn', data.receivedOn)
    if (day.error) return fail(c, 400, day.error)
    const claim = await ownClaim(me.companyId, c.req.param('claimId'))
    if (!claim) return fail(c, 404, 'Claim not found')
    const [row] = await db.insert(mortgageCheck).values({
      companyId: me.companyId, jobId: claim.jobId, claimId: claim.id, mortgageCompany: data.mortgageCompany,
      loanNumber: data.loanNumber || null, checkNumber: data.checkNumber || null, amount: Number(data.amount).toFixed(2),
      status: 'received', receivedAt: day.value ?? new Date(), notes: data.notes || null, createdById: me.userId,
    }).returning()
    await trail(me.companyId, claim, me.userId, 'note', `Mortgage-company check received — ${usd(Number(data.amount))} — ${data.mortgageCompany}${data.checkNumber ? `, check ${data.checkNumber}` : ''}`)
    return one(c, checkFor(await maySeeMoney(c))(row), 201)
  })

  // The check's facts. Its status moves through /status, which keeps the days.
  app.put('/mortgage-checks/:id', requirePermission('insurance:update'), async (c) => {
    const me = c.get('user')
    const parsed = checkFacts.partial().safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return invalid(c, parsed.error)
    const found = await ownCheck(me.companyId, c.req.param('id'))
    if (!found) return fail(c, 404, 'Check not found')
    const { receivedOn, amount, ...rest } = parsed.data
    const set: Record<string, unknown> = { updatedAt: new Date() }
    for (const [k, v] of Object.entries(rest)) if (v !== undefined) set[k] = v === '' ? null : v
    if (set.mortgageCompany === null) return fail(c, 400, 'mortgageCompany: is required', 'validation_failed', { mortgageCompany: 'is required' })
    if (amount !== undefined) set.amount = Number(amount).toFixed(2)
    const day = dayField('receivedOn', receivedOn)
    if (day.error) return fail(c, 400, day.error)
    if (day.value) set.receivedAt = day.value
    const [row] = await db.update(mortgageCheck).set(set as any).where(and(eq(mortgageCheck.id, found.id), eq(mortgageCheck.companyId, me.companyId))).returning()
    return one(c, checkFor(await maySeeMoney(c))(row))
  })

  // Move the check along (or back), stamping the day, with a line in the claim's trail.
  app.post('/mortgage-checks/:id/status', requirePermission('insurance:update'), async (c) => {
    const me = c.get('user')
    const parsed = z.object({ status: z.enum(MORTGAGE_STATUSES), on: z.string().optional(), trackingNumber: text().optional() })
      .safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return invalid(c, parsed.error)
    const { status, trackingNumber } = parsed.data
    const day = dayField('on', parsed.data.on)
    if (day.error) return fail(c, 400, day.error)
    const found = await ownCheck(me.companyId, c.req.param('id'))
    if (!found) return fail(c, 404, 'Check not found')
    const set: Record<string, unknown> = { status, [STATUS_DAY[status]]: day.value ?? new Date(), updatedAt: new Date() }
    // Back a step: the days after it did not happen yet.
    for (const later of MORTGAGE_STATUSES.slice(MORTGAGE_STATUSES.indexOf(status) + 1)) set[STATUS_DAY[later]] = null
    if (status === 'sent_to_mortgage' && trackingNumber) set.trackingNumber = trackingNumber
    const [row] = await db.update(mortgageCheck).set(set as any).where(and(eq(mortgageCheck.id, found.id), eq(mortgageCheck.companyId, me.companyId))).returning()
    const claim = await ownClaim(me.companyId, found.claimId)
    if (claim) {
      await trail(me.companyId, claim, me.userId, 'status_change',
        `Mortgage-company check (${usd(Number(found.amount))}, ${found.mortgageCompany}): ${STATUS_WORDS[status]}${status === 'sent_to_mortgage' && trackingNumber ? ` — tracking ${trackingNumber}` : ''}`)
    }
    return one(c, checkFor(await maySeeMoney(c))(row))
  })

  app.delete('/mortgage-checks/:id', requirePermission('insurance:delete'), async (c) => {
    const me = c.get('user')
    const found = await ownCheck(me.companyId, c.req.param('id'))
    if (!found) return fail(c, 404, 'Check not found')
    await db.delete(mortgageCheck).where(and(eq(mortgageCheck.id, found.id), eq(mortgageCheck.companyId, me.companyId)))
    return done(c)
  })

  return app
}

/**
 * The reminder, made once when a job with held depreciation is done (called as a job reaches a stage — ./../stageEffects.ts
 * stageReached). Does nothing unless Insurance Follow-ups is on, the stage is one at which the roof is built, the job has a
 * claim, something is held and the reminder was not already made. Never throws: a reminder that can't be made never holds
 * up the job.
 */
export function createDepreciationReminder(d: CrmDeps) {
  const { db } = d
  return async function remindDepreciation(companyId: string, jobId: string, stage: string): Promise<boolean> {
    try {
      if (!(COMPLETION_STAGES as readonly string[]).includes(stage)) return false
      if (!(await d.features.enabledFeaturesFor(companyId)).includes('insurance_extras')) return false
      const [claim] = await db.select().from(insuranceClaim).where(and(eq(insuranceClaim.jobId, jobId), eq(insuranceClaim.companyId, companyId))).limit(1)
      if (!claim || claim.depreciationRecoveredAt || claim.depreciationRemindedAt) return false
      const held = depreciationHeldOf(claim)
      if (held <= 0) return false
      // The mark is in the write, so two stage moves at once make one reminder.
      const [marked] = await db.update(insuranceClaim).set({ depreciationRemindedAt: new Date() } as any)
        .where(and(eq(insuranceClaim.id, claim.id), isNull(insuranceClaim.depreciationRemindedAt))).returning()
      if (!marked) return false

      const [row] = await db.select().from(job).where(and(eq(job.id, jobId), eq(job.companyId, companyId))).limit(1)
      const owner = row?.assignedSalesRepId
        ? { id: row.assignedSalesRepId as string }
        : (await db.select({ id: user.id }).from(user).where(and(eq(user.companyId, companyId), eq(user.role, 'owner'))).limit(1))[0]
      const address = row?.address || row?.title || 'this job'
      await db.insert(claimActivity).values({
        companyId, jobId, claimId: claim.id, userId: null, activityType: 'reminder',
        body: `The roof is done — send ${claim.insuranceCompany} the certificate of completion to release the ${usd(held)} depreciation they are holding.`,
      })
      if (owner?.id) {
        await db.insert(jobNote).values({
          companyId, jobId, userId: owner.id, isInternal: true,
          body: `Reminder: the roof is done and ${claim.insuranceCompany} is holding depreciation on claim ${claim.claimNumber}. Send them the certificate of completion to release it.`,
        } as any)
        await d.phonePush?.send?.(companyId, [owner.id], {
          title: 'Send the certificate of completion',
          body: `${address} is done — ${claim.insuranceCompany} is holding depreciation until they have it.`,
          data: { jobId, claimId: claim.id, kind: 'depreciation_reminder' },
        })
      }
      return true
    } catch (err) {
      d.logger?.warn?.('[roof] depreciation reminder not made', { error: (err as Error).message })
      return false
    }
  }
}
