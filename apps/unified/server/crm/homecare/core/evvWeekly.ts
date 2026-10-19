// Does THIS visit still need Sandata? Moved from templates/crm-homecare/backend/src/services/evvWeekly.ts (ported
// there from CVHC helpers/evvWeekly.js). The SQL (visitMinutesSql, weekCte and the two reads) is in
// server/data/homecareEvv.ts.
//
// A payer can authorize two kinds of weekly units per client (Sun–Sat weeks): EVV-required attendant care (checked
// in/out on Sandata — S5125 in Wisconsin Family Care) and non-EVV time such as homemaker (S5130).
// `clients.evv_weekly_units` holds the EVV allowance. Visits are sent to Sandata until that week's Sandata minutes reach
// the allowance; after that the rest of the week is non-EVV time. A visit that starts while EVV minutes remain goes to
// Sandata whole (a small overshoot is fine). The decision is stored per visit (time_entries.sandata_required) so the
// clock-out prompt always matches the clock-in. Weeks run Sunday–Saturday in the agency's EVV time zone.
//
// Changes: the reads are the company's (evvWeekUsage / decideSandataRequired take its id first); clientInSandata reads
// a camelCase client (isPrivatePay, sandataEvvRequired, medicaidId).
import type { CrmDeps } from '../../deps.ts'
import { evvWeekUsageRow, clientSandataFacts } from '../../../data/homecareEvv.ts'
import { MA_ID_RE } from './sandataPayload.ts'

export const UNIT_MINUTES = 15

// The one rule for "is this client in Sandata": their payer is marked as a Sandata EVV payer and they have a 10–12
// digit Medicaid ID on file. Private pay never. The caregiver app receives the answer as `inSandata`.
export function clientInSandata(c: { isPrivatePay?: boolean | null; sandataEvvRequired?: boolean | null; medicaidId?: string | null } | null | undefined): boolean {
  if (!c || c.isPrivatePay === true) return false
  return c.sandataEvvRequired === true && MA_ID_RE.test(String(c.medicaidId || '').trim())
}

export interface SandataDecision {
  required: boolean
  reason: 'not_sandata_client' | 'no_allowance_entered' | 'no_evv_units' | 'evv_minutes_remaining' | 'evv_week_met'
  allowanceMinutes?: number
  weekStart?: string
  weekEnd?: string
  usedMinutes?: number
}

// Never hold up a clock-in on this: if the answer isn't back in `ms`, resolve null and the app falls back to prompting
// (sending an EVV visit to Sandata is the safe side).
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), ms) })
  return Promise.race([promise.finally(() => clearTimeout(timer)), timeout])
}

// Claim days for one client's Sun–Sat week. Pure (no DB). `visits` = that week's finished visits, any order:
// { date:'YYYY-MM-DD', start, minutes, sentToSandata, ... }. EVV minutes come from the visits that went through
// Sandata, in time order, never more than the weekly allowance (null = no allowance entered → all Sandata minutes are
// EVV). Everything else is non-EVV. Units are rounded per day (minutes / 15, nearest whole unit), and the week's EVV
// units are trimmed (latest day first) so rounding can never claim more than the allowance.
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

export function createEvvWeekly(d: CrmDeps) {
  /** Sandata minutes already used by a client in the Sun–Sat week containing `atIso` (null = now). */
  function evvWeekUsage(companyId: string, clientId: string, atIso: string | null, opts: { excludeEntryId?: string | null; timezone: string }) {
    return evvWeekUsageRow(d.db, companyId, clientId, atIso, opts)
  }

  // true  = send this visit to Sandata
  // false = don't (not a Sandata client, no EVV hours, or this week's EVV hours are met)
  async function decideSandataRequired(companyId: string, clientId: string, atIso: string | null, opts: { excludeEntryId?: string | null; timezone: string }): Promise<SandataDecision> {
    const client = await clientSandataFacts(d.db, companyId, clientId)
    if (!clientInSandata(client)) return { required: false, reason: 'not_sandata_client' }
    if (client!.evvWeeklyUnits == null) return { required: true, reason: 'no_allowance_entered' }
    const allowanceMinutes = Number(client!.evvWeeklyUnits) * UNIT_MINUTES
    if (allowanceMinutes <= 0) return { required: false, reason: 'no_evv_units', allowanceMinutes: 0 }
    const usage = await evvWeekUsage(companyId, clientId, atIso, opts)
    const required = usage.usedMinutes < allowanceMinutes
    return { required, reason: required ? 'evv_minutes_remaining' : 'evv_week_met', allowanceMinutes, ...usage }
  }

  return { evvWeekUsage, decideSandataRequired }
}

export type EvvWeekly = ReturnType<typeof createEvvWeekly>
