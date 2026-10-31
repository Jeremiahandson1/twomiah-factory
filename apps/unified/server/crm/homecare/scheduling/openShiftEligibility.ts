// Who an open shift may be told to: active caregivers who are free then, not ruled out for this client or this day (do-not-use list, time off,
// marked unavailable, outside the days and hours they work), without an expired credential the agency blocks, and — when the posting was
// offered to chosen caregivers only — one of those. The broadcast and the resend to newcomers use the same rule.
import type { CrmDeps } from '../../deps.ts'
import type { HomecareCore } from '../core/index.ts'
import { caregiverFit, doNotUseOf } from '../core/caregiverFit.ts'
import { eligibleForShift, caregiversForSuggestions, clientForSuggestions } from '../../../data/homecareScheduling.ts'

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

/** The caregivers this shift's client and day rule out (core/caregiverFit.ts — the auto-fill and suggestion rule). */
async function unfitFor(d: CrmDeps, companyId: string, s: any): Promise<Set<string>> {
  const date = String(s.shiftDate).slice(0, 10)
  const cgs = await caregiversForSuggestions(d.db, companyId, WEEKDAYS[new Date(`${date}T12:00:00Z`).getUTCDay()], date)
  const dnu = doNotUseOf(s.clientId ? await clientForSuggestions(d.db, companyId, s.clientId) : null)
  return new Set(cgs.filter((cg: any) => caregiverFit(cg, dnu, s.startTime, s.endTime).blocks.length).map((cg: any) => String(cg.id)))
}

export async function eligibleToTell(core: HomecareCore, d: CrmDeps, companyId: string, s: any): Promise<any[]> {
  const blocked = await unfitFor(d, companyId, s)
  const all = await eligibleForShift(d.db, companyId, s)
  // Nobody with an expired credential is told when the agency blocks them (Credential settings › Block).
  const noCert = await core.certReminders.blockedFor(companyId, all.map((r) => String(r.id)), s.shiftDate)
  return all.filter((r) => !r.hasConflict && !blocked.has(String(r.id)) && !noCert[String(r.id)] && (!Array.isArray(s.visibleTo) || s.visibleTo.includes(r.id)))
}
