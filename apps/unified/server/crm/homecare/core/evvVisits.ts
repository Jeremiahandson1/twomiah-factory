// EVV visit records and the structured time-change log. Moved from
// templates/crm-homecare/backend/src/services/evvVisits.ts (ported there from the CVHC CRM: routes/sandataRoutes.js
// createEVVFromTimeEntry, the visit_time_changes writers and timeTrackingRoutes.js recordSandataDecision). The SQL is in
// server/data/homecareEvv.ts.
//
// Every write here is best-effort from the punch paths' point of view: a clock-out never fails because an EVV record
// could not be written.
//
// NOT ported from CVHC on purpose: CVHC also adds the visit's units to authorizations.used_units here, while its claims
// engine adds them again when the claim is generated. This product's claims engine already deducts at claim time.
//
// Changes: every read and write is the company's (its id comes first); the auto-submit queue is handed in
// (core/sandataAutoSubmit.ts) instead of imported at call time; logs go through the app's logger.
import { and, eq } from 'drizzle-orm'
import { timeEntries, visitTimeChanges } from '../../../db/schema/index.ts'
import { timeEntryForEvv, activeAuthorizationOn, upsertEvvVisit } from '../../../data/homecareEvv.ts'
import type { CrmDeps } from '../../deps.ts'
import { normalizeLoc, EVV_REASON_CODES, EVV_REASONS_NEEDING_MEMO } from './sandataPayload.ts'
import { withTimeout, type EvvWeekly } from './evvWeekly.ts'
import type { SandataClient } from './sandataClient.ts'
import type { SandataAutoSubmit } from './sandataAutoSubmit.ts'
import { normalizeAuthUnit } from './authUnits.ts'

// Same as CVHC calcUnits: 15-minute units (default) or hours to 2dp, or 1 per visit.
export function calcUnits(startTime: unknown, endTime: unknown, unitType?: string | null): number {
  if (!endTime) return 0
  const mins = (new Date(endTime as any).getTime() - new Date(startTime as any).getTime()) / 60000
  // Read through the one unit table (authUnits.ts). The template compared with 'hour' and 'visit', but the
  // authorization form stores 'hours' and 'visits', so an hourly or per-visit authorization's EVV visits were counted
  // as 15-minute units (fixed in the move).
  const unit = normalizeAuthUnit(unitType) ?? '15min'
  if (unit === 'hours') return Math.round(mins / 60 * 100) / 100
  if (unit === 'visits' || unit === 'days') return 1 // one visit, on one service day
  return Math.round(mins / 15 * 100) / 100
}

// The calendar date of an instant in the agency's EVV time zone (YYYY-MM-DD).
export function localDate(at: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(at)
  const get = (t: string) => parts.find((p) => p.type === t)?.value || ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

// Returns an error message, or null when the code (and memo where required) is acceptable.
export function evvReasonError(reasonCode: unknown, memo: unknown): string | null {
  const code = String(reasonCode ?? '')
  if (!(EVV_REASON_CODES as readonly string[]).includes(code)) return 'reasonCode required (EVV codes 1,2,3,4,5,7,8)'
  if (EVV_REASONS_NEEDING_MEMO.includes(code) && !String(memo ?? '').trim()) return `Reason code ${code} requires a memo explaining the change`
  return null
}

/** A raw `timestamp` value (UTC wall clock, string or Date) as an instant. */
export function asUtc(v: unknown): Date {
  if (v instanceof Date) return v
  const s = String(v)
  return new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : s.replace(' ', 'T') + 'Z')
}

// Runs AFTER the punch is saved and is capped, so it can never block or slow a clock-in.
export const SANDATA_DECISION_MS = 2500

export function createEvvVisits(d: CrmDeps, deps: { sandata: SandataClient; evvWeekly: EvvWeekly; autoSubmit: SandataAutoSubmit }) {
  const { sandata, evvWeekly, autoSubmit } = deps

  // The one writer of visit_time_changes. Caller has validated the code with evvReasonError().
  async function recordVisitTimeChange(companyId: string, input: {
    timeEntryId: string
    changedById: string | null
    oldStart?: Date | null
    newStart?: Date | null
    oldEnd?: Date | null
    newEnd?: Date | null
    reasonCode: string
    memo?: string | null
  }) {
    const [row] = await d.db.insert(visitTimeChanges).values({
      companyId,
      timeEntryId: input.timeEntryId,
      changedById: input.changedById,
      oldStart: input.oldStart ?? null,
      newStart: input.newStart ?? null,
      oldEnd: input.oldEnd ?? null,
      newEnd: input.newEnd ?? null,
      reasonCode: input.reasonCode,
      memo: String(input.memo ?? '').trim().slice(0, 256) || null,
    }).returning()
    return row
  }

  // The per-visit Sandata decision (made at clock-in). On a timeout or error it returns null and the app falls back
  // to prompting as before.
  async function recordSandataDecision(companyId: string, entryId: string, clientId: string, atIso: string | null): Promise<boolean | null> {
    try {
      const cfg = await sandata.getConfig(companyId)
      const decision = await withTimeout(
        evvWeekly.decideSandataRequired(companyId, clientId, atIso, { excludeEntryId: entryId, timezone: cfg.timezone }), SANDATA_DECISION_MS)
      if (!decision) return null
      await d.db.update(timeEntries).set({ sandataRequired: decision.required })
        .where(and(eq(timeEntries.id, entryId), eq(timeEntries.companyId, companyId)))
      return decision.required
    } catch (e: any) {
      d.logger.error('[clock-in] sandata decision', { error: e?.message })
      return null
    }
  }

  // EVV visit from a closed time entry. Called when a shift is closed (app clock-out, IVR clock-out, office close).
  // Upserts on time_entry_id, so a second close of the same entry refreshes the record instead of duplicating it.
  async function createEVVFromTimeEntry(companyId: string, timeEntryId: string) {
    try {
      const cfg = await sandata.getConfig(companyId)
      const te = await timeEntryForEvv(d.db, companyId, timeEntryId)
      if (!te || !te.endTime) return null
      // EVV applies only to payer-funded services (core/payerFunding.ts): no record for private pay.
      if (te.privatePay) return null

      // A raw `timestamp` comes back without a zone; it is UTC.
      const start = asUtc(te.startTime)
      const end = asUtc(te.endTime)
      const serviceDate = localDate(start, cfg.timezone)
      const serviceCode = te.defaultServiceCode || 'T1019'

      const authorization = await activeAuthorizationOn(d.db, companyId, te.clientId, serviceDate, te.defaultServiceCode ?? null)

      const gpsIn = normalizeLoc(te.clockInLocation)
      const gpsOut = normalizeLoc(te.clockOutLocation)
      const units = calcUnits(start, end, authorization?.unitType || '15min')

      const issues: Array<{ code: string; msg: string }> = []
      if (!te.medicaidId) issues.push({ code: 'NO_MEDICAID_ID', msg: 'Client has no Medicaid ID on file' })
      if (!te.evvWorkerId && !te.npiNumber) issues.push({ code: 'NO_WORKER_ID', msg: 'Caregiver has no EVV Worker ID or NPI' })
      if (!authorization) issues.push({ code: 'NO_AUTH', msg: 'No active authorization found for this service/date' })
      if (!gpsIn) issues.push({ code: 'NO_GPS_IN', msg: 'No GPS on clock-in' })
      if (!gpsOut) issues.push({ code: 'NO_GPS_OUT', msg: 'No GPS on clock-out' })

      const record = await upsertEvvVisit(d.db, companyId, {
        timeEntryId,
        clientId: te.clientId,
        caregiverId: te.caregiverId,
        authorizationId: authorization?.id || null,
        serviceCode,
        modifier: te.defaultModifier || null,
        serviceDate,
        actualStart: start,
        actualEnd: end,
        unitsOfService: String(units),
        gpsInLat: gpsIn ? String(gpsIn.lat) : null,
        gpsInLng: gpsIn ? String(gpsIn.lng) : null,
        gpsOutLat: gpsOut ? String(gpsOut.lat) : null,
        gpsOutLng: gpsOut ? String(gpsOut.lng) : null,
        sandataStatus: issues.length === 0 ? 'ready' : 'pending',
        evvMethod: te.originPhone ? 'telephony' : (gpsIn || gpsOut) ? 'gps' : 'manual',
        isVerified: issues.length === 0,
        verificationIssues: issues,
      })

      // Auto-enqueue for Sandata when the visit is ready (no-op until the account is configured).
      if (record && record.sandataStatus === 'ready' && record.autoSubmitEnabled !== false) {
        autoSubmit.enqueueVisit(companyId, record.id).catch((e: any) => d.logger.error('[EVV auto-submit] enqueue', { error: e?.message }))
      }
      return record
    } catch (e: any) {
      d.logger.error('[EVV] createEVVFromTimeEntry error', { error: e?.message })
      return null
    }
  }

  return { recordVisitTimeChange, recordSandataDecision, createEVVFromTimeEntry }
}

export type EvvVisits = ReturnType<typeof createEvvVisits>
