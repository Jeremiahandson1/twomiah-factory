import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { serviceRecord, serviceMenu, contact, clientProfile, user, appointment, company } from '../../db/schema.ts'
import { rebookInterval, describeInterval, categoryKey, preferredCategoryLabel } from '../shared/index.ts'
import { eq, and, inArray, isNotNull, sql, gt } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission, hasPermission, getExtraPermissions } from '../middleware/permissions.ts'
import { sendSMS } from '../services/sms.ts'
import { salonToday } from '../utils/salonDate.ts'
// Who is due, computed once for this list and for the dashboard's tile. (T58)
// excludedCategories and shiftDays moved with it — they were only ever used by that computation.
import { dueRebookings } from '../services/rebookingDue.ts'

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
/**
 * The per-category recall message, keyed the same way the rhythms are — lowercased — so a salon
 * does not have to know how their own menu was capitalised to write a message for it.
 */
async function rebookingTemplates(companyId: string): Promise<Record<string, string>> {
  try {
    const [co] = await db.select({ settings: company.settings }).from(company).where(eq(company.id, companyId)).limit(1)
    const raw = (co?.settings as any)?.rebookingTemplates
    if (!raw || typeof raw !== 'object') return {}
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(raw)) {
      const text = String(v ?? '').trim()
      // categoryKey, not just lowercase: the category a template hangs off is folded the same way
      // the rhythms are, so a message written for "Colour" still reaches the merged chip. Keying
      // these two things differently is how a template would silently stop attaching. (RR0929)
      if (text) out[categoryKey(k)] = text
    }
    return out
  } catch { return {} }
}

// excludedCategories (which service categories this salon does not chase) and shiftDays (whole-day
// arithmetic on the SHOP's calendar, Salon T25 N2) moved into services/rebookingDue.ts with the
// computation that was their only caller. The notes on why each works the way it does moved with them.

// GET /reminders/due?window=14&maxOverdue=90 — clients whose next visit is due
// within `window` days or overdue by up to `maxOverdue` days. The overdue floor
// matters: without it a client who moved away three years ago sits at the top of
// the list forever and the report stops being a call list. Anyone past the floor
// is a win-back, and shows up in /lapsed instead.
app.get('/due', requirePermission('contacts:read'), async (c) => {
  const u = c.get('user') as any
  const windowDays = Math.min(365, Math.max(1, +(c.req.query('window') || '14')))
  const maxOverdue = Math.min(3650, Math.max(1, +(c.req.query('maxOverdue') || '90')))
  /**
   * The rows come from services/rebookingDue.ts, which is also what the dashboard tile counts. (T58)
   *
   * This computation used to live here and the dashboard had its own, keyed on (contact, service) and
   * applying none of the four rules below it — so the tile and this list gave different numbers while
   * the dashboard's comment claimed they could not. The whole of it moved out rather than being copied
   * across: a rule added to recall has to move the tile with it.
   */
  const filtered = await dueRebookings(u.companyId, { windowDays, maxOverdue })

  // ── the category IS the screen, not a column on it ───────────────────────────────────────────
  //
  // Phorest's Client Reconnect is worked one Service Category at a time: you look at the overdue
  // clients for a category and press Contact Overdue Clients for that category. That is the right
  // shape, and not only for tidiness — the MESSAGE differs. "Time to book your roots" and "time
  // for a trim" are not the same text, and a flat list mixing them can only send one of them.
  //
  // So the counts come back for every category whatever the filter, and the screen can offer them
  // as the way in. A client on two rhythms appears once under each, which is one call per
  // conversation rather than two calls or one wrong one.
  // Spellings are collected so the chip can be LABELLED with the one the salon actually uses. A
  // shop whose whole menu says "colour" must not be shown a chip reading "color" just because that
  // is the key the two fold to. (RR0929)
  const summary = new Map<string, { category: string; label: string; due: number; overdue: number; seen: string[] }>()
  for (const r of filtered) {
    const key = categoryKey(r.category)
    const row = summary.get(key) || { category: key, label: '', due: 0, overdue: 0, seen: [] }
    row.seen.push(String(r.category || 'other'))
    row.due++
    if (r.overdue) row.overdue++
    summary.set(key, row)
  }
  for (const row of summary.values()) row.label = preferredCategoryLabel(row.seen)
  const templates = await rebookingTemplates(u.companyId)
  const categories = [...summary.values()]
    .sort((a, b) => b.overdue - a.overdue || b.due - a.due || a.label.localeCompare(b.label))
    .map(({ seen, ...row }) => ({ ...row, template: templates[row.category] || null }))

  // ?category= narrows the rows. The counts above are deliberately NOT narrowed, so the screen can
  // keep showing what else is waiting while you work one of them.
  //
  // Folded on BOTH sides: a screen that sent back the chip's own key would otherwise miss the rows
  // spelled the other way — which is the bug this fold exists to remove, one layer up.
  const askedFor = String(c.req.query('category') || '').trim()
  const wanted = askedFor ? categoryKey(askedFor) : ''
  const shown = wanted ? filtered.filter((r) => categoryKey(r.category) === wanted) : filtered

  return c.json({
    count: shown.length,
    overdue: shown.filter(d => d.overdue).length,
    data: shown,
    categories,
    // Everyone waiting, across every category — the number the overview headline is about.
    totalDue: filtered.length,
    totalOverdue: filtered.filter(d => d.overdue).length,
  })
})

/**
 * The message each Service Category gets.
 *
 * Phorest gives every category its own set of templates, and the reason is the whole point of
 * working a recall list by category: what you say to a colour client six weeks out is not what you
 * say to somebody due a trim. A single shop-wide message is the thing that makes recall texts read
 * like spam.
 *
 * Reading is open to anyone who can see the list; writing is company config, like every other
 * setting a shop's words live in.
 */
app.get('/templates', requirePermission('contacts:read'), async (c) => {
  const u = c.get('user') as any
  return c.json({ templates: await rebookingTemplates(u.companyId) })
})

app.put('/templates', requirePermission('company:update'), async (c) => {
  const u = c.get('user') as any
  const body = (await c.req.json().catch(() => null)) ?? ({} as any)
  const incoming = body?.templates
  if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
    return c.json({ error: 'Send templates as { templates: { colour: "…" } }.' }, 400)
  }

  const next: Record<string, string> = {}
  for (const [rawKey, rawValue] of Object.entries(incoming)) {
    // Folded on the way IN as well, so "Colour" and "Color" cannot be stored as two templates for
    // one chip — whichever the salon typed last would win at random. (RR0929)
    const key = categoryKey(rawKey)
    if (!key || !String(rawKey).trim()) continue
    const text = String(rawValue ?? '').trim()
    // An empty template means "go back to the shop's default", which is how you undo one without a
    // separate delete.
    if (!text) continue
    if (text.length > 640) return c.json({ error: `The ${key} message is too long for a text — keep it under 640 characters.` }, 400)
    next[key] = text
  }

  const [co] = await db.select({ settings: company.settings }).from(company).where(eq(company.id, u.companyId)).limit(1)
  const settings = { ...(co?.settings as any || {}), rebookingTemplates: next }
  await db.update(company).set({ settings, updatedAt: new Date() } as any).where(eq(company.id, u.companyId))
  return c.json({ templates: next })
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

  /**
   * THE SIBLING OF THE CLIENT CHART'S LIFETIME VALUE. (T41)
   *
   * The report named routes/clients.ts; this list emits the same fact per row, behind
   * contacts:read, which every stylist holds. Same rule, applied here because a report naming one
   * place is not a reason to leave the other one open.
   *
   * THE ORDER IS KEPT EITHER WAY. The win-back list is sorted highest-spend-first, because that is
   * what makes it a work queue rather than an alphabet — so the sort happens on the real figure and
   * only then is the column dropped. A stylist still gets the best clients to call first; they just
   * are not told what each one is worth.
   *
   * (This one sums serviceRecord.priceCharged, not the invoice table, so the two figures can
   * disagree — the chart's is what was actually paid. The per-visit price stays on the visit card
   * regardless: the stylist typed it.)
   */
  const maySeeClientMoney = hasPermission(u?.role, 'invoices:read', await getExtraPermissions(u?.userId))

  const data = rows
    .map(r => ({ ...r, visits: Number(r.visits), lifetimeValue: Number(r.lifetimeValue) }))
    .sort((a, b) => b.lifetimeValue - a.lifetimeValue)
    .map(r => { if (maySeeClientMoney) return r; const { lifetimeValue, ...rest } = r; return rest })

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
