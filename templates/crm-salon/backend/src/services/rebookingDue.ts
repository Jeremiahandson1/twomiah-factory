/**
 * WHO IS DUE A REBOOKING — one computation, for every surface that reports it. (T58)
 *
 *   "Salon: the rebooking counts disagree."
 *
 * They did, and they could not have agreed. The recall LIST (routes/reminders.ts) applies four rules
 * the dashboard's tile had never heard of:
 *
 *   1. one row per client per RHYTHM, not per service. Keying on (client, service) put a client who
 *      had a root touch-up and a cut in the same visit on the list twice — "Sarah Mitchell,
 *      3 September, two rows, one client and one phone call" — and the dashboard was still keying on
 *      (contact, service), so its number counted that client twice.
 *   2. the client's OWN rhythm. rebookInterval reads the visit history: a client with three or more
 *      visits in a category is on her own interval, and the menu's figure is for a client the shop
 *      does not know yet. The dashboard used the menu figure for everybody.
 *   3. the categories the salon has switched OFF (settings.rebookingCategoriesOff). A blow-dry before
 *      a wedding is not a rhythm. The dashboard counted them.
 *   4. a client who already has a future appointment has effectively rebooked and is not chased.
 *      The dashboard counted them too.
 *
 * So the tile was higher than the list, by a different amount per tenant, and the dashboard's own
 * comment said "Mirrors GET /reminders/due — same rule, one number", which is how a disagreement
 * survives a read-through: the claim was in the code and the rule was not.
 *
 * It lives here, called by both. A fifth rule added to recall now moves the tile with it.
 */
import { db } from '../../db/index.ts'
import { serviceRecord, serviceMenu, contact, user, appointment, company } from '../../db/schema.ts'
import { rebookInterval, describeInterval, categoryKey } from '../shared/index.ts'
import { eq, and, isNotNull, gt } from 'drizzle-orm'
import { salonToday } from '../utils/salonDate.ts'

const dayStr = (d: Date) => d.toISOString().slice(0, 10)

/**
 * Whole-day arithmetic on a date that is ALREADY the shop's — it never asks what time it is.
 * Formatted by hand rather than through toISOString().slice(0, 10) so it cannot be mistaken for the
 * UTC-today bug, by a reader or by scripts/check-salon-days-are-the-shop-calendar.ts.
 */
export const shiftDays = (day: string, delta: number) => {
  const [y, m, d] = day.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d) + delta * 86400000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`
}

/**
 * Categories this salon does not want chased.
 *
 * A blow-dry before a wedding is not a rhythm, and a one-off waxing appointment does not mean the
 * client is overdue six weeks later. Stored as settings.rebookingCategoriesOff: string[]; absent means
 * chase everything, which is what every existing tenant already does.
 *
 * Matched the same way the rhythms are keyed, so switching off "Waxing" also switches off "waxing",
 * and switching off "Colour" also switches off "Color": a category that is one category for chasing
 * has to be one category for switching off too, or the shop turns it off and half of it keeps
 * ringing. (RR0929)
 */
export async function excludedCategories(companyId: string): Promise<Set<string>> {
  try {
    const [co] = await db.select({ settings: company.settings }).from(company).where(eq(company.id, companyId)).limit(1)
    const raw = (co?.settings as any)?.rebookingCategoriesOff
    return new Set(Array.isArray(raw) ? raw.map((s: any) => categoryKey(s)) : [])
  } catch { return new Set() }
}

export interface DueOptions {
  /** Due within this many days counts as due. */
  windowDays?: number
  /**
   * How far overdue still counts as a call list. Without a floor a client who moved away three years
   * ago sits at the top for ever and the report stops being a call list; past it they are a win-back
   * and show up in /lapsed instead.
   */
  maxOverdue?: number
}

/**
 * The due rows, windowed, de-duplicated by rhythm and with the already-booked removed.
 *
 * Returns them in due-date order with `overdue` stamped, which is exactly what the recall screen
 * renders and what the dashboard tile counts.
 */
export async function dueRebookings(companyId: string, opts: DueOptions = {}): Promise<any[]> {
  const windowDays = Math.min(365, Math.max(1, Number(opts.windowDays ?? 14) || 14))
  const maxOverdue = Math.min(3650, Math.max(1, Number(opts.maxOverdue ?? 90) || 90))

  // The shop's calendar, like every other day question in this template (utils/salonDate.ts, T25 N2).
  const today = await salonToday(companyId)
  const cutoff = shiftDays(today, windowDays)
  const floor = shiftDays(today, -maxOverdue)

  const rows = await db.select({
    recordId: serviceRecord.id,
    performedAt: serviceRecord.performedAt,
    serviceId: serviceRecord.serviceId,
    serviceName: serviceMenu.name,
    category: serviceMenu.category,
    rebookIntervalDays: serviceMenu.rebookIntervalDays,
    stylistFirstName: user.firstName,
    stylistLastName: user.lastName,
    contactId: contact.id,
    clientName: contact.name,
    clientEmail: contact.email,
    clientPhone: contact.phone,
    clientMobile: contact.mobile,
  })
    .from(serviceRecord)
    .innerJoin(serviceMenu, eq(serviceRecord.serviceId, serviceMenu.id))
    .leftJoin(contact, eq(serviceRecord.contactId, contact.id))
    .leftJoin(user, eq(serviceRecord.stylistId, user.id))
    .where(and(eq(serviceRecord.companyId, companyId), isNotNull(serviceMenu.rebookIntervalDays)))

  // ── one row per client per RHYTHM, not per service ─────────────────────────────────────────────
  //
  // A salon's recall is organised by the rhythm a client is on, and a client who alternates a gloss
  // with a full colour is on ONE colour rhythm, not two. categoryKey folds case, spacing AND the
  // British/American spelling, because a real tenant has both "Color" and "colour" on the menu and
  // grouping on the raw string would chase one client twice for the same rhythm. (RR0929)
  const excluded = await excludedCategories(companyId)
  const byRhythm = new Map<string, any[]>()
  for (const r of rows) {
    if (!r.contactId) continue
    const category = String(r.category || 'other')
    const rhythm = categoryKey(category)
    if (excluded.has(rhythm)) continue
    const key = `${r.contactId}|${rhythm}`
    const list = byRhythm.get(key)
    if (list) list.push(r); else byRhythm.set(key, [r])
  }

  const data = [...byRhythm.values()]
    .map((visits) => {
      // The most recent visit in this rhythm is the one the row is ABOUT — its date, its service and
      // its stylist are what the desk needs when they pick up the phone.
      const last = visits.reduce((a, b) => (new Date(a.performedAt) > new Date(b.performedAt) ? a : b))
      // …and the whole history is what decides WHEN.
      const interval = rebookInterval(visits.map((v) => v.performedAt), last.rebookIntervalDays)
      if (!interval.days) return null
      return {
        ...last,
        // Kept for every screen that already reads it, now meaning "the interval actually used".
        rebookIntervalDays: interval.days,
        intervalBasis: interval.basis,
        intervalNote: describeInterval(interval),
        visitsInRhythm: visits.length,
        dueDate: dayStr(new Date(new Date(last.performedAt).getTime() + interval.days * 86400000)),
      }
    })
    .filter((r): r is any => !!r)
    .filter((r) => r.dueDate <= cutoff && r.dueDate >= floor)
    .map((r) => ({ ...r, overdue: r.dueDate < today }))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))

  // A client who already has a future appointment has effectively rebooked — don't nag them (and
  // don't text them as overdue). (RECALL-02)
  const booked = new Set(
    (await db.select({ contactId: appointment.contactId }).from(appointment)
      .where(and(eq(appointment.companyId, companyId), gt(appointment.startTime, new Date()))))
      .map((a) => a.contactId).filter(Boolean),
  )
  return data.filter((r) => !booked.has(r.contactId))
}
