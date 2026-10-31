// Service-plan reports, the full set (RULEBOOK §2: raw SQL lives here). Built on the plan's history (agreement_event):
//   - what happened in a period     — made, renewed, suspended, reactivated, cancelled, expired, per plan name
//   - active at the start / the end — the state a plan was in at an instant, read from its last event up to then
//   - plan revenue by month         — recurring (monthly value of the plans active at each month's end) and collected
//                                     (payments on the invoices a plan billed, net of refunds), 12 months, per plan name
// Every report takes the same filters (plan name, seller, customer, current status). Nothing is guessed: a plan with no
// history rows at all (made by a script, or before the log) is read from its own created date; a payment on an invoice no
// plan is linked to is not plan revenue and is not counted.
import { sql } from 'drizzle-orm'
import { storeDateString } from '@twomiah/tenant-backend'
import { rowsOf, num, r2, at, between, namesFor, yearlyValue, planWhere, type PlanFilter, type Range, type Person } from './teamReports.ts'
export type { PlanFilter }

export const EVENT_KINDS = ['created', 'renewed', 'suspended', 'reactivated', 'cancelled', 'expired'] as const
export type EventKind = typeof EVENT_KINDS[number]

/** A plan's state at an instant, from its last event up to then. */
type State = 'active' | 'suspended' | 'ended' | null
const stateOf = (kind: string | null): State =>
  !kind ? null : kind === 'suspended' ? 'suspended' : kind === 'cancelled' || kind === 'expired' ? 'ended' : 'active'

export interface PlanAt { id: string; name: string; contactId: string; amount: unknown; frequency: string; state: State }

/** Every plan that matches the filters, with the state it was in at `when` (null: it did not exist yet). */
export async function plansAt(db: any, companyId: string, when: Date, f: PlanFilter = {}): Promise<PlanAt[]> {
  const rows = rowsOf(await db.execute(sql`
    SELECT a.id, a.name, a.contact_id, a.amount, a.billing_frequency,
      COALESCE(
        (SELECT e.kind FROM agreement_event e WHERE e.agreement_id = a.id AND e.at <= ${at(when)} ORDER BY e.at DESC, e.id DESC LIMIT 1),
        CASE WHEN NOT EXISTS (SELECT 1 FROM agreement_event e WHERE e.agreement_id = a.id) AND a.created_at <= ${at(when)} THEN 'created' END
      ) AS last_kind
    FROM service_agreement a WHERE a.company_id = ${companyId} ${planWhere(f)}`))
  return rows.map((r) => ({ id: r.id, name: r.name, contactId: r.contact_id, amount: r.amount, frequency: r.billing_frequency, state: stateOf(r.last_kind) }))
}

export interface SummaryCounts { made: number; renewed: number; suspended: number; reactivated: number; cancelled: number; expired: number; activeAtStart: number; activeAtEnd: number }
export interface SummaryRow extends SummaryCounts { name: string }
const zero = (): SummaryCounts => ({ made: 0, renewed: 0, suspended: 0, reactivated: 0, cancelled: 0, expired: 0, activeAtStart: 0, activeAtEnd: 0 })
const COUNT_OF: Record<string, keyof SummaryCounts> = { created: 'made', renewed: 'renewed', suspended: 'suspended', reactivated: 'reactivated', cancelled: 'cancelled', expired: 'expired' }

/**
 * What happened to the plans in a period, per plan name, with how many were active when it began and when it ended.
 * A period with no start has no "active at start" (nothing was before it); with no end it runs to now.
 */
export async function planSummary(db: any, companyId: string, range: Range, f: PlanFilter = {}, now = new Date()): Promise<{ totals: SummaryCounts; rows: SummaryRow[] }> {
  const events = rowsOf(await db.execute(sql`
    SELECT a.name, e.kind, COUNT(*) AS n FROM agreement_event e JOIN service_agreement a ON a.id = e.agreement_id
    WHERE e.company_id = ${companyId} ${between(sql.raw('e.at'), range)} ${planWhere(f)} GROUP BY 1, 2`))
  const acc = new Map<string, SummaryCounts>()
  const slot = (name: string) => { let s = acc.get(name); if (!s) { s = zero(); acc.set(name, s) } return s }
  for (const e of events) { const k = COUNT_OF[e.kind]; if (k) slot(e.name)[k] += num(e.n) }
  if (range.gte) for (const p of await plansAt(db, companyId, new Date(range.gte.getTime() - 1), f)) if (p.state === 'active') slot(p.name).activeAtStart += 1
  for (const p of await plansAt(db, companyId, range.lte ?? now, f)) if (p.state === 'active') slot(p.name).activeAtEnd += 1
  const rows = [...acc.entries()].map(([name, c]) => ({ name, ...c })).sort((a, b) => b.activeAtEnd - a.activeAtEnd || a.name.localeCompare(b.name))
  const totals = zero()
  for (const r of rows) for (const k of Object.keys(totals) as Array<keyof SummaryCounts>) totals[k] += r[k]
  return { totals, rows }
}

export interface EventRow { id: string; kind: EventKind; at: string; planId: string; number: string; name: string; contactId: string; customer: string; by: string | null; note: string | null }

/** The history lines in a period (the numbers in the summary, one by one), newest first. */
export async function planEvents(db: any, companyId: string, range: Range, f: PlanFilter = {}, kind?: string): Promise<EventRow[]> {
  const rows = rowsOf(await db.execute(sql`
    SELECT e.id, e.kind, e.at, e.by_user_id, e.note, a.id AS plan_id, a.number, a.name, a.contact_id, c.name AS contact_name, c.company AS contact_company
    FROM agreement_event e JOIN service_agreement a ON a.id = e.agreement_id LEFT JOIN contact c ON c.id = a.contact_id
    WHERE e.company_id = ${companyId} ${kind ? sql`AND e.kind = ${kind}` : sql``} ${between(sql.raw('e.at'), range)} ${planWhere(f)}
    ORDER BY e.at DESC, e.id DESC LIMIT 2000`))
  const people = await namesFor(db, companyId, [...new Set(rows.map((r) => r.by_user_id).filter(Boolean))] as string[], [])
  return rows.map((r) => ({
    id: r.id, kind: r.kind, at: new Date(r.at).toISOString(), planId: r.plan_id, number: r.number, name: r.name,
    contactId: r.contact_id, customer: r.contact_name || r.contact_company || 'Customer',
    by: r.by_user_id ? people.get(`u:${r.by_user_id}`)?.name ?? null : null, note: r.note || null,
  }))
}

export interface PlanListRow { id: string; number: string; name: string; status: string; contactId: string; customer: string; soldBy: Person | null; madeOn: string; yearlyValue: number }

/** The plans made in a period, one by one (the Sold report's numbers; the drill-down from a seller). */
export async function plansMade(db: any, companyId: string, range: Range, f: PlanFilter = {}): Promise<PlanListRow[]> {
  const rows = rowsOf(await db.execute(sql`
    SELECT a.id, a.number, a.name, a.status, a.contact_id, a.created_at, a.sold_by_id, a.amount, a.billing_frequency, c.name AS contact_name, c.company AS contact_company
    FROM service_agreement a LEFT JOIN contact c ON c.id = a.contact_id
    WHERE a.company_id = ${companyId} ${between(sql.raw('a.created_at'), range)} ${planWhere(f)}
    ORDER BY a.created_at DESC, a.number DESC LIMIT 2000`))
  const people = await namesFor(db, companyId, [...new Set(rows.map((r) => r.sold_by_id).filter(Boolean))] as string[], [])
  return rows.map((r) => ({
    id: r.id, number: r.number, name: r.name, status: r.status, contactId: r.contact_id, customer: r.contact_name || r.contact_company || 'Customer',
    soldBy: r.sold_by_id ? people.get(`u:${r.sold_by_id}`) ?? null : null, madeOn: new Date(r.created_at).toISOString().slice(0, 10), yearlyValue: yearlyValue(r.amount, r.billing_frequency),
  }))
}

export interface RevenueRow { name: string; recurring: number[]; collected: number[]; collectedTotal: number }
export interface PlanRevenue { months: string[]; rows: RevenueRow[]; totals: { recurring: number[]; collected: number[]; collectedTotal: number } }

const addMonths = (ym: string, n: number) => { const [y, m] = ym.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}` }

/**
 * Plan revenue for `count` months ending at `lastMonth` (YYYY-MM, the business's calendar). Recurring is the monthly value
 * of the plans active at the end of each month (the current month: right now); collected is the money taken in the month on
 * the invoices a plan billed, by the payment's own day — refunds are negative rows, so it is net.
 * `monthStart(ym)` / `monthEnd(ym)` turn a month into its instants on the company's clock.
 */
export async function planRevenue(
  db: any, companyId: string, tz: string, lastMonth: string, count: number, f: PlanFilter,
  monthStart: (ym: string) => Date, now = new Date(),
): Promise<PlanRevenue> {
  const months = Array.from({ length: count }, (_, i) => addMonths(lastMonth, i - (count - 1)))
  const rec = new Map<string, number[]>(), col = new Map<string, number[]>()
  const slot = (m: Map<string, number[]>, name: string) => { let a = m.get(name); if (!a) { a = new Array(count).fill(0); m.set(name, a) } return a }
  for (let i = 0; i < count; i++) {
    const end = new Date(Math.min(monthStart(addMonths(months[i], 1)).getTime() - 1, now.getTime()))
    for (const p of await plansAt(db, companyId, end, f)) if (p.state === 'active') slot(rec, p.name)[i] += yearlyValue(p.amount, p.frequency) / 12
  }
  const first = monthStart(months[0]), last = new Date(monthStart(addMonths(lastMonth, 1)).getTime() - 1)
  const paid = rowsOf(await db.execute(sql`
    SELECT p.amount, p.paid_at, a.name FROM payment p
    JOIN invoice i ON i.id = p.invoice_id JOIN service_agreement a ON a.id = i.service_agreement_id
    WHERE i.company_id = ${companyId} ${between(sql.raw('p.paid_at'), { gte: first, lte: last })} ${planWhere(f)}`))
  for (const p of paid) {
    const i = months.indexOf(storeDateString(new Date(p.paid_at), tz).slice(0, 7))
    if (i >= 0) slot(col, p.name)[i] += num(p.amount)
  }
  const names = [...new Set([...rec.keys(), ...col.keys()])].sort((a, b) => a.localeCompare(b))
  const rows: RevenueRow[] = names.map((name) => {
    const recurring = (rec.get(name) ?? new Array(count).fill(0)).map(r2), collected = (col.get(name) ?? new Array(count).fill(0)).map(r2)
    return { name, recurring, collected, collectedTotal: r2(collected.reduce((a, b) => a + b, 0)) }
  })
  const sum = (k: 'recurring' | 'collected') => months.map((_, i) => r2(rows.reduce((a, r) => a + r[k][i], 0)))
  return { months, rows, totals: { recurring: sum('recurring'), collected: sum('collected'), collectedTotal: r2(rows.reduce((a, r) => a + r.collectedTotal, 0)) } }
}

export interface PaymentRow { id: string; paidOn: string; amount: number; invoiceId: string; invoiceNumber: string; planId: string; planNumber: string; name: string; contactId: string; customer: string }

/** The payments behind a collected figure: one month and optionally one plan name (the drill-down from the revenue report). */
export async function planPayments(db: any, companyId: string, range: Range, f: PlanFilter = {}): Promise<PaymentRow[]> {
  const rows = rowsOf(await db.execute(sql`
    SELECT p.id, p.amount, p.paid_at, i.id AS invoice_id, i.number AS invoice_number, a.id AS plan_id, a.number AS plan_number, a.name, a.contact_id, c.name AS contact_name, c.company AS contact_company
    FROM payment p JOIN invoice i ON i.id = p.invoice_id JOIN service_agreement a ON a.id = i.service_agreement_id LEFT JOIN contact c ON c.id = a.contact_id
    WHERE i.company_id = ${companyId} ${between(sql.raw('p.paid_at'), range)} ${planWhere(f)}
    ORDER BY p.paid_at DESC, p.id DESC LIMIT 2000`))
  return rows.map((r) => ({
    id: r.id, paidOn: new Date(r.paid_at).toISOString().slice(0, 10), amount: r2(num(r.amount)), invoiceId: r.invoice_id, invoiceNumber: r.invoice_number,
    planId: r.plan_id, planNumber: r.plan_number, name: r.name, contactId: r.contact_id, customer: r.contact_name || r.contact_company || 'Customer',
  }))
}
