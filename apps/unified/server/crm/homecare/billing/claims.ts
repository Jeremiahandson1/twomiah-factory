// Claims management — generate from EVV, the denial queue and resubmission, manual status updates (with idempotent
// authorization deduction on submit), payer routing, 837P / insurer-portal / IRIS exports, and the dashboard summary.
// Moved from templates/crm-homecare/backend/src/routes/claims.ts (ported there from CVHC routes/claimsRoutes.js). The
// claims engine is core/claimsEngine.ts; this file's SQL is in server/data/homecareBillingRoutes.ts.
//
// Who: the template's router was requireAdmin (owner/admin). Reading is care-billing:read (the office manager holds
// it); generating claims is care-billing:create; status changes, submission and the exports (which mark claims
// submitted) are care-billing:update. A caregiver holds none.
//
// Changes from the template: the company's claims only; replies are camelCase, still with CVHC's names beside the
// table's own (chargeAmount = billedAmount, procedureCode = serviceCode, units = unitsBilled, submittedDate =
// submissionDate); the lists are { data, pagination }; the aging buckets are under30 / days30To60 / days60To90 / over90;
// "Cannot submit claim" names its blockers in the sentence (they were a `blockers` field), with code auth_blocked.
import { Hono } from 'hono'
import { and, eq, asc, desc } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import { claims, claimStatusHistory, denialCodeLookup, referralSources, company } from '../../../db/schema/index.ts'
import {
  claimRows, claimsSummaryFigures, denialQueueRows, resubmitDeniedClaim, setClaimStatusRow, claimsForExport,
  markClaimsExported, claimDetail, invoiceForClaim, editClaimNotes,
} from '../../../data/homecareBillingRoutes.ts'
import { generate837P, getProviderInfo } from '../core/edi837Generator.ts'
import { routeClaim, generateMidasExport, generateIRISExport } from '../core/payerRouter.ts'
import { parseClaimPortal } from '../core/portalClaimDays.ts'
import type { HomecareCore } from '../core/index.ts'
import type { CrmDeps } from '../../deps.ts'
import type { AppEnv } from '../../../http/env.ts'
import { fail, one, listAll } from '../../../http/reply.ts'
import { isDate, body, who, download } from './shared.ts'

export const CLAIM_STATUSES = ['draft', 'pending', 'ready', 'submitted', 'accepted', 'paid', 'partial', 'denied', 'voided', 'appealed']

const idsOf = (b: any): string[] => (Array.isArray(b?.claimIds) ? b.claimIds.filter((x: any) => typeof x === 'string' && x) : [])

export function createClaimRoutes(core: HomecareCore, d: CrmDeps) {
  const { db } = d
  const { requirePermission } = d.permissions
  const engine = core.claims
  const app = new Hono<AppEnv>()
  const read = requirePermission('care-billing:read')
  const create = requirePermission('care-billing:create')
  const update = requirePermission('care-billing:update')

  async function agencyRow(companyId: string) {
    const [a] = await db.select().from(company).where(eq(company.id, companyId)).limit(1)
    return a || null
  }

  async function history(companyId: string, claimId: string, status: string, notes: string | null, userId: string | null) {
    await db.insert(claimStatusHistory).values({ companyId, claimId, status, notes, createdBy: userId })
  }

  // GET / — claims, newest first (500 max), filtered by status / payer / service dates. A list reply.
  app.get('/', read, async (c) => {
    const { status, payerId, startDate, endDate } = c.req.query()
    const rows = await claimRows(db, who(c).companyId, { status, payerId, startDate, endDate })
    return listAll(c, rows)
  })

  // GET /reports/summary — status rollup, by payer, aging of what is out, A/R, paid this month, denied.
  app.get('/reports/summary', read, async (c) => {
    const f = await claimsSummaryFigures(db, who(c).companyId)
    return one(c, {
      byStatus: f.byStatus, byPayer: f.byPayer, aging: f.aging, totalAR: Number(f.ar?.totalAr || 0), paidThisMonth: f.paidThisMonth, deniedClaims: f.denied,
      // the template's earlier summary fields, kept for its dashboard tiles
      totalClaims: f.totals.n, totalBilled: Number(f.totals.billed), totalPaid: Number(f.totals.paid),
      outstanding: Number((Number(f.totals.billed) - Number(f.totals.paid)).toFixed(2)),
    })
  })

  // GET /denial-queue — denied claims with the denial code's description and its usual fix. A list reply.
  app.get('/denial-queue', read, async (c) => {
    const rows = await denialQueueRows(db, who(c).companyId)
    return listAll(c, rows)
  })

  // GET /lookup/denial-codes — a list reply.
  app.get('/lookup/denial-codes', read, async (c) => {
    const rows = await db.select().from(denialCodeLookup).where(eq(denialCodeLookup.companyId, who(c).companyId)).orderBy(asc(denialCodeLookup.code))
    return listAll(c, rows)
  })

  // POST /:id/resubmit — a denied claim becomes a new pending claim; the original is voided.
  app.post('/:id/resubmit', create, async (c) => {
    const { companyId, userId } = who(c)
    const id = c.req.param('id')
    const newId = createId()
    const out = await db.transaction(async (tx: any) => {
      const r = await resubmitDeniedClaim(tx, companyId, id, newId, userId)
      if (!r) return null
      await tx.insert(claimStatusHistory).values({ companyId, claimId: newId, status: 'pending', notes: `Resubmitted from denied claim ${r.claimNumber}`, createdBy: userId })
      return r.fresh
    })
    if (!out) return fail(c, 404, 'Denied claim not found')
    return one(c, out, 201)
  })

  // POST /from-evv (and the template's older /generate-from-evv) — one draft claim from an EVV visit.
  const fromEvv = async (c: any) => {
    const { companyId, userId } = who(c)
    const { evvVisitId } = await body(c)
    if (!evvVisitId) return fail(c, 400, 'EVV visit ID is required')
    try {
      return one(c, await engine.generateClaimFromEVV(companyId, evvVisitId, userId), 201)
    } catch (e: any) {
      return fail(c, e?.status === 404 ? 404 : 400, e.message)
    }
  }
  app.post('/from-evv', create, fromEvv)
  app.post('/generate-from-evv', create, fromEvv)

  // POST /batch-generate — draft claims for every claimable visit in the range.
  app.post('/batch-generate', create, async (c) => {
    const { companyId, userId } = who(c)
    const { startDate, endDate } = await body(c)
    if (!isDate(startDate) || !isDate(endDate)) return fail(c, 400, 'Start date and end date are required')
    return one(c, await engine.batchGenerateClaims(companyId, startDate, endDate, userId))
  })

  /**
   * Set a claim's status with its side effects: submitted/accepted/paid dates, paid amount, denial code/reason, EOB
   * notes; on submission the authorization's units are deducted ONCE. Returns the refusal, or whether units were deducted.
   */
  async function setClaimStatus(c: any, claimId: string, b: any, historyNote: string | null): Promise<Response | { unitsDeducted: boolean }> {
    const { companyId, userId } = who(c)
    const status = b.status
    if (!CLAIM_STATUSES.includes(status)) return fail(c, 400, `status must be one of ${CLAIM_STATUSES.join(', ')}`)
    const paid = b.paidAmount != null && b.paidAmount !== '' ? Number(b.paidAmount) : null
    if (paid != null && (!Number.isFinite(paid) || paid < 0)) return fail(c, 400, 'paidAmount must be a non-negative number')
    const found = await setClaimStatusRow(db, companyId, claimId, {
      status, paidAmount: paid, denialCode: b.denialCode || null, denialReason: b.denialReason || null, eobNotes: b.eobNotes || null,
    })
    if (!found) return fail(c, 404, 'Claim not found')
    await history(companyId, claimId, status,
      historyNote ?? `Manual status update${b.denialCode ? ` (${b.denialCode})` : ''}${b.denialReason ? `: ${b.denialReason}` : ''}`, userId)
    let unitsDeducted = false
    if (status === 'submitted') unitsDeducted = await engine.deductAuthorizationUnits(companyId, claimId)
    return { unitsDeducted }
  }
  const statusReply = (c: any, r: Response | { unitsDeducted: boolean }) => (r instanceof Response ? r : one(c, { success: true, unitsDeducted: r.unitsDeducted }))

  // POST /update-status { claimId, status, … }
  app.post('/update-status', update, async (c) => {
    const b = await body(c)
    if (!b.claimId || !b.status) return fail(c, 400, 'claimId and status are required')
    return statusReply(c, await setClaimStatus(c, b.claimId, b, null))
  })
  // PUT /:id/status { status, notes, … }
  app.put('/:id/status', update, async (c) => {
    const b = await body(c)
    return statusReply(c, await setClaimStatus(c, c.req.param('id'), b, b.notes || null))
  })

  // GET /:id/auth-check
  app.get('/:id/auth-check', read, async (c) => one(c, await engine.checkAuthorizationForSubmission(who(c).companyId, c.req.param('id'))))

  // POST /:id/submit — refuses when the authorization blocks it; deducts its units once.
  app.post('/:id/submit', update, async (c) => {
    const { companyId } = who(c)
    const id = c.req.param('id')
    const check = await engine.checkAuthorizationForSubmission(companyId, id)
    if (check.blockers?.includes('Claim not found')) return fail(c, 404, 'Claim not found')
    if (!check.canSubmit) return fail(c, 400, `Cannot submit claim: ${check.blockers.join(' ')}`, 'auth_blocked')
    const r = await setClaimStatus(c, id, { status: 'submitted' },
      check.warnings.length ? `Submitted with warnings: ${check.warnings.join('; ')}` : 'Claim submitted')
    if (r instanceof Response) return r
    const [claim] = await db.select().from(claims).where(and(eq(claims.id, id), eq(claims.companyId, companyId))).limit(1)
    return one(c, { claim, warnings: check.warnings })
  })

  // GET /:id/route — where this claim's payer submits.
  app.get('/:id/route', read, async (c) => {
    const { companyId } = who(c)
    const [row] = await db.select({ rs: referralSources }).from(claims)
      .innerJoin(referralSources, eq(claims.payerId, referralSources.id))
      .where(and(eq(claims.id, c.req.param('id')), eq(claims.companyId, companyId))).limit(1)
    if (!row) return fail(c, 404, 'Claim or payer not found')
    return one(c, routeClaim(row.rs as any))
  })

  // GET /:id/history — a list reply.
  app.get('/:id/history', read, async (c) => {
    const rows = await db.select().from(claimStatusHistory)
      .where(and(eq(claimStatusHistory.claimId, c.req.param('id')), eq(claimStatusHistory.companyId, who(c).companyId)))
      .orderBy(desc(claimStatusHistory.createdAt))
    return listAll(c, rows)
  })

  // POST /export/837p — an EDI 837P file for the selected claims; they become submitted and their authorization units
  // are deducted (once each).
  app.post('/export/837p', update, async (c) => {
    const { companyId } = who(c)
    const ids = idsOf(await body(c))
    if (!ids.length) return fail(c, 400, 'No claims selected')
    const rows = await claimsForExport(db, companyId, ids)
    if (!rows.length) return fail(c, 400, 'No claims found')
    const provider = getProviderInfo((await agencyRow(companyId)) as any)
    const payer = { name: rows[0].payerName || 'PAYER', ediPayerId: rows[0].ediPayerId || '', npi: rows[0].payerNpi || '' }
    const edi = generate837P({ claims: rows as any, provider, payer, interchangeControlNum: Date.now() } as any)
    await markClaimsExported(db, companyId, ids, 'edi837')
    for (const cl of rows) { try { await engine.deductAuthorizationUnits(companyId, cl.id) } catch { /* non-fatal, as in CVHC */ } }
    return download(c, 'text/plain', `claims-837p-${Date.now()}.edi`, edi)
  })

  // POST /export/portal (and CVHC's /export/midas) — the insurer-portal upload packet for the selected claims, titled
  // with their payer's configured portal.
  const portalExport = async (c: any) => {
    const { companyId } = who(c)
    const ids = idsOf(await body(c))
    if (!ids.length) return fail(c, 400, 'No claims selected')
    const rows = await claimsForExport(db, companyId, ids)
    if (!rows.length) return fail(c, 400, 'No claims found')
    const portals = [...new Set(rows.map((cl) => parseClaimPortal(cl.claimPortal)?.name || null))]
    const portalName = portals.length === 1 && portals[0] ? portals[0] : 'Insurer Portal'
    const csv = generateMidasExport(rows as any, getProviderInfo((await agencyRow(companyId)) as any), portalName)
    await markClaimsExported(db, companyId, ids, 'portal_export')
    return download(c, 'text/csv', `${portalName.replace(/[^A-Za-z0-9]+/g, '-')}-Upload-Packet-${await core.time.today(companyId)}.csv`, csv)
  }
  app.post('/export/portal', update, portalExport)
  app.post('/export/midas', update, portalExport)

  // POST /export/iris — the IRIS FEA export.
  app.post('/export/iris', update, async (c) => {
    const { companyId } = who(c)
    const ids = idsOf(await body(c))
    if (!ids.length) return fail(c, 400, 'No claims selected')
    const rows = await claimsForExport(db, companyId, ids)
    if (!rows.length) return fail(c, 400, 'No claims found')
    const csv = generateIRISExport(rows as any)
    await markClaimsExported(db, companyId, ids, 'iris_export')
    return download(c, 'text/csv', `IRIS-FEA-Export-${await core.time.today(companyId)}.csv`, csv)
  })

  // GET /:id — one claim with its payer, client, invoice, authorization, denial lookup and history.
  app.get('/:id', read, async (c) => {
    const { companyId } = who(c)
    const id = c.req.param('id')
    const claim = await claimDetail(db, companyId, id)
    if (!claim) return fail(c, 404, 'Claim not found')
    const statusHistory = await db.select().from(claimStatusHistory)
      .where(and(eq(claimStatusHistory.claimId, id), eq(claimStatusHistory.companyId, companyId)))
      .orderBy(desc(claimStatusHistory.createdAt))
    return one(c, { ...claim, statusHistory })
  })

  // POST / — a draft claim from an invoice (CVHC "create claim from invoice").
  app.post('/', create, async (c) => {
    const { companyId, userId } = who(c)
    const b = await body(c)
    if (!b.invoiceId) return fail(c, 400, 'invoiceId is required')
    const inv = await invoiceForClaim(db, companyId, b.invoiceId)
    if (!inv) return fail(c, 404, 'Invoice not found')
    const units = Math.round(Number(inv.hours) * 4 * 100) / 100 // 15-minute units
    // The dates of service are the invoice's LINES, not its billing period: the claim's service_date is the first day
    // served (837P and the portal exports read it).
    const [claim] = await db.insert(claims).values({
      companyId,
      invoiceId: inv.id,
      claimNumber: `CLM-${Date.now().toString(36).toUpperCase()}`,
      payerId: inv.payerId,
      payerType: inv.payerType || null,
      clientId: inv.clientId,
      serviceDate: inv.firstDay || inv.s,
      serviceDateFrom: inv.firstDay || inv.s,
      serviceDateTo: inv.lastDay || inv.e,
      placeOfService: b.placeOfService || '12',
      serviceCode: b.procedureCode || null,
      modifier: b.modifier || null,
      diagnosisCode: b.diagnosisCode || null,
      unitsBilled: String(units),
      billedAmount: String(inv.total),
      status: 'draft',
      createdById: userId,
    }).returning()
    await history(companyId, claim.id, 'draft', 'Claim created', userId)
    return one(c, claim, 201)
  })

  // PATCH /:id — the template's older edit path, kept to the fields an office edits by hand.
  app.patch('/:id', update, async (c) => {
    const b = await body(c)
    if (b.status) return statusReply(c, await setClaimStatus(c, c.req.param('id'), b, b.statusNotes || null))
    const r = await editClaimNotes(db, who(c).companyId, c.req.param('id'), { notes: b.notes ?? null, eobNotes: b.eobNotes ?? null, checkNumber: b.checkNumber ?? null })
    if (!r) return fail(c, 404, 'Claim not found')
    return one(c, r)
  })

  return app
}
