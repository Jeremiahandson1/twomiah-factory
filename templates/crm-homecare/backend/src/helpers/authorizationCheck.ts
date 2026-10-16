// Authorization ADVICE for staffing a shift. It never blocks. (Ported from the CVHC home care CRM,
// helpers/authorizationCheck.js.)
//
// Scheduling is not billing: a client needs care whether or not the payer has approved units yet,
// and refusing to staff a shift is the most expensive response to a paperwork gap. CVHC's hard block
// silently refused schedule creation for 8 of its 25 payer clients. Every shortfall is a warning;
// callers surface `warnings` and must not refuse the write. `allowed` is always true.
import { sql } from 'drizzle-orm'
import { one } from './scheduleRows.ts'
import { privatePaySql } from './payerFunding.ts'
import { toAuthUnits } from '../services/authUnits.ts'

export async function checkAuthorizationBalance(clientId: string | null | undefined, shiftHours: number): Promise<{
  allowed: true; warnings: string[]; authorization: any | null
}> {
  const warnings: string[] = []
  if (!clientId) return { allowed: true, warnings, authorization: null }

  // Authorizations apply only to payer-funded services (helpers/payerFunding.ts): a private-pay
  // client — by the flag OR by a payer whose payer_type is private_pay — gets no authorization advice.
  const pp = await one<any>(sql`SELECT ${privatePaySql('c')} AS private_pay FROM clients c WHERE c.id = ${clientId}`)
  if (pp?.private_pay) return { allowed: true, warnings, authorization: null }

  const auth = await one<any>(sql`
    SELECT a.*, to_char(a.end_date, 'YYYY-MM-DD') AS end_ymd,
      (a.authorized_units - a.used_units) AS remaining_units,
      ROUND((a.used_units / NULLIF(a.authorized_units, 0)) * 100, 1) AS pct_used,
      CASE
        WHEN a.end_date < CURRENT_DATE THEN 'expired'
        WHEN a.authorized_units - a.used_units <= a.low_units_alert_threshold THEN 'low'
        WHEN a.end_date <= CURRENT_DATE + 30 THEN 'expiring_soon'
        ELSE 'ok'
      END AS health_status
    FROM authorizations a
    WHERE a.client_id = ${clientId} AND a.status = 'active'
      AND a.start_date <= CURRENT_DATE AND a.end_date >= CURRENT_DATE
    ORDER BY a.end_date ASC
    LIMIT 1`)

  if (!auth) {
    return { allowed: true, warnings: ['No active authorization on file for this client'], authorization: null }
  }

  const remaining = parseFloat(auth.remaining_units) || 0
  // One shift is shiftHours × 4 quarter-hours, one visit, one day — in the authorization's unit.
  const requested = toAuthUnits(auth.unit_type, { quarterHours: shiftHours * 4, visits: 1, days: 1 })
  const threshold = parseFloat(auth.low_units_alert_threshold) || 0

  if (auth.health_status === 'expired') {
    warnings.push(`Authorization ${auth.auth_number || ''} expired on ${auth.end_ymd} — this shift may not be billable until it's renewed`.replace('  ', ' '))
  }
  if (remaining < requested) {
    warnings.push(`Authorization balance looks short: ${remaining} ${auth.unit_type || 'unit'} remaining, ${requested} needed for this shift — check ${auth.auth_number ? 'auth ' + auth.auth_number : 'the authorization'} before billing`)
  }
  if (auth.health_status === 'low') {
    warnings.push(`Authorization running low: ${remaining} units remaining (${auth.pct_used}% used)`)
  }
  if (auth.health_status === 'expiring_soon') {
    const daysLeft = Math.ceil((new Date(`${auth.end_ymd}T00:00:00Z`).getTime() - Date.now()) / 86400000)
    warnings.push(`Authorization expires in ${daysLeft} days (${auth.end_ymd})`)
  }
  if (remaining - requested <= threshold) {
    warnings.push(`After this shift, only ${(remaining - requested).toFixed(1)} units will remain`)
  }
  return { allowed: true, warnings, authorization: auth }
}
