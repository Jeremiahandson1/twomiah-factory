// Authorization ADVICE for schedule creation. It never blocks.
//
// Scheduling is not billing: a client needs care whether or not the payer has approved units
// yet, and refusing to staff a shift is the most expensive possible answer to a paperwork gap.
// It also compares two different quantities — an authorization is often a WEEKLY allowance while
// used_units accumulates across the whole period — so a hard block goes negative in week two and
// never recovers. Every shortfall is therefore a warning; callers surface `warnings` and never
// refuse the write. `allowed` stays (always true) for callers that check it.
import { db } from '../../db/index.ts'
import { sql } from 'drizzle-orm'

const rowsOf = (r: any): any[] => r?.rows ?? r ?? []

export async function checkAuthorizationBalance(clientId: string, hours: number): Promise<{
  allowed: true; warnings: string[]; error: null; authorization: any | null
}> {
  const warnings: string[] = []
  const auth = rowsOf(await db.execute(sql`
    SELECT a.*,
           a.authorized_units - a.used_units AS remaining_units,
           ROUND((a.used_units / NULLIF(a.authorized_units, 0)) * 100, 1) AS pct_used,
           CASE
             WHEN a.end_date < CURRENT_DATE THEN 'expired'
             WHEN a.authorized_units - a.used_units <= a.low_units_alert_threshold THEN 'low'
             WHEN a.end_date <= CURRENT_DATE + 30 THEN 'expiring_soon'
             ELSE 'ok'
           END AS health_status
      FROM authorizations a
     WHERE a.client_id = ${clientId}
       AND a.status = 'active'
       AND a.start_date <= CURRENT_DATE
       AND a.end_date >= CURRENT_DATE
     ORDER BY a.end_date ASC
     LIMIT 1`))[0]

  if (!auth) {
    const client = rowsOf(await db.execute(sql`SELECT is_private_pay FROM clients WHERE id = ${clientId}`))[0]
    if (client?.is_private_pay) return { allowed: true, warnings: [], error: null, authorization: null }
    return { allowed: true, warnings: ['No active authorization on file for this client'], error: null, authorization: null }
  }

  const remaining = parseFloat(auth.remaining_units) || 0
  let requestedUnits: number
  switch (auth.unit_type) {
    case 'hourly': requestedUnits = hours; break
    case 'daily': requestedUnits = 1; break
    case 'visit': requestedUnits = 1; break
    default: requestedUnits = hours * 4; break // 15-minute units
  }
  const threshold = parseFloat(auth.low_units_alert_threshold) || 0

  if (auth.health_status === 'expired') {
    warnings.push(`Authorization ${auth.auth_number || ''} expired on ${String(auth.end_date).slice(0, 10)} — this shift may not be billable until it's renewed`.replace('  ', ' '))
  }
  if (remaining < requestedUnits) {
    warnings.push(`Authorization balance looks short: ${remaining} ${auth.unit_type || 'unit'} remaining, ${requestedUnits} needed for this shift — check ${auth.auth_number ? 'auth ' + auth.auth_number : 'the authorization'} before billing`)
  }
  if (auth.health_status === 'low') {
    warnings.push(`Authorization running low: ${remaining} units remaining (${auth.pct_used}% used)`)
  }
  if (auth.health_status === 'expiring_soon') {
    const daysLeft = Math.ceil((new Date(auth.end_date).getTime() - Date.now()) / 86400000)
    warnings.push(`Authorization expires in ${daysLeft} days (${String(auth.end_date).slice(0, 10)})`)
  }
  if (remaining - requestedUnits <= threshold) {
    warnings.push(`After this shift, only ${(remaining - requestedUnits).toFixed(1)} units will remain`)
  }
  return { allowed: true, warnings, error: null, authorization: auth }
}
