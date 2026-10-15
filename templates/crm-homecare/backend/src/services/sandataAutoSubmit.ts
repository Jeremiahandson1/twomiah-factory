// services/sandataAutoSubmit.ts
// Automated Sandata alternate-EVV submission queue (ported from CVHC services/sandataAutoSubmit.js).
//
// Flow per visit: assemble the bundle from live rows -> make sure the CLIENT record is accepted by
// Sandata first (visits for an unknown client reject whole) -> build spec JSON -> POST -> store the
// transaction UUID -> poll /status for accept/reject. Serialized one at a time with a delay,
// retried with backoff; permanent errors fail fast to needs_manual.
//
// DORMANT WITHOUT AN ACCOUNT: enqueueVisit() and processQueue() no-op until the agency's Sandata
// account (or the SANDATA_* env fallback) is complete, so nothing here fires before go-live.
//
// Never double-runs: one in-process worker (queueProcessing), and each queue row is claimed with a
// conditional UPDATE … WHERE status = 'queued' before it is worked.
import { sql, eq, and, inArray } from 'drizzle-orm'
import { db } from '../../db/index.ts'
import { evvVisits, sandataSubmissionQueue, clients, notifications, users } from '../../db/schema.ts'
import * as sandata from './sandataClient.ts'
import type { SandataConfig, StatusResult } from './sandataClient.ts'
import * as payloads from './sandataPayload.ts'
import { asUtc } from './evvVisits.ts'

const envMs = (name: string, dflt: number) => {
  const n = parseInt(process.env[name] || '', 10)
  return Number.isFinite(n) && n >= 0 ? n : dflt
}
const QUEUE_DELAY_MS = () => envMs('SANDATA_QUEUE_DELAY_MS', 3000)
const RETRY_BASE_DELAY_MS = () => envMs('SANDATA_RETRY_BASE_MS', 5000)
export const MAX_RETRIES = 3
// Status polling after a POST: results may queue during peak load. Short in-line polls here;
// anything still processing stays 'submitted' and is re-checked by pollPendingStatuses()
// (dashboard load / poll button).
const STATUS_POLL_DELAYS_MS = () => {
  const raw = process.env.SANDATA_STATUS_POLL_DELAYS_MS
  if (raw != null && raw !== '') return raw.split(',').map((s) => Math.max(0, parseInt(s, 10) || 0))
  return [10000, 20000, 30000]
}

const rowsOf = (r: any): any[] => (r && Array.isArray(r.rows) ? r.rows : Array.isArray(r) ? r : [])
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

let queueProcessing = false

// ═══ BUNDLE: everything one visit submission needs, read fresh at submit time ═══════════════════
// GPS is re-read from time_entries (not the evv_visits snapshot): a late GPS fix lands on the time
// entry after clock-out and the snapshot taken at clock-out would miss it.
export async function fetchBundle(evvVisitId: string) {
  const row = rowsOf(await db.execute(sql`
    SELECT ev.id AS evv_id, ev.time_entry_id, ev.service_code, ev.modifier,
           ev.service_date, ev.actual_start, ev.actual_end,
           ev.sandata_status, ev.sandata_sequence, ev.exception_ack,
           ev.sandata_exception_code, ev.exception_ack_reason, ev.exception_ack_memo,
           te.start_time, te.end_time, te.clock_in_location, te.clock_out_location, te.origin_phone,
           c.id AS client_id, c.medicaid_id, c.sandata_synced_at, c.sandata_sequence AS client_sequence,
           c.first_name, c.last_name, c.address, c.city, c.state, c.zip, c.phone,
           c.latitude, c.longitude, c.is_active AS client_is_active, c.created_at AS client_created_at,
           rs.sandata_payer_id, rs.sandata_payer_program,
           cp.evv_worker_id,
           ct.default_service_code
      FROM evv_visits ev
      JOIN time_entries te ON te.id = ev.time_entry_id
      JOIN clients c ON c.id = ev.client_id
      LEFT JOIN referral_sources rs ON rs.id = c.referred_by_id
      LEFT JOIN caregiver_profiles cp ON cp.caregiver_id = ev.caregiver_id
      LEFT JOIN care_types ct ON ct.id = c.care_type_id
     WHERE ev.id = ${evvVisitId}`))[0]
  if (!row) return null

  const changes = rowsOf(await db.execute(sql`
    SELECT vtc.*, u.email AS changed_by_label
      FROM visit_time_changes vtc
      LEFT JOIN users u ON u.id = vtc.changed_by_id
     WHERE vtc.time_entry_id = ${row.time_entry_id}
     ORDER BY vtc.changed_at ASC`))
    .map((c: any) => ({ ...c, changed_at: c.changed_at ? asUtc(c.changed_at) : null }))

  return { row, changes }
}

export function toVisitBundle({ row, changes }: { row: any; changes: any[] }, cfg: SandataConfig): payloads.VisitBundle {
  const t = (v: unknown) => (v == null ? null : asUtc(v))
  return {
    providerId: cfg.providerId,
    visitOtherId: row.evv_id,
    sequence: null, // filled at submit
    workerId: row.evv_worker_id,
    medicaidId: row.medicaid_id,
    payerId: row.sandata_payer_id,
    payerProgram: row.sandata_payer_program,
    serviceCode: row.service_code || row.default_service_code,
    modifier: row.modifier || null,
    startTime: t(row.actual_start || row.start_time),
    endTime: t(row.actual_end || row.end_time),
    clockInLoc: row.clock_in_location,
    clockOutLoc: row.clock_out_location,
    originPhone: row.origin_phone,
    changes,
    exceptionAck: row.exception_ack && row.sandata_exception_code
      ? { code: row.sandata_exception_code, acknowledged: true }
      : null,
    cancelled: false,
    timeZone: cfg.sandataTimeZone,
  }
}

// ═══ CLIENT-FIRST SYNC (an unknown client MA ID rejects the whole visit) ═══════════════════════
async function ensureClientSynced(row: any, cfg: SandataConfig): Promise<{ ok: boolean; error?: string }> {
  if (row.sandata_synced_at) return { ok: true }

  const seq = payloads.nextSequence(row.client_sequence)
  const clientPayload = payloads.buildClientPayload({
    first_name: row.first_name, last_name: row.last_name,
    medicaid_id: row.medicaid_id, is_active: row.client_is_active,
    address: row.address, city: row.city, state: row.state, zip: row.zip,
    phone: row.phone, latitude: row.latitude, longitude: row.longitude,
    created_at: row.client_created_at ? asUtc(row.client_created_at) : null,
    sandata_payer_id: row.sandata_payer_id,
    sandata_payer_program: row.sandata_payer_program,
    default_service_code: row.service_code || row.default_service_code,
  }, {
    providerId: cfg.providerId,
    sequence: seq,
    includePayerSegment: !!(row.sandata_payer_id && row.address && row.phone),
    timeZone: cfg.sandataTimeZone,
    agencyState: cfg.state,
  })

  const post = await sandata.postRecords(cfg, 'clients', clientPayload)
  if (!post.ok || !post.uuid) {
    return { ok: false, error: `Client POST failed (HTTP ${post.status}): ${JSON.stringify(post.data).slice(0, 300)}` }
  }

  const status = await pollStatus(cfg, 'clients', post.uuid)
  if (status && status.ready && !status.accepted) {
    const reason = (status.rejects[0] && (status.rejects[0].Reason || status.rejects[0].reason)) || 'rejected'
    return { ok: false, error: `Client record rejected by Sandata: ${reason}` }
  }

  // Accepted (or still processing after our polls — optimistic; a visit reject for an unknown
  // client surfaces on the visit status and retries later).
  await db.update(clients).set({ sandataSequence: seq, sandataSyncedAt: new Date(), updatedAt: new Date() }).where(eq(clients.id, row.client_id))
  return { ok: true }
}

async function pollStatus(cfg: SandataConfig, entity: 'clients' | 'visits', uuid: string): Promise<StatusResult | null> {
  let last: StatusResult | null = null
  for (const delay of STATUS_POLL_DELAYS_MS()) {
    await sleep(delay)
    try {
      last = await sandata.getStatus(cfg, entity, uuid)
      if (last.ready) return last
    } catch {
      last = null
    }
  }
  return last
}

// ═══ ENQUEUE ═══════════════════════════════════════════════════════════════════════════════════
export async function enqueueVisit(evvVisitId: string): Promise<{ queued: boolean; reason?: string; id?: string; path?: string }> {
  // Dormant until the account exists — do not build a queue of items that can only fail.
  const cfg = await sandata.getConfig()
  if (!cfg.isConfigured) return { queued: false, reason: 'Sandata not configured — visit stays staged until the Sandata account is set' }

  const existing = rowsOf(await db.execute(sql`
    SELECT id, status FROM sandata_submission_queue
     WHERE evv_visit_id = ${evvVisitId} AND status NOT IN ('failed', 'cancelled', 'completed')
     LIMIT 1`))[0]
  if (existing) return { queued: false, reason: `Already in queue (${existing.status})`, id: existing.id }

  const [visit] = await db.select({ id: evvVisits.id }).from(evvVisits).where(eq(evvVisits.id, evvVisitId)).limit(1)
  if (!visit) return { queued: false, reason: 'EVV visit not found' }

  const [q] = await db.insert(sandataSubmissionQueue).values({ evvVisitId, submissionPath: 'api', status: 'queued', retryCount: 0 }).returning()
  processQueueAsync()
  return { queued: true, id: q.id, path: 'api' }
}

// ═══ PROCESS QUEUE ═════════════════════════════════════════════════════════════════════════════
export function processQueueAsync() {
  if (queueProcessing) return
  queueProcessing = true
  processQueue().catch((err) => {
    console.error('[Sandata Queue] Processing error:', err?.message)
  }).finally(() => {
    queueProcessing = false
  })
}

export async function processQueue() {
  const cfg = await sandata.getConfig()
  if (!cfg.isConfigured) return // dormant

  while (true) {
    const item = rowsOf(await db.execute(sql`
      SELECT sq.id AS queue_id, sq.evv_visit_id, sq.retry_count,
             c.first_name AS client_first, c.last_name AS client_last, ev.service_date
        FROM sandata_submission_queue sq
        JOIN evv_visits ev ON ev.id = sq.evv_visit_id
        JOIN clients c ON c.id = ev.client_id
       WHERE sq.status = 'queued'
         AND (sq.next_retry_at IS NULL OR sq.next_retry_at <= (now() AT TIME ZONE 'UTC'))
       ORDER BY sq.created_at ASC
       LIMIT 1`))[0]
    if (!item) break

    const claimed = await db.update(sandataSubmissionQueue)
      .set({ status: 'processing', startedAt: new Date() })
      .where(and(eq(sandataSubmissionQueue.id, item.queue_id), eq(sandataSubmissionQueue.status, 'queued')))
      .returning({ id: sandataSubmissionQueue.id })
    if (!claimed.length) continue

    let result: { success: boolean; error?: string; permanent?: boolean }
    try {
      result = await submitViaAPI(item.evv_visit_id, cfg)
    } catch (err: any) {
      result = { success: false, error: err?.message }
    }

    if (result.success) {
      await db.update(sandataSubmissionQueue).set({ status: 'completed', completedAt: new Date() }).where(eq(sandataSubmissionQueue.id, item.queue_id))
    } else {
      const retryCount = (item.retry_count || 0) + 1
      if (result.permanent || retryCount >= MAX_RETRIES) {
        await db.update(sandataSubmissionQueue)
          .set({ status: 'failed', retryCount, lastError: result.error || null, completedAt: new Date() })
          .where(eq(sandataSubmissionQueue.id, item.queue_id))
        await db.update(evvVisits).set({
          sandataStatus: 'needs_manual',
          sandataExceptionDesc: result.permanent
            ? `Permanent error — needs admin fix: ${result.error}`
            : `Auto-submission failed after ${MAX_RETRIES} attempts: ${result.error}`,
          updatedAt: new Date(),
        }).where(eq(evvVisits.id, item.evv_visit_id))
        await notifySubmissionFailure(item, result.error || 'unknown error')
      } else {
        const delayMs = RETRY_BASE_DELAY_MS() * Math.pow(2, retryCount - 1)
        await db.update(sandataSubmissionQueue)
          .set({ status: 'queued', retryCount, lastError: result.error || null, nextRetryAt: new Date(Date.now() + delayMs) })
          .where(eq(sandataSubmissionQueue.id, item.queue_id))
      }
    }

    await sleep(QUEUE_DELAY_MS())
  }

  // Items waiting on a backoff timer are skipped above, so schedule a one-shot wake-up (capped at
  // 10 min); otherwise a retry could sit until the next unrelated enqueue.
  try {
    const wait = rowsOf(await db.execute(sql`
      SELECT EXTRACT(EPOCH FROM (MIN(next_retry_at) - (now() AT TIME ZONE 'UTC'))) AS secs
        FROM sandata_submission_queue
       WHERE status = 'queued' AND next_retry_at > (now() AT TIME ZONE 'UTC')`))[0]
    const secs = Number(wait?.secs)
    if (Number.isFinite(secs) && secs > 0) {
      const t: any = setTimeout(processQueueAsync, Math.min(secs + 1, 600) * 1000)
      if (t && typeof t.unref === 'function') t.unref()
    }
  } catch (e: any) { console.error('[Sandata Queue] retry wake-up:', e?.message) }
}

// ═══ SUBMIT ONE VISIT ══════════════════════════════════════════════════════════════════════════
export async function submitViaAPI(evvVisitId: string, cfgIn?: SandataConfig): Promise<{ success: boolean; error?: string; permanent?: boolean }> {
  const cfg = cfgIn || await sandata.getConfig()
  const assembled = await fetchBundle(evvVisitId)
  if (!assembled) return { success: false, error: 'EVV visit not found', permanent: true }

  const bundle = toVisitBundle(assembled, cfg)

  // Pre-flight: problems that can never succeed on retry fail fast to needs_manual with a precise
  // fix-it message (no burned retries).
  const problems = payloads.validateVisitBundle(bundle)
  if (problems.length) {
    const msg = problems.map((p) => p.msg).join('; ')
    await db.update(evvVisits).set({ sandataExceptionCode: problems[0].code.slice(0, 20), sandataExceptionDesc: msg.slice(0, 500), updatedAt: new Date() })
      .where(eq(evvVisits.id, evvVisitId))
    return { success: false, error: msg, permanent: true }
  }

  // The client must be known to Sandata before its visits.
  const clientSync = await ensureClientSynced(assembled.row, cfg)
  if (!clientSync.ok) return { success: false, error: clientSync.error, permanent: /rejected/i.test(clientSync.error || '') }

  // Strictly increasing sequence; a rejected sequence is never reused.
  const seq = payloads.nextSequence(assembled.row.sandata_sequence)
  bundle.sequence = seq
  const payload = payloads.buildVisitPayload(bundle)

  const post = await sandata.postRecords(cfg, 'visits', payload)
  await db.update(evvVisits).set({
    sandataSequence: seq, sandataUuid: post.uuid, sandataResponse: post.data || {},
    sandataSubmittedAt: new Date(), updatedAt: new Date(),
  }).where(eq(evvVisits.id, evvVisitId))

  if (!post.ok || !post.uuid) {
    return { success: false, error: `Visit POST failed (HTTP ${post.status}): ${JSON.stringify(post.data).slice(0, 300)}` }
  }

  await db.update(evvVisits).set({ sandataStatus: 'submitted', needsResubmit: false, updatedAt: new Date() }).where(eq(evvVisits.id, evvVisitId))

  // Learn accept/reject now if Sandata has finished processing.
  const status = await pollStatus(cfg, 'visits', post.uuid)
  if (status && status.ready) {
    await applyStatusResult(evvVisitId, status)
    if (!status.accepted) {
      const reason = (status.rejects[0] && (status.rejects[0].Reason || status.rejects[0].reason)) || 'rejected'
      return { success: false, error: `Sandata rejected: ${reason}`, permanent: false }
    }
  }
  // Still processing -> stays 'submitted'; pollPendingStatuses() resolves it later.
  return { success: true }
}

export async function applyStatusResult(evvVisitId: string, status: StatusResult) {
  if (status.accepted) {
    await db.update(evvVisits).set({ sandataStatus: 'accepted', sandataExceptionCode: null, sandataExceptionDesc: null, updatedAt: new Date() })
      .where(eq(evvVisits.id, evvVisitId))
  } else {
    const reject = status.rejects && status.rejects[0]
    const reason = (reject && (reject.Reason || reject.reason)) || 'Record rejected'
    await db.update(evvVisits).set({
      sandataStatus: 'exception', sandataExceptionCode: 'REJECT',
      sandataExceptionDesc: String(reason).slice(0, 500), sandataResponse: status.data || {}, updatedAt: new Date(),
    }).where(eq(evvVisits.id, evvVisitId))
  }
}

// Re-check every visit that was POSTed but whose accept/reject wasn't known yet.
export async function pollPendingStatuses(): Promise<{ checked: number; resolved?: number }> {
  const cfg = await sandata.getConfig()
  if (!cfg.isConfigured) return { checked: 0 }
  const pending = rowsOf(await db.execute(sql`
    SELECT id, sandata_uuid FROM evv_visits
     WHERE sandata_status = 'submitted' AND sandata_uuid IS NOT NULL
     ORDER BY sandata_submitted_at ASC
     LIMIT 50`))
  let resolved = 0
  for (const v of pending) {
    try {
      const status = await sandata.getStatus(cfg, 'visits', v.sandata_uuid)
      if (status.ready) { await applyStatusResult(v.id, status); resolved++ }
    } catch (e: any) {
      console.error('[Sandata Poll] status check failed:', v.id, e?.message)
    }
  }
  return { checked: pending.length, resolved }
}

// A submitted/accepted visit changed -> requeue with the next sequence (incremental interface).
export async function requeueChangedVisit(evvVisitId: string) {
  await db.update(evvVisits).set({ needsResubmit: true, updatedAt: new Date() }).where(eq(evvVisits.id, evvVisitId))
  return enqueueVisit(evvVisitId)
}

// ═══ NOTIFICATION / STATUS ═════════════════════════════════════════════════════════════════════
async function notifySubmissionFailure(item: any, error: string) {
  const clientName = `${item.client_first} ${item.client_last}`
  const admins = await db.select({ id: users.id }).from(users)
    .where(and(inArray(users.role, ['admin', 'owner']), eq(users.isActive, true)))
  const date = typeof item.service_date === 'string' ? item.service_date : String(item.service_date || '').slice(0, 10)
  for (const admin of admins) {
    await db.insert(notifications).values({
      userId: admin.id,
      type: 'evv_submission_failed',
      title: `EVV Submission Failed: ${clientName}`,
      message: `Sandata auto-submission failed for ${clientName} (${date}).\n\nError: ${error}\n\nFix the underlying issue, then retry from the EVV dashboard.`,
      isRead: false,
    })
  }
}

export async function getQueueStatus() {
  return rowsOf(await db.execute(sql`
    SELECT status, COUNT(*)::int AS count, MIN(created_at) AS oldest
      FROM sandata_submission_queue
     WHERE created_at > (now() AT TIME ZONE 'UTC') - INTERVAL '7 days'
     GROUP BY status ORDER BY status`))
}

export async function retrySubmission(queueId: string): Promise<boolean> {
  const rows = await db.update(sandataSubmissionQueue)
    .set({ status: 'queued', retryCount: 0, lastError: null, nextRetryAt: null })
    .where(and(eq(sandataSubmissionQueue.id, queueId), eq(sandataSubmissionQueue.status, 'failed')))
    .returning({ id: sandataSubmissionQueue.id })
  if (rows.length) processQueueAsync()
  return rows.length > 0
}
