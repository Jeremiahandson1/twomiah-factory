// Supplement statuses of the company's own, and the tracker across every claim (roofing parity, row 10; docs/parity/
// roof-insurance-extras.md #2 and #3; AccuLynx "Tips for Managing Your Roofing Permits, Mortgage Checks, & Supplements").
// Composed into /api/insurance-extras (./extras.ts), so it is behind the not-ready feature `insurance_extras` like the rest.
//
//   · THE FIXED FOUR STAY. A supplement is draft → submitted → approved / denied (./insurance.ts), and the claim's money, the
//     Xactimate scope, the follow-ups and the trail are all keyed on those. A company's own status (supplement_status: "Under
//     review", "Pending re-inspection", "Need more information from the rep") sits ON TOP of them and never changes them.
//     Each one names the fixed status it sits under (`baseStatus`) and can be put only on a supplement that is in it; when the
//     fixed status moves on, a custom status that no longer fits is cleared (`customStatusAfter`, called by insurance.ts).
//   · THE TRACKER. GET /supplements lists the supplements of every claim in two columns: REQUESTED (a draft — raised, not yet
//     sent to the carrier) and IN PROGRESS (submitted — with the carrier, answer awaited). Approved and denied ones are the
//     claim's record, not work in progress; ?decided=1 adds them for a look back.
//
// Who may: reading the company's statuses is a signed-in seat (the claim page, which the crew reads, draws the label); the
// tracker is the office's (insurance:read, it runs across every claim); putting a status on a supplement is insurance:update;
// defining, renaming, ordering, archiving and deleting the statuses is the company's set-up (settings:update). A figure is the
// books' (invoices:read): a seat without it sees the supplement without the amount, absent and flagged moneyWithheld.
import { Hono } from 'hono'
import { z } from 'zod'
import { and, asc, count, desc, eq, inArray, ne } from 'drizzle-orm'
import { claimActivity, insuranceClaim, job, supplement, supplementStatus } from '../../../db/schema/index.ts'
import { invalid } from '../../../http/errors.ts'
import type { AppEnv } from '../../../http/env.ts'
import { done, fail, listAll, one } from '../../../http/reply.ts'
import type { CrmDeps } from '../../deps.ts'
import { canSeeWith } from '../../deps.ts'

/** The fixed four, as the supplement's `status` holds them, in the order a supplement moves. */
export const FIXED_SUPPLEMENT_STATUSES = ['draft', 'submitted', 'approved', 'denied'] as const
export type FixedSupplementStatus = (typeof FIXED_SUPPLEMENT_STATUSES)[number]
/** What a person calls each of the fixed four — a company's own status may not borrow one of these words. */
export const FIXED_STATUS_WORDS: Record<FixedSupplementStatus, string> = { draft: 'Draft', submitted: 'Submitted', approved: 'Approved', denied: 'Denied' }

/** The tracker's two columns: which fixed status lands in which. A decided supplement is in neither. */
export const TRACKER_COLUMNS = { draft: 'requested', submitted: 'in_progress' } as const
export type TrackerColumn = (typeof TRACKER_COLUMNS)[FixedSupplementStatus & keyof typeof TRACKER_COLUMNS]

const MAX_NAME = 40
const nameKey = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase()

/**
 * What the custom status of a supplement becomes when its fixed status moves to `newFixed`: kept when the status still sits under
 * the new fixed status, cleared when it does not. A patch to spread into the supplement's update. Reads one row; `tx` may be the
 * transaction the move runs in.
 */
export async function customStatusAfter(tx: any, sup: { customStatusId?: string | null }, newFixed: FixedSupplementStatus): Promise<{ customStatusId?: null; customStatusAt?: null }> {
  if (!sup.customStatusId) return {}
  const [s] = await tx.select({ baseStatus: supplementStatus.baseStatus }).from(supplementStatus).where(eq(supplementStatus.id, sup.customStatusId)).limit(1)
  return s && s.baseStatus === newFixed ? {} : { customStatusId: null, customStatusAt: null }
}

const statusFacts = z.object({
  name: z.string().trim().min(1, 'is required').max(MAX_NAME, `must be ${MAX_NAME} letters or fewer`),
  baseStatus: z.enum(FIXED_SUPPLEMENT_STATUSES),
})

export function createSupplementTracker(d: CrmDeps) {
  const { db } = d
  const { requirePermission } = d.permissions
  const canSee = canSeeWith(d.permissions)
  const app = new Hono<AppEnv>()

  const maySeeMoney = async (c: any): Promise<boolean> => {
    const u = c.get('user')
    try { return !!(await canSee(u?.role, 'invoices:read', u?.userId)) } catch { return false }
  }
  const ownStatus = async (companyId: string, id: string) =>
    (await db.select().from(supplementStatus).where(and(eq(supplementStatus.id, id), eq(supplementStatus.companyId, companyId))).limit(1))[0]
  const inUse = async (id: string): Promise<number> =>
    Number((await db.select({ n: count() }).from(supplement).where(eq(supplement.customStatusId, id)))[0]?.n ?? 0)
  /** The name is the company's own and unique among its statuses, archived ones too (read without regard to case or spacing). */
  const nameTaken = async (companyId: string, name: string, exceptId?: string) => {
    const all = await db.select({ id: supplementStatus.id, name: supplementStatus.name }).from(supplementStatus).where(eq(supplementStatus.companyId, companyId))
    return all.some((s: any) => s.id !== exceptId && nameKey(s.name) === nameKey(name))
  }
  const borrowsFixedWord = (name: string) => (Object.values(FIXED_STATUS_WORDS) as string[]).some((w) => nameKey(w) === nameKey(name))
  const present = (s: any) => ({ ...s, archived: !!s.archivedAt })

  // ══════════════════════════════════════════════════════
  // THE COMPANY'S STATUSES
  // ══════════════════════════════════════════════════════

  // In the order the company set, with how many supplements carry each. Archived ones are listed (the claim page still has to
  // name them on the supplements that carry them) — `archived` says which.
  app.get('/supplement-statuses', async (c) => {
    const me = c.get('user')
    const rows = await db.select().from(supplementStatus).where(eq(supplementStatus.companyId, me.companyId))
      .orderBy(asc(supplementStatus.sortOrder), asc(supplementStatus.createdAt), asc(supplementStatus.id))
    const used = await db.select({ id: supplement.customStatusId, n: count() }).from(supplement)
      .where(eq(supplement.companyId, me.companyId)).groupBy(supplement.customStatusId)
    const carried = new Map<string, number>(used.filter((u: any) => u.id).map((u: any) => [u.id as string, u.n as number]))
    return listAll(c, rows.map((s: any) => ({ ...present(s), supplements: Number(carried.get(s.id) ?? 0) })))
  })

  app.post('/supplement-statuses', requirePermission('settings:update'), async (c) => {
    const me = c.get('user')
    const parsed = statusFacts.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return invalid(c, parsed.error)
    const { name, baseStatus } = parsed.data
    if (borrowsFixedWord(name)) return fail(c, 400, `“${name}” is one of the four statuses every supplement already has. Choose a different name.`, 'status_name_taken', { name: 'is already a built-in status' })
    if (await nameTaken(me.companyId, name)) return fail(c, 409, `You already have a supplement status called “${name}”.`, 'status_name_taken', { name: 'is already used' })
    const [last] = await db.select({ n: supplementStatus.sortOrder }).from(supplementStatus).where(eq(supplementStatus.companyId, me.companyId)).orderBy(desc(supplementStatus.sortOrder)).limit(1)
    const [row] = await db.insert(supplementStatus).values({ companyId: me.companyId, name: name.replace(/\s+/g, ' '), baseStatus, sortOrder: (last?.n ?? -1) + 1 }).returning()
    return one(c, { ...present(row), supplements: 0 }, 201)
  })

  // The order, as the whole list of ids. Declared before /:id so "order" is not read as one.
  app.put('/supplement-statuses/order', requirePermission('settings:update'), async (c) => {
    const me = c.get('user')
    const parsed = z.object({ ids: z.array(z.string().min(1)).min(1) }).safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return invalid(c, parsed.error)
    const mine = await db.select({ id: supplementStatus.id }).from(supplementStatus).where(and(eq(supplementStatus.companyId, me.companyId), inArray(supplementStatus.id, parsed.data.ids)))
    if (mine.length !== new Set(parsed.data.ids).size) return fail(c, 404, 'One of those statuses was not found.')
    await db.transaction(async (tx: any) => {
      for (const [i, id] of parsed.data.ids.entries()) {
        await tx.update(supplementStatus).set({ sortOrder: i, updatedAt: new Date() }).where(and(eq(supplementStatus.id, id), eq(supplementStatus.companyId, me.companyId)))
      }
    })
    return done(c)
  })

  // Rename, move under another fixed status, archive or restore. Moving one under a different fixed status clears it from the
  // supplements that carry it and no longer fit, so none is left wearing a status that is not under its fixed one.
  app.put('/supplement-statuses/:id', requirePermission('settings:update'), async (c) => {
    const me = c.get('user')
    const parsed = statusFacts.partial().extend({ archived: z.boolean().optional() }).safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return invalid(c, parsed.error)
    const found = await ownStatus(me.companyId, c.req.param('id'))
    if (!found) return fail(c, 404, 'Supplement status not found')
    const set: Record<string, unknown> = { updatedAt: new Date() }
    const { name, baseStatus, archived } = parsed.data
    if (name !== undefined) {
      if (borrowsFixedWord(name)) return fail(c, 400, `“${name}” is one of the four statuses every supplement already has. Choose a different name.`, 'status_name_taken', { name: 'is already a built-in status' })
      if (await nameTaken(me.companyId, name, found.id)) return fail(c, 409, `You already have a supplement status called “${name}”.`, 'status_name_taken', { name: 'is already used' })
      set.name = name.replace(/\s+/g, ' ')
    }
    if (baseStatus !== undefined) set.baseStatus = baseStatus
    if (archived !== undefined) set.archivedAt = archived ? (found.archivedAt ?? new Date()) : null
    const row = await db.transaction(async (tx: any) => {
      const [updated] = await tx.update(supplementStatus).set(set as any).where(and(eq(supplementStatus.id, found.id), eq(supplementStatus.companyId, me.companyId))).returning()
      if (baseStatus !== undefined && baseStatus !== found.baseStatus) {
        await tx.update(supplement).set({ customStatusId: null, customStatusAt: null, updatedAt: new Date() })
          .where(and(eq(supplement.customStatusId, found.id), ne(supplement.status, baseStatus)))
      }
      return updated
    })
    return one(c, { ...present(row), supplements: await inUse(row.id) })
  })

  // Delete one nothing carries. One that is carried is archived instead (it keeps its name on the supplements that have it).
  app.delete('/supplement-statuses/:id', requirePermission('settings:update'), async (c) => {
    const me = c.get('user')
    const found = await ownStatus(me.companyId, c.req.param('id'))
    if (!found) return fail(c, 404, 'Supplement status not found')
    const n = await inUse(found.id)
    if (n > 0) return fail(c, 409, `${n} supplement${n === 1 ? ' is' : 's are'} marked “${found.name}”. Archive it instead — it keeps its name on those and is not offered again.`, 'status_in_use')
    await db.delete(supplementStatus).where(and(eq(supplementStatus.id, found.id), eq(supplementStatus.companyId, me.companyId)))
    return done(c)
  })

  // ══════════════════════════════════════════════════════
  // ONE SUPPLEMENT'S STATUS
  // ══════════════════════════════════════════════════════

  // Put the company's status on a supplement ({ statusId }), or take it off ({ statusId: null }). A line in the claim's trail
  // either way. The fixed status is not touched.
  app.post('/supplements/:id/custom-status', requirePermission('insurance:update'), async (c) => {
    const me = c.get('user')
    const parsed = z.object({ statusId: z.string().min(1).nullable() }).safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return invalid(c, parsed.error)
    const [sup] = await db.select().from(supplement).where(and(eq(supplement.id, c.req.param('id')), eq(supplement.companyId, me.companyId))).limit(1)
    if (!sup) return fail(c, 404, 'Supplement not found')
    let label = ''
    if (parsed.data.statusId !== null) {
      const status = await ownStatus(me.companyId, parsed.data.statusId)
      if (!status) return fail(c, 404, 'Supplement status not found')
      if (status.archivedAt && sup.customStatusId !== status.id) return fail(c, 409, `“${status.name}” has been archived, so it can no longer be put on a supplement.`, 'status_archived')
      if (status.baseStatus !== sup.status) {
        return fail(c, 409, `“${status.name}” is for a supplement that is ${FIXED_STATUS_WORDS[status.baseStatus as FixedSupplementStatus]?.toLowerCase() ?? status.baseStatus}, and ${sup.supplementNumber} is ${sup.status}.`, 'status_wrong_base')
      }
      label = status.name
    }
    const [updated] = await db.update(supplement).set({ customStatusId: parsed.data.statusId, customStatusAt: parsed.data.statusId ? new Date() : null, updatedAt: new Date() })
      .where(and(eq(supplement.id, sup.id), eq(supplement.companyId, me.companyId))).returning()
    await db.insert(claimActivity).values({
      companyId: me.companyId, jobId: sup.jobId, claimId: sup.claimId, userId: me.userId, activityType: 'supplement',
      body: parsed.data.statusId ? `Supplement ${sup.supplementNumber} marked “${label}”` : `Supplement ${sup.supplementNumber}: company status cleared`,
    })
    return one(c, await withoutMoneyUnlessSeen(c, updated))
  })

  const withoutMoneyUnlessSeen = async (c: any, sup: any) => {
    if (await maySeeMoney(c)) return sup
    const { totalAmount: _t, approvedAmount: _a, lineItems: _l, ...rest } = sup
    return { ...rest, moneyWithheld: true }
  }

  // ══════════════════════════════════════════════════════
  // THE TRACKER ACROSS EVERY CLAIM
  // ══════════════════════════════════════════════════════

  // Every supplement still being worked, oldest first within its column. ?decided=1 adds the approved and the denied;
  // ?statusId= narrows to one of the company's statuses.
  app.get('/supplements', requirePermission('insurance:read'), async (c) => {
    const me = c.get('user')
    const decided = c.req.query('decided') === '1'
    const conditions = [eq(supplement.companyId, me.companyId), inArray(supplement.status, decided ? [...FIXED_SUPPLEMENT_STATUSES] : ['draft', 'submitted'])]
    if (c.req.query('statusId')) conditions.push(eq(supplement.customStatusId, c.req.query('statusId')!))
    const rows = await db.select({
      sup: supplement, claimNumber: insuranceClaim.claimNumber, insuranceCompany: insuranceClaim.insuranceCompany,
      jobNumber: job.number, address: job.address, customName: supplementStatus.name, customArchivedAt: supplementStatus.archivedAt,
    }).from(supplement)
      .innerJoin(insuranceClaim, eq(insuranceClaim.id, supplement.claimId)).innerJoin(job, eq(job.id, supplement.jobId))
      .leftJoin(supplementStatus, eq(supplementStatus.id, supplement.customStatusId))
      .where(and(...conditions)).orderBy(asc(supplement.createdAt), asc(supplement.id))
    const sees = await maySeeMoney(c)
    const now = Date.now()
    const data = rows.map((r: any) => {
      const s = r.sup
      const since = s.status === 'draft' ? s.createdAt : (s.submittedAt ?? s.createdAt)
      const base = {
        id: s.id, supplementNumber: s.supplementNumber, status: s.status, reason: s.reason,
        column: (TRACKER_COLUMNS as Record<string, string>)[s.status] ?? 'decided',
        customStatusId: s.customStatusId ?? null, customStatus: r.customName ?? null, customStatusArchived: !!r.customArchivedAt,
        claimId: s.claimId, jobId: s.jobId, claimNumber: r.claimNumber, insuranceCompany: r.insuranceCompany, jobNumber: r.jobNumber, address: r.address,
        createdAt: s.createdAt, submittedAt: s.submittedAt ?? null,
        daysOpen: since ? Math.max(0, Math.floor((now - new Date(since).getTime()) / 86_400_000)) : 0,
      }
      return sees ? { ...base, totalAmount: s.totalAmount, approvedAmount: s.approvedAmount ?? null } : { ...base, moneyWithheld: true }
    })
    return listAll(c, data)
  })

  return app
}
