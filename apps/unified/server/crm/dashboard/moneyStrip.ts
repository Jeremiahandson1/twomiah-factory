// The owner's three questions, answered the same on every trade's home screen: what came in, what is owed to me, and who
// is waiting on an answer. GET /api/dashboard-strip. It sits beside each trade's own /api/dashboard rather than inside
// it, because nine dashboards are built on different tables and each should not grow its own copy of the sums.
//
//   cash in    payments recorded this week and this month (the business's calendar, its time zone). The payments' own
//              dates, so a late payment lands in the week it arrived, not the week it was billed. Gross of refunds: an
//              invoice keeps only a running refunded total, with no date to book it against.
//   owed       what open invoices still owe (the invoice list's balance), and how much of that is past due (the due
//              day is over on the business's clock — the invoice list's rule).
//   waiting    new leads nobody has answered for more than a day: inbox enquiries still at `new` and lead contacts
//              nobody has quoted, booked or billed (tenant-backend reporting/newLeads.ts — the same rule as the New
//              leads tile, with an age on it).
//
// Each half is sent only to a seat that may see it, and only where the trade has it — the key is absent otherwise, so a
// screen can tell "not yours to see" from "none". Money asks invoices:read (the Invoices page's question); leads ask
// leads:read (the Lead Inbox's).
import { Hono } from 'hono'
import { and, eq, gte, ne } from 'drizzle-orm'
import {
  companyTimeZone, storeDayRange, storeDayStart, markerDayIsOver, invoiceBalance, round2, DEFAULT_OPEN_STATUSES, countNewLeads,
} from '@twomiah/tenant-backend'
import { contact, quote, job, invoice, payment, lead } from '../../db/schema/index.ts'
import { canSeeWith, type CrmDeps } from '../deps.ts'
import type { AppEnv } from '../../http/env.ts'
import { one } from '../../http/reply.ts'

const DAY = 86400000
/** A lead is "unanswered" once it has waited this long. */
export const UNANSWERED_AFTER_MS = DAY

export interface MoneyStrip {
  money?: { cashInWeek: number; cashInMonth: number; owed: number; owedCount: number; overdue: number; overdueCount: number }
  leads?: { unanswered: number }
}

/** Monday of the local week and the first of the local month, as the instants those local days begin. */
export function periodStarts(tz: string, now: Date = new Date()): { week: Date; month: Date } {
  const { date } = storeDayRange(tz, now)
  const day = new Date(`${date}T00:00:00.000Z`)
  const sinceMonday = (day.getUTCDay() + 6) % 7
  const monday = new Date(day.getTime() - sinceMonday * DAY)
  const first = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), 1))
  return { week: storeDayStart(monday.toISOString().slice(0, 10), tz), month: storeDayStart(first.toISOString().slice(0, 10), tz) }
}

export function createMoneyStripRoutes(d: CrmDeps) {
  const { db } = d
  const canSee = canSeeWith(d.permissions)
  const app = new Hono<AppEnv>()

  app.get('/', async (c) => {
    const me = c.get('user') as any
    const companyId = me.companyId
    const features: string[] = await d.features.enabledFeaturesFor(companyId)
    const out: MoneyStrip = {}

    if (features.includes('invoices') && (await canSee(me.role, 'invoices:read', me.userId))) {
      const tz = await companyTimeZone(db, companyId)
      const { week, month } = periodStarts(tz)
      const since = week.getTime() < month.getTime() ? week : month
      const [invoices, payments] = await Promise.all([
        db.select({ status: invoice.status, total: invoice.total, amountPaid: invoice.amountPaid, amountRefunded: invoice.amountRefunded, dueDate: invoice.dueDate })
          .from(invoice).where(and(eq(invoice.companyId, companyId), ne(invoice.status, 'draft'), ne(invoice.status, 'void'))),
        db.select({ amount: payment.amount, paidAt: payment.paidAt }).from(payment)
          .innerJoin(invoice, eq(payment.invoiceId, invoice.id))
          .where(and(eq(invoice.companyId, companyId), gte(payment.paidAt, since))),
      ])
      let owed = 0, owedCount = 0, overdue = 0, overdueCount = 0
      for (const inv of invoices as any[]) {
        if (!DEFAULT_OPEN_STATUSES.includes(inv.status)) continue
        const balance = invoiceBalance(inv)
        owed = round2(owed + balance); owedCount++
        if (inv.dueDate && markerDayIsOver(inv.dueDate, tz)) { overdue = round2(overdue + balance); overdueCount++ }
      }
      let cashInWeek = 0, cashInMonth = 0
      for (const p of payments as any[]) {
        const at = new Date(p.paidAt).getTime(), amount = Number(p.amount) || 0
        if (at >= week.getTime()) cashInWeek = round2(cashInWeek + amount)
        if (at >= month.getTime()) cashInMonth = round2(cashInMonth + amount)
      }
      out.money = { cashInWeek, cashInMonth, owed, owedCount, overdue, overdueCount }
    }

    if (await canSee(me.role, 'leads:read', me.userId)) {
      const waiting = await countNewLeads(db, { lead, contact, quote, job, invoice }, companyId, {
        inbox: features.includes('lead_inbox'), olderThan: new Date(Date.now() - UNANSWERED_AFTER_MS),
      })
      out.leads = { unanswered: waiting.total }
    }
    return one(c, out)
  })

  return app
}
