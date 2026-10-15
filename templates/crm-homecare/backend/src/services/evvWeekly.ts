// services/evvWeekly.ts — does THIS visit still need Sandata? (ported from CVHC helpers/evvWeekly.js)
//
// A payer can authorize two kinds of weekly units per client (Sun–Sat weeks): EVV-required
// attendant care (checked in/out on Sandata — S5125 in Wisconsin Family Care) and non-EVV time
// such as homemaker (S5130). `clients.evv_weekly_units` holds the EVV allowance. Visits are sent
// to Sandata until that week's Sandata minutes reach the allowance; after that the rest of the
// week is non-EVV time and the caregiver is not sent to Sandata. A visit that starts while EVV
// minutes remain goes to Sandata whole (a small overshoot is fine).
//
// The decision is stored per visit (time_entries.sandata_required) so the clock-out prompt always
// matches the clock-in: a visit checked in on Sandata is checked out too.
//
// Weeks run Sunday–Saturday in the agency's EVV time zone (services/sandataClient getConfig()).
// time_entries timestamps are stored as UTC wall-clock `timestamp` values, hence the
// `AT TIME ZONE 'UTC'` before converting to the agency zone.
import { sql, type SQL } from 'drizzle-orm'
import { db } from '../../db/index.ts'
import { MA_ID_RE } from './sandataPayload.ts'

export const UNIT_MINUTES = 15

// Minutes a visit counts toward the week. A finished visit counts its BILLABLE minutes (capped
// when a clock-out was missed) — raw clock time would let one forgotten clock-out (a real 23-hour
// punch on a 2¼-hour visit) "use up" a client's EVV week. An open visit counts its elapsed time,
// capped at its scheduled length (16h when none). `atExpr` is a timestamptz expression.
export function visitMinutesSql(atExpr: SQL): SQL {
  return sql`CASE WHEN te.end_time IS NOT NULL
       THEN COALESCE(te.billable_minutes, te.duration_minutes, EXTRACT(EPOCH FROM (te.end_time - te.start_time)) / 60)
       ELSE LEAST(GREATEST(0, EXTRACT(EPOCH FROM (${atExpr} - (te.start_time AT TIME ZONE 'UTC'))) / 60),
                  COALESCE(te.allotted_minutes, 960))
  END`
}

// Local Sun–Sat week (as dates) containing an instant, in the agency zone.
export function weekCte(atIso: string | null, tz: string): SQL {
  return sql`d AS (SELECT ((COALESCE(${atIso}::timestamptz, now())) AT TIME ZONE ${tz})::date AS day),
          w AS (SELECT day - EXTRACT(DOW FROM day)::int AS ws FROM d)`
}

// The one rule for "is this client in Sandata": their payer is marked as a Sandata EVV payer and
// they have a 10–12 digit Medicaid ID on file. Private pay never. The caregiver app receives the
// answer as `in_sandata` (routes/sandata.ts caregiver-context) instead of re-deriving it.
export function clientInSandata(c: { is_private_pay?: boolean | null; sandata_evv_required?: boolean | null; medicaid_id?: string | null } | null | undefined): boolean {
  if (!c || c.is_private_pay === true) return false
  return c.sandata_evv_required === true && MA_ID_RE.test(String(c.medicaid_id || '').trim())
}

const rowsOf = (r: any): any[] => (r && Array.isArray(r.rows) ? r.rows : Array.isArray(r) ? r : [])

// Sandata minutes already used by a client in the Sun–Sat week containing `atIso` (null = now).
// Visits from before the decision existed (sandata_required NULL) count.
export async function evvWeekUsage(clientId: string, atIso: string | null, opts: { excludeEntryId?: string | null; timezone: string }) {
  const at = sql`COALESCE(${atIso}::timestamptz, now())`
  const r = await db.execute(sql`
    WITH ${weekCte(atIso, opts.timezone)}
    SELECT to_char(w.ws, 'YYYY-MM-DD') AS week_start,
           to_char(w.ws + 6, 'YYYY-MM-DD') AS week_end,
           COALESCE(SUM(${visitMinutesSql(at)}), 0)::float AS used_minutes
      FROM w
      LEFT JOIN time_entries te
        ON te.client_id = ${clientId}
       AND ((te.start_time AT TIME ZONE 'UTC') AT TIME ZONE ${opts.timezone})::date BETWEEN w.ws AND w.ws + 6
       AND COALESCE(te.sandata_required, true) = true
       AND (${opts.excludeEntryId ?? null}::text IS NULL OR te.id <> ${opts.excludeEntryId ?? null}::text)
     GROUP BY w.ws`)
  const row = rowsOf(r)[0] || {}
  return { weekStart: row.week_start as string, weekEnd: row.week_end as string, usedMinutes: Math.round(Number(row.used_minutes) || 0) }
}

export interface SandataDecision {
  required: boolean
  reason: 'not_sandata_client' | 'no_allowance_entered' | 'no_evv_units' | 'evv_minutes_remaining' | 'evv_week_met'
  allowanceMinutes?: number
  weekStart?: string
  weekEnd?: string
  usedMinutes?: number
}

// true  = send this visit to Sandata
// false = don't (not a Sandata client, no EVV hours, or this week's EVV hours are met)
export async function decideSandataRequired(clientId: string, atIso: string | null, opts: { excludeEntryId?: string | null; timezone: string }): Promise<SandataDecision> {
  const r = await db.execute(sql`
    SELECT c.is_private_pay, c.medicaid_id, c.evv_weekly_units, rs.sandata_evv_required
      FROM clients c LEFT JOIN referral_sources rs ON rs.id = c.referred_by_id
     WHERE c.id = ${clientId}`)
  const client = rowsOf(r)[0]
  if (!clientInSandata(client)) return { required: false, reason: 'not_sandata_client' }
  if (client.evv_weekly_units == null) return { required: true, reason: 'no_allowance_entered' }
  const allowanceMinutes = Number(client.evv_weekly_units) * UNIT_MINUTES
  if (allowanceMinutes <= 0) return { required: false, reason: 'no_evv_units', allowanceMinutes: 0 }
  const usage = await evvWeekUsage(clientId, atIso, opts)
  const required = usage.usedMinutes < allowanceMinutes
  return { required, reason: required ? 'evv_minutes_remaining' : 'evv_week_met', allowanceMinutes, ...usage }
}

// Never hold up a clock-in on this: if the answer isn't back in `ms`, resolve null and the app
// falls back to prompting (sending an EVV visit to Sandata is the safe side).
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), ms) })
  return Promise.race([promise.finally(() => clearTimeout(timer)), timeout])
}

// Claim days for one client's Sun–Sat week. Pure (no DB). `visits` = that week's finished visits,
// any order: { date:'YYYY-MM-DD', start, minutes, sentToSandata, ... }. EVV minutes come from the
// visits that went through Sandata, in time order, never more than the weekly allowance (null = no
// allowance entered → all Sandata minutes are EVV). Everything else is non-EVV. Units are rounded
// per day (minutes / 15, nearest whole unit), and the week's EVV units are trimmed (latest day
// first) so rounding can never claim more than the allowance.
// The billing area's insurer-portal claim-days page (CVHC EvvClaimWeek / MIDAS) reads this.
export function allocateEvvWeek<V extends { date: string; start: string; minutes: number; sentToSandata: boolean }>(evvWeeklyUnits: number | null, visits: V[]) {
  const allowanceMin = evvWeeklyUnits == null ? Infinity : Number(evvWeeklyUnits) * UNIT_MINUTES
  let evvLeft = allowanceMin
  const sorted = [...visits].sort((a, b) => String(a.start).localeCompare(String(b.start)))
  const byDay = new Map<string, { date: string; evvMinutes: number; homemakerMinutes: number; visits: any[] }>()
  const out = sorted.map((v) => {
    const minutes = Math.max(0, Math.round(Number(v.minutes) || 0))
    const evvMin = v.sentToSandata ? Math.min(minutes, Math.max(0, evvLeft)) : 0
    if (v.sentToSandata) evvLeft -= evvMin
    const row = { ...v, minutes, evvMinutes: evvMin, homemakerMinutes: minutes - evvMin }
    const d = byDay.get(v.date) || { date: v.date, evvMinutes: 0, homemakerMinutes: 0, visits: [] }
    d.evvMinutes += row.evvMinutes; d.homemakerMinutes += row.homemakerMinutes; d.visits.push(row)
    byDay.set(v.date, d)
    return row
  })
  const days = [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date)).map((d) => ({
    ...d,
    evvUnits: Math.round(d.evvMinutes / UNIT_MINUTES),
    homemakerUnits: Math.round(d.homemakerMinutes / UNIT_MINUTES),
  }))
  if (Number.isFinite(allowanceMin)) {
    let over = days.reduce((s, d) => s + d.evvUnits, 0) - Number(evvWeeklyUnits)
    for (let i = days.length - 1; i >= 0 && over > 0; i--) {
      const cut = Math.min(over, days[i].evvUnits)
      days[i].evvUnits -= cut; days[i].homemakerUnits += cut; over -= cut
    }
  }
  return {
    days,
    visits: out,
    totals: {
      evvUnits: days.reduce((s, d) => s + d.evvUnits, 0),
      homemakerUnits: days.reduce((s, d) => s + d.homemakerUnits, 0),
      evvAuthorizedUnits: evvWeeklyUnits == null ? null : Number(evvWeeklyUnits),
    },
  }
}
