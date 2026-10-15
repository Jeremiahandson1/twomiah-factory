// routes/sandata.ts — Sandata alternate-EVV (ported from the CVHC CRM's routes/sandataRoutes.js).
//
// Transport and payloads live in services/sandataClient.ts and services/sandataPayload.ts; the
// queue in services/sandataAutoSubmit.ts; visit records and the time-change log in
// services/evvVisits.ts; the weekly EVV allowance in services/evvWeekly.ts.
//
// Auth: every office route is `requireAdmin` on the route itself. The one caregiver route,
// GET /caregiver-context, is scoped to the signed-in user's own clients and open visit.
import { Hono } from 'hono'
import { sql, eq } from 'drizzle-orm'
import { db } from '../../db/index.ts'
import { agencies, evvVisits, clients } from '../../db/schema.ts'
import { authenticate, requireAdmin } from '../middleware/auth.ts'
import { encrypt } from '../utils/encryption.ts'
import { getConfig, postRecords, UAT_BASE, PROD_BASE } from '../services/sandataClient.ts'
import { isValidTimezone } from '../services/agencyTime.ts'
import * as payloads from '../services/sandataPayload.ts'
import { evvReasonError, recordVisitTimeChange, localDate } from '../services/evvVisits.ts'
import { clientInSandata } from '../services/evvWeekly.ts'
import {
  enqueueVisit, pollPendingStatuses, requeueChangedVisit, getQueueStatus, retrySubmission,
} from '../services/sandataAutoSubmit.ts'

const app = new Hono()
app.use('*', authenticate)

const rowsOf = (r: any): any[] => (r && Array.isArray(r.rows) ? r.rows : Array.isArray(r) ? r : [])
const isDate = (s: unknown) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)

async function dateRange(c: any): Promise<{ start: string; end: string }> {
  const cfg = await getConfig()
  const today = localDate(new Date(), cfg.timezone)
  const weekAgo = localDate(new Date(Date.now() - 7 * 86400000), cfg.timezone)
  const qs = c.req.query('startDate'); const qe = c.req.query('endDate')
  return { start: isDate(qs) ? qs : weekAgo, end: isDate(qe) ? qe : today }
}

// Wisconsin DMS payer codes (WI Alt-EVV Addendum v2.6 Appendix 1) — offered as presets to a
// Wisconsin agency only. Any other state enters its own payer's codes.
const WI_PAYER_PRESETS = [
  { label: 'My Choice Wisconsin (Family Care MCO)', sandataPayerId: 'MCFC-CW', sandataPayerProgram: 'WIMCO' },
  { label: 'Inclusa (Family Care MCO)', sandataPayerId: 'INCLUSA', sandataPayerProgram: 'WIMCO' },
  { label: 'Lakeland Care (Family Care MCO)', sandataPayerId: 'LAKELAND', sandataPayerProgram: 'WIMCO' },
  { label: 'Molina (HMO)', sandataPayerId: 'WIMOLINA', sandataPayerProgram: 'WIHMO' },
  { label: 'ForwardHealth fee-for-service', sandataPayerId: 'WIFFS', sandataPayerProgram: 'FFS' },
]

// ─── CAREGIVER: who of MY clients is in Sandata, and my open visit's decision ─────────────────
// The caregiver app uses this for the "check in/out on Sandata too" prompts. A client's Medicaid
// ID is returned only for clients in Sandata (it is pasted into Sandata Mobile Connect), and only
// for the caregiver's own clients.
app.get('/caregiver-context', async (c) => {
  const user = c.get('user') as any
  const userId = String(user?.userId || user?.id || '')
  const cfg = await getConfig()
  const rows = rowsOf(await db.execute(sql`
    SELECT c.id, c.first_name, c.last_name, c.is_private_pay, c.medicaid_id, rs.sandata_evv_required
      FROM clients c
      LEFT JOIN referral_sources rs ON rs.id = c.referred_by_id
     WHERE c.is_active = true
       AND (EXISTS (SELECT 1 FROM client_assignments ca
                     WHERE ca.client_id = c.id AND ca.caregiver_id = ${userId} AND ca.status = 'active')
            OR EXISTS (SELECT 1 FROM schedules s
                        WHERE s.client_id = c.id AND s.caregiver_id = ${userId} AND s.is_active = true))
     ORDER BY c.first_name, c.last_name`))
  const clientsOut = rows.map((r: any) => {
    const inSandata = clientInSandata(r)
    return { id: r.id, first_name: r.first_name, last_name: r.last_name, in_sandata: inSandata, medicaid_id: inSandata ? String(r.medicaid_id).trim() : null }
  })
  const open = rowsOf(await db.execute(sql`
    SELECT id, client_id, sandata_required FROM time_entries
     WHERE caregiver_id = ${userId} AND end_time IS NULL
     ORDER BY start_time DESC LIMIT 1`))[0]
  return c.json({
    sandataAgencyId: cfg.agencyId,
    isWisconsin: cfg.isWisconsin,
    clients: clientsOut,
    activeVisit: open ? { time_entry_id: open.id, client_id: open.client_id, sandata_required: open.sandata_required ?? null } : null,
  })
})

// ─── AGENCY SANDATA ACCOUNT ───────────────────────────────────────────────────────────────────
app.get('/settings', requireAdmin, async (c) => {
  const [agency] = await db.select().from(agencies).limit(1)
  const cfg = await getConfig()
  return c.json({
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

app.put('/settings', requireAdmin, async (c) => {
  const body = await c.req.json().catch(() => ({})) as Record<string, any>
  const [agency] = await db.select().from(agencies).limit(1)
  if (!agency) return c.json({ error: 'Agency not found' }, 404)
  const str = (v: unknown) => (v == null ? null : String(v).trim() || null)

  const set: Record<string, any> = { updatedAt: new Date() }
  if ('username' in body) set.sandataUsername = str(body.username)
  if ('accountId' in body) set.sandataAccountId = str(body.accountId)
  if ('providerId' in body) set.medicaidId = str(body.providerId)
  if ('agencyId' in body) set.sandataAgencyId = str(body.agencyId)
  if ('apiUrl' in body) {
    const url = str(body.apiUrl)
    if (url && !/^https:\/\/([a-z0-9-]+\.)*sandata\.com(\/|$)/i.test(url)) {
      return c.json({ error: 'The Sandata API URL must be an https://…sandata.com address.' }, 400)
    }
    set.sandataApiUrl = url ? url.replace(/\/+$/, '') : null
  }
  if ('timezone' in body) {
    const tz = str(body.timezone)
    // The agency's one time zone (services/agencyTime.ts) — the same setting as Company settings.
    if (tz && !isValidTimezone(tz)) return c.json({ error: `"${tz}" is not a time zone (use e.g. America/Chicago).` }, 400)
    set.timezone = tz
  }
  // Password: a non-empty value replaces it; clearPassword removes it; absent/blank keeps it.
  if (body.clearPassword === true) set.sandataPasswordEncrypted = null
  else if (typeof body.password === 'string' && body.password.trim()) {
    try { set.sandataPasswordEncrypted = encrypt(body.password.trim()) }
    catch { return c.json({ error: 'The server has no ENCRYPTION_KEY, so the password cannot be stored safely.' }, 400) }
  }
  await db.update(agencies).set(set).where(eq(agencies.id, agency.id))
  const cfg = await getConfig()
  return c.json({ success: true, isConfigured: cfg.isConfigured })
})

app.get('/payer-presets', requireAdmin, async (c) => {
  const cfg = await getConfig()
  return c.json({ state: cfg.state, presets: cfg.isWisconsin ? WI_PAYER_PRESETS : [] })
})

// ─── EVV STATUS DASHBOARD ─────────────────────────────────────────────────────────────────────
app.get('/status', requireAdmin, async (c) => {
  const cfg = await getConfig()
  // Opportunistic: resolve accept/reject for anything POSTed but not yet confirmed, every time an
  // admin opens the dashboard. No-op unconfigured.
  if (cfg.isConfigured) pollPendingStatuses().catch((e) => console.error('[EVV poll]', e?.message))
  const { start, end } = await dateRange(c)
  const visits = rowsOf(await db.execute(sql`
    SELECT ev.*,
           c.first_name AS client_first, c.last_name AS client_last, c.medicaid_id,
           u.first_name AS cg_first, u.last_name AS cg_last,
           cp.evv_worker_id, cp.npi_number
      FROM evv_visits ev
      JOIN clients c ON ev.client_id = c.id
      JOIN users u ON ev.caregiver_id = u.id
      LEFT JOIN caregiver_profiles cp ON cp.caregiver_id = u.id
     WHERE ev.service_date BETWEEN ${start}::date AND ${end}::date
     ORDER BY ev.service_date DESC, ev.actual_start DESC`))
  const by = (s: string) => visits.filter((v: any) => v.sandata_status === s).length
  const summary = {
    total: visits.length,
    verified: visits.filter((v: any) => v.is_verified).length,
    pending: by('pending'),
    ready: by('ready'),
    submitted: by('submitted'),
    accepted: by('accepted'),
    exceptions: by('exception'),
    needsManual: by('needs_manual'),
    hasIssues: visits.filter((v: any) => Array.isArray(v.verification_issues) && v.verification_issues.length > 0).length,
  }
  return c.json({ sandataConfigured: cfg.isConfigured, startDate: start, endDate: end, summary, visits })
})

// ─── SUBMIT VISITS (through the queue: one payload builder, one transport, one retry policy) ──
app.post('/submit', requireAdmin, async (c) => {
  const body = await c.req.json().catch(() => ({})) as any
  const cfg = await getConfig()
  if (!cfg.isConfigured) {
    return c.json({ error: 'Sandata credentials not configured', setup: 'Enter the Sandata account (username, password, account id and the agency Medicaid provider id) under Integrations → EVV.' }, 400)
  }
  const visitIds = body?.visitIds
  if (!Array.isArray(visitIds) || visitIds.length === 0) return c.json({ error: 'visitIds array required' }, 400)
  const results: Array<{ visitId: string; queued: boolean; reason: string | null }> = []
  for (const id of visitIds) {
    try {
      const r = await enqueueVisit(String(id))
      results.push({ visitId: String(id), queued: r.queued, reason: r.reason || null })
    } catch (e: any) {
      results.push({ visitId: String(id), queued: false, reason: e?.message || 'enqueue failed' })
    }
  }
  return c.json({ queued: results.filter((r) => r.queued).length, results })
})

// ─── VISIT DETAIL ─────────────────────────────────────────────────────────────────────────────
app.get('/visit/:id', requireAdmin, async (c) => {
  const row = rowsOf(await db.execute(sql`
    SELECT ev.*,
           c.first_name AS client_first, c.last_name AS client_last, c.medicaid_id, c.evv_client_id,
           u.first_name AS cg_first, u.last_name AS cg_last,
           cp.evv_worker_id, cp.npi_number,
           a.auth_number, a.authorized_units, a.used_units, a.end_date AS auth_expires
      FROM evv_visits ev
      JOIN clients c ON ev.client_id = c.id
      JOIN users u ON ev.caregiver_id = u.id
      LEFT JOIN caregiver_profiles cp ON cp.caregiver_id = u.id
      LEFT JOIN authorizations a ON ev.authorization_id = a.id
     WHERE ev.id = ${c.req.param('id')}`))[0]
  if (!row) return c.json({ error: 'EVV visit not found' }, 404)
  const changes = rowsOf(await db.execute(sql`
    SELECT vtc.*, u.first_name AS changed_by_first, u.last_name AS changed_by_last
      FROM visit_time_changes vtc LEFT JOIN users u ON u.id = vtc.changed_by_id
     WHERE vtc.time_entry_id = ${row.time_entry_id}
     ORDER BY vtc.changed_at ASC`))
  return c.json({ ...row, time_changes: changes })
})

// ─── MANUAL CORRECTION ────────────────────────────────────────────────────────────────────────
// Setting times by hand is a VisitChanges event: it must carry a reason code and goes out as
// Adjusted times. A visit already at Sandata is retransmitted with the next sequence.
app.put('/visit/:id', requireAdmin, async (c) => {
  const user = c.get('user') as any
  const body = await c.req.json().catch(() => ({})) as any
  const { serviceCode, modifier, authorizationId, actualStart, actualEnd, reasonCode, reasonMemo } = body || {}
  const [prev] = await db.select().from(evvVisits).where(eq(evvVisits.id, c.req.param('id'))).limit(1)
  if (!prev) return c.json({ error: 'EVV visit not found' }, 404)

  const parse = (v: unknown) => {
    if (v == null || v === '') return null
    const d = new Date(v as any)
    return isNaN(d.getTime()) ? undefined : d
  }
  const newStart = parse(actualStart)
  const newEnd = parse(actualEnd)
  if (newStart === undefined || newEnd === undefined) return c.json({ error: 'actualStart / actualEnd must be valid date-times' }, 400)
  const effStart = newStart || prev.actualStart
  const effEnd = newEnd || prev.actualEnd
  if (effEnd && effStart && effEnd.getTime() <= effStart.getTime()) return c.json({ error: 'The visit must end after it starts' }, 400)

  const changingTimes = newStart != null || newEnd != null
  if (changingTimes) {
    const err = evvReasonError(reasonCode, reasonMemo)
    if (err) return c.json({ error: err.startsWith('reasonCode') ? 'reasonCode required when changing visit times (EVV codes 1,2,3,4,5,7,8)' : err }, 400)
    await recordVisitTimeChange({
      timeEntryId: prev.timeEntryId,
      changedById: user?.userId || null,
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
  await db.update(evvVisits).set(set).where(eq(evvVisits.id, prev.id))

  if (['submitted', 'accepted'].includes(prev.sandataStatus)) {
    requeueChangedVisit(prev.id).catch((e) => console.error('[EVV requeue]', e?.message))
  }
  return c.json({ success: true })
})

// ─── ACKNOWLEDGE A SANDATA EXCEPTION ──────────────────────────────────────────────────────────
// For exceptions that can't be "fixed" in the data (spec 3.8): the office attests it was
// reviewed, with a reason code; the visit is resubmitted carrying VisitExceptionAcknowledgement.
app.post('/visit/:id/acknowledge', requireAdmin, async (c) => {
  const user = c.get('user') as any
  const body = await c.req.json().catch(() => ({})) as any
  const err = evvReasonError(body?.reasonCode, body?.memo)
  if (err) return c.json({ error: err.startsWith('reasonCode') ? err : `Reason code ${String(body?.reasonCode)} requires a memo` }, 400)
  const [visit] = await db.select().from(evvVisits).where(eq(evvVisits.id, c.req.param('id'))).limit(1)
  if (!visit) return c.json({ error: 'EVV visit not found' }, 404)

  await db.update(evvVisits).set({
    exceptionAck: true,
    exceptionAckById: user?.userId || null,
    exceptionAckAt: new Date(),
    exceptionAckReason: String(body.reasonCode),
    exceptionAckMemo: String(body?.memo || '').trim().slice(0, 256) || null,
    sandataStatus: ['exception', 'needs_manual'].includes(visit.sandataStatus) ? 'ready' : visit.sandataStatus,
    updatedAt: new Date(),
  }).where(eq(evvVisits.id, visit.id))

  enqueueVisit(visit.id).catch((e) => console.error('[EVV ack enqueue]', e?.message))
  return c.json({ success: true })
})

// ─── POLL SUBMITTED VISITS FOR ACCEPT/REJECT ──────────────────────────────────────────────────
app.post('/poll-status', requireAdmin, async (c) => c.json(await pollPendingStatuses()))

// ─── CERTIFICATION READINESS ──────────────────────────────────────────────────────────────────
// Everything that would make Sandata reject a visit, queryable before credentials exist.
// In scope: active, non-private-pay clients whose payer is a Sandata payer (or who have no payer).
app.get('/readiness', requireAdmin, async (c) => {
  const cfg = await getConfig()
  const clientRows = rowsOf(await db.execute(sql`
    SELECT c.id, c.first_name, c.last_name, c.medicaid_id,
           rs.name AS payer_name, rs.sandata_payer_id, rs.sandata_payer_program,
           ct.name AS care_type, ct.default_service_code
      FROM clients c
      LEFT JOIN referral_sources rs ON rs.id = c.referred_by_id
      LEFT JOIN care_types ct ON ct.id = c.care_type_id
     WHERE c.is_active = true
       AND COALESCE(c.is_private_pay, false) = false
       AND (rs.id IS NULL OR rs.sandata_evv_required = true OR NULLIF(TRIM(rs.sandata_payer_id), '') IS NOT NULL)
     ORDER BY c.last_name, c.first_name`))
  const clientsWithIssues = clientRows.map((r: any) => {
    const issues: string[] = []
    if (!payloads.MA_ID_RE.test(payloads.digitsOnly(r.medicaid_id))) issues.push('missing/invalid Medicaid ID')
    if (!r.payer_name) issues.push('no payer assigned')
    else if (!r.sandata_payer_id || !r.sandata_payer_program) issues.push(`payer "${r.payer_name}" has no Sandata code`)
    if (!r.default_service_code) issues.push(`care type "${r.care_type || 'none'}" has no service code`)
    return { ...r, issues }
  }).filter((r: any) => r.issues.length)

  const caregivers = rowsOf(await db.execute(sql`
    SELECT u.id, u.first_name, u.last_name, cp.evv_worker_id
      FROM users u LEFT JOIN caregiver_profiles cp ON cp.caregiver_id = u.id
     WHERE u.role = 'caregiver' AND u.is_active = true
     ORDER BY u.last_name, u.first_name`))
  const caregiversWithIssues = caregivers
    .filter((u: any) => !payloads.WORKER_ID_RE.test(payloads.digitsOnly(u.evv_worker_id)))
    .map((u: any) => ({ ...u, issue: 'missing/invalid EVV worker ID' }))

  const careTypes = rowsOf(await db.execute(sql`
    SELECT ct.name, ct.default_service_code, COUNT(c.id)::int AS active_clients
      FROM care_types ct
      LEFT JOIN clients c ON c.care_type_id = ct.id AND c.is_active = true
     GROUP BY ct.id, ct.name, ct.default_service_code
     ORDER BY active_clients DESC`))

  const since = localDate(new Date(Date.now() - 30 * 86400000), cfg.timezone)
  const visitStats = rowsOf(await db.execute(sql`
    SELECT sandata_status, COUNT(*)::int AS n
      FROM evv_visits WHERE service_date >= ${since}::date
     GROUP BY sandata_status`))

  return c.json({
    configured: cfg.isConfigured,
    providerIdSet: !!cfg.providerId,
    clientsInScope: clientRows.length,
    clientsWithIssues,
    activeCaregivers: caregivers.length,
    caregiversWithIssues,
    careTypesMissingServiceCode: careTypes.filter((ct: any) => !ct.default_service_code && ct.active_clients > 0),
    visitStatsLast30Days: visitStats,
  })
})

// ─── SYNC ONE CLIENT ──────────────────────────────────────────────────────────────────────────
// Force a fresh client-record send (normally automatic before that client's first visit).
app.post('/sync-client/:clientId', requireAdmin, async (c) => {
  const cfg = await getConfig()
  if (!cfg.isConfigured) return c.json({ error: 'Sandata not configured' }, 400)
  const row = rowsOf(await db.execute(sql`
    SELECT c.*, rs.sandata_payer_id, rs.sandata_payer_program, ct.default_service_code
      FROM clients c
      LEFT JOIN referral_sources rs ON rs.id = c.referred_by_id
      LEFT JOIN care_types ct ON ct.id = c.care_type_id
     WHERE c.id = ${c.req.param('clientId')}`))[0]
  if (!row) return c.json({ error: 'Client not found' }, 404)
  if (!payloads.MA_ID_RE.test(payloads.digitsOnly(row.medicaid_id))) {
    return c.json({ error: 'Client needs a valid 10-12 digit Medicaid ID first' }, 400)
  }
  const seq = payloads.nextSequence(row.sandata_sequence)
  const payload = payloads.buildClientPayload(row, {
    providerId: cfg.providerId,
    sequence: seq,
    includePayerSegment: !!(row.sandata_payer_id && row.address && row.phone),
    timeZone: cfg.sandataTimeZone,
    agencyState: cfg.state,
  })
  try {
    const post = await postRecords(cfg, 'clients', payload)
    if (post.ok && post.uuid) {
      await db.update(clients).set({ sandataSequence: seq, sandataSyncedAt: new Date(), updatedAt: new Date() }).where(eq(clients.id, row.id))
    }
    return c.json({ ok: post.ok, uuid: post.uuid, data: post.data })
  } catch (e: any) {
    return c.json({ ok: false, error: `Sandata could not be reached: ${e?.message || 'network error'}` }, 502)
  }
})

// ─── QUEUE ────────────────────────────────────────────────────────────────────────────────────
app.get('/queue', requireAdmin, async (c) => {
  const queueStatus = await getQueueStatus()
  const recentFailures = rowsOf(await db.execute(sql`
    SELECT sq.*, ev.service_date,
           c.first_name AS client_first, c.last_name AS client_last,
           u.first_name AS cg_first, u.last_name AS cg_last
      FROM sandata_submission_queue sq
      JOIN evv_visits ev ON sq.evv_visit_id = ev.id
      JOIN clients c ON ev.client_id = c.id
      JOIN users u ON ev.caregiver_id = u.id
     WHERE sq.status = 'failed'
       AND sq.completed_at > (now() AT TIME ZONE 'UTC') - INTERVAL '30 days'
     ORDER BY sq.completed_at DESC
     LIMIT 50`))
  return c.json({ queueStatus, recentFailures })
})

app.post('/queue/retry/:id', requireAdmin, async (c) => {
  const ok = await retrySubmission(c.req.param('id'))
  if (!ok) return c.json({ error: 'No failed submission with that id' }, 404)
  return c.json({ success: true, message: 'Submission re-queued' })
})

app.get('/submission-status', requireAdmin, async (c) => {
  const { start, end } = await dateRange(c)
  const visits = rowsOf(await db.execute(sql`
    SELECT ev.id, ev.service_date, ev.sandata_status, ev.sandata_visit_id,
           ev.sandata_submitted_at, ev.auto_submit_enabled,
           c.first_name AS client_first, c.last_name AS client_last,
           u.first_name AS cg_first, u.last_name AS cg_last,
           sq.status AS queue_status, sq.retry_count, sq.last_error, sq.submission_path
      FROM evv_visits ev
      JOIN clients c ON ev.client_id = c.id
      JOIN users u ON ev.caregiver_id = u.id
      LEFT JOIN sandata_submission_queue sq ON sq.evv_visit_id = ev.id
     WHERE ev.service_date BETWEEN ${start}::date AND ${end}::date
     ORDER BY ev.service_date DESC, ev.actual_start DESC`))
  const by = (s: string) => visits.filter((v: any) => v.sandata_status === s).length
  return c.json({
    summary: {
      total: visits.length,
      pending: by('pending'), ready: by('ready'), submitted: by('submitted'), accepted: by('accepted'),
      needsManual: by('needs_manual'), exception: by('exception'),
      inQueue: visits.filter((v: any) => v.queue_status === 'queued' || v.queue_status === 'processing').length,
    },
    visits,
  })
})

// ─── CONFIG STATUS ────────────────────────────────────────────────────────────────────────────
app.get('/config', requireAdmin, async (c) => {
  const cfg = await getConfig()
  return c.json({
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

export default app
