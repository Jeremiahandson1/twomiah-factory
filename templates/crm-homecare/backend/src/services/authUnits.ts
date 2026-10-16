// Authorization units — the ONE place that converts between what a claim bills and what an
// authorization counts.
//
// A claim always bills 15-minute units (claims.units_billed: 8.00 for a 2-hour visit). An
// authorization counts in its own unit_type, which the office picks on the form:
//
//   '15min'  — 15-minute units (the DB default): claim units as they are
//   'hours'  — hours: claim units ÷ 4
//   'visits' — visits: the number of visits the claim covers (an EVV claim is one visit; a claim
//              made from an invoice covers each distinct visit on its lines)
//   'days'   — days of service: the number of distinct service days the claim covers
//
// Before this module the deduction added the claim's 15-minute units straight onto used_units
// whatever the unit_type, so an hours authorization was used up four times too fast, and the
// forecast and optimizer read 'visits' and 'days' as hours.
//
// Older rows and older callers spelled the same units 'hour', 'hourly', 'visit', 'day', 'daily'.
// normalizeAuthUnit reads every one of them; an unknown spelling is null so a writer can refuse it.

export type AuthUnit = '15min' | 'hours' | 'visits' | 'days'
export const AUTH_UNITS: AuthUnit[] = ['15min', 'hours', 'visits', 'days']
export const AUTH_UNIT_LABEL: Record<AuthUnit, string> = { '15min': '15-minute units', hours: 'hours', visits: 'visits', days: 'days' }

const ALIASES: Record<string, AuthUnit> = {
  '15min': '15min', '15-min': '15min', '15_min': '15min', unit: '15min', units: '15min', quarter_hour: '15min',
  hours: 'hours', hour: 'hours', hourly: 'hours', hr: 'hours', hrs: 'hours',
  visits: 'visits', visit: 'visits', per_visit: 'visits',
  days: 'days', day: 'days', daily: 'days',
}

/** The canonical unit for a stored or submitted spelling; '' / null → the DB default '15min';
 *  anything unrecognised → null. */
export function normalizeAuthUnit(v: unknown): AuthUnit | null {
  if (v == null || String(v).trim() === '') return '15min'
  return ALIASES[String(v).trim().toLowerCase()] ?? null
}

/** What a claim (or a planned shift) uses of an authorization, in the authorization's own unit. */
export function toAuthUnits(unit: unknown, use: { quarterHours: number; visits: number; days: number }): number {
  const u = normalizeAuthUnit(unit) ?? '15min'
  const r2 = (n: number) => Math.round(n * 100) / 100
  if (u === 'hours') return r2(use.quarterHours / 4)
  if (u === 'visits') return use.visits
  if (u === 'days') return use.days
  return r2(use.quarterHours)
}

/** Authorization units as hours — null for visits and days, which have no hour equivalent. */
export function authUnitsToHours(units: number, unit: unknown): number | null {
  const u = normalizeAuthUnit(unit) ?? '15min'
  if (u === '15min') return units / 4
  if (u === 'hours') return units
  return null
}

/** The same conversion in SQL, for queries that sum authorizations: NULL for visits / days. */
export function authUnitsToHoursSql(unitsCol: string, unitCol: string): string {
  const t = `LOWER(COALESCE(NULLIF(TRIM(${unitCol}), ''), '15min'))`
  return `(CASE WHEN ${t} IN ('15min', '15-min', '15_min', 'unit', 'units', 'quarter_hour') THEN (${unitsCol}) / 4.0
                WHEN ${t} IN ('hours', 'hour', 'hourly', 'hr', 'hrs') THEN (${unitsCol})
                ELSE NULL END)`
}
