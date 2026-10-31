// Pay rules (rows 19–21, care_payroll_rules): the visits behind a pay run, one row each, with the times travel is worked out from,
// the break and sleepover marks, the service's overtime switch, the points travel is measured between; each caregiver's pay
// profile and per-service rates; the audit trail of classified hours; mileage by kind; the period's approved expenses.
// Raw SQL lives here (RULEBOOK).
import { sql } from 'drizzle-orm'
import { camelRows } from '@twomiah/tenant-backend'
import { createId } from '@paralleldrive/cuid2'
import { inList, type Q } from './homecareCore.ts'

const quoted = (vals: readonly string[]) => sql.raw(vals.map((s) => `'${s.replace(/'/g, "''")}'`).join(', '))

export interface PayableVisit {
  id: string; caregiverId: string; clientId: string | null; shiftDate: string; minutes: number
  /** 'YYYY-MM-DDTHH:MM:SS' as stored (no zone), or null */
  actualStart: string | null; actualEnd: string | null; scheduledStart: string | null; scheduledEnd: string | null
  scheduledMinutes: number | null; status: string
  careTypeId: string | null; otExempt: boolean
  travelPaid: boolean | null; travelMinutes: number | null; travelMiles: string | null
  mealBreakMinutes: number | null; mealWaived: boolean; restBreakMissed: boolean; isSleepover: boolean
  clientFirstName: string | null; clientLastName: string | null
  clientLat: string | null; clientLng: string | null
  /** The punch points, as the phone sent them ({ lat, lng } or { latitude, longitude }), or null. */
  gpsIn: any; gpsOut: any
}

/**
 * The payable visits (payroll shift reviews paid by payroll) with shift dates in [start, end], oldest first within a caregiver:
 * by when they began (the punch, else the scheduled start), so the order in a day is the order they were worked. A sleepover with
 * no awake minutes is in: it is a worked day.
 */
export async function payableVisits(q: Q, companyId: string, start: string, end: string, payable: readonly string[], caregiverId: string | null): Promise<PayableVisit[]> {
  return camelRows(await q.execute(sql`
    SELECT psr.id, psr.caregiver_id, psr.client_id, to_char(psr.shift_date, 'YYYY-MM-DD') AS shift_date, COALESCE(psr.payable_minutes, 0) AS minutes,
           to_char(psr.actual_start, 'YYYY-MM-DD"T"HH24:MI:SS') AS actual_start, to_char(psr.actual_end, 'YYYY-MM-DD"T"HH24:MI:SS') AS actual_end,
           to_char(psr.shift_date + psr.scheduled_start, 'YYYY-MM-DD"T"HH24:MI:SS') AS scheduled_start,
           to_char(psr.shift_date + psr.scheduled_end, 'YYYY-MM-DD"T"HH24:MI:SS') AS scheduled_end,
           psr.scheduled_minutes, psr.status,
           s.care_type_id, COALESCE(ct.exclude_from_overtime, false) AS ot_exempt,
           psr.travel_paid, psr.travel_minutes, psr.travel_miles,
           psr.meal_break_minutes, psr.meal_waived, psr.rest_break_missed, psr.is_sleepover,
           c.first_name AS client_first_name, c.last_name AS client_last_name, c.latitude AS client_lat, c.longitude AS client_lng,
           te.clock_in_location AS gps_in, te.clock_out_location AS gps_out
      FROM payroll_shift_reviews psr
      LEFT JOIN schedules s ON s.id = psr.schedule_id
      LEFT JOIN care_types ct ON ct.id = s.care_type_id
      LEFT JOIN clients c ON c.id = psr.client_id
      LEFT JOIN time_entries te ON te.id = psr.time_entry_id
     WHERE psr.company_id = ${companyId} AND psr.shift_date BETWEEN ${start}::date AND ${end}::date
       AND psr.status IN (${quoted(payable)}) AND (psr.payable_minutes > 0 OR psr.is_sleepover)
       AND (${caregiverId}::text IS NULL OR psr.caregiver_id = ${caregiverId})
     ORDER BY psr.caregiver_id, psr.shift_date, COALESCE(psr.actual_start, psr.shift_date + psr.scheduled_start) NULLS LAST, psr.created_at, psr.id`)) as any
}

/** The payroll worker ids (ADP file number / Paychex worker id) of the company's caregivers. */
export async function payrollWorkerIds(q: Q, companyId: string, caregiverIds: string[]): Promise<Map<string, string>> {
  if (!caregiverIds.length) return new Map()
  const rows = camelRows(await q.execute(sql`
    SELECT caregiver_id, payroll_worker_id FROM caregiver_profiles
     WHERE company_id = ${companyId} AND payroll_worker_id IS NOT NULL AND payroll_worker_id <> ''`))
  const wanted = new Set(caregiverIds)
  return new Map(rows.filter((r: any) => wanted.has(String(r.caregiverId))).map((r: any) => [String(r.caregiverId), String(r.payrollWorkerId)]))
}

export interface PayProfile { caregiverId: string; mileageRate: string | null; isFacilityStaff: boolean; homeLat: string | null; homeLng: string | null }
/** Each named caregiver's pay profile (own mileage rate, facility staff) and home point. Caregivers without a profile row are listed too. */
export async function caregiverPayProfiles(q: Q, companyId: string, caregiverIds: string[]): Promise<PayProfile[]> {
  if (!caregiverIds.length) return []
  return camelRows(await q.execute(sql`
    SELECT u.id AS caregiver_id, p.mileage_rate, COALESCE(p.is_facility_staff, false) AS is_facility_staff, u.latitude AS home_lat, u.longitude AS home_lng
      FROM "user" u LEFT JOIN caregiver_profiles p ON p.caregiver_id = u.id AND p.company_id = ${companyId}
     WHERE u.company_id = ${companyId} AND u.id IN (${inList(caregiverIds)})`)) as any
}

/** Each named caregiver's hourly rate per care type (caregiver_care_type_rates), for the blended regular rate. */
export async function caregiverCareTypeCents(q: Q, companyId: string, caregiverIds: string[]): Promise<Map<string, Map<string, number>>> {
  const out = new Map<string, Map<string, number>>()
  if (!caregiverIds.length) return out
  const rows = camelRows(await q.execute(sql`
    SELECT caregiver_id, care_type_id, hourly_rate FROM caregiver_care_type_rates
     WHERE company_id = ${companyId} AND caregiver_id IN (${inList(caregiverIds)}) AND hourly_rate IS NOT NULL`))
  for (const r of rows as any[]) {
    const cents = Math.round(Number(r.hourlyRate) * 100)
    if (!Number.isFinite(cents) || cents <= 0) continue
    if (!out.has(r.caregiverId)) out.set(r.caregiverId, new Map())
    out.get(r.caregiverId)!.set(String(r.careTypeId), cents)
  }
  return out
}

export interface MileageByKind { caregiverId: string; kind: string; miles: string; amount: string }
/** The period's mileage per caregiver and kind (travel / errand): miles and the dollars recorded on the trips. */
export async function mileageByKind(q: Q, companyId: string, start: string, end: string): Promise<MileageByKind[]> {
  return camelRows(await q.execute(sql`
    SELECT caregiver_id, kind, SUM(miles)::text AS miles, COALESCE(SUM(amount), 0)::text AS amount
      FROM mileage_entries WHERE company_id = ${companyId} AND date BETWEEN ${start}::date AND ${end}::date
     GROUP BY 1, 2`)) as any
}

export interface ApprovedExpense { caregiverId: string; amount: string; count: number }
/** The period's approved expenses per person (the ADP EXP row). */
export async function approvedExpenses(q: Q, companyId: string, start: string, end: string): Promise<ApprovedExpense[]> {
  return camelRows(await q.execute(sql`
    SELECT user_id AS caregiver_id, SUM(amount)::text AS amount, COUNT(*)::int AS count
      FROM expenses WHERE company_id = ${companyId} AND status = 'approved' AND user_id IS NOT NULL AND date BETWEEN ${start}::date AND ${end}::date
     GROUP BY 1`)) as any
}

export interface AuditRowIn {
  reviewId: string | null; segmentKind: string; segmentDate: string; minutes: number
  regularMinutes: number; overtimeMinutes: number; doubleTimeMinutes: number; unpaidMinutes: number
  isHoliday: boolean; rateCents: number; ruleId: string; reasons: string[]
}
/** Replace the stored classification of one caregiver's approved period. */
export async function replacePayHourAudit(q: Q, companyId: string, caregiverId: string, start: string, end: string, rows: AuditRowIn[]): Promise<void> {
  await q.execute(sql`DELETE FROM pay_hour_audit WHERE company_id = ${companyId} AND caregiver_id = ${caregiverId} AND period_start = ${start}::date AND period_end = ${end}::date`)
  for (const r of rows) {
    await q.execute(sql`INSERT INTO pay_hour_audit (id, company_id, caregiver_id, period_start, period_end, review_id, segment_kind, segment_date, minutes, regular_minutes, overtime_minutes, double_time_minutes, unpaid_minutes, is_holiday, rate_cents, rule_id, reasons)
      VALUES (${createId()}, ${companyId}, ${caregiverId}, ${start}::date, ${end}::date, ${r.reviewId}, ${r.segmentKind}, ${r.segmentDate}::date, ${r.minutes}, ${r.regularMinutes}, ${r.overtimeMinutes}, ${r.doubleTimeMinutes}, ${r.unpaidMinutes}, ${r.isHoliday}, ${r.rateCents}, ${r.ruleId}, ${JSON.stringify(r.reasons)}::json)`)
  }
}

/** The stored classification of a caregiver's approved period, in the order worked. */
export async function storedPayHourAudit(q: Q, companyId: string, caregiverId: string, start: string, end: string): Promise<any[]> {
  return camelRows(await q.execute(sql`
    SELECT review_id, segment_kind, to_char(segment_date, 'YYYY-MM-DD') AS segment_date, minutes, regular_minutes, overtime_minutes, double_time_minutes, unpaid_minutes,
           is_holiday, rate_cents, rule_id, reasons, created_at
      FROM pay_hour_audit WHERE company_id = ${companyId} AND caregiver_id = ${caregiverId} AND period_start = ${start}::date AND period_end = ${end}::date
     ORDER BY segment_date, created_at, id`))
}
