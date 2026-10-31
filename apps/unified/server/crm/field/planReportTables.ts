// The service-plan reports as tables: every tab of Plan Reports, with its columns, its rows, and the links from a number to
// the records behind it. One builder serves the screen, the CSV download and the scheduled email, so they cannot disagree.
import { renewalsDue, churnedPlans, type PlanFilter, type Range } from '../../data/teamReports.ts'
import { planSummary, planEvents, plansMade, planRevenue, planPayments } from '../../data/planReports.ts'
import { dayMarker } from '@twomiah/tenant-backend'
import type { Col, ReportTable, Row } from './reportTables.ts'
import { monthStartIn } from './reportTables.ts'

export const PLAN_TABS = ['sold', 'plans', 'summary', 'events', 'renewals', 'ended', 'revenue', 'payments'] as const
export type PlanTab = typeof PLAN_TABS[number]
export const PLAN_TAB_LABEL: Record<PlanTab, string> = {
  sold: 'Sold by', plans: 'Plans made', summary: 'Summary', events: 'History', renewals: 'Coming due', ended: 'Ended', revenue: 'Revenue', payments: 'Payments',
}
const KIND_WORDS: Record<string, string> = { created: 'Made', renewed: 'Renewed', suspended: 'Suspended', reactivated: 'Reactivated', cancelled: 'Cancelled', expired: 'Ran out' }
const SUMMARY_KIND: Record<string, string> = { made: 'created', renewed: 'renewed', suspended: 'suspended', reactivated: 'reactivated', cancelled: 'cancelled', expired: 'expired' }
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const monthLabel = (ym: string) => `${MONTH_NAMES[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`

export interface PlanParams {
  tab: PlanTab
  range: Range
  filter: PlanFilter
  /** Look-ahead for Coming due: 30 or 60. */
  days?: 30 | 60
  /** Events: only this kind. */
  kind?: string
  /** Revenue: recurring or collected. */
  measure?: 'recurring' | 'collected'
  /** Revenue and Payments: the month (YYYY-MM) a figure is for. */
  month?: string
  /** The business's today (YYYY-MM-DD) and clock. */
  today: string
  tz: string
  now?: Date
}

const filtersDrill = (f: PlanFilter) => ({ ...(f.sellerId ? { sellerId: f.sellerId } : {}), ...(f.contactId ? { contactId: f.contactId } : {}), ...(f.status ? { status: f.status } : {}) })

export async function planTable(db: any, companyId: string, p: PlanParams): Promise<ReportTable> {
  const money = (key: string, label: string, extra: Partial<Col> = {}): Col => ({ key, label, kind: 'money', ...extra })
  switch (p.tab) {
    case 'plans': {
      const rows = await plansMade(db, companyId, p.range, p.filter)
      return {
        tab: 'plans', title: 'Plans made', note: 'Every plan made in the period.',
        columns: [
          { key: 'number', label: 'Plan', link: 'agreement', idKey: 'id' }, { key: 'name', label: 'Plan name' },
          { key: 'customer', label: 'Customer', link: 'contact', idKey: 'contactId' }, { key: 'seller', label: 'Sold by' },
          { key: 'madeOn', label: 'Made on', kind: 'date' }, { key: 'status', label: 'Status' }, money('yearlyValue', 'Yearly value'),
        ],
        rows: rows.map((r) => ({ id: r.id, number: r.number, name: r.name, contactId: r.contactId, customer: r.customer, seller: r.soldBy?.name ?? 'Not recorded', madeOn: r.madeOn, status: r.status.charAt(0).toUpperCase() + r.status.slice(1), yearlyValue: r.yearlyValue })),
      }
    }
    case 'sold': {
      const made = await plansMade(db, companyId, p.range, p.filter)
      const by = new Map<string, { id: string | null; name: string; plans: number; yearly: number; active: number }>()
      for (const r of made) {
        const k = r.soldBy?.id ?? 'none'
        const a = by.get(k) ?? { id: r.soldBy?.id ?? null, name: r.soldBy?.name ?? 'Made before we kept track', plans: 0, yearly: 0, active: 0 }
        a.plans += 1; a.yearly += r.yearlyValue; if (r.status === 'active') a.active += 1
        by.set(k, a)
      }
      const rows: Row[] = [...by.values()].sort((a, b) => (a.id ? 0 : 1) - (b.id ? 0 : 1) || b.yearly - a.yearly).map((a) => ({
        seller: a.name, plans: a.plans, yearlyValue: Math.round(a.yearly * 100) / 100, stillActive: a.active, average: a.plans ? Math.round((a.yearly / a.plans) * 100) / 100 : 0,
        drill: { plans: { tab: 'plans', ...filtersDrill(p.filter), ...(p.filter.name ? { planName: p.filter.name } : {}), sellerId: a.id ?? 'none' } },
      }))
      return {
        tab: 'sold', title: 'Plans sold by person', note: 'Plans made in the period, by the person who sold them. Yearly value is the price of one bill times the bills in a year.',
        columns: [{ key: 'seller', label: 'Sold by' }, { key: 'plans', label: 'Plans', kind: 'number' }, money('yearlyValue', 'Yearly value'), { key: 'stillActive', label: 'Still active', kind: 'number' }, money('average', 'Average plan', { default: false })],
        rows,
        totals: { seller: 'Total', plans: rows.reduce((a, r) => a + r.plans, 0), yearlyValue: Math.round(rows.reduce((a, r) => a + r.yearlyValue, 0) * 100) / 100, stillActive: rows.reduce((a, r) => a + r.stillActive, 0) },
      }
    }
    case 'summary': {
      const { totals, rows } = await planSummary(db, companyId, p.range, p.filter, p.now)
      const withDrill = (name: string | null, r: any): Row => {
        const row: Row = { name: name ?? 'All plans', ...r }
        row.drill = Object.fromEntries(Object.entries(SUMMARY_KIND).map(([col, kind]) => [col, { tab: 'events', kind, ...filtersDrill(p.filter), ...(name ? { planName: name } : p.filter.name ? { planName: p.filter.name } : {}) }]))
        return row
      }
      return {
        tab: 'summary', title: 'Plan summary', note: 'What happened to the plans in the period, and how many were active when it began and when it ended. A plan on hold is not active.',
        columns: [
          { key: 'name', label: 'Plan' }, { key: 'activeAtStart', label: 'Active at start', kind: 'number' }, { key: 'made', label: 'Made', kind: 'number' }, { key: 'renewed', label: 'Renewed', kind: 'number' },
          { key: 'suspended', label: 'Suspended', kind: 'number' }, { key: 'reactivated', label: 'Reactivated', kind: 'number' }, { key: 'cancelled', label: 'Cancelled', kind: 'number' },
          { key: 'expired', label: 'Ran out', kind: 'number' }, { key: 'activeAtEnd', label: 'Active at end', kind: 'number' },
        ],
        rows: rows.map((r) => withDrill(r.name, r)), totals: withDrill(null, totals),
      }
    }
    case 'events': {
      const rows = await planEvents(db, companyId, p.range, p.filter, p.kind)
      return {
        tab: 'events', title: p.kind ? `Plans ${(KIND_WORDS[p.kind] ?? p.kind).toLowerCase()}` : 'Plan history', note: 'Every change to a plan, newest first.',
        columns: [
          { key: 'at', label: 'When', kind: 'datetime' }, { key: 'what', label: 'What' }, { key: 'number', label: 'Plan', link: 'agreement', idKey: 'planId' }, { key: 'name', label: 'Plan name' },
          { key: 'customer', label: 'Customer', link: 'contact', idKey: 'contactId' }, { key: 'by', label: 'By' }, { key: 'note', label: 'Note', default: false },
        ],
        rows: rows.map((r) => ({ ...r, what: KIND_WORDS[r.kind] ?? r.kind, by: r.by ?? 'The app' })),
      }
    }
    case 'renewals': {
      const days = p.days === 60 ? 60 : 30
      const rows = await renewalsDue(db, companyId, dayMarker(p.today), days, p.filter)
      return {
        tab: 'renewals', title: `Coming due in ${days} days`, note: 'Plans still active whose term ends soon. "Needs a person" lapses unless someone renews it.',
        columns: [
          { key: 'number', label: 'Plan', link: 'agreement', idKey: 'id' }, { key: 'name', label: 'Plan name' }, { key: 'customer', label: 'Customer', link: 'contact', idKey: 'contactId' },
          { key: 'endDate', label: 'Ends', kind: 'date' }, { key: 'daysLeft', label: 'Days left', kind: 'number' }, { key: 'renews', label: 'Renewal' }, { key: 'autopay', label: 'Autopay' }, money('yearlyValue', 'Yearly value'),
        ],
        rows: rows.map((r) => ({ ...r, renews: r.renewal === 'manual' ? 'Needs a person' : 'Renews itself', autopay: r.autopay ? 'Yes' : 'No' })),
      }
    }
    case 'ended': {
      const rows = await churnedPlans(db, companyId, p.range, p.filter)
      return {
        tab: 'ended', title: 'Plans that ended', note: 'Cancelled by someone, or ran out their term without a renewal. A day marked "about" is from a plan that ended before the app recorded it.',
        columns: [
          { key: 'number', label: 'Plan', link: 'agreement', idKey: 'id' }, { key: 'name', label: 'Plan name' }, { key: 'customer', label: 'Customer' },
          { key: 'how', label: 'How' }, { key: 'endedOn', label: 'Ended' }, { key: 'reason', label: 'Reason' }, { key: 'seller', label: 'Sold by' }, money('yearlyValue', 'Yearly value'),
        ],
        rows: rows.map((r) => ({ ...r, how: r.how === 'expired' ? 'Ran out' : 'Cancelled', endedOn: r.dateKnown ? r.endedOn : `about ${r.endedOn}`, seller: r.soldBy?.name ?? 'Not recorded' })),
      }
    }
    case 'revenue': {
      const measure = p.measure === 'collected' ? 'collected' : 'recurring'
      const rev = await planRevenue(db, companyId, p.tz, p.month ?? p.today.slice(0, 7), 12, p.filter, monthStartIn(p.tz), p.now)
      const cols: Col[] = [{ key: 'name', label: 'Plan' }, ...rev.months.map((m, i) => money(`m${i}`, monthLabel(m)))]
      if (measure === 'collected') cols.push(money('total', 'Total'))
      const rowOf = (name: string, vals: number[], total?: number): Row => {
        const row: Row = { name }
        vals.forEach((v, i) => { row[`m${i}`] = v })
        if (measure === 'collected') {
          row.total = total
          row.drill = Object.fromEntries(vals.map((_, i) => [`m${i}`, { tab: 'payments', month: rev.months[i], ...(name !== 'All plans' ? { planName: name } : {}), ...filtersDrill(p.filter) }]))
        }
        return row
      }
      return {
        tab: 'revenue', title: measure === 'collected' ? 'Plan revenue collected, by month' : 'Recurring plan revenue, by month',
        note: measure === 'collected'
          ? 'Money taken in each month on invoices a plan billed, net of refunds. Invoices from before plans were linked to their invoices are matched by their wording where it is unambiguous.'
          : 'The monthly value of the plans that were active at the end of each month. A plan on hold is not counted.',
        columns: cols,
        rows: rev.rows.map((r) => rowOf(r.name, r[measure], r.collectedTotal)),
        totals: rowOf('All plans', rev.totals[measure], rev.totals.collectedTotal),
      }
    }
    case 'payments': {
      const month = p.month ?? p.today.slice(0, 7)
      const start = monthStartIn(p.tz)(month), nextMonth = (() => { const [y, m] = month.split('-').map(Number); const d = new Date(Date.UTC(y, m, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}` })()
      const range: Range = { gte: start, lte: new Date(monthStartIn(p.tz)(nextMonth).getTime() - 1) }
      const rows = await planPayments(db, companyId, range, p.filter)
      return {
        tab: 'payments', title: `Plan payments, ${monthLabel(month)}`, note: 'The payments behind a collected figure.',
        columns: [
          { key: 'paidOn', label: 'Paid on', kind: 'date' }, { key: 'invoiceNumber', label: 'Invoice', link: 'invoice', idKey: 'invoiceId' }, { key: 'planNumber', label: 'Plan', link: 'agreement', idKey: 'planId' },
          { key: 'name', label: 'Plan name' }, { key: 'customer', label: 'Customer', link: 'contact', idKey: 'contactId' }, money('amount', 'Amount'),
        ],
        rows: rows as unknown as Row[],
        totals: { paidOn: 'Total', amount: Math.round(rows.reduce((a, r) => a + r.amount, 0) * 100) / 100 },
      }
    }
  }
}
