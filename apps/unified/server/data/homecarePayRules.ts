// Pay rules (item 2, care_payroll_rules): the visits behind a pay run, one row each, with the times travel is worked out from.
// Raw SQL lives here (RULEBOOK).
import { sql } from 'drizzle-orm'
import { camelRows } from '@twomiah/tenant-backend'
import type { Q } from './homecareCore.ts'

const quoted = (vals: readonly string[]) => sql.raw(vals.map((s) => `'${s.replace(/'/g, "''")}'`).join(', '))

export interface PayableVisit {
  id: string; caregiverId: string; clientId: string | null; shiftDate: string; minutes: number
  /** 'YYYY-MM-DDTHH:MM:SS' as stored (no zone), or null */
  actualStart: string | null; actualEnd: string | null; scheduledStart: string | null; scheduledEnd: string | null
}

/**
 * The payable visits (payroll shift reviews paid by payroll) with shift dates in [start, end], oldest first within a caregiver:
 * by when they began (the punch, else the scheduled start), so the order in a day is the order they were worked.
 */
export async function payableVisits(q: Q, companyId: string, start: string, end: string, payable: readonly string[], caregiverId: string | null): Promise<PayableVisit[]> {
  return camelRows(await q.execute(sql`
    SELECT psr.id, psr.caregiver_id, psr.client_id, to_char(psr.shift_date, 'YYYY-MM-DD') AS shift_date, psr.payable_minutes AS minutes,
           to_char(psr.actual_start, 'YYYY-MM-DD"T"HH24:MI:SS') AS actual_start, to_char(psr.actual_end, 'YYYY-MM-DD"T"HH24:MI:SS') AS actual_end,
           to_char(psr.shift_date + psr.scheduled_start, 'YYYY-MM-DD"T"HH24:MI:SS') AS scheduled_start,
           to_char(psr.shift_date + psr.scheduled_end, 'YYYY-MM-DD"T"HH24:MI:SS') AS scheduled_end
      FROM payroll_shift_reviews psr
     WHERE psr.company_id = ${companyId} AND psr.shift_date BETWEEN ${start}::date AND ${end}::date
       AND psr.status IN (${quoted(payable)}) AND psr.payable_minutes > 0
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
