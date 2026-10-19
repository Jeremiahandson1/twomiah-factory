// Rebooking and recall — the retention wedge. Moved from templates/crm-salon/backend/src/routes/reminders.ts.
//   GET  /reminders/due        clients past (or nearing) their rebook interval, by category
//   GET  /reminders/templates  the message each category gets; PUT to change them
//   GET  /reminders/lapsed     clients whose last visit is older than N months
//   GET  /reminders/birthdays  clients with a birthday in the next N days
//   POST /reminders/send       bulk text to selected clients
// "Due" is computed, never stored: re-timing a service on the menu re-times every client on it.
import { Hono } from 'hono'
import { and, eq, inArray, isNotNull } from 'drizzle-orm'
import { categoryKey, preferredCategoryLabel } from '@twomiah/tenant-backend'
import { contact, clientProfile, company } from '../../db/schema/index.ts'
import { lapsedClients } from '../../data/salon.ts'
import type { AppEnv } from '../../http/env.ts'
import { fail, one } from '../../http/reply.ts'
import { canSeeWith, type CrmDeps } from '../deps.ts'
import type { SalonServices } from './services.ts'

// The most rows one reminders list answers with (lapsed, birthdays).
const LIST_CAP = 500
const dayStr = (d: Date) => d.toISOString().slice(0, 10)

export function createReminderRoutes(d: CrmDeps, salon: SalonServices) {
  const { db } = d
  const { requirePermission } = d.permissions
  const canSee = canSeeWith(d.permissions)
  const app = new Hono<AppEnv>()

  /** The per-category recall message, keyed the way the rhythms are (categoryKey), so "Colour" still reaches its chip. (RR0929) */
  async function rebookingTemplates(companyId: string): Promise<Record<string, string>> {
    try {
      const [co] = await db.select({ settings: company.settings }).from(company).where(eq(company.id, companyId)).limit(1)
      const raw = (co?.settings as any)?.rebookingTemplates
      if (!raw || typeof raw !== 'object') return {}
      const out: Record<string, string> = {}
      for (const [k, v] of Object.entries(raw)) {
        const text = String(v ?? '').trim()
        if (text) out[categoryKey(k)] = text
      }
      return out
    } catch { return {} }
  }

  /**
   * GET /reminders/due?window=14&maxOverdue=90 — the rows the dashboard tile counts too (T58). The category is the way
   * in: counts come back for every category whatever ?category= narrows the rows to, and each chip is labelled with the
   * spelling the salon actually uses. (RR0929)
   */
  app.get('/due', requirePermission('contacts:read'), async (c) => {
    const u = c.get('user') as any
    const windowDays = Math.min(365, Math.max(1, +(c.req.query('window') || '14')))
    const maxOverdue = Math.min(3650, Math.max(1, +(c.req.query('maxOverdue') || '90')))
    const filtered = await salon.rebooking.dueRebookings(u.companyId, { windowDays, maxOverdue })

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
      .map(({ seen: _seen, ...row }) => ({ ...row, template: templates[row.category] || null }))

    const askedFor = String(c.req.query('category') || '').trim()
    const wanted = askedFor ? categoryKey(askedFor) : ''
    const shown = wanted ? filtered.filter((r) => categoryKey(r.category) === wanted) : filtered

    return one(c, {
      count: shown.length,
      overdue: shown.filter((x) => x.overdue).length,
      data: shown,
      categories,
      totalDue: filtered.length,
      totalOverdue: filtered.filter((x) => x.overdue).length,
    })
  })

  // The message each category gets: reading for anyone who sees the list, writing is company config.
  app.get('/templates', requirePermission('contacts:read'), async (c) => {
    const u = c.get('user') as any
    return one(c, { templates: await rebookingTemplates(u.companyId) })
  })

  app.put('/templates', requirePermission('company:update'), async (c) => {
    const u = c.get('user') as any
    const body = (await c.req.json().catch(() => null)) ?? ({} as any)
    const incoming = body?.templates
    if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) return fail(c, 400, 'Send templates as { templates: { colour: "…" } }.')

    const next: Record<string, string> = {}
    for (const [rawKey, rawValue] of Object.entries(incoming)) {
      // Folded on the way IN as well, so "Colour" and "Color" are one template. (RR0929)
      const key = categoryKey(rawKey)
      if (!key || !String(rawKey).trim()) continue
      const text = String(rawValue ?? '').trim()
      // Empty means "back to the shop's default".
      if (!text) continue
      if (text.length > 640) return fail(c, 400, `The ${key} message is too long for a text — keep it under 640 characters.`)
      next[key] = text
    }
    const [co] = await db.select({ settings: company.settings }).from(company).where(eq(company.id, u.companyId)).limit(1)
    const settings = { ...((co?.settings as any) || {}), rebookingTemplates: next }
    await db.update(company).set({ settings, updatedAt: new Date() } as any).where(eq(company.id, u.companyId))
    return one(c, { templates: next })
  })

  /**
   * GET /reminders/lapsed?months=6 — clients whose last visit is older than N months, highest spend first. The spend
   * is the salon's money: only a seat that may see invoices gets the figure; the order is kept either way. (T41)
   */
  app.get('/lapsed', requirePermission('contacts:read'), async (c) => {
    const u = c.get('user') as any
    const months = Math.min(60, Math.max(1, +(c.req.query('months') || '6')))
    const cutoff = new Date(); cutoff.setMonth(cutoff.getMonth() - months)
    const rows = await lapsedClients(db, u.companyId, cutoff.toISOString(), LIST_CAP)
    const maySeeClientMoney = await canSee(u?.role, 'invoices:read', u?.userId)
    const data = rows
      .map((r) => ({ ...r, visits: Number(r.visits), lifetimeValue: Number(r.lifetimeValue) }))
      .sort((a, b) => b.lifetimeValue - a.lifetimeValue)
      .map((r) => { if (maySeeClientMoney) return r; const { lifetimeValue: _v, ...rest } = r; return rest })
    return one(c, { count: data.length, months, data, capped: data.length >= LIST_CAP })
  })

  // GET /reminders/birthdays?window=30 — month and day only, so the year on the profile never matters.
  app.get('/birthdays', requirePermission('contacts:read'), async (c) => {
    const u = c.get('user') as any
    const windowDays = Math.min(365, Math.max(1, +(c.req.query('window') || '30')))
    const rows: Array<{ contactId: string; clientName: string | null; clientEmail: string | null; clientPhone: string | null; clientMobile: string | null; birthday: string | null }> = await db.select({
      contactId: contact.id, clientName: contact.name, clientEmail: contact.email, clientPhone: contact.phone, clientMobile: contact.mobile, birthday: clientProfile.birthday,
    })
      .from(clientProfile)
      .innerJoin(contact, eq(clientProfile.contactId, contact.id))
      .where(and(eq(clientProfile.companyId, u.companyId), isNotNull(clientProfile.birthday)))

    const now = new Date()
    const data = rows
      .map((r) => {
        const [, m, dd] = String(r.birthday).split('-').map(Number)
        let next = new Date(now.getFullYear(), m - 1, dd)
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
        if (next < startOfToday) next = new Date(now.getFullYear() + 1, m - 1, dd)
        const daysAway = Math.round((next.getTime() - startOfToday.getTime()) / 86400000)
        return { ...r, nextBirthday: dayStr(next), daysAway }
      })
      .filter((r) => r.daysAway <= windowDays)
      .sort((a, b) => a.daysAway - b.daysAway)
      .slice(0, LIST_CAP)
    return one(c, { count: data.length, data, capped: data.length >= LIST_CAP })
  })

  /**
   * POST /reminders/send { contactIds, message } — bulk text. Only a real 'sent' counts as sent; a refused or failed
   * message carries its reason back to the screen, and a missing number is the last reason given. (FULL0929 F8)
   */
  app.post('/send', requirePermission('contacts:update'), async (c) => {
    const u = c.get('user') as any
    const body = (await c.req.json().catch(() => null)) ?? ({} as any)
    const contactIds: string[] = Array.isArray(body.contactIds) ? body.contactIds.filter(Boolean) : []
    const message: string = (body.message || '').trim()
    if (!contactIds.length || !message) return fail(c, 400, 'contactIds and message are required')

    const clients: Array<typeof contact.$inferSelect> = await db.select().from(contact).where(and(eq(contact.companyId, u.companyId), inArray(contact.id, contactIds)))
    let sent = 0
    const failures: string[] = []
    const reasons: string[] = []
    const noPhoneIds: string[] = []
    for (const ct of clients) {
      const to = ct.mobile || ct.phone
      if (!to) { failures.push(ct.id); noPhoneIds.push(ct.id); continue }
      try {
        const row: any = await d.services.sms.sendSMS(u.companyId, { contactId: ct.id, toPhone: to, message, userId: u.userId })
        if (row?.status === 'sent') sent++
        else { failures.push(ct.id); reasons.push(row?.errorMessage || 'Send failed') }
      } catch (e: any) { failures.push(ct.id); reasons.push(e?.message || 'Send failed') }
    }
    const noPhone = noPhoneIds.length
    return one(c, {
      sent, failed: failures.length, failures, noPhone,
      reason: reasons[0] || (noPhone ? `${noPhone === 1 ? 'That client has' : `${noPhone} of these clients have`} no mobile number on file.` : null),
    })
  })

  return app
}
