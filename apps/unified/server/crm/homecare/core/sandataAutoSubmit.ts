// Automated Sandata alternate-EVV submission queue. Moved from
// templates/crm-homecare/backend/src/services/sandataAutoSubmit.ts (ported there from CVHC
// services/sandataAutoSubmit.js). The SQL is in server/data/homecareEvv.ts.
//
// Flow per visit: assemble the bundle from live rows -> make sure the CLIENT record is accepted by Sandata first
// (visits for an unknown client reject whole) -> build spec JSON -> POST -> store the transaction UUID -> poll /status
// for accept/reject. Serialized one at a time with a delay, retried with backoff; permanent errors fail fast to
// needs_manual.
//
// DORMANT WITHOUT AN ACCOUNT: enqueueVisit() and the queue no-op until the company's Sandata account (or the
// SANDATA_* env fallback) is complete.
//
// Never double-runs: one in-process worker per core instance (queueProcessing), and each queue row is claimed with a
// conditional UPDATE … WHERE status = 'queued' before it is worked.
//
// Changes: everything is the company's — the calls a route makes take its id first, each queue row carries
// company_id, and the one queue worker serves every company, reading each item's company's account (an item whose
// company has no account any more is left queued and skipped, as the template's worker returned without touching
// it). The failure notice goes to the company's own office. Nothing here starts on its own: the worker runs when a
// visit is queued or retried, and the one-shot backoff wake-up it sets is runtime, as in the template.
import { and, eq, inArray } from 'drizzle-orm'
import { evvVisits, sandataSubmissionQueue, clients, notifications, user } from '../../../db/schema/index.ts'
import {
  sandataBundleRow, visitTimeChangesFor, liveQueueItem, nextQueuedItem, secondsToNextRetry,
  submittedVisitsAwaitingStatus, queueStatusCounts,
} from '../../../data/homecareEvv.ts'
import type { CrmDeps } from '../../deps.ts'
import { postRecords, getStatus, type SandataClient, type SandataConfig, type StatusResult } from './sandataClient.ts'
import * as payloads from './sandataPayload.ts'
import { asUtc } from './evvVisits.ts'

const envMs = (name: string, dflt: number) => {
  const n = parseInt(process.env[name] || '', 10)
  return Number.isFinite(n) && n >= 0 ? n : dflt
}
const QUEUE_DELAY_MS = () => envMs('SANDATA_QUEUE_DELAY_MS', 3000)
const RETRY_BASE_DELAY_MS = () => envMs('SANDATA_RETRY_BASE_MS', 5000)
export const MAX_RETRIES = 3
// Status polling after a POST: short in-line polls here; anything still processing stays 'submitted' and is
// re-checked by pollPendingStatuses() (dashboard load / poll button).
const STATUS_POLL_DELAYS_MS = () => {
  const raw = process.env.SANDATA_STATUS_POLL_DELAYS_MS
  if (raw != null && raw !== '') return raw.split(',').map((s) => Math.max(0, parseInt(s, 10) || 0))
  return [10000, 20000, 30000]
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** The submission bundle from a bundle row and its time changes (camelCase rows). */
export function toVisitBundle({ row, changes }: { row: any; changes: any[] }, cfg: SandataConfig): payloads.VisitBundle {
  const t = (v: unknown) => (v == null ? null : asUtc(v))
  return {
    providerId: cfg.providerId,
    visitOtherId: row.evvId,
    sequence: null, // filled at submit
    workerId: row.evvWorkerId,
    medicaidId: row.medicaidId,
    payerId: row.sandataPayerId,
    payerProgram: row.sandataPayerProgram,
    serviceCode: row.serviceCode || row.defaultServiceCode,
    modifier: row.modifier || null,
    startTime: t(row.actualStart || row.startTime),
    endTime: t(row.actualEnd || row.endTime),
    clockInLoc: row.clockInLocation,
    clockOutLoc: row.clockOutLocation,
    originPhone: row.originPhone,
    changes,
    exceptionAck: row.exceptionAck && row.sandataExceptionCode
      ? { code: row.sandataExceptionCode, acknowledged: true }
      : null,
    cancelled: false,
    timeZone: cfg.sandataTimeZone,
  }
}

export function createSandataAutoSubmit(d: CrmDeps, deps: { sandata: SandataClient }) {
  const { sandata } = deps
  const db = d.db
  let queueProcessing = false

  // ═══ BUNDLE: everything one visit submission needs, read fresh at submit time ═══
  async function fetchBundle(companyId: string, evvVisitId: string) {
    const row = await sandataBundleRow(db, companyId, evvVisitId)
    if (!row) return null
    const changes = (await visitTimeChangesFor(db, companyId, row.timeEntryId))
      .map((c: any) => ({ ...c, changedAt: c.changedAt ? asUtc(c.changedAt) : null }))
    return { row, changes }
  }

  // ═══ CLIENT-FIRST SYNC (an unknown client MA ID rejects the whole visit) ═══
  async function ensureClientSynced(companyId: string, row: any, cfg: SandataConfig): Promise<{ ok: boolean; error?: string }> {
    if (row.sandataSyncedAt) return { ok: true }

    const seq = payloads.nextSequence(row.clientSequence)
    const clientPayload = payloads.buildClientPayload({
      firstName: row.firstName, lastName: row.lastName,
      medicaidId: row.medicaidId, isActive: row.clientIsActive,
      address: row.address, city: row.city, state: row.state, zip: row.zip,
      phone: row.phone, latitude: row.latitude, longitude: row.longitude,
      createdAt: row.clientCreatedAt ? asUtc(row.clientCreatedAt) : null,
      sandataPayerId: row.sandataPayerId,
      sandataPayerProgram: row.sandataPayerProgram,
      defaultServiceCode: row.serviceCode || row.defaultServiceCode,
    }, {
      providerId: cfg.providerId,
      sequence: seq,
      includePayerSegment: !!(row.sandataPayerId && row.address && row.phone),
      timeZone: cfg.sandataTimeZone,
      agencyState: cfg.state,
    })

    const post = await postRecords(cfg, 'clients', clientPayload)
    if (!post.ok || !post.uuid) {
      return { ok: false, error: `Client POST failed (HTTP ${post.status}): ${JSON.stringify(post.data).slice(0, 300)}` }
    }

    const status = await pollStatus(cfg, 'clients', post.uuid)
    if (status && status.ready && !status.accepted) {
      const reason = (status.rejects[0] && (status.rejects[0].Reason || status.rejects[0].reason)) || 'rejected'
      return { ok: false, error: `Client record rejected by Sandata: ${reason}` }
    }

    // Accepted (or still processing after our polls — optimistic; a visit reject for an unknown client surfaces on
    // the visit status and retries later).
    await db.update(clients).set({ sandataSequence: seq, sandataSyncedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(clients.id, row.clientId), eq(clients.companyId, companyId)))
    return { ok: true }
  }

  async function pollStatus(cfg: SandataConfig, entity: 'clients' | 'visits', uuid: string): Promise<StatusResult | null> {
    let last: StatusResult | null = null
    for (const delay of STATUS_POLL_DELAYS_MS()) {
      await sleep(delay)
      try {
        last = await getStatus(cfg, entity, uuid)
        if (last.ready) return last
      } catch {
        last = null
      }
    }
    return last
  }

  // ═══ ENQUEUE ═══
  async function enqueueVisit(companyId: string, evvVisitId: string): Promise<{ queued: boolean; reason?: string; id?: string; path?: string }> {
    // Dormant until the account exists — do not build a queue of items that can only fail.
    const cfg = await sandata.getConfig(companyId)
    if (!cfg.isConfigured) return { queued: false, reason: 'Sandata not configured — visit stays staged until the Sandata account is set' }

    const existing = await liveQueueItem(db, companyId, evvVisitId)
    if (existing) return { queued: false, reason: `Already in queue (${existing.status})`, id: existing.id }

    const [visit] = await db.select({ id: evvVisits.id }).from(evvVisits)
      .where(and(eq(evvVisits.id, evvVisitId), eq(evvVisits.companyId, companyId))).limit(1)
    if (!visit) return { queued: false, reason: 'EVV visit not found' }

    const [q] = await db.insert(sandataSubmissionQueue).values({ companyId, evvVisitId, submissionPath: 'api', status: 'queued', retryCount: 0 }).returning()
    processQueueAsync()
    return { queued: true, id: q.id, path: 'api' }
  }

  // ═══ PROCESS QUEUE ═══
  function processQueueAsync() {
    if (queueProcessing) return
    queueProcessing = true
    processQueue().catch((err) => {
      d.logger.error('[Sandata Queue] Processing error', { error: err?.message })
    }).finally(() => {
      queueProcessing = false
    })
  }

  async function processQueue() {
    const configs = new Map<string, SandataConfig>()
    const dormant: string[] = []

    while (true) {
      const item = await nextQueuedItem(db, dormant)
      if (!item) break
      let cfg = configs.get(item.companyId)
      if (!cfg) { cfg = await sandata.getConfig(item.companyId); configs.set(item.companyId, cfg) }
      if (!cfg.isConfigured) { dormant.push(item.companyId); continue } // dormant

      const claimed = await db.update(sandataSubmissionQueue)
        .set({ status: 'processing', startedAt: new Date() })
        .where(and(eq(sandataSubmissionQueue.id, item.queueId), eq(sandataSubmissionQueue.status, 'queued')))
        .returning({ id: sandataSubmissionQueue.id })
      if (!claimed.length) continue

      let result: { success: boolean; error?: string; permanent?: boolean }
      try {
        result = await submitViaAPI(item.companyId, item.evvVisitId, cfg)
      } catch (err: any) {
        result = { success: false, error: err?.message }
      }

      if (result.success) {
        await db.update(sandataSubmissionQueue).set({ status: 'completed', completedAt: new Date() }).where(eq(sandataSubmissionQueue.id, item.queueId))
      } else {
        const retryCount = (item.retryCount || 0) + 1
        if (result.permanent || retryCount >= MAX_RETRIES) {
          await db.update(sandataSubmissionQueue)
            .set({ status: 'failed', retryCount, lastError: result.error || null, completedAt: new Date() })
            .where(eq(sandataSubmissionQueue.id, item.queueId))
          await db.update(evvVisits).set({
            sandataStatus: 'needs_manual',
            sandataExceptionDesc: result.permanent
              ? `Permanent error — needs admin fix: ${result.error}`
              : `Auto-submission failed after ${MAX_RETRIES} attempts: ${result.error}`,
            updatedAt: new Date(),
          }).where(eq(evvVisits.id, item.evvVisitId))
          await notifySubmissionFailure(item, result.error || 'unknown error')
        } else {
          const delayMs = RETRY_BASE_DELAY_MS() * Math.pow(2, retryCount - 1)
          await db.update(sandataSubmissionQueue)
            .set({ status: 'queued', retryCount, lastError: result.error || null, nextRetryAt: new Date(Date.now() + delayMs) })
            .where(eq(sandataSubmissionQueue.id, item.queueId))
        }
      }

      await sleep(QUEUE_DELAY_MS())
    }

    // Items waiting on a backoff timer are skipped above, so schedule a one-shot wake-up (capped at 10 min);
    // otherwise a retry could sit until the next unrelated enqueue.
    try {
      const secs = await secondsToNextRetry(db)
      if (secs != null && secs > 0) {
        const t: any = setTimeout(processQueueAsync, Math.min(secs + 1, 600) * 1000)
        if (t && typeof t.unref === 'function') t.unref()
      }
    } catch (e: any) { d.logger.error('[Sandata Queue] retry wake-up', { error: e?.message }) }
  }

  // ═══ SUBMIT ONE VISIT ═══
  async function submitViaAPI(companyId: string, evvVisitId: string, cfgIn?: SandataConfig): Promise<{ success: boolean; error?: string; permanent?: boolean }> {
    const cfg = cfgIn || await sandata.getConfig(companyId)
    const assembled = await fetchBundle(companyId, evvVisitId)
    if (!assembled) return { success: false, error: 'EVV visit not found', permanent: true }

    const bundle = toVisitBundle(assembled, cfg)
    const visitWhere = and(eq(evvVisits.id, evvVisitId), eq(evvVisits.companyId, companyId))

    // Pre-flight: problems that can never succeed on retry fail fast to needs_manual with a precise fix-it message.
    const problems = payloads.validateVisitBundle(bundle)
    if (problems.length) {
      const msg = problems.map((p) => p.msg).join('; ')
      await db.update(evvVisits).set({ sandataExceptionCode: problems[0].code.slice(0, 20), sandataExceptionDesc: msg.slice(0, 500), updatedAt: new Date() })
        .where(visitWhere)
      return { success: false, error: msg, permanent: true }
    }

    // The client must be known to Sandata before its visits.
    const clientSync = await ensureClientSynced(companyId, assembled.row, cfg)
    if (!clientSync.ok) return { success: false, error: clientSync.error, permanent: /rejected/i.test(clientSync.error || '') }

    // Strictly increasing sequence; a rejected sequence is never reused.
    const seq = payloads.nextSequence(assembled.row.sandataSequence)
    bundle.sequence = seq
    const payload = payloads.buildVisitPayload(bundle)

    const post = await postRecords(cfg, 'visits', payload)
    await db.update(evvVisits).set({
      sandataSequence: seq, sandataUuid: post.uuid, sandataResponse: post.data || {},
      sandataSubmittedAt: new Date(), updatedAt: new Date(),
    }).where(visitWhere)

    if (!post.ok || !post.uuid) {
      return { success: false, error: `Visit POST failed (HTTP ${post.status}): ${JSON.stringify(post.data).slice(0, 300)}` }
    }

    await db.update(evvVisits).set({ sandataStatus: 'submitted', needsResubmit: false, updatedAt: new Date() }).where(visitWhere)

    // Learn accept/reject now if Sandata has finished processing.
    const status = await pollStatus(cfg, 'visits', post.uuid)
    if (status && status.ready) {
      await applyStatusResult(companyId, evvVisitId, status)
      if (!status.accepted) {
        const reason = (status.rejects[0] && (status.rejects[0].Reason || status.rejects[0].reason)) || 'rejected'
        return { success: false, error: `Sandata rejected: ${reason}`, permanent: false }
      }
    }
    // Still processing -> stays 'submitted'; pollPendingStatuses() resolves it later.
    return { success: true }
  }

  async function applyStatusResult(companyId: string, evvVisitId: string, status: StatusResult) {
    const visitWhere = and(eq(evvVisits.id, evvVisitId), eq(evvVisits.companyId, companyId))
    if (status.accepted) {
      await db.update(evvVisits).set({ sandataStatus: 'accepted', sandataExceptionCode: null, sandataExceptionDesc: null, updatedAt: new Date() })
        .where(visitWhere)
    } else {
      const reject = status.rejects && status.rejects[0]
      const reason = (reject && (reject.Reason || reject.reason)) || 'Record rejected'
      await db.update(evvVisits).set({
        sandataStatus: 'exception', sandataExceptionCode: 'REJECT',
        sandataExceptionDesc: String(reason).slice(0, 500), sandataResponse: status.data || {}, updatedAt: new Date(),
      }).where(visitWhere)
    }
  }

  // Re-check every visit of the company that was POSTed but whose accept/reject wasn't known yet. The template ran it
  // from the EVV dashboard's load (GET, routes/sandata.ts) and its "poll" button — never on a timer.
  async function pollPendingStatuses(companyId: string): Promise<{ checked: number; resolved?: number }> {
    const cfg = await sandata.getConfig(companyId)
    if (!cfg.isConfigured) return { checked: 0 }
    const pending = await submittedVisitsAwaitingStatus(db, companyId)
    let resolved = 0
    for (const v of pending) {
      try {
        const status = await getStatus(cfg, 'visits', v.sandataUuid)
        if (status.ready) { await applyStatusResult(companyId, v.id, status); resolved++ }
      } catch (e: any) {
        d.logger.error('[Sandata Poll] status check failed', { visitId: v.id, error: e?.message })
      }
    }
    return { checked: pending.length, resolved }
  }

  // A submitted/accepted visit changed -> requeue with the next sequence (incremental interface).
  async function requeueChangedVisit(companyId: string, evvVisitId: string) {
    await db.update(evvVisits).set({ needsResubmit: true, updatedAt: new Date() })
      .where(and(eq(evvVisits.id, evvVisitId), eq(evvVisits.companyId, companyId)))
    return enqueueVisit(companyId, evvVisitId)
  }

  // ═══ NOTIFICATION / STATUS ═══
  async function notifySubmissionFailure(item: any, error: string) {
    const clientName = `${item.clientFirst} ${item.clientLast}`
    const admins: { id: string }[] = await db.select({ id: user.id }).from(user)
      .where(and(eq(user.companyId, item.companyId), inArray(user.role, ['admin', 'owner']), eq(user.isActive, true)))
    const date = typeof item.serviceDate === 'string' ? item.serviceDate : String(item.serviceDate || '').slice(0, 10)
    for (const admin of admins) {
      await db.insert(notifications).values({
        companyId: item.companyId,
        userId: admin.id,
        type: 'evv_submission_failed',
        title: `EVV Submission Failed: ${clientName}`,
        message: `Sandata auto-submission failed for ${clientName} (${date}).\n\nError: ${error}\n\nFix the underlying issue, then retry from the EVV dashboard.`,
        isRead: false,
      })
    }
  }

  function getQueueStatus(companyId: string) {
    return queueStatusCounts(db, companyId)
  }

  async function retrySubmission(companyId: string, queueId: string): Promise<boolean> {
    const rows = await db.update(sandataSubmissionQueue)
      .set({ status: 'queued', retryCount: 0, lastError: null, nextRetryAt: null })
      .where(and(eq(sandataSubmissionQueue.id, queueId), eq(sandataSubmissionQueue.companyId, companyId), eq(sandataSubmissionQueue.status, 'failed')))
      .returning({ id: sandataSubmissionQueue.id })
    if (rows.length) processQueueAsync()
    return rows.length > 0
  }

  return {
    fetchBundle, toVisitBundle, enqueueVisit, processQueueAsync, processQueue, submitViaAPI, applyStatusResult,
    pollPendingStatuses, requeueChangedVisit, getQueueStatus, retrySubmission, MAX_RETRIES,
  }
}

export type SandataAutoSubmit = ReturnType<typeof createSandataAutoSubmit>
