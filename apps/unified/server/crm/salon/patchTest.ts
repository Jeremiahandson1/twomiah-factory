// Patch-test status (salon gap #13): a client's patch test is a date and a result — passed or failed. A service that "needs a
// patch test" (the Service Menu's box) is held back when the client has none on record, it has run out, or it failed:
// ONLINE it is refused outright (the client is asked to call), and at the DESK the booking needs a reason typed, kept on the
// appointment. The rule is the salon's own switch (Settings › The Book, off by default), so a salon that never asked for
// it books exactly as before. A date recorded before results were kept counts as passed.
import { eq } from 'drizzle-orm'
import { clientProfile, company } from '../../db/schema/index.ts'

export const PATCH_TEST_RULE = 'patchTestRule'
/** The menu service a held client is offered online instead (their patch-test appointment); optional, the salon's pick. */
export const PATCH_TEST_SERVICE = 'patchTestServiceId'
/** A patch test is good for this long (it was the Book's warning window already). */
export const PATCH_TEST_VALID_DAYS = 180

export type PatchTestState = 'none' | 'passed' | 'failed' | 'expired'

export function ruleOn(settings: unknown): boolean {
  let s: any = settings
  if (typeof s === 'string') { try { s = JSON.parse(s) } catch { s = {} } }
  return !!(s && typeof s === 'object' && s[PATCH_TEST_RULE] === true)
}

const dayNumber = (ymd: string) => Math.floor(new Date(ymd.slice(0, 10) + 'T00:00:00Z').getTime() / 86_400_000)

/** Where a client stands today (a calendar day, YYYY-MM-DD, on the salon's wall). */
export function patchTestState(at: string | null | undefined, result: string | null | undefined, today: string): { state: PatchTestState; ageDays: number | null } {
  if (!at || !/^\d{4}-\d{2}-\d{2}/.test(String(at))) return { state: 'none', ageDays: null }
  const ageDays = dayNumber(today) - dayNumber(String(at))
  if (result === 'failed') return { state: 'failed', ageDays }
  return { state: ageDays > PATCH_TEST_VALID_DAYS ? 'expired' : 'passed', ageDays }
}

/** Why a service cannot be booked now, in a client's words; null = fine. */
export function patchTestHold(state: PatchTestState, serviceName: string): string | null {
  if (state === 'passed') return null
  const what = serviceName || 'This service'
  if (state === 'failed') return `${what} needs a passed patch test, and the last one did not pass.`
  if (state === 'expired') return `${what} needs a patch test within the last ${Math.round(PATCH_TEST_VALID_DAYS / 30)} months, and yours has run out.`
  return `${what} needs a patch test first, and none is on record.`
}

/** The patch-test service the salon picked, if it is set. */
export function offeredServiceId(settings: unknown): string | null {
  let s: any = settings
  if (typeof s === 'string') { try { s = JSON.parse(s) } catch { s = {} } }
  const id = s && typeof s === 'object' ? s[PATCH_TEST_SERVICE] : null
  return typeof id === 'string' && id ? id : null
}

export async function settingsOf(exec: any, companyId: string) {
  const [co] = await exec.select({ settings: company.settings }).from(company).where(eq(company.id, companyId)).limit(1)
  return co?.settings
}

export async function ruleOnFor(exec: any, companyId: string): Promise<boolean> {
  const [co] = await exec.select({ settings: company.settings }).from(company).where(eq(company.id, companyId)).limit(1)
  return ruleOn(co?.settings)
}

export async function stateFor(exec: any, contactId: string, today: string) {
  const [p] = await exec.select({ at: clientProfile.patchTestAt, result: clientProfile.patchTestResult }).from(clientProfile).where(eq(clientProfile.contactId, contactId)).limit(1)
  return patchTestState(p?.at ?? null, p?.result ?? null, today)
}
