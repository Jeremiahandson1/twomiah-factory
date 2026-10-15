// Reading a client's vitals (client_vitals), newest first, with the name of whoever took them.
// Shared by the staff route (/api/medications/vitals/*) and the family portal's vitals view.
import { sql } from 'drizzle-orm'
import { db } from '../../db/index.ts'

const rowsOf = (r: any): any[] => r?.rows ?? r ?? []

export async function listClientVitals(clientId: string, limit = 50, opts: { from?: Date; to?: Date } = {}): Promise<any[]> {
  const lim = Math.min(Math.max(Math.trunc(Number(limit)) || 50, 1), 500)
  return rowsOf(await db.execute(sql`
    SELECT cv.*, u.first_name AS caregiver_first, u.last_name AS caregiver_last
      FROM client_vitals cv LEFT JOIN users u ON cv.caregiver_id = u.id
     WHERE cv.client_id = ${clientId}
       ${opts.from ? sql`AND cv.recorded_at >= ${opts.from.toISOString()}::timestamp` : sql``}
       ${opts.to ? sql`AND cv.recorded_at <= ${opts.to.toISOString()}::timestamp` : sql``}
     ORDER BY cv.recorded_at DESC
     LIMIT ${lim}`))
}
