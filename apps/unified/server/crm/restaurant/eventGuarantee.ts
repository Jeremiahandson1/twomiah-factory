// The guaranteed-count cutoff (restaurant-bar-depth #5, Tripleseat's "guarantee date"). The venue sets how many days
// before an event the client's head count is final (Settings: eventSettings.guaranteeDays). A reminder goes to the client
// a few days before that; from the cutoff on, the count — and any per-head menu line going down — is locked, and only a
// manager (invoices:update) changes it, with a reason that is kept on the event and in the audit log.
//
// Behind the 'event_guarantee' feature (not ready): off, counts change as they always did.
import { and, eq, inArray, isNull, gte } from 'drizzle-orm'
import { event, contact, company } from '../../db/schema/index.ts'
import type { CrmDeps } from '../deps.ts'
import { getEventSettings } from './eventSettings.ts'
import { HELD, venueToday, eventDayWords } from './eventBooking.ts'

/** A calendar day (YYYY-MM-DD) `days` earlier. */
export function dayBefore(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d - days)).toISOString().slice(0, 10)
}

/** The cutoff day for an event and whether `today` is on or past it. No cutoff set (0 days) = never locked. */
export function guaranteeFor(ev: { eventDate: string; status: string }, guaranteeDays: number, today: string): { cutoff: string | null; locked: boolean } {
  if (!(guaranteeDays > 0) || !ev.eventDate) return { cutoff: null, locked: false }
  const cutoff = dayBefore(ev.eventDate, guaranteeDays)
  return { cutoff, locked: today >= cutoff && ['tentative', 'confirmed'].includes(ev.status) }
}

export async function guaranteeOn(d: Pick<CrmDeps, 'features'>, companyId: string): Promise<boolean> {
  return d.features.isFeatureEnabled(companyId, 'event_guarantee')
}

export type LockVerdict = { ok: true; override?: { reason: string; at: Date; by: string } } | { ok: false; status: 400 | 403 | 409; message: string; code: string }

/**
 * May this seat change a locked count? Called only for a write that would change the count (or lower a per-head line).
 * Not locked: fine. Locked: a manager with a reason; a manager without one is asked for it; anyone else is refused.
 */
export async function countChangeVerdict(d: CrmDeps, user: any, ev: { eventDate: string; status: string }, reason: unknown): Promise<LockVerdict> {
  if (!(await guaranteeOn(d, user.companyId))) return { ok: true }
  const settings = await getEventSettings(d.db, user.companyId)
  const g = guaranteeFor(ev, settings.guaranteeDays, await venueToday(d.db, user.companyId))
  if (!g.locked) return { ok: true }
  const { hasPermission, getExtraPermissions } = d.permissions
  const manager = hasPermission(user?.role, 'invoices:update', await getExtraPermissions(user?.userId))
  const why = typeof reason === 'string' ? reason.trim() : ''
  const locked = `The guest count was locked on ${eventDayWords(g.cutoff!)} (${settings.guaranteeDays} days before the event).`
  if (!manager) return { ok: false, status: 403, code: 'count_locked', message: `${locked} Ask a manager to change it.` }
  if (why.length < 3) return { ok: false, status: 409, code: 'count_locked', message: `${locked} Give a reason to change it anyway.` }
  return { ok: true, override: { reason: why.slice(0, 500), at: new Date(), by: user.userId } }
}

/** The columns an override writes on the event. */
export const overrideColumns = (o: { reason: string; at: Date; by: string }) => ({ guaranteeOverrideReason: o.reason, guaranteeOverriddenAt: o.at, guaranteeOverriddenBy: o.by })

/**
 * Reminds each client, once, to confirm their count: from `guaranteeReminderDays` before the cutoff until the cutoff.
 * Run daily by the job below; callable on its own (the test). Returns how many were sent.
 */
export async function runGuaranteeReminders(d: CrmDeps, now = new Date()): Promise<number> {
  const { db } = d
  let sent = 0
  const companies = await db.select({ id: company.id, name: company.name, enabled: company.enabledFeatures }).from(company)
  for (const co of companies) {
    if (!(await guaranteeOn(d, co.id))) continue
    const s = await getEventSettings(db, co.id)
    if (!(s.guaranteeDays > 0) || !(s.guaranteeReminderDays > 0)) continue
    const today = await venueToday(db, co.id)
    const rows = await db.select({ ev: event, email: contact.email, name: contact.name, optOut: contact.emailOptOut }).from(event)
      .innerJoin(contact, eq(event.contactId, contact.id))
      .where(and(eq(event.companyId, co.id), inArray(event.status, HELD), isNull(event.guaranteeReminderSentAt), gte(event.eventDate, today)))
    for (const r of rows) {
      const g = guaranteeFor(r.ev, s.guaranteeDays, today)
      if (!g.cutoff || g.locked || today < dayBefore(g.cutoff, s.guaranteeReminderDays)) continue
      if (!r.email || r.optOut) continue
      // Claimed before the email goes, so two passes at once send one.
      const claimed = await db.update(event).set({ guaranteeReminderSentAt: now }).where(and(eq(event.id, r.ev.id), isNull(event.guaranteeReminderSentAt))).returning({ id: event.id })
      if (!claimed.length) continue
      try {
        await d.services.emailService.send(r.email, 'eventNote', {
          companyName: co.name, contactName: r.name || 'there',
          subject: `Please confirm your guest count for ${eventDayWords(r.ev.eventDate)}`,
          headline: `Your guest count is final on ${eventDayWords(g.cutoff)}.`,
          body: `We are planning ${eventDayWords(r.ev.eventDate)} for ${r.ev.guestCountFinal ?? r.ev.guestCount ?? 'your'} guests. After ${eventDayWords(g.cutoff)} the number is locked and we prepare for it. If it has changed, reply to this email before then.`,
        })
        sent++
      } catch (err: any) {
        d.logger.warn('[events] guarantee reminder not sent', { event: r.ev.id, error: err?.message })
      }
    }
  }
  return sent
}
