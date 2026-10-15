// services/evvVisits.ts — EVV visit records and the structured time-change log.
// Ported from the CVHC CRM: routes/sandataRoutes.js createEVVFromTimeEntry, the
// visit_time_changes writers (sandata PUT /visit/:id, admin force clock-out) and
// timeTrackingRoutes.js recordSandataDecision.
//
// Every write here is best-effort from the punch paths' point of view: a clock-out never fails
// because an EVV record could not be written.
import { sql, eq } from 'drizzle-orm'
import { db } from '../../db/index.ts'
import { evvVisits, timeEntries, visitTimeChanges } from '../../db/schema.ts'
import { getConfig } from './sandataClient.ts'
import { normalizeLoc, EVV_REASON_CODES, EVV_REASONS_NEEDING_MEMO } from './sandataPayload.ts'
import { decideSandataRequired, withTimeout } from './evvWeekly.ts'

const rowsOf = (r: any): any[] => (r && Array.isArray(r.rows) ? r.rows : Array.isArray(r) ? r : [])

// ── units ─────────────────────────────────────────────────────────────────────────────────────
// Same as CVHC calcUnits: 15-minute units (default) or hours to 2dp, or 1 per visit.
export function calcUnits(startTime: unknown, endTime: unknown, unitType?: string | null): number {
  if (!endTime) return 0
  const mins = (new Date(endTime as any).getTime() - new Date(startTime as any).getTime()) / 60000
  if (unitType === 'hour') return Math.round(mins / 60 * 100) / 100
  if (unitType === 'visit') return 1
  return Math.round(mins / 15 * 100) / 100 // '15min' and the default
}

// The calendar date of an instant in the agency's EVV time zone (YYYY-MM-DD).
export function localDate(at: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(at)
  const get = (t: string) => parts.find((p) => p.type === t)?.value || ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

// ── reason codes ─────────────────────────────────────────────────────────────────────────────
// Returns an error message, or null when the code (and memo where required) is acceptable.
export function evvReasonError(reasonCode: unknown, memo: unknown): string | null {
  const code = String(reasonCode ?? '')
  if (!(EVV_REASON_CODES as readonly string[]).includes(code)) return 'reasonCode required (EVV codes 1,2,3,4,5,7,8)'
  if (EVV_REASONS_NEEDING_MEMO.includes(code) && !String(memo ?? '').trim()) return `Reason code ${code} requires a memo explaining the change`
  return null
}

// The one writer of visit_time_changes. Caller has validated the code with evvReasonError().
export async function recordVisitTimeChange(input: {
  timeEntryId: string
  changedById: string | null
  oldStart?: Date | null
  newStart?: Date | null
  oldEnd?: Date | null
  newEnd?: Date | null
  reasonCode: string
  memo?: string | null
}) {
  const [row] = await db.insert(visitTimeChanges).values({
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

// ── the per-visit Sandata decision (made at clock-in) ─────────────────────────────────────────
// Runs AFTER the punch is saved and is capped, so it can never block or slow a clock-in: on a
// timeout or error it returns null and the app falls back to prompting as before.
export const SANDATA_DECISION_MS = 2500
export async function recordSandataDecision(entryId: string, clientId: string, atIso: string | null): Promise<boolean | null> {
  try {
    const cfg = await getConfig()
    const decision = await withTimeout(
      decideSandataRequired(clientId, atIso, { excludeEntryId: entryId, timezone: cfg.timezone }), SANDATA_DECISION_MS)
    if (!decision) return null
    await db.update(timeEntries).set({ sandataRequired: decision.required }).where(eq(timeEntries.id, entryId))
    return decision.required
  } catch (e: any) {
    console.error('[clock-in] sandata decision:', e?.message)
    return null
  }
}

// ── EVV visit from a closed time entry ────────────────────────────────────────────────────────
// Called when a shift is closed (app clock-out, IVR clock-out, office close). Upserts on
// time_entry_id, so a second close of the same entry refreshes the record instead of duplicating it.
//
// NOT ported from CVHC on purpose: CVHC also adds the visit's units to authorizations.used_units
// here, while its claims engine adds them again when the claim is generated. This template's
// claims engine (services/claimsEngine.ts) already deducts at claim time, so deducting here too
// would count every visit twice against the authorization.
export async function createEVVFromTimeEntry(timeEntryId: string) {
  try {
    const cfg = await getConfig()
    const te = rowsOf(await db.execute(sql`
      SELECT te.id, te.client_id, te.caregiver_id, te.start_time, te.end_time,
             te.clock_in_location, te.clock_out_location, te.origin_phone,
             c.medicaid_id, cp.evv_worker_id, cp.npi_number,
             ct.default_service_code, ct.default_modifier
        FROM time_entries te
        JOIN clients c ON c.id = te.client_id
        LEFT JOIN caregiver_profiles cp ON cp.caregiver_id = te.caregiver_id
        LEFT JOIN care_types ct ON ct.id = c.care_type_id
       WHERE te.id = ${timeEntryId}`))[0]
    if (!te || !te.end_time) return null

    // drizzle hands raw `timestamp` columns back as strings without a zone; they are UTC.
    const start = asUtc(te.start_time)
    const end = asUtc(te.end_time)
    const serviceDate = localDate(start, cfg.timezone)
    const serviceCode = te.default_service_code || 'T1019'

    const authorization = rowsOf(await db.execute(sql`
      SELECT id, unit_type FROM authorizations
       WHERE client_id = ${te.client_id}
         AND status = 'active'
         AND start_date <= ${serviceDate}::date
         AND end_date >= ${serviceDate}::date
         AND (procedure_code = ${te.default_service_code ?? null} OR procedure_code IS NULL)
       ORDER BY end_date ASC
       LIMIT 1`))[0] || null

    const gpsIn = normalizeLoc(te.clock_in_location)
    const gpsOut = normalizeLoc(te.clock_out_location)
    const units = calcUnits(start, end, authorization?.unit_type || '15min')

    const issues: Array<{ code: string; msg: string }> = []
    if (!te.medicaid_id) issues.push({ code: 'NO_MEDICAID_ID', msg: 'Client has no Medicaid ID on file' })
    if (!te.evv_worker_id && !te.npi_number) issues.push({ code: 'NO_WORKER_ID', msg: 'Caregiver has no EVV Worker ID or NPI' })
    if (!authorization) issues.push({ code: 'NO_AUTH', msg: 'No active authorization found for this service/date' })
    if (!gpsIn) issues.push({ code: 'NO_GPS_IN', msg: 'No GPS on clock-in' })
    if (!gpsOut) issues.push({ code: 'NO_GPS_OUT', msg: 'No GPS on clock-out' })

    const values = {
      timeEntryId,
      clientId: te.client_id,
      caregiverId: te.caregiver_id,
      authorizationId: authorization?.id || null,
      serviceCode,
      modifier: te.default_modifier || null,
      serviceDate,
      actualStart: start,
      actualEnd: end,
      unitsOfService: String(units),
      gpsInLat: gpsIn ? String(gpsIn.lat) : null,
      gpsInLng: gpsIn ? String(gpsIn.lng) : null,
      gpsOutLat: gpsOut ? String(gpsOut.lat) : null,
      gpsOutLng: gpsOut ? String(gpsOut.lng) : null,
      sandataStatus: issues.length === 0 ? 'ready' : 'pending',
      evvMethod: te.origin_phone ? 'telephony' : (gpsIn || gpsOut) ? 'gps' : 'manual',
      isVerified: issues.length === 0,
      verificationIssues: issues,
    }
    const [record] = await db.insert(evvVisits).values(values as any).onConflictDoUpdate({
      target: evvVisits.timeEntryId,
      set: {
        actualEnd: values.actualEnd,
        unitsOfService: values.unitsOfService,
        gpsOutLat: values.gpsOutLat,
        gpsOutLng: values.gpsOutLng,
        verificationIssues: values.verificationIssues,
        isVerified: values.isVerified,
        // Re-building a not-yet-sent record moves it between pending and ready with its issues.
        // CVHC left the status as first written, so a visit whose issues were fixed stayed
        // 'pending' — and only 'ready' visits can be selected for submission.
        sandataStatus: sql`CASE WHEN ${evvVisits.sandataStatus} IN ('pending', 'ready') THEN ${values.sandataStatus} ELSE ${evvVisits.sandataStatus} END`,
        updatedAt: new Date(),
      },
    }).returning()

    // Auto-enqueue for Sandata when the visit is ready (no-op until the account is configured).
    if (record && record.sandataStatus === 'ready' && record.autoSubmitEnabled !== false) {
      const { enqueueVisit } = await import('./sandataAutoSubmit.ts')
      enqueueVisit(record.id).catch((e: any) => console.error('[EVV auto-submit] enqueue:', e?.message))
    }
    return record
  } catch (e: any) {
    console.error('[EVV] createEVVFromTimeEntry error:', e?.message)
    return null
  }
}

export function asUtc(v: unknown): Date {
  if (v instanceof Date) return v
  const s = String(v)
  return new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : s.replace(' ', 'T') + 'Z')
}
