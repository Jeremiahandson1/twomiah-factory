// MARKETING ROI (parity tier 3, field service — ServiceTitan's marketing ROI scorecard; feature marketing_roi, not ready). Per lead
// source over a period: the leads that came in, how many became customers, the jobs and the money those customers brought, against
// what was spent on the source. The spend is kept per source per month in the same ledger the restaurant's event marketing spend
// uses (event_marketing_spend — a source, a month, an amount), not a second one.
//
//   GET /api/marketing-roi?from=YYYY-MM-DD&to=YYYY-MM-DD    reports:read; the money only for a seat with invoices:read
//   GET /api/marketing-roi/spend?from=YYYY-MM&to=YYYY-MM     invoices:read
//   PUT /api/marketing-roi/spend                             invoices:update { source, month, amountCents } (0 takes it away)
//
// Attribution, said plainly on the page: a lead's source is the platform it came from (lead.source_platform); its customer is the
// contact it was converted to; that customer's jobs made in the period and the payments on their invoices in the period count to the
// source. Spend counts for the months the period touches.
import { Hono } from 'hono'
import { and, asc, eq, gte, inArray, isNotNull, lte } from 'drizzle-orm'
import { companyTimeZone, storeDayStart } from '@twomiah/tenant-backend'
import { eventMarketingSpend, invoice, job, lead, payment } from '../../db/schema/index.ts'
import type { AppEnv } from '../../http/env.ts'
import { done, fail, one } from '../../http/reply.ts'
import type { CrmDeps } from '../deps.ts'
import { canSeeWith } from '../deps.ts'

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/
const MAX_SPEND_CENTS = 100_000_000
export const sourceWords = (s: string) => s.replace(/_/g, ' ').replace(/^./, (ch) => ch.toUpperCase())

export interface RoiRow { source: string; label: string; leads: number; customers: number; jobs: number; revenue?: number; spend?: number; costPerLead?: number | null; returnPerDollar?: number | null }

export function createMarketingRoiRoutes(d: CrmDeps) {
  const { db, audit } = d
  const { requirePermission } = d.permissions
  const mayWith = canSeeWith(d.permissions)
  const app = new Hono<AppEnv>()

  app.get('/', requirePermission('reports:read'), async (c) => {
    const me = c.get('user')
    const from = c.req.query('from') || '', to = c.req.query('to') || ''
    if (!DAY_RE.test(from) || !DAY_RE.test(to) || to < from) return fail(c, 400, 'Choose the period: from and to as dates, from first.')
    const money = !!(await mayWith(me.role, 'invoices:read', me.userId).catch(() => false))
    const tz = await companyTimeZone(db, me.companyId)
    const start = storeDayStart(from, tz), end = new Date(storeDayStart(to, tz).getTime() + 86_400_000)
    const leads = await db.select({ source: lead.sourcePlatform, contactId: lead.convertedContactId }).from(lead)
      .where(and(eq(lead.companyId, me.companyId), gte(lead.receivedAt, start), lte(lead.receivedAt, end)))
    const bySource = new Map<string, { leads: number; contacts: Set<string> }>()
    for (const l of leads as any[]) {
      const k = String(l.source || 'unknown')
      const s = bySource.get(k) ?? { leads: 0, contacts: new Set<string>() }
      s.leads++
      if (l.contactId) s.contacts.add(l.contactId)
      bySource.set(k, s)
    }
    const allContacts = [...new Set([...bySource.values()].flatMap((s) => [...s.contacts]))]
    const jobs = allContacts.length ? await db.select({ contactId: job.contactId }).from(job).where(and(eq(job.companyId, me.companyId), inArray(job.contactId, allContacts), gte(job.createdAt, start), lte(job.createdAt, end))) : []
    const paid = money && allContacts.length ? await db.select({ contactId: invoice.contactId, amount: payment.amount }).from(payment).innerJoin(invoice, eq(invoice.id, payment.invoiceId))
      .where(and(eq(invoice.companyId, me.companyId), inArray(invoice.contactId, allContacts), isNotNull(payment.paidAt), gte(payment.paidAt, start), lte(payment.paidAt, end))) : []
    const spendRows = money ? await db.select({ source: eventMarketingSpend.source, cents: eventMarketingSpend.amountCents }).from(eventMarketingSpend)
      .where(and(eq(eventMarketingSpend.companyId, me.companyId), gte(eventMarketingSpend.month, from.slice(0, 7)), lte(eventMarketingSpend.month, to.slice(0, 7)))) : []
    const spend = new Map<string, number>()
    for (const r of spendRows as any[]) spend.set(r.source, (spend.get(r.source) ?? 0) + Number(r.cents))
    const sources = [...new Set([...bySource.keys(), ...spend.keys()])]
    const rows: RoiRow[] = sources.map((k) => {
      const s = bySource.get(k) ?? { leads: 0, contacts: new Set<string>() }
      const row: RoiRow = { source: k, label: sourceWords(k), leads: s.leads, customers: s.contacts.size, jobs: (jobs as any[]).filter((j) => s.contacts.has(j.contactId)).length }
      if (money) {
        const revenueCents = Math.round((paid as any[]).filter((p) => s.contacts.has(p.contactId)).reduce((n, p) => n + Number(p.amount) * 100, 0))
        const spentCents = spend.get(k) ?? 0
        row.revenue = revenueCents / 100
        row.spend = spentCents / 100
        row.costPerLead = spentCents && s.leads ? Math.round(spentCents / s.leads) / 100 : null
        row.returnPerDollar = spentCents ? Math.round((revenueCents / spentCents) * 100) / 100 : null
      }
      return row
    }).sort((a, b) => (b.revenue ?? 0) - (a.revenue ?? 0) || b.leads - a.leads || a.label.localeCompare(b.label))
    return one(c, { from, to, money, rows })
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
