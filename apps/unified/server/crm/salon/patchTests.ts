// A client's patch tests, kept as a history (salon parity row 22; Fresha "record client patch tests"): each has a date, a status — pending, passed
// or failed — who ran it, a title and a description. The latest PASSED-or-FAILED test is mirrored onto client_profile.patch_test_at / _result, which
// is what the booking rule (./patchTest.ts) has always read, so the rule is unchanged; a pending test is not a result and changes nothing there.
// Completing the salon's named patch-test appointment records a test for it and asks for the result (the appointment answer carries the test).
import { and, desc, eq } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import { clientProfile, patchTest, serviceMenu, user } from '../../db/schema/index.ts'
import type { SalonClock } from './days.ts'
import { calendarDateIn } from './days.ts'
import { offeredServiceId, patchTestState, settingsOf } from './patchTest.ts'

export const PATCH_STATUSES = ['pending', 'passed', 'failed'] as const
export type PatchStatus = (typeof PATCH_STATUSES)[number]
export class PatchTestError extends Error { constructor(message: string, public status: 400 | 404 | 409, public code: string, public field?: string) { super(message) } }

const nameOf = (u: any) => [u?.firstName, u?.lastName].filter(Boolean).join(' ').trim() || u?.email || ''
const realDay = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(s + 'T00:00:00Z').getTime()) && new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s

export type PatchTestView = {
  id: string; testedAt: string; status: PatchStatus; title: string | null; description: string | null
  ranByName: string | null; ranByUserId: string | null; appointmentId: string | null
}
const view = (r: typeof patchTest.$inferSelect): PatchTestView => ({
  id: r.id, testedAt: String(r.testedAt).slice(0, 10), status: r.status as PatchStatus, title: r.title, description: r.description,
  ranByName: r.ranByName, ranByUserId: r.ranByUserId, appointmentId: r.appointmentId,
})

export function createPatchTests(db: any, clock: SalonClock) {
  /** Put the latest passed/failed test on the client's profile (created if the client has none yet). */
  async function mirror(exec: any, companyId: string, contactId: string): Promise<void> {
    const rows: Array<typeof patchTest.$inferSelect> = await exec.select().from(patchTest)
      .where(and(eq(patchTest.companyId, companyId), eq(patchTest.contactId, contactId)))
      .orderBy(desc(patchTest.testedAt), desc(patchTest.createdAt))
    const latest = rows.find((r) => r.status === 'passed' || r.status === 'failed')
    const values = { patchTestAt: latest ? String(latest.testedAt).slice(0, 10) : null, patchTestResult: latest ? latest.status : null }
    const [profile] = await exec.select({ id: clientProfile.id }).from(clientProfile).where(and(eq(clientProfile.contactId, contactId), eq(clientProfile.companyId, companyId))).limit(1)
    if (profile) await exec.update(clientProfile).set({ ...values, updatedAt: new Date() }).where(eq(clientProfile.id, profile.id))
    else if (latest) await exec.insert(clientProfile).values({ id: createId(), contactId, companyId, ...values } as any)
  }

  async function list(companyId: string, contactId: string): Promise<PatchTestView[]> {
    const rows = await db.select().from(patchTest).where(and(eq(patchTest.companyId, companyId), eq(patchTest.contactId, contactId))).orderBy(desc(patchTest.testedAt), desc(patchTest.createdAt))
    return rows.map(view)
  }

  async function checked(companyId: string, input: Record<string, unknown>, actor: any, existing?: typeof patchTest.$inferSelect) {
    const today = await clock.salonToday(companyId)
    const out: Record<string, unknown> = {}
    if (input.testedAt !== undefined || !existing) {
      const day = String(input.testedAt ?? today).slice(0, 10)
      if (!realDay(day)) throw new PatchTestError('Enter the date of the test.', 400, 'BAD_DATE', 'testedAt')
      if (day > today) throw new PatchTestError('A patch test cannot be dated in the future.', 400, 'BAD_DATE', 'testedAt')
      out.testedAt = day
    }
    if (input.status !== undefined || !existing) {
      const status = String(input.status ?? 'pending')
      if (!(PATCH_STATUSES as readonly string[]).includes(status)) throw new PatchTestError('A patch test is pending, passed or failed.', 400, 'BAD_STATUS', 'status')
      out.status = status
    }
    for (const [k, max, label] of [['title', 120, 'Title'], ['description', 1000, 'Description']] as const) {
      if (input[k] === undefined) { if (!existing) out[k] = null; continue }
      const v = String(input[k] ?? '').trim()
      if (v.length > max) throw new PatchTestError(`${label} must be ${max} characters or fewer.`, 400, 'TOO_LONG', k)
      out[k] = v || null
    }
    // Who ran it: a login of this salon, or a name typed (a chair-only stylist has no login). Default: the person recording it.
    if (input.ranByUserId !== undefined || input.ranByName !== undefined || !existing) {
      if (typeof input.ranByUserId === 'string' && input.ranByUserId) {
        const [u] = await db.select().from(user).where(and(eq(user.id, input.ranByUserId), eq(user.companyId, companyId))).limit(1)
        if (!u) throw new PatchTestError('Choose someone from your team.', 400, 'BAD_PERSON', 'ranByUserId')
        out.ranByUserId = u.id; out.ranByName = nameOf(u)
      } else if (typeof input.ranByName === 'string' && input.ranByName.trim()) {
        out.ranByUserId = null; out.ranByName = input.ranByName.trim().slice(0, 80)
      } else if (!existing) {
        out.ranByUserId = actor?.userId || actor?.id || null; out.ranByName = nameOf(actor) || null
      }
    }
    return out
  }

  async function create(companyId: string, contactId: string, input: Record<string, unknown>, actor: any): Promise<PatchTestView> {
    const values = await checked(companyId, input, actor)
    let row!: typeof patchTest.$inferSelect
    await db.transaction(async (tx: any) => {
      ;[row] = await tx.insert(patchTest).values({ companyId, contactId, ...values } as any).returning()
      await mirror(tx, companyId, contactId)
    })
    return view(row)
  }

  async function update(companyId: string, id: string, input: Record<string, unknown>, actor: any): Promise<PatchTestView & { contactId: string }> {
    const [existing] = await db.select().from(patchTest).where(and(eq(patchTest.id, id), eq(patchTest.companyId, companyId))).limit(1)
    if (!existing) throw new PatchTestError('That patch test is gone.', 404, 'NOT_FOUND')
    const values = await checked(companyId, input, actor, existing)
    let row = existing
    await db.transaction(async (tx: any) => {
      ;[row] = await tx.update(patchTest).set({ ...values, updatedAt: new Date() } as any).where(eq(patchTest.id, id)).returning()
      await mirror(tx, companyId, existing.contactId)
    })
    return { ...view(row), contactId: existing.contactId }
  }

  async function remove(companyId: string, id: string): Promise<{ contactId: string; was: PatchTestView }> {
    const [existing] = await db.select().from(patchTest).where(and(eq(patchTest.id, id), eq(patchTest.companyId, companyId))).limit(1)
    if (!existing) throw new PatchTestError('That patch test is gone.', 404, 'NOT_FOUND')
    await db.transaction(async (tx: any) => {
      await tx.delete(patchTest).where(eq(patchTest.id, id))
      await mirror(tx, companyId, existing.contactId)
    })
    return { contactId: existing.contactId, was: view(existing) }
  }

  /**
   * The salon's named patch-test appointment was completed: record a test for it (once — one test per appointment) dated that day and run by its
   * stylist, with the result if the desk gave one, else pending (the screen then asks). Any other appointment: null.
   */
  async function forCompletedVisit(companyId: string, appt: { id: string; contactId: string | null; serviceId: string | null; startTime: Date; stylistId: string | null; stylistMemberId?: string | null }, result?: unknown): Promise<PatchTestView | null> {
    if (!appt.contactId || !appt.serviceId) return null
    const wanted = offeredServiceId(await settingsOf(db, companyId))
    if (!wanted || wanted !== appt.serviceId) return null
    const status: PatchStatus = result === 'passed' || result === 'failed' ? result : 'pending'
    const [menu] = await db.select({ name: serviceMenu.name }).from(serviceMenu).where(eq(serviceMenu.id, appt.serviceId)).limit(1)
    const [stylist] = appt.stylistId ? await db.select().from(user).where(eq(user.id, appt.stylistId)).limit(1) : []
    const tz = await clock.salonTimezone(companyId)
    const day = calendarDateIn(new Date(appt.startTime), tz)
    let row: typeof patchTest.$inferSelect | undefined
    await db.transaction(async (tx: any) => {
      const [made] = await tx.insert(patchTest).values({
        companyId, contactId: appt.contactId, testedAt: day, status, title: menu?.name || 'Patch test', description: null,
        ranByUserId: stylist?.id ?? null, ranByName: stylist ? nameOf(stylist) : null, appointmentId: appt.id,
      } as any).onConflictDoNothing().returning()
      if (made) row = made
      else {
        // Completed before (or again): keep what is there, but a result given now settles a pending one.
        const [have] = await tx.select().from(patchTest).where(eq(patchTest.appointmentId, appt.id)).limit(1)
        row = have
        if (have && have.status === 'pending' && status !== 'pending') [row] = await tx.update(patchTest).set({ status, updatedAt: new Date() }).where(eq(patchTest.id, have.id)).returning()
      }
      await mirror(tx, companyId, appt.contactId!)
    })
    return row ? view(row) : null
  }

  /** The sentence for a message to a client whose service needs a patch test they do not hold, or null. */
  async function needNote(companyId: string, contactId: string | null, serviceMenuId: string | null): Promise<string | null> {
    if (!contactId || !serviceMenuId) return null
    const [menu] = await db.select({ name: serviceMenu.name, requires: serviceMenu.requiresPatchTest }).from(serviceMenu).where(and(eq(serviceMenu.id, serviceMenuId), eq(serviceMenu.companyId, companyId))).limit(1)
    if (!menu?.requires) return null
    const [profile] = await db.select({ at: clientProfile.patchTestAt, result: clientProfile.patchTestResult }).from(clientProfile).where(and(eq(clientProfile.contactId, contactId), eq(clientProfile.companyId, companyId))).limit(1)
    const state = patchTestState(profile?.at ?? null, profile?.result ?? null, await clock.salonToday(companyId)).state
    if (state === 'passed') return null
    const name = menu.name || 'This service'
    return state === 'failed' ? `${name} needs a passed patch test, and your last one did not pass. Please talk to us before your visit.`
      : state === 'expired' ? `${name} needs a patch test within the last six months, and yours has run out. Please book a new patch test before your visit.`
        : `${name} needs a patch test first, and we have none on record for you. Please book a patch test before your visit.`
  }

  /** Where the client stands today (none / passed / failed / expired), from the mirrored latest result. */
  async function state(companyId: string, contactId: string) {
    const [profile] = await db.select({ at: clientProfile.patchTestAt, result: clientProfile.patchTestResult }).from(clientProfile).where(and(eq(clientProfile.contactId, contactId), eq(clientProfile.companyId, companyId))).limit(1)
    return patchTestState(profile?.at ?? null, profile?.result ?? null, await clock.salonToday(companyId))
  }

  /**
   * The chart form's single "last patch test" date and result (the form that came before the history, and the phone app's): it corrects
   * the latest test (date and result), records one when the client has none, or — cleared — removes the test of the date it had. The history stays the source; the profile follows.
   */
  async function setLatest(companyId: string, contactId: string, was: string | null, now: string | null, result: string | null, actor: any): Promise<void> {
    await db.transaction(async (tx: any) => {
      if (!now) {
        if (was) await tx.delete(patchTest).where(and(eq(patchTest.companyId, companyId), eq(patchTest.contactId, contactId), eq(patchTest.testedAt, was)))
      } else {
        const status = result === 'failed' ? 'failed' : 'passed'
        const onDay = async (day: string) => (await tx.select().from(patchTest).where(and(eq(patchTest.companyId, companyId), eq(patchTest.contactId, contactId), eq(patchTest.testedAt, day))).orderBy(desc(patchTest.createdAt)).limit(1))[0]
        // This single-record form EDITS the latest test (its date or result); it never adds to the history — the history panel does that.
        const latest = was ? await onDay(was) : null
        if (latest) await tx.update(patchTest).set({ testedAt: now, status, updatedAt: new Date() }).where(eq(patchTest.id, latest.id))
        else await tx.insert(patchTest).values({ companyId, contactId, testedAt: now, status, title: 'Patch test', ranByUserId: actor?.userId || actor?.id || null, ranByName: nameOf(actor) || null } as any)
      }
      await mirror(tx, companyId, contactId)
    })
  }

  return { list, create, update, remove, mirror, forCompletedVisit, needNote, state, setLatest }
}
export type PatchTests = ReturnType<typeof createPatchTests>
