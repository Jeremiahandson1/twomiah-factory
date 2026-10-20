// "Where's the crew" for the office (crm/field/geofencing.ts GET /crew): each person who has location tracking switched
// on (their own choice, user_settings), with their latest location and whether they are on the clock. Raw SQL for
// DISTINCT ON (RULEBOOK §2).
import { sql } from 'drizzle-orm'

const rowsOf = (r: any): any[] => ((r as any)?.rows || r) as any[]

export interface CrewLocation {
  userId: string
  name: string
  role: string
  trackingOn: boolean
  lat: number | null
  lng: number | null
  accuracy: number | null
  seenAt: string | null
  onTheClock: boolean
}

export async function crewLocations(db: any, companyId: string): Promise<CrewLocation[]> {
  const r = await db.execute(sql`
    SELECT u.id AS user_id, trim(coalesce(u.first_name, '') || ' ' || coalesce(u.last_name, '')) AS name, u.role,
           s.location_tracking_enabled AS tracking_on,
           l.lat, l.lng, l.accuracy, l.timestamp AS seen_at,
           EXISTS (SELECT 1 FROM time_entry t WHERE t.user_id = u.id AND t.company_id = ${companyId} AND t.clock_in IS NOT NULL AND t.clock_out IS NULL) AS on_the_clock
    FROM "user" u
    JOIN user_settings s ON s.user_id = u.id AND s.location_tracking_enabled = true
    LEFT JOIN LATERAL (
      SELECT lat, lng, accuracy, timestamp FROM location_log
      WHERE user_id = u.id AND company_id = ${companyId}
      ORDER BY timestamp DESC LIMIT 1
    ) l ON true
    WHERE u.company_id = ${companyId} AND u.is_active = true
    ORDER BY l.timestamp DESC NULLS LAST, name`)
  return rowsOf(r).map((x: any) => ({
    userId: x.user_id, name: x.name || 'Unnamed', role: x.role, trackingOn: !!x.tracking_on,
    lat: x.lat == null ? null : Number(x.lat), lng: x.lng == null ? null : Number(x.lng),
    accuracy: x.accuracy == null ? null : Number(x.accuracy),
    seenAt: x.seen_at ? new Date(x.seen_at).toISOString() : null,
    onTheClock: !!x.on_the_clock,
  }))
}
