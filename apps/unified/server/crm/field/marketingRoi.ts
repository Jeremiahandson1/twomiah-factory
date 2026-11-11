// MARKETING ROI (parity tier 3, field service — ServiceTitan's marketing ROI scorecard; feature marketing_roi, not ready). Per lead
// source over a period: the leads that came in, how many became customers, the jobs and the money those customers brought, against
// what was spent on the source. The spend is kept per source per month in the same ledger the restaurant's event marketing spend
// uses (event_marketing_spend — a source, a month, an amount), not a second one.
//
//   GET /api/marketing-roi?from=YYYY-MM-DD&to=YYYY-MM-DD    reports:read; the money only for a seat with invoices:read
//   GET /api/marketing-roi/map?from=&to=[&source=]           reports:read — the heat map: customers, jobs and (invoices:read) paid
//                                                            by the customers' ZIP, every customer or one source's
//   GET /api/marketing-roi/spend?from=YYYY-MM&to=YYYY-MM     invoices:read
//   PUT /api/marketing-roi/spend                             invoices:update { source, month, amountCents } (0 takes it away)
//
// Attribution, said plainly on the page: a lead's source is the platform it came from (lead.source_platform); its customer is the
// contact it was converted to; that customer's jobs made in the period and the payments on their invoices in the period count to the
// source. Spend counts for the months the period touches.
//
// CALL TRACKING (ServiceTitan's campaign phone numbers): each tracking number names its source, so an inbound call on it counts to
// that source (the Calls column). A first-time caller is that source's lead: the Lead Inbox's "phone" lead from the call is moved to
// the number's source (matched by the caller's number), and where the inbox is off the caller is the contact the call made (found
// by number), a customer once they have a job in the period.
import { Hono } from 'hono'
import { and, asc, eq, gte, inArray, isNotNull, lte, ne } from 'drizzle-orm'
import { companyTimeZone, storeDayStart } from '@twomiah/tenant-backend'
import { callLog, contact, eventMarketingSpend, invoice, job, lead, payment, trackingNumber } from '../../db/schema/index.ts'
import type { AppEnv } from '../../http/env.ts'
import { done, fail, one } from '../../http/reply.ts'
import type { CrmDeps } from '../deps.ts'
import { canSeeWith } from '../deps.ts'
import { createGeocodingService } from './geocodingService.ts'

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/
const MAX_SPEND_CENTS = 100_000_000
export const sourceWords = (s: string) => s.replace(/_/g, ' ').replace(/^./, (ch) => ch.toUpperCase())
/** A source as the spend ledger keys it ("Google Ads" → "google_ads"). */
export const sourceKey = (s: unknown) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, '_').slice(0, 60)
/** A phone number's last ten digits, to match a lead or contact to a call. */
const digits = (p: unknown) => String(p ?? '').replace(/\D/g, '').slice(-10)

export interface RoiRow { source: string; label: string; calls: number; leads: number; customers: number; jobs: number; revenue?: number; spend?: number; costPerLead?: number | null; returnPerDollar?: number | null }

/** ZIPs looked up per opening of the map (each is one Google lookup, then kept by the geocoder's cache). */
export const ZIP_LOOKUPS_PER_OPEN = 25

export function createMarketingRoiRoutes(d: CrmDeps) {
  const { db, audit } = d
  // A ZIP with no customer or job on the map is placed at the ZIP itself (live test 11/11: a customer typed in by hand has no
  // map point until a map screen looks their jobs up, so the heat map drew nothing). The geocoder keeps each answer 7 days.
  const geocoding = createGeocodingService(d)
  const { requirePermission } = d.permissions
  const mayWith = canSeeWith(d.permissions)
  const app = new Hono<AppEnv>()

  /** Who each source brought in [start, end): its leads, calls and the customers they became (see the attribution above). */
  async function attribution(companyId: string, start: Date, end: Date) {
    const bySource = new Map<string, { leads: number; calls: number; contacts: Set<string> }>()
    const of = (k: string) => { const s = bySource.get(k) ?? { leads: 0, calls: 0, contacts: new Set<string>() }; bySource.set(k, s); return s }
    // Tracked calls: the number's source (or the call's own, from the provider).
    const calls = await db.select({ source: callLog.source, numberSource: trackingNumber.source, first: callLog.firstTimeCaller, from: callLog.callerNumber, contactId: callLog.contactId })
      .from(callLog).leftJoin(trackingNumber, eq(trackingNumber.id, callLog.trackingNumberId))
      .where(and(eq(callLog.companyId, companyId), eq(callLog.direction, 'inbound'), gte(callLog.createdAt, start), lte(callLog.createdAt, end)))
    const callSourceOf = new Map<string, string>()   // caller's digits → source, first-time callers only
    for (const cl of calls as any[]) {
      const k = sourceKey(cl.numberSource || cl.source)
      if (!k) continue
      of(k).calls++
      const n = digits(cl.from)
      if (cl.first && n && !callSourceOf.has(n)) callSourceOf.set(n, k)
    }
    const leads = await db.select({ source: lead.sourcePlatform, contactId: lead.convertedContactId, phone: lead.phone }).from(lead)
      .where(and(eq(lead.companyId, companyId), gte(lead.receivedAt, start), lte(lead.receivedAt, end)))
    const ledByCall = new Set<string>()
    for (const l of leads as any[]) {
      const n = digits(l.phone)
      const viaCall = l.source === 'phone' && n ? callSourceOf.get(n) : undefined
      if (viaCall) ledByCall.add(n)
      const s = of(viaCall ?? String(l.source || 'unknown'))
      s.leads++
      if (l.contactId) s.contacts.add(l.contactId)
    }
    // First-time callers with no inbox lead (the inbox off): the lead is the call; the customer is the contact it made, with a job.
    const unled = [...callSourceOf].filter(([n]) => !ledByCall.has(n))
    if (unled.length) {
      const people = await db.select({ id: contact.id, phone: contact.phone }).from(contact).where(and(eq(contact.companyId, companyId), isNotNull(contact.phone)))
      const byNumber = new Map((people as any[]).map((p) => [digits(p.phone), p.id as string]))
      const ids = unled.map(([n]) => byNumber.get(n)).filter(Boolean) as string[]
      const withJobs = new Set(ids.length ? ((await db.select({ contactId: job.contactId }).from(job).where(and(eq(job.companyId, companyId), inArray(job.contactId, ids), gte(job.createdAt, start), lte(job.createdAt, end)))) as any[]).map((j) => j.contactId) : [])
      for (const [n, k] of unled) {
        const s = of(k)
        s.leads++
        const id = byNumber.get(n)
        if (id && withJobs.has(id)) s.contacts.add(id)
      }
    }
    return bySource
  }

  const period = async (c: any) => {
    const from = c.req.query('from') || '', to = c.req.query('to') || ''
    if (!DAY_RE.test(from) || !DAY_RE.test(to) || to < from) return null
    const tz = await companyTimeZone(db, c.get('user').companyId)
    return { from, to, start: storeDayStart(from, tz), end: new Date(storeDayStart(to, tz).getTime() + 86_400_000) }
  }

  app.get('/', requirePermission('reports:read'), async (c) => {
    const me = c.get('user')
    const p = await period(c)
    if (!p) return fail(c, 400, 'Choose the period: from and to as dates, from first.')
    const { from, to, start, end } = p
    const money = !!(await mayWith(me.role, 'invoices:read', me.userId).catch(() => false))
    const bySource = await attribution(me.companyId, start, end)
    const allContacts = [...new Set([...bySource.values()].flatMap((s) => [...s.contacts]))]
    const jobs = allContacts.length ? await db.select({ contactId: job.contactId }).from(job).where(and(eq(job.companyId, me.companyId), inArray(job.contactId, allContacts), gte(job.createdAt, start), lte(job.createdAt, end))) : []
    const paid = money && allContacts.length ? await db.select({ contactId: invoice.contactId, amount: payment.amount }).from(payment).innerJoin(invoice, eq(invoice.id, payment.invoiceId))
      .where(and(eq(invoice.companyId, me.companyId), inArray(invoice.contactId, allContacts), isNotNull(payment.paidAt), ne(payment.method, 'account_balance'), gte(payment.paidAt, start), lte(payment.paidAt, end))) : []
    const spendRows = money ? await db.select({ source: eventMarketingSpend.source, cents: eventMarketingSpend.amountCents }).from(eventMarketingSpend)
      .where(and(eq(eventMarketingSpend.companyId, me.companyId), gte(eventMarketingSpend.month, from.slice(0, 7)), lte(eventMarketingSpend.month, to.slice(0, 7)))) : []
    const spend = new Map<string, number>()
    for (const r of spendRows as any[]) spend.set(r.source, (spend.get(r.source) ?? 0) + Number(r.cents))
    const sources = [...new Set([...bySource.keys(), ...spend.keys()])]
    const rows: RoiRow[] = sources.map((k) => {
      const s = bySource.get(k) ?? { leads: 0, calls: 0, contacts: new Set<string>() }
      const row: RoiRow = { source: k, label: sourceWords(k), calls: s.calls, leads: s.leads, customers: s.contacts.size, jobs: (jobs as any[]).filter((j) => s.contacts.has(j.contactId)).length }
      if (money) {
        const revenueCents = Math.round((paid as any[]).filter((p) => s.contacts.has(p.contactId)).reduce((n, p) => n + Number(p.amount) * 100, 0))
        const spentCents = spend.get(k) ?? 0
        row.revenue = revenueCents / 100
        row.spend = spentCents / 100
        row.costPerLead = spentCents && s.leads ? Math.round(spentCents / s.leads) / 100 : null
        row.returnPerDollar = spentCents ? Math.round((revenueCents / spentCents) * 100) / 100 : null
      }
      return row
    }).sort((a, b) => (b.revenue ?? 0) - (a.revenue ?? 0) || b.leads - a.leads || b.calls - a.calls || a.label.localeCompare(b.label))
    return one(c, { from, to, money, rows })
  })

  /**
   * The heat map (ServiceTitan's revenue map): the period's customers by their ZIP — how many, their jobs made in the period and
   * (invoices:read) what they paid in it — every paying or booked customer, or only one source's (?source=, the attribution above).
   * Each ZIP is placed at the middle of its customers' map points, else its jobs', else at the ZIP itself (looked up — up to
   * ZIP_LOOKUPS_PER_OPEN a time); a ZIP still with no point (no Maps key, or not found) is counted as unplaced.
   */
  app.get('/map', requirePermission('reports:read'), async (c) => {
    const me = c.get('user')
    const p = await period(c)
    if (!p) return fail(c, 400, 'Choose the period: from and to as dates, from first.')
    const money = !!(await mayWith(me.role, 'invoices:read', me.userId).catch(() => false))
    const source = sourceKey(c.req.query('source'))
    const only = source ? [...((await attribution(me.companyId, p.start, p.end)).get(source)?.contacts ?? [])] : null
    if (only && !only.length) return one(c, { from: p.from, to: p.to, source: source || null, money, zips: [], unplaced: 0 })
    const jobs = await db.select({ contactId: job.contactId, zip: job.zip, lat: job.lat, lng: job.lng }).from(job)
      .where(and(eq(job.companyId, me.companyId), isNotNull(job.contactId), gte(job.createdAt, p.start), lte(job.createdAt, p.end), only ? inArray(job.contactId, only) : undefined))
    const paid = money ? await db.select({ contactId: invoice.contactId, amount: payment.amount }).from(payment).innerJoin(invoice, eq(invoice.id, payment.invoiceId))
      .where(and(eq(invoice.companyId, me.companyId), isNotNull(payment.paidAt), ne(payment.method, 'account_balance'), gte(payment.paidAt, p.start), lte(payment.paidAt, p.end), only ? inArray(invoice.contactId, only) : undefined)) : []
    const ids = [...new Set([...(jobs as any[]).map((j) => j.contactId), ...(paid as any[]).map((x) => x.contactId)].filter(Boolean))] as string[]
    const people = ids.length ? await db.select({ id: contact.id, zip: contact.zip, lat: contact.lat, lng: contact.lng }).from(contact).where(and(eq(contact.companyId, me.companyId), inArray(contact.id, ids))) : []
    const person = new Map((people as any[]).map((x) => [x.id, x]))
    const zip5 = (z: unknown) => String(z ?? '').trim().replace(/^(\d{5})-\d{4}$/, '$1')
    type Cell = { zip: string; customers: Set<string>; jobs: number; cents: number; pts: Array<[number, number]>; jobPts: Array<[number, number]> }
    const cells = new Map<string, Cell>()
    const cellOf = (z: string) => { const x = cells.get(z) ?? { zip: z, customers: new Set<string>(), jobs: 0, cents: 0, pts: [], jobPts: [] }; cells.set(z, x); return x }
    const zipOfPerson = (id: string, fallback?: unknown) => zip5(person.get(id)?.zip) || zip5(fallback)
    for (const j of jobs as any[]) {
      const z = zipOfPerson(j.contactId, j.zip); if (!z) continue
      const x = cellOf(z); x.jobs++; x.customers.add(j.contactId)
      if (j.lat != null && j.lng != null) x.jobPts.push([Number(j.lat), Number(j.lng)])
    }
    for (const r of paid as any[]) {
      const z = zipOfPerson(r.contactId); if (!z) continue
      const x = cellOf(z); x.cents += Math.round(Number(r.amount) * 100); x.customers.add(r.contactId)
    }
    for (const x of cells.values()) for (const id of x.customers) { const q = person.get(id); if (q?.lat != null && q?.lng != null) x.pts.push([Number(q.lat), Number(q.lng)]) }
    const mid = (pts: Array<[number, number]>) => pts.length ? [pts.reduce((n, q) => n + q[0], 0) / pts.length, pts.reduce((n, q) => n + q[1], 0) / pts.length] : null
    const atZip = new Map<string, [number, number]>()
    const bare = [...cells.values()].filter((x) => !x.pts.length && !x.jobPts.length && /^\d{5}$/.test(x.zip)).slice(0, ZIP_LOOKUPS_PER_OPEN)
    for (const x of bare) {
      const found = await geocoding.geocode(`${x.zip}, USA`, me.companyId).catch(() => null)
      if (found) atZip.set(x.zip, [found.lat, found.lng])
    }
    let unplaced = 0
    const zips = [...cells.values()].map((x) => {
      const at = mid(x.pts) ?? mid(x.jobPts) ?? atZip.get(x.zip) ?? null
      if (!at) unplaced++
      return { zip: x.zip, customers: x.customers.size, jobs: x.jobs, ...(money ? { revenue: x.cents / 100 } : {}), lat: at ? Math.round(at[0] * 1e5) / 1e5 : null, lng: at ? Math.round(at[1] * 1e5) / 1e5 : null }
    }).sort((a: any, b: any) => (b.revenue ?? 0) - (a.revenue ?? 0) || b.jobs - a.jobs || a.zip.localeCompare(b.zip))
    return one(c, { from: p.from, to: p.to, source: source || null, money, zips, unplaced })
  })

  app.get('/spend', requirePermission('invoices:read'), async (c) => {
    const me = c.get('user')
    const from = c.req.query('from') || '', to = c.req.query('to') || from
    if (!MONTH_RE.test(from) || !MONTH_RE.test(to) || to < from) return fail(c, 400, 'Choose the months: from and to as YYYY-MM, from first.')
    const rows = await db.select().from(eventMarketingSpend).where(and(eq(eventMarketingSpend.companyId, me.companyId), gte(eventMarketingSpend.month, from), lte(eventMarketingSpend.month, to))).orderBy(asc(eventMarketingSpend.month), asc(eventMarketingSpend.source))
    return one(c, { data: (rows as any[]).map((r) => ({ id: r.id, source: r.source, label: sourceWords(r.source), month: r.month, amountCents: r.amountCents })) })
  })

  app.put('/spend', requirePermission('invoices:update'), async (c) => {
    const me = c.get('user')
    const b: any = (await c.req.json().catch(() => null)) ?? {}
    const source = typeof b.source === 'string' ? b.source.trim().toLowerCase().replace(/\s+/g, '_').slice(0, 60) : ''
    if (!source) return fail(c, 400, 'Choose the lead source the money was spent on.')
    if (typeof b.month !== 'string' || !MONTH_RE.test(b.month)) return fail(c, 400, 'Choose the month.')
    if (!Number.isInteger(b.amountCents) || b.amountCents < 0 || b.amountCents > MAX_SPEND_CENTS) return fail(c, 400, 'The amount is from 0 to 1,000,000 dollars.')
    const [existing] = await db.select().from(eventMarketingSpend).where(and(eq(eventMarketingSpend.companyId, me.companyId), eq(eventMarketingSpend.source, source), eq(eventMarketingSpend.month, b.month))).limit(1)
    if (b.amountCents === 0) {
      if (existing) await db.delete(eventMarketingSpend).where(eq(eventMarketingSpend.id, existing.id))
      return done(c, 'Spend removed.')
    }
    const [row] = existing
      ? await db.update(eventMarketingSpend).set({ amountCents: b.amountCents, updatedBy: me.userId, updatedAt: new Date() }).where(eq(eventMarketingSpend.id, existing.id)).returning()
      : await db.insert(eventMarketingSpend).values({ source, month: b.month, amountCents: b.amountCents, updatedBy: me.userId, companyId: me.companyId }).returning()
    audit.log({ action: existing ? audit.ACTIONS.UPDATE : audit.ACTIONS.CREATE, entity: 'event_marketing_spend', entityId: row.id, entityName: `${sourceWords(source)} spend, ${b.month}`, metadata: { amountCents: b.amountCents }, req: c })
    return one(c, { id: row.id, source: row.source, label: sourceWords(row.source), month: row.month, amountCents: row.amountCents })
  })

  return app
}
