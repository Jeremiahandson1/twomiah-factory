// Who an open shift may be told to: active caregivers who are free then, not ruled out for this client or this day (do-not-use list, time off,
// marked unavailable, outside the days and hours they work), without an expired credential the agency blocks, and — when the posting was
// offered to chosen caregivers only — one of those. The broadcast and the resend to newcomers use the same rule.
import type { CrmDeps } from '../../deps.ts'
import type { HomecareCore } from '../core/index.ts'
import { caregiverFit, doNotUseOf } from '../core/caregiverFit.ts'
import { eligibleForShift, caregiversForSuggestions, clientForSuggestions } from '../../../data/homecareScheduling.ts'
import { MATCH_PREFS_FEATURE, matchTraits, normMustHave } from '../core/matchTraits.ts'
import { distanceMiles } from './schedulingHub.ts'

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

/** The caregivers this shift's client and day rule out (core/caregiverFit.ts — the auto-fill and suggestion rule). */
async function unfitFor(d: CrmDeps, companyId: string, s: any): Promise<Set<string>> {
  const date = String(s.shiftDate).slice(0, 10)
  const cgs = await caregiversForSuggestions(d.db, companyId, WEEKDAYS[new Date(`${date}T12:00:00Z`).getUTCDay()], date)
  const client = s.clientId ? await clientForSuggestions(d.db, companyId, s.clientId) : null
  const dnu = doNotUseOf(client)
  // Row 14 (care_match_prefs): a caregiver who misses one of the client's must-haves is not offered the shift (WellSky: caregivers see
  // the open shifts they qualify for).
  const matchPrefs = !!client && await d.features.isFeatureEnabled(companyId, MATCH_PREFS_FEATURE)
  return new Set(cgs.filter((cg: any) => caregiverFit(cg, dnu, s.startTime, s.endTime).blocks.length
    || (matchPrefs && matchTraits(client, cg, distanceMiles(cg.latitude, cg.longitude, client.latitude, client.longitude)).hardMisses.length)).map((cg: any) => String(cg.id)))
}

export async function eligibleToTell(core: HomecareCore, d: CrmDeps, companyId: string, s: any): Promise<any[]> {
  const blocked = await unfitFor(d, companyId, s)
  const all = await eligibleForShift(d.db, companyId, s)
  // Nobody with an expired credential is told when the agency blocks them (Credential settings › Block).
  const noCert = await core.certReminders.blockedFor(companyId, all.map((r) => String(r.id)), s.shiftDate)
  return all.filter((r) => !r.hasConflict && !blocked.has(String(r.id)) && !noCert[String(r.id)] && (!Array.isArray(s.visibleTo) || s.visibleTo.includes(r.id)))
}

/** Row 14: does this caregiver miss one of the shift client's must-haves (care_match_prefs)? False when the client has none. */
export async function mustHaveMiss(d: CrmDeps, companyId: string, s: any, caregiverId: string): Promise<boolean> {
  if (!s.clientId) return false
  const client = await clientForSuggestions(d.db, companyId, s.clientId)
  if (!client || !normMustHave(client.matchMustHave).length) return false
  const date = String(s.shiftDate ?? s.date).slice(0, 10)
  const cg = (await caregiversForSuggestions(d.db, companyId, null, date)).find((x: any) => String(x.id) === String(caregiverId))
  if (!cg) return false
  return matchTraits(client, cg, distanceMiles(cg.latitude, cg.longitude, client.latitude, client.longitude)).hardMisses.length > 0
}
