import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { serviceRecord, serviceMenu, contact, clientProfile, user, appointment, company } from '../../db/schema.ts'
import { rebookInterval, describeInterval } from '../shared/index.ts'
import { eq, and, inArray, isNotNull, sql, gt } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'
import { sendSMS } from '../services/sms.ts'
import { salonToday } from '../utils/salonDate.ts'

/**
 * Rebooking / recall engine — the retention wedge.
 *   GET  /reminders/due       clients past (or nearing) their rebook interval
 *   GET  /reminders/lapsed    clients whose last visit is older than N months
 *   GET  /reminders/birthdays clients with a birthday in the next N days
 *   POST /reminders/send      bulk SMS to selected clients
 *
 * "Due" is computed, never stored: last service record + that service's
 * rebookIntervalDays. Re-timing a service in the menu re-times every client on
 * it, which is the whole point of keeping the interval on the menu row.
 */

const app = new Hono()
app.use('*', authenticate)

const dayStr = (d: Date) => d.toISOString().slice(0, 10)

/**
 * Categories this salon does not want chased.
 *
 * A blow-dry before a wedding is not a rhythm, and a one-off waxing appointment does not mean the
 * client is overdue six weeks later. Phorest lets a salon exclude Service Categories from Client
 * Reconnect for the same reason. Stored as settings.rebookingCategoriesOff: string[]; absent means
 * chase everything, which is what every existing tenant already does.
 */
async function excludedCategories(companyId: string): Promise<Set<string>> {
  try {
    const [co] = await db.select({ settings: company.settings }).from(company).where(eq(company.id, companyId)).limit(1)
    const raw = (co?.settings as any)?.rebookingCategoriesOff
    // Matched the same way the rhythms are keyed, so switching off "Waxing" also switches off
    // "waxing" — a salon should not have to know how their own menu was capitalised.
    return new Set(Array.isArray(raw) ? raw.map((s: any) => String(s).trim().toLowerCase()) : [])
  } catch { return new Set() }
}

// The rebooking list is answered on the SHOP's calendar, like every other day question in this
// template (utils/salonDate.ts, Salon T25 N2). It was the one place the N2 sweep missed: `overdue`
// compared a client's due date against the UTC day, so from 7pm in Chicago every client due TOMORROW
// was already flagged overdue — and that flag is not just a label, it decides who gets chased.
// Shifting a plain YYYY-MM-DD by whole days keeps it a calendar question; going via Date.now() would
// put the UTC clock straight back in.
// Date.UTC here is calendar arithmetic on a date that is ALREADY the shop's, not a reading of the
// clock — it never asks what time it is. Formatted by hand rather than via toISOString().slice(0, 10)
// so it cannot be mistaken for the UTC-today bug, by a reader or by
// scripts/check-salon-days-are-the-shop-calendar.ts.
const shiftDays = (day: string, delta: number) => {
  const [y, m, d] = day.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d) + delta * 86400000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`
}

// GET /reminders/due?window=14&maxOverdue=90 — clients whose next visit is due
// within `window` days or overdue by up to `maxOverdue` days. The overdue floor
// matters: without it a client who moved away three years ago sits at the top of
// the list forever and the report stops being a call list. Anyone past the floor
// is a win-back, and shows up in /lapsed instead.
app.get('/due', requirePermission('contacts:read'), async (c) => {
  const u = c.get('user') as any
  const windowDays = Math.min(365, Math.max(1, +(c.req.query('window') || '14')))
  const maxOverdue = Math.min(3650, Math.max(1, +(c.req.query('maxOverdue') || '90')))
  const today = await salonToday(u.companyId)
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
    .where(and(eq(serviceRecord.companyId, u.companyId), isNotNull(serviceMenu.rebookIntervalDays)))

  // ── one row per client per RHYTHM, not per service ───────────────────────────────────────────
  //
  // This used to key on (client, service), so a client who had a root touch-up and a cut in the
  // same visit appeared TWICE on the same date — Sarah Mitchell, 3 September, two rows, one client
  // and one phone call. A salon's recall is organised by the rhythm a client is on, and a client
  // who alternates a gloss with a full colour is on ONE colour rhythm, not two. Phorest groups by
  // Service Category for exactly this reason; so does this now. Which categories a salon wants
  // chased is theirs to say (settings.rebookingCategoriesOff).
  const excluded = await excludedCategories(u.companyId)
  const byRhythm = new Map<string, any[]>()
  for (const r of rows) {
    if (!r.contactId) continue
    // Category is free text on the menu row, and a real tenant has both "Color" and "colour" on it.
    // Grouping on the raw string would put one client on two rhythms that are the same rhythm, and
    // then chase her twice for it — the exact bug this grouping exists to fix, re-entering through
    // the shift key. Matched case- and space-insensitively; the row still shows what the menu says.
    const category = String(r.category || 'other')
    const rhythm = category.trim().toLowerCase()
    if (excluded.has(rhythm)) continue
    const key = `${r.contactId}|${rhythm}`
    const list = byRhythm.get(key)
    if (list) list.push(r); else byRhythm.set(key, [r])
  }

  const t = today
  const data = [...byRhythm.values()]
    .map((visits) => {
      // The most recent visit in this rhythm is the one the row is ABOUT — its date, its service
      // and its stylist are what the desk needs when they pick up the phone.
      const last = visits.reduce((a, b) => (new Date(a.performedAt) > new Date(b.performedAt) ? a : b))
      // …and the whole history is what decides WHEN. A client with three or more visits in this
      // category is on her own rhythm; the menu's figure is for a client we do not know yet.
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
    .filter(r => r.dueDate <= cutoff && r.dueDate >= floor)
    .map(r => ({ ...r, overdue: r.dueDate < t }))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))

  // A client who already has a future appointment has effectively rebooked — don't nag
  // them (and don't text them as overdue). (RECALL-02)
  const booked = new Set(
    (await db.select({ contactId: appointment.contactId }).from(appointment)
      .where(and(eq(appointment.companyId, u.companyId), gt(appointment.startTime, new Date()))))
      .map(a => a.contactId).filter(Boolean)
  )
  const filtered = data.filter(r => !booked.has(r.contactId))

  return c.json({ count: filtered.length, overdue: filtered.filter(d => d.overdue).length, data: filtered })
})

// GET /reminders/lapsed?months=6 — clients whose last visit is older than N
// months. Clients who have never been in the chair are excluded: they are a
// lead-nurture problem, not a win-back one.
app.get('/lapsed', requirePermission('contacts:read'), async (c) => {
  const u = c.get('user') as any
  const months = Math.min(60, Math.max(1, +(c.req.query('months') || '6')))
  const cutoff = new Date(); cutoff.setMonth(cutoff.getMonth() - months)
  const cutoffIso = cutoff.toISOString()

  const rows = await db.select({
    contactId: contact.id,
    clientName: contact.name,
    clientEmail: contact.email,
    clientPhone: contact.phone,
    clientMobile: contact.mobile,
    lastVisit: sql<string | null>`max(${serviceRecord.performedAt})`,
    visits: sql<number>`count(${serviceRecord.id})`,
    lifetimeValue: sql<string>`coalesce(sum(${serviceRecord.priceCharged}), 0)`,
  })
    .from(contact)
    .innerJoin(serviceRecord, eq(serviceRecord.contactId, contact.id))
    .where(and(eq(contact.companyId, u.companyId), eq(serviceRecord.companyId, u.companyId)))
    .groupBy(contact.id)
    .having(sql`max(${serviceRecord.performedAt}) < ${cutoffIso}`)

  const data = rows
    .map(r => ({ ...r, visits: Number(r.visits), lifetimeValue: Number(r.lifetimeValue) }))
    .sort((a, b) => b.lifetimeValue - a.lifetimeValue)

  return c.json({ count: data.length, months, data })
})

// GET /reminders/birthdays?window=30 — birthdays in the next N days. Month/day
// only, so the year stored on the profile never matters.
app.get('/birthdays', requirePermission('contacts:read'), async (c) => {
  const u = c.get('user') as any
  const windowDays = Math.min(365, Math.max(1, +(c.req.query('window') || '30')))

  const rows = await db.select({
    contactId: contact.id,
    clientName: contact.name,
    clientEmail: contact.email,
    clientPhone: contact.phone,
    clientMobile: contact.mobile,
    birthday: clientProfile.birthday,
  })
    .from(clientProfile)
    .innerJoin(contact, eq(clientProfile.contactId, contact.id))
    .where(and(eq(clientProfile.companyId, u.companyId), isNotNull(clientProfile.birthday)))

  const now = new Date()
  const data = rows
    .map(r => {
      // Next occurrence of this month/day, rolling into next year if it has passed.
      const [, m, d] = String(r.birthday).split('-').map(Number)
      let next = new Date(now.getFullYear(), m - 1, d)
      const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
      if (next < startOfToday) next = new Date(now.getFullYear() + 1, m - 1, d)
      const daysAway = Math.round((next.getTime() - startOfToday.getTime()) / 86400000)
      return { ...r, nextBirthday: dayStr(next), daysAway }
    })
    .filter(r => r.daysAway <= windowDays)
    .sort((a, b) => a.daysAway - b.daysAway)

  return c.json({ count: data.length, data })
})

// POST /reminders/send  { contactIds: string[], message: string } — bulk SMS.
app.post('/send', requirePermission('contacts:update'), async (c) => {
  const u = c.get('user') as any
  const body = (await c.req.json().catch(() => null)) ?? ({} as any)
  const contactIds: string[] = Array.isArray(body.contactIds) ? body.contactIds.filter(Boolean) : []
  const message: string = (body.message || '').trim()
  if (!contactIds.length || !message) return c.json({ error: 'contactIds and message are required' }, 400)

  const clients = await db.select().from(contact).where(and(eq(contact.companyId, u.companyId), inArray(contact.id, contactIds)))
  let sent = 0
  const failures: string[] = []
  const reasons: string[] = []
  const noPhoneIds: string[] = []
  for (const ct of clients) {
    const to = (ct as any).mobile || ct.phone
    if (!to) { failures.push(ct.id); noPhoneIds.push(ct.id); continue }
    try {
      // sendSMS returns the saved row; a carrier failure comes back as status "failed", not a throw,
      // and a send that was never attempted comes back "refused". (SALON-C4)
      //
      // FULL0929 F8: this counted anything that was not literally 'failed' as a send — so a REFUSED
      // message, where the shop has no Twilio number and an empty wallet and nothing was attempted,
      // was reported as {sent: 1}. No thread, no charge, no text, and an API saying it went. A count
      // of messages sent has to mean messages that were sent, so only a real 'sent' counts now and
      // everything else carries its reason back to the screen.
      const row: any = await sendSMS(u.companyId, { contactId: ct.id, toPhone: to, message, userId: u.userId })
      if (row?.status === 'sent') { sent++ }
      else { failures.push(ct.id); reasons.push(row?.errorMessage || 'Send failed') }
    } catch (e: any) { failures.push(ct.id); reasons.push(e?.message || 'Send failed') }
  }
  // Every failure now carries a reason back to the screen. A client with no mobile was already
  // counted and already counted as failed, but `reason` came back null — so the desk saw "1 failed"
  // and nothing telling them what to do about it. It is the LAST resort of the three, because a
  // shop whose texting is switched off must not be told the problem was one client's missing
  // number. (FULL0929 F8)
  const noPhone = noPhoneIds.length
  return c.json({
    sent, failed: failures.length, failures, noPhone,
    reason: reasons[0]
      || (noPhone ? `${noPhone === 1 ? 'That client has' : `${noPhone} of these clients have`} no mobile number on file.` : null),
  })
})

export default app
