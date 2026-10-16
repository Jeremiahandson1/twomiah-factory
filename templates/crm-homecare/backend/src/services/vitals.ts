// Reading a client's vitals (client_vitals), newest first, with the name of whoever took them.
// Shared by the staff route (/api/medications/vitals/*) and the family portal's vitals view.
import { sql } from 'drizzle-orm'
import { db } from '../../db/index.ts'

const rowsOf = (r: any): any[] => r?.rows ?? r ?? []

// recorded_at / created_at are `timestamp` WITHOUT time zone holding UTC wall-clock values, and a raw
// query hands them back as bare text ("2026-10-16 16:10:00"), which a browser reads as ITS local
// time: 11:10 AM Central printed as 4:10 PM (Run 4). They go out as UTC instants instead.
const utcIso = (col: string) => sql.raw(`to_char(cv.${col}, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS ${col}`)
const VITAL_COLUMNS = sql.raw(['id', 'client_id', 'caregiver_id', 'time_entry_id', 'systolic_bp', 'diastolic_bp', 'pulse',
  'respirations', 'oxygen_saturation', 'temperature_f', 'blood_glucose', 'weight_lbs', 'pain_scale', 'pain_location', 'notes']
  .map((col) => `cv.${col}`).join(', '))

export async function listClientVitals(clientId: string, limit = 50, opts: { from?: Date; to?: Date } = {}): Promise<any[]> {
  const lim = Math.min(Math.max(Math.trunc(Number(limit)) || 50, 1), 500)
  return rowsOf(await db.execute(sql`
    SELECT ${VITAL_COLUMNS}, ${utcIso('recorded_at')}, ${utcIso('created_at')},
           u.first_name AS caregiver_first, u.last_name AS caregiver_last
      FROM client_vitals cv LEFT JOIN users u ON cv.caregiver_id = u.id
     WHERE cv.client_id = ${clientId}
       ${opts.from ? sql`AND cv.recorded_at >= ${opts.from.toISOString()}::timestamp` : sql``}
       ${opts.to ? sql`AND cv.recorded_at <= ${opts.to.toISOString()}::timestamp` : sql``}
     ORDER BY cv.recorded_at DESC
     LIMIT ${lim}`))
}
