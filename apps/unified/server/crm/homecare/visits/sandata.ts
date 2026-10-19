// /api/sandata — Sandata alternate EVV: the agency's account, the EVV dashboard, submissions, corrections with reason
// codes, exception acknowledgement, readiness, the queue. Moved from templates/crm-homecare/backend/src/routes/sandata.ts
// (ported there from the CVHC CRM's routes/sandataRoutes.js). Transport, payloads, the queue and the visit records are
// the home-care core's (core/sandataClient.ts, sandataPayload.ts, sandataAutoSubmit.ts, evvVisits.ts, evvWeekly.ts);
// the SQL is in server/data/homecareVisits.ts.
//
// Permissions: every office route was requireAdmin — OFFICE_EVV. The caregiver route, GET /caregiver-context, is
// evv:read, scoped to the signed-in caregiver's own clients and open visit, as before.
//
// Changes: every read and write is the signed-in person's company's (its Sandata account is its own company row);
// replies are camelCase (RULEBOOK §2) — the dashboard's visits, the readiness lists, the queue failures, the caregiver
// context (inSandata, medicaidId, activeVisit.timeEntryId / sandataRequired); a refusal carries no extra fields
// (§3: "submit before an account exists" says where to set it up in its sentence; a failed client sync is a 502
// sentence, not { ok: false, error }).
import { Hono } from 'hono'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { company, evvVisits, clients, timeEntries } from '../../../db/schema/index.ts'
import type { AppEnv } from '../../../http/env.ts'
import { fail, one, done } from '../../../http/reply.ts'
import type { CrmDeps } from '../../deps.ts'
import type { HomecareCore } from '../core/index.ts'
import { encrypt } from '../core/encryption.ts'
import { UAT_BASE, PROD_BASE, postRecords } from '../core/sandataClient.ts'
import { isValidTimezone } from '../core/agencyTime.ts'
import * as payloads from '../core/sandataPayload.ts'
import { evvReasonError, localDate } from '../core/evvVisits.ts'
import { clientInSandata } from '../core/evvWeekly.ts'
import {
  caregiverSandataClients, evvVisitsInRange, evvVisitDetail, visitTimeChangesNamed, sandataScopeClients,
  activeUsersWithWorkerId, careTypeClientCounts, evvStatusCountsSince, clientForSandataSync, recentQueueFailures,
  submissionStatusVisits,
} from '../../../data/homecareVisits.ts'
import { OFFICE_EVV, isCaregiver, who } from './shared.ts'

const isDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)

// Wisconsin DMS payer codes (WI Alt-EVV Addendum v2.6 Appendix 1) — offered as presets to a Wisconsin agency only. Any
// other state enters its own payer's codes.
const WI_PAYER_PRESETS = [
  { label: 'My Choice Wisconsin (Family Care MCO)', sandataPayerId: 'MCFC-CW', sandataPayerProgram: 'WIMCO' },
  { label: 'Inclusa (Family Care MCO)', sandataPayerId: 'INCLUSA', sandataPayerProgram: 'WIMCO' },
  { label: 'Lakeland Care (Family Care MCO)', sandataPayerId: 'LAKELAND', sandataPayerProgram: 'WIMCO' },
  { label: 'Molina (HMO)', sandataPayerId: 'WIMOLINA', sandataPayerProgram: 'WIHMO' },
  { label: 'ForwardHealth fee-for-service', sandataPayerId: 'WIFFS', sandataPayerProgram: 'FFS' },
]

export function createSandataRoutes(core: HomecareCore, d: CrmDeps) {
  const { db } = d
  const { requirePermission } = d.permissions
  const { sandata, autoSubmit, evvVisits: evv } = core
  const app = new Hono<AppEnv>()
  const office = requirePermission(OFFICE_EVV)

  async function dateRange(c: any, companyId: string): Promise<{ start: string; end: string }> {
    const cfg = await sandata.getConfig(companyId)
    const today = localDate(new Date(), cfg.timezone)
    const weekAgo = localDate(new Date(Date.now() - 7 * 86400000), cfg.timezone)
    const qs = c.req.query('startDate'); const qe = c.req.query('endDate')
    return { start: isDate(qs) ? qs : weekAgo, end: isDate(qe) ? qe : today }
  }

  // ─── CAREGIVER: who of MY clients is in Sandata, and my open visit's decision ───────────────
  // The caregiver app uses this for the "check in/out on Sandata too" prompts. A client's Medicaid ID is returned only
  // for clients in Sandata (it is pasted into Sandata Mobile Connect), and only for the caregiver's own clients.
  app.get('/caregiver-context', requirePermission('evv:read'), async (c) => {
    const { companyId, me } = who(c)
    const cfg = await sandata.getConfig(companyId)
    const rows = await caregiverSandataClients(db, companyId, me)
    const clientsOut = rows.map((r: any) => {
      const inSandata = clientInSandata(r)
      return { id: r.id, firstName: r.firstName, lastName: r.lastName, inSandata, medicaidId: inSandata ? String(r.medicaidId).trim() : null }
    })
    const [open] = await db.select({ id: timeEntries.id, clientId: timeEntries.clientId, sandataRequired: timeEntries.sandataRequired })
      .from(timeEntries)
      .where(and(eq(timeEntries.companyId, companyId), eq(timeEntries.caregiverId, me), isNull(timeEntries.endTime)))
      .orderBy(desc(timeEntries.startTime)).limit(1)
    return one(c, {
      sandataAgencyId: cfg.agencyId,
      isWisconsin: cfg.isWisconsin,
      clients: clientsOut,
      activeVisit: open ? { timeEntryId: open.id, clientId: open.clientId, sandataRequired: open.sandataRequired ?? null } : null,
    })
  })

  // ─── AGENCY SANDATA ACCOUNT ─────────────────────────────────────────────────────────────────
  app.get('/settings', office, async (c) => {
    const { companyId } = who(c)
    const [agency] = await db.select().from(company).where(eq(company.id, companyId)).limit(1)
    const cfg = await sandata.getConfig(companyId)
    return one(c, {
      username: agency?.sandataUsername || '',
      hasPassword: !!agency?.sandataPasswordEncrypted,
      accountId: agency?.sandataAccountId || '',
      providerId: agency?.medicaidId || '',
      apiUrl: agency?.sandataApiUrl || '',
      agencyId: agency?.sandataAgencyId || '',
      timezone: agency?.timezone || '',
      effectiveTimezone: cfg.timezone,
      state: cfg.state,
      isWisconsin: cfg.isWisconsin,
      isConfigured: cfg.isConfigured,
      uatUrl: UAT_BASE,
      productionUrl: PROD_BASE,
    })
  })

  app.put('/settings', office, async (c) => {
    const { companyId } = who(c)
    const body = await c.req.json().catch(() => ({})) as Record<string, any>
    const [agency] = await db.select({ id: company.id }).from(company).where(eq(company.id, companyId)).limit(1)
    if (!agency) return fail(c, 404, 'Agency not found')
    const str = (v: unknown) => (v == null ? null : String(v).trim() || null)

    const set: Record<string, any> = { updatedAt: new Date() }
    if ('username' in body) set.sandataUsername = str(body.username)
    if ('accountId' in body) set.sandataAccountId = str(body.accountId)
    if ('providerId' in body) set.medicaidId = str(body.providerId)
    if ('agencyId' in body) set.sandataAgencyId = str(body.agencyId)
    if ('apiUrl' in body) {
      const url = str(body.apiUrl)
      if (url && !/^https:\/\/([a-z0-9-]+\.)*sandata\.com(\/|$)/i.test(url)) {
        return fail(c, 400, 'The Sandata API URL must be an https://…sandata.com address.')
      }
      set.sandataApiUrl = url ? url.replace(/\/+$/, '') : null
    }
    if ('timezone' in body) {
      const tz = str(body.timezone)
      // The agency's one time zone (core/agencyTime.ts) — the same setting as Company settings.
      if (tz && !isValidTimezone(tz)) return fail(c, 400, `"${tz}" is not a time zone (use e.g. America/Chicago).`)
      set.timezone = tz
    }
    // Password: a non-empty value replaces it; clearPassword removes it; absent/blank keeps it.
    if (body.clearPassword === true) set.sandataPasswordEncrypted = null
    else if (typeof body.password === 'string' && body.password.trim()) {
      try { set.sandataPasswordEncrypted = encrypt(body.password.trim()) }
      catch { return fail(c, 400, 'The server has no ENCRYPTION_KEY, so the password cannot be stored safely.') }
    }
    await db.update(company).set(set).where(eq(company.id, agency.id))
    const cfg = await sandata.getConfig(companyId)
    return one(c, { success: true, isConfigured: cfg.isConfigured })
  })

  // The presets fill the payer form's Sandata codes (billing/PayersServiceCodes.tsx), so whoever may write a payer may
  // read them (billing/payers.ts: care-billing:create / update). It was OFFICE_EVV, which an agency's billing seat need
  // not hold — the form's preset picker 403'd for it (found in the browser, 2026-10-19). Static reference data.
  app.get('/payer-presets', d.permissions.requireAnyPermission(['care-billing:create', 'care-billing:update']), async (c) => {
    const cfg = await sandata.getConfig(who(c).companyId)
    return one(c, { state: cfg.state, presets: cfg.isWisconsin ? WI_PAYER_PRESETS : [] })
  })

  // ─── EVV STATUS DASHBOARD ───────────────────────────────────────────────────────────────────
  app.get('/status', office, async (c) => {
    const { companyId } = who(c)
    const cfg = await sandata.getConfig(companyId)
    // Opportunistic: resolve accept/reject for anything POSTed but not yet confirmed, every time an admin opens the
    // dashboard. No-op unconfigured.
    if (cfg.isConfigured) autoSubmit.pollPendingStatuses(companyId).catch((e: any) => d.logger.error('[EVV poll]', { error: e?.message }))
    const { start, end } = await dateRange(c, companyId)
    const visits = await evvVisitsInRange(db, companyId, start, end)
    const by = (s: string) => visits.filter((v: any) => v.sandataStatus === s).length
    const summary = {
      total: visits.length,
      verified: visits.filter((v: any) => v.isVerified).length,
      pending: by('pending'),
      ready: by('ready'),
      submitted: by('submitted'),
      accepted: by('accepted'),
      exceptions: by('exception'),
      needsManual: by('needs_manual'),
      hasIssues: visits.filter((v: any) => Array.isArray(v.verificationIssues) && v.verificationIssues.length > 0).length,
    }
    return one(c, { sandataConfigured: cfg.isConfigured, startDate: start, endDate: end, summary, visits })
  })

  // ─── SUBMIT VISITS (through the queue: one payload builder, one transport, one retry policy) ──
  app.post('/submit', office, async (c) => {
    const { companyId } = who(c)
    const body = await c.req.json().catch(() => ({})) as any
    const cfg = await sandata.getConfig(companyId)
    if (!cfg.isConfigured) {
      return fail(c, 400, 'Sandata credentials not configured. Enter the Sandata account (username, password, account id and the agency Medicaid provider id) under Integrations → EVV.', 'sandata_not_configured')
    }
    const visitIds = body?.visitIds
    if (!Array.isArray(visitIds) || visitIds.length === 0) return fail(c, 400, 'visitIds array required')
    const results: Array<{ visitId: string; queued: boolean; reason: string | null }> = []
    for (const id of visitIds) {
      try {
        const r = await autoSubmit.enqueueVisit(companyId, String(id))
        results.push({ visitId: String(id), queued: r.queued, reason: r.reason || null })
      } catch (e: any) {
        results.push({ visitId: String(id), queued: false, reason: e?.message || 'enqueue failed' })
      }
    }
    return one(c, { queued: results.filter((r) => r.queued).length, results })
  })

  // ─── VISIT DETAIL ───────────────────────────────────────────────────────────────────────────
  app.get('/visit/:id', office, async (c) => {
    const { companyId } = who(c)
    const row = await evvVisitDetail(db, companyId, c.req.param('id'))
    if (!row) return fail(c, 404, 'EVV visit not found')
    const timeChanges = await visitTimeChangesNamed(db, companyId, row.timeEntryId)
    return one(c, { ...row, timeChanges })
  })

  // ─── MANUAL CORRECTION ──────────────────────────────────────────────────────────────────────
  // Setting times by hand is a VisitChanges event: it must carry a reason code and goes out as Adjusted times. A visit
  // already at Sandata is retransmitted with the next sequence.
  app.put('/visit/:id', office, async (c) => {
    const { companyId, me } = who(c)
    const body = await c.req.json().catch(() => ({})) as any
    const { serviceCode, modifier, authorizationId, actualStart, actualEnd, reasonCode, reasonMemo } = body || {}
    const [prev] = await db.select().from(evvVisits).where(and(eq(evvVisits.id, c.req.param('id')), eq(evvVisits.companyId, companyId))).limit(1)
    if (!prev) return fail(c, 404, 'EVV visit not found')

    const parse = (v: unknown) => {
      if (v == null || v === '') return null
      const dt = new Date(v as any)
      return isNaN(dt.getTime()) ? undefined : dt
    }
    const newStart = parse(actualStart)
    const newEnd = parse(actualEnd)
    if (newStart === undefined || newEnd === undefined) return fail(c, 400, 'actualStart / actualEnd must be valid date-times')
    const effStart = newStart || prev.actualStart
    const effEnd = newEnd || prev.actualEnd
    if (effEnd && effStart && effEnd.getTime() <= effStart.getTime()) return fail(c, 400, 'The visit must end after it starts')

    const changingTimes = newStart != null || newEnd != null
    if (changingTimes) {
      const err = evvReasonError(reasonCode, reasonMemo)
      if (err) return fail(c, 400, err.startsWith('reasonCode') ? 'reasonCode required when changing visit times (EVV codes 1,2,3,4,5,7,8)' : err)
      await evv.recordVisitTimeChange(companyId, {
        timeEntryId: prev.timeEntryId,
        changedById: me || null,
        oldStart: newStart ? prev.actualStart : null, newStart: newStart || null,
        oldEnd: newEnd ? prev.actualEnd : null, newEnd: newEnd || null,
        reasonCode: String(reasonCode), memo: reasonMemo,
      })
    }

    const set: Record<string, any> = { updatedAt: new Date() }
    if (serviceCode) set.serviceCode = String(serviceCode)
    if (modifier) set.modifier = String(modifier)
    if (authorizationId) set.authorizationId = String(authorizationId)
    if (newStart) set.actualStart = newStart
    if (newEnd) set.actualEnd = newEnd
    if (prev.sandataStatus === 'exception') set.sandataStatus = 'ready'
    await db.update(evvVisits).set(set).where(and(eq(evvVisits.id, prev.id), eq(evvVisits.companyId, companyId)))

    if (['submitted', 'accepted'].includes(String(prev.sandataStatus))) {
      autoSubmit.requeueChangedVisit(companyId, prev.id).catch((e: any) => d.logger.error('[EVV requeue]', { error: e?.message }))
    }
    return done(c)
  })

  // ─── ACKNOWLEDGE A SANDATA EXCEPTION ────────────────────────────────────────────────────────
  // For exceptions that can't be "fixed" in the data (spec 3.8): the office attests it was reviewed, with a reason
  // code; the visit is resubmitted carrying VisitExceptionAcknowledgement.
  app.post('/visit/:id/acknowledge', office, async (c) => {
    const { companyId, me } = who(c)
    const body = await c.req.json().catch(() => ({})) as any
    const err = evvReasonError(body?.reasonCode, body?.memo)
    if (err) return fail(c, 400, err.startsWith('reasonCode') ? err : `Reason code ${String(body?.reasonCode)} requires a memo`)
    const [visit] = await db.select().from(evvVisits).where(and(eq(evvVisits.id, c.req.param('id')), eq(evvVisits.companyId, companyId))).limit(1)
    if (!visit) return fail(c, 404, 'EVV visit not found')

    await db.update(evvVisits).set({
      exceptionAck: true,
      exceptionAckById: me || null,
      exceptionAckAt: new Date(),
      exceptionAckReason: String(body.reasonCode),
      exceptionAckMemo: String(body?.memo || '').trim().slice(0, 256) || null,
      sandataStatus: ['exception', 'needs_manual'].includes(String(visit.sandataStatus)) ? 'ready' : visit.sandataStatus,
      updatedAt: new Date(),
    }).where(and(eq(evvVisits.id, visit.id), eq(evvVisits.companyId, companyId)))

    autoSubmit.enqueueVisit(companyId, visit.id).catch((e: any) => d.logger.error('[EVV ack enqueue]', { error: e?.message }))
    return done(c)
  })

  // ─── POLL SUBMITTED VISITS FOR ACCEPT/REJECT ────────────────────────────────────────────────
  app.post('/poll-status', office, async (c) => one(c, await autoSubmit.pollPendingStatuses(who(c).companyId)))

  // ─── CERTIFICATION READINESS ────────────────────────────────────────────────────────────────
  // Everything that would make Sandata reject a visit, queryable before credentials exist. In scope: active,
  // non-private-pay clients whose payer is a Sandata payer (or who have no payer).
  app.get('/readiness', office, async (c) => {
    const { companyId } = who(c)
    const cfg = await sandata.getConfig(companyId)
    const clientRows = await sandataScopeClients(db, companyId)
    const clientsWithIssues = clientRows.map((r: any) => {
      const issues: string[] = []
      if (!payloads.MA_ID_RE.test(payloads.digitsOnly(r.medicaidId))) issues.push('missing/invalid Medicaid ID')
      if (!r.payerName) issues.push('no payer assigned')
      else if (!r.sandataPayerId || !r.sandataPayerProgram) issues.push(`payer "${r.payerName}" has no Sandata code`)
      if (!r.defaultServiceCode) issues.push(`care type "${r.careType || 'none'}" has no service code`)
      return { ...r, issues }
    }).filter((r: any) => r.issues.length)

    // The caregivers: active people whose role is the field rung.
    const caregivers = (await activeUsersWithWorkerId(db, companyId))
      .filter((u: any) => isCaregiver(d, u))
      .map(({ role: _role, ...u }: any) => u)
    const caregiversWithIssues = caregivers
      .filter((u: any) => !payloads.WORKER_ID_RE.test(payloads.digitsOnly(u.evvWorkerId)))
      .map((u: any) => ({ ...u, issue: 'missing/invalid EVV worker ID' }))

    const careTypes = await careTypeClientCounts(db, companyId)
    const since = localDate(new Date(Date.now() - 30 * 86400000), cfg.timezone)
    const visitStats = await evvStatusCountsSince(db, companyId, since)

    return one(c, {
      configured: cfg.isConfigured,
      providerIdSet: !!cfg.providerId,
      clientsInScope: clientRows.length,
      clientsWithIssues,
      activeCaregivers: caregivers.length,
      caregiversWithIssues,
      careTypesMissingServiceCode: careTypes.filter((ct: any) => !ct.defaultServiceCode && ct.activeClients > 0),
      visitStatsLast30Days: visitStats,
    })
  })

  // ─── SYNC ONE CLIENT ────────────────────────────────────────────────────────────────────────
  // Force a fresh client-record send (normally automatic before that client's first visit).
  app.post('/sync-client/:clientId', office, async (c) => {
    const { companyId } = who(c)
    const cfg = await sandata.getConfig(companyId)
    if (!cfg.isConfigured) return fail(c, 400, 'Sandata not configured')
    const row = await clientForSandataSync(db, companyId, c.req.param('clientId'))
    if (!row) return fail(c, 404, 'Client not found')
    if (!payloads.MA_ID_RE.test(payloads.digitsOnly(row.medicaidId))) {
      return fail(c, 400, 'Client needs a valid 10-12 digit Medicaid ID first')
    }
    const seq = payloads.nextSequence(row.sandataSequence)
    const payload = payloads.buildClientPayload(row, {
      providerId: cfg.providerId,
      sequence: seq,
      includePayerSegment: !!(row.sandataPayerId && row.address && row.phone),
      timeZone: cfg.sandataTimeZone,
      agencyState: cfg.state,
    })
    try {
      const post = await postRecords(cfg, 'clients', payload)
      if (post.ok && post.uuid) {
        await db.update(clients).set({ sandataSequence: seq, sandataSyncedAt: new Date(), updatedAt: new Date() })
          .where(and(eq(clients.id, row.id), eq(clients.companyId, companyId)))
      }
      return one(c, { ok: post.ok, uuid: post.uuid, data: post.data })
    } catch (e: any) {
      return fail(c, 502, `Sandata could not be reached: ${e?.message || 'network error'}`)
    }
  })

  // ─── QUEUE ──────────────────────────────────────────────────────────────────────────────────
  app.get('/queue', office, async (c) => {
    const { companyId } = who(c)
    const queueStatus = await autoSubmit.getQueueStatus(companyId)
    const recentFailures = await recentQueueFailures(db, companyId)
    return one(c, { queueStatus, recentFailures })
  })

  app.post('/queue/retry/:id', office, async (c) => {
    const ok = await autoSubmit.retrySubmission(who(c).companyId, c.req.param('id'))
    if (!ok) return fail(c, 404, 'No failed submission with that id')
    return done(c, 'Submission re-queued')
  })

  app.get('/submission-status', office, async (c) => {
    const { companyId } = who(c)
    const { start, end } = await dateRange(c, companyId)
    const visits = await submissionStatusVisits(db, companyId, start, end)
    const by = (s: string) => visits.filter((v: any) => v.sandataStatus === s).length
    return one(c, {
      summary: {
        total: visits.length,
        pending: by('pending'), ready: by('ready'), submitted: by('submitted'), accepted: by('accepted'),
        needsManual: by('needs_manual'), exception: by('exception'),
        inQueue: visits.filter((v: any) => v.queueStatus === 'queued' || v.queueStatus === 'processing').length,
      },
      visits,
    })
  })

  // ─── CONFIG STATUS ──────────────────────────────────────────────────────────────────────────
  app.get('/config', office, async (c) => {
    const cfg = await sandata.getConfig(who(c).companyId)
    return one(c, {
      isConfigured: cfg.isConfigured,
      hasUsername: !!cfg.username,
      hasPassword: !!cfg.password,
      hasAccountId: !!cfg.accountId,
      hasProviderId: !!cfg.providerId,
      baseUrl: cfg.baseUrl,
      isWisconsin: cfg.isWisconsin,
      setupInstructions: cfg.isConfigured ? null : {
        step1: 'Start alternate-EVV certification with Sandata for your state and get the agency\'s API credentials.',
        step2: 'Clear the readiness issues (Medicaid IDs, EVV worker IDs, payer codes, service codes).',
        step3: 'Enter the Sandata account under Integrations → EVV: username, password, account id and the agency Medicaid provider id.',
        step4: 'The UAT endpoint is the default; switch the API URL to production at go-live.',
      },
    })
  })

  return app
}
