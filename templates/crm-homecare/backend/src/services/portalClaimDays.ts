// Insurer-portal claim days — ported from CVHC's MIDAS claim days page (billingRoutes
// GET /evv-claim-week + helpers/evvWeekly.js allocateEvvWeek), generalised.
//
// CVHC built this for ONE insurer: My Choice Wisconsin authorises two kinds of weekly units per
// client, keyed into its MIDAS portal per day —
//   S5125 attendant care — EVV required (checked in/out on Sandata)
//   S5130 homemaker      — no EVV
// and the office needs, per client per day, how many units of each to claim.
//
// Here the portal, the two procedure codes and their labels are DATA on the payer
// (referral_sources.claim_portal), so My Choice / MIDAS is one configuration and another insurer
// with the same two-code shape is another. WISCONSIN_PRESETS is offered by the screen only when the
// agency's state is WI.
//
// The arithmetic is CVHC's, unchanged:
//   · a Sun–Sat week; 1 unit = 15 minutes
//   · EVV minutes come from the visits that went through EVV, in time order, never more than the
//     client's weekly EVV allowance (NULL allowance = all EVV time counts as EVV)
//   · everything else is the other code (homemaker)
//   · units are rounded PER DAY, and the week's EVV units are trimmed latest-day-first so rounding
//     can never claim more than the allowance
//   · training (shadow) shifts never bill
//
// The week's allocation is evv's allocateEvvWeek (services/evvWeekly.ts) — one copy for the EVV
// screens and this page. A visit with no stored Sandata decision (time_entries.sandata_required NULL,
// e.g. from before the decision existed) of an EVV client counts as EVV.
import { sql } from 'drizzle-orm'
import { allocateEvvWeek } from './evvWeekly.ts'

export interface ClaimPortalConfig {
  name: string          // the portal, e.g. "MIDAS"
  evvCode: string       // e.g. "S5125"
  evvLabel: string      // e.g. "Attendant care (EVV)"
  otherCode: string     // e.g. "S5130"
  otherLabel: string    // e.g. "Homemaker"
}

/** Offered by the screen when the agency's state is WI. Data, not behaviour. */
export const WISCONSIN_PRESETS: Array<{ id: string; label: string; config: ClaimPortalConfig }> = [
  {
    id: 'wi-my-choice-midas',
    label: 'My Choice Wisconsin — MIDAS (S5125 attendant care / S5130 homemaker)',
    config: { name: 'MIDAS', evvCode: 'S5125', evvLabel: 'Attendant care (EVV)', otherCode: 'S5130', otherLabel: 'Homemaker' },
  },
]

/** A config is usable when it names the portal and both codes. */
export function parseClaimPortal(v: any): ClaimPortalConfig | null {
  let o = v
  if (typeof o === 'string') { try { o = JSON.parse(o) } catch { return null } }
  if (!o || typeof o !== 'object') return null
  const s = (x: any) => (typeof x === 'string' ? x.trim() : '')
  const cfg = { name: s(o.name), evvCode: s(o.evvCode), evvLabel: s(o.evvLabel), otherCode: s(o.otherCode), otherLabel: s(o.otherLabel) }
  if (!cfg.name || !cfg.evvCode || !cfg.otherCode) return null
  return { ...cfg, evvLabel: cfg.evvLabel || cfg.evvCode, otherLabel: cfg.otherLabel || cfg.otherCode }
}

/** A client goes through EVV for this payer when they bill the payer (not private pay) and have a
 *  Medicaid ID on file — the EVV system has no record of a member without one. */
export function clientInEvv(c: { is_private_pay?: boolean | null; medicaid_id?: string | null }) {
  if (!c || c.is_private_pay === true) return false
  return String(c.medicaid_id || '').trim().length > 0
}

type Dbc = { execute: (q: any) => Promise<any> }
const rowsOf = (r: any): any[] => (r?.rows ?? r ?? []) as any[]

/** The Sunday (YYYY-MM-DD) of the week containing `day`. */
export function sundayOf(day: string) {
  const d = new Date(day + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() - d.getUTCDay())
  return d.toISOString().slice(0, 10)
}

/**
 * Claim days for every client of `payerId` for the Sun–Sat week containing `weekStart`.
 * Times are on the agency's clock (`tz`).
 */
export async function portalClaimWeek(dbc: Dbc, payerId: string, weekStart: string, tz: string) {
  const ws = sundayOf(weekStart)
  const we = (() => { const d = new Date(ws + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + 6); return d.toISOString().slice(0, 10) })()

  const local = (c: string) => sql.raw(`((${c} AT TIME ZONE 'UTC') AT TIME ZONE `)

  const r = rowsOf(await dbc.execute(sql`
    SELECT te.id, te.client_id,
           te.sandata_required AS sent_flag,
           te.needs_approval AS needs_approval,
           te.approval_reason AS approval_reason,
           COALESCE(te.billable_minutes, te.duration_minutes, EXTRACT(EPOCH FROM (te.end_time - te.start_time)) / 60) AS minutes,
           to_char(${local('te.start_time')}${tz}), 'YYYY-MM-DD') AS date,
           to_char(${local('te.start_time')}${tz}), 'YYYY-MM-DD"T"HH24:MI') AS start,
           to_char(${local('te.start_time')}${tz}), 'FMHH12:MI AM') AS clock_in,
           to_char(${local('te.end_time')}${tz}), 'FMHH12:MI AM') AS clock_out,
           COALESCE(s.is_training, false) AS is_training,
           u.first_name || ' ' || u.last_name AS caregiver,
           c.first_name, c.last_name, c.medicaid_id, c.mco_member_id, c.is_private_pay,
           c.evv_weekly_units
      FROM time_entries te
      JOIN clients c ON c.id = te.client_id
      JOIN users u ON u.id = te.caregiver_id
      LEFT JOIN schedules s ON s.id = te.schedule_id
     WHERE te.end_time IS NOT NULL
       AND c.referred_by_id = ${payerId}
       AND COALESCE(c.is_private_pay, false) = false
       AND (${local('te.start_time')}${tz}))::date BETWEEN ${ws}::date AND ${we}::date
     ORDER BY c.last_name, c.first_name, te.start_time`))

  const byClient = new Map<string, any>()
  for (const v of r) {
    if (v.is_training === true) continue
    if (!byClient.has(v.client_id)) {
      byClient.set(v.client_id, {
        client_id: v.client_id, client_name: `${v.first_name} ${v.last_name}`.trim(),
        medicaid_id: v.medicaid_id || null, mco_member_id: v.mco_member_id || null,
        evv_weekly_units: v.evv_weekly_units == null ? null : Number(v.evv_weekly_units),
        in_evv: clientInEvv(v), visits: [] as any[],
      })
    }
    const cl = byClient.get(v.client_id)
    cl.visits.push({
      id: v.id, date: v.date, start: v.start, clock_in: v.clock_in, clock_out: v.clock_out,
      caregiver: v.caregiver, minutes: Number(v.minutes) || 0,
      // No stored decision (visits from before the Sandata decision existed): an EVV client's
      // visits all went through EVV.
      sentToSandata: v.sent_flag == null ? cl.in_evv : v.sent_flag === true,
      needs_approval: v.needs_approval === true, approval_reason: v.approval_reason || null,
    })
  }
  const clients = [...byClient.values()].map((cl) => {
    const alloc = allocateEvvWeek(cl.in_evv ? cl.evv_weekly_units : 0, cl.visits)
    const { visits, ...rest } = cl
    return { ...rest, ...alloc, pending_approval: visits.filter((v: any) => v.needs_approval).length }
  })
  return { week_start: ws, week_end: we, clients }
}
