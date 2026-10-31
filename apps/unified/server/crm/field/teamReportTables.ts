// The team revenue report as tables — revenue per person, the invoices and jobs behind it, quote conversion and the quotes behind
// that — in the shape the saved/scheduled reports and CSV share (reportTables.ts). The money rules are data/teamRevenue.ts's.
import { storeDateString } from '@twomiah/tenant-backend'
import { NO_JOB, NO_ONE, QUOTE_BASES, QUOTE_GROUPS, contactNamesFor, quoteGroups, quoteLines, revenuePeople, revenueSlices, dollars, type QuoteBasis, type QuoteGroup } from '../../data/teamRevenue.ts'
import type { Range } from '../../data/teamReports.ts'
import type { Col, ReportTable, Row } from './reportTables.ts'

export const TEAM_TABS = ['revenue', 'invoices', 'jobs', 'quotes', 'quote_list'] as const
export type TeamTab = typeof TEAM_TABS[number]
export const TEAM_TAB_LABEL: Record<TeamTab, string> = { revenue: 'Revenue per person', invoices: 'Invoices', jobs: 'Jobs', quotes: 'Quote conversion', quote_list: 'Quotes' }
export { QUOTE_BASES, QUOTE_GROUPS }

export interface TeamParams {
  tab: TeamTab; range: Range; tz: string; contactId?: string
  /** a person key ("u:<id>" / "m:<id>") or a bucket ("unassigned", "no_job", "none") */
  person?: string
  by: QuoteGroup; basis: QuoteBasis; status?: 'approved' | 'declined' | 'open'
}

const BASIS_WORDS: Record<QuoteBasis, string> = { drafted: 'drafted', sent: 'sent', approved: 'approved', converted: 'converted to a job', completed: 'whose job was completed' }
const GROUP_WORDS: Record<QuoteGroup, string> = { salesperson: 'salesperson', writer: 'person who wrote it', tech: 'tech on the job it became' }
const SPLIT_WORDS = { equal: 'Equal shares', hours: 'By hours', percent: 'By percent' } as const
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

const bucketName = (key: string, group?: QuoteGroup) =>
  key === NO_JOB ? 'Not on a job (office sales)' : key === NO_ONE ? 'No one on the job'
    : group === 'writer' ? 'Written before we kept track' : group === 'salesperson' ? 'No salesperson' : 'No one on the job'

export async function teamTable(db: any, companyId: string, p: TeamParams): Promise<ReportTable> {
  const money = (key: string, label: string, extra: Partial<Col> = {}): Col => ({ key, label, kind: 'money', ...extra })
  const day = (iso: string | null) => (iso ? storeDateString(new Date(iso), p.tz) : null)
  switch (p.tab) {
    case 'revenue': {
      const data = await revenueSlices(db, companyId, p.range, { contactId: p.contactId })
      const { rows, totals } = revenuePeople(data)
      const shown = p.person ? rows.filter((r) => r.key === p.person) : rows
      const out: Row[] = shown.map((r) => ({
        person: r.person ? r.person.name : bucketName(r.key), invoices: r.invoiceCount, jobs: r.jobCount, invoiced: r.invoiced, collected: r.collected,
        hours: r.hours, perHour: r.hours ? dollars(Math.round((r.invoiced / r.hours) * 100)) : null, collectedPerHour: r.hours ? dollars(Math.round((r.collected / r.hours) * 100)) : null, sharedInvoiced: r.sharedInvoiced,
        drill: { invoices: { tab: 'invoices', person: r.key }, invoiced: { tab: 'invoices', person: r.key }, collected: { tab: 'invoices', person: r.key }, jobs: { tab: 'jobs', person: r.key }, sharedInvoiced: { tab: 'invoices', person: r.key } },
      }))
      const t = p.person ? null : totals
      return {
        tab: 'revenue', title: 'Revenue per person',
        note: 'Invoiced is every invoice that is not a draft or void, by the day it was made; collected is the payments taken in the period, net of refunds. A job with several people on it is shared between them — equally, by the billable hours each logged on it, or by the percentages the office set on the job — and the parts add back to the invoice to the cent. Billable hours are every billable time entry in the period, approved or not.',
        columns: [
          { key: 'person', label: 'Person' }, { key: 'invoices', label: 'Invoices', kind: 'number' }, { key: 'jobs', label: 'Jobs', kind: 'number' },
          money('invoiced', 'Invoiced'), money('collected', 'Collected'), { key: 'hours', label: 'Billable hours', kind: 'number' },
          money('perHour', 'Invoiced per billable hour'), money('collectedPerHour', 'Collected per billable hour', { default: false }), money('sharedInvoiced', 'From shared jobs', { default: false }),
        ],
        rows: out,
        totals: t ? { person: 'Total', invoices: t.invoiceCount, invoiced: t.invoiced, collected: t.collected, hours: t.hours, perHour: t.hours ? dollars(Math.round((t.invoiced / t.hours) * 100)) : null, drill: { invoices: { tab: 'invoices', person: '' }, invoiced: { tab: 'invoices', person: '' }, collected: { tab: 'invoices', person: '' } } } : null,
      }
    }
    case 'invoices': {
      const data = await revenueSlices(db, companyId, p.range, { contactId: p.contactId })
      const slices = (p.person ? data.slices.filter((s) => s.person === p.person) : data.slices).filter((s) => s.invoicedCents !== 0 || s.collectedCents !== 0)
        .sort((a, b) => b.on.localeCompare(a.on) || a.invoiceNumber.localeCompare(b.invoiceNumber) || a.person.localeCompare(b.person))
      const rows: Row[] = slices.map((s) => ({
        invoice: s.invoiceNumber, invoiceId: s.invoiceId, on: day(s.on), customer: s.customer, contactId: s.contactId, job: s.jobNumber, jobId: s.jobId,
        person: data.people.get(s.person)?.name ?? bucketName(s.person), share: Math.round(s.share * 10000) / 100,
        invoiceTotal: dollars(s.invoiceTotalCents), invoiced: dollars(s.invoicedCents), collected: dollars(s.collectedCents),
      }))
      const sum = (k: 'invoicedCents' | 'collectedCents') => dollars(slices.reduce((n, s) => n + s[k], 0))
      return {
        tab: 'invoices', title: 'Invoices behind the revenue', note: 'One line per invoice and person: their share of it, and the part of the invoice and of its payments that is theirs. An invoice paid in the period but made before it shows only what was collected.',
        columns: [
          { key: 'invoice', label: 'Invoice', link: 'invoice', idKey: 'invoiceId' }, { key: 'on', label: 'Made on', kind: 'date' }, { key: 'customer', label: 'Customer', link: 'contact', idKey: 'contactId' },
          { key: 'job', label: 'Job', link: 'job', idKey: 'jobId' }, { key: 'person', label: 'Person' }, { key: 'share', label: 'Share', kind: 'percent' },
          money('invoiceTotal', 'Invoice total', { default: false }), money('invoiced', 'Invoiced (their part)'), money('collected', 'Collected (their part)'),
        ],
        rows, totals: { invoice: 'Total', invoiced: sum('invoicedCents'), collected: sum('collectedCents') },
      }
    }
    case 'jobs': {
      const data = await revenueSlices(db, companyId, p.range, { contactId: p.contactId })
      const slices = p.person ? data.slices.filter((s) => s.person === p.person) : data.slices
      const byJob = new Map<string, { inv: number; col: number }>()
      for (const s of slices) if (s.jobId) { const a = byJob.get(s.jobId) ?? { inv: 0, col: 0 }; a.inv += s.invoicedCents; a.col += s.collectedCents; byJob.set(s.jobId, a) }
      const jobs = [...byJob.keys()].map((id) => data.jobs.get(id)!).filter(Boolean)
      const names = await contactNamesFor(db, companyId, jobs.map((j) => j.contactId ?? ''))
      const nameOf = (k: string) => data.people.get(k)?.name ?? 'Unnamed'
      const rows: Row[] = jobs.map((j) => {
        const a = byJob.get(j.jobId)!
        const total = Object.values(j.hours).reduce((n, h) => n + h, 0)
        return {
          job: j.number, jobId: j.jobId, title: j.title, customer: j.contactId ? names.get(j.contactId) ?? 'Customer' : '', contactId: j.contactId,
          split: j.people.length > 1 ? SPLIT_WORDS[j.mode] : 'One person',
          people: j.people.length ? j.people.map((k) => (j.people.length > 1 ? `${nameOf(k)} ${Math.round((j.shares[k] ?? 0) * 10000) / 100}%` : nameOf(k))).join(' · ') : 'No one',
          hours: Math.round(total * 100) / 100, invoiced: dollars(a.inv), collected: dollars(a.col), completed: day(j.completedAt), note: j.fallback ?? '',
        }
      }).sort((a, b) => String(b.job).localeCompare(String(a.job)))
      return {
        tab: 'jobs', title: p.person ? 'Jobs behind this person’s revenue' : 'Jobs behind the revenue', note: 'The jobs the period’s invoices and payments belong to. With a person chosen, the amounts are their part only.',
        columns: [
          { key: 'job', label: 'Job', link: 'job', idKey: 'jobId' }, { key: 'title', label: 'Title' }, { key: 'customer', label: 'Customer', link: 'contact', idKey: 'contactId' },
          { key: 'people', label: 'People and shares' }, { key: 'split', label: 'Split' }, { key: 'hours', label: 'Billable hours on job', kind: 'number', default: false },
          money('invoiced', 'Invoiced'), money('collected', 'Collected'), { key: 'completed', label: 'Completed', kind: 'date' }, { key: 'note', label: 'Note' },
        ],
        rows, totals: { job: 'Total', invoiced: dollars(rows.reduce((n, r) => n + Math.round(r.invoiced * 100), 0)), collected: dollars(rows.reduce((n, r) => n + Math.round(r.collected * 100), 0)) },
      }
    }
    case 'quotes': {
      const { lines, people } = await quoteLines(db, companyId, p.range, p.by, p.basis, { contactId: p.contactId, person: p.person })
      const groups = quoteGroups(lines, people)
      const rows: Row[] = groups.map((g) => ({
        person: g.person ? g.person.name : bucketName('none', p.by), quotes: g.quotes, approved: g.approved, declined: g.declined, open: g.open,
        approvedValue: g.approvedValue, sentValue: g.sentValue, rate: g.conversionRate, average: g.average,
        drill: { quotes: { tab: 'quote_list', person: g.key, status: '' }, approved: { tab: 'quote_list', person: g.key, status: 'approved' }, declined: { tab: 'quote_list', person: g.key, status: 'declined' }, open: { tab: 'quote_list', person: g.key, status: 'open' } },
      }))
      const sum = (k: 'quotes' | 'approved' | 'declined' | 'open') => groups.reduce((n, g) => n + g[k], 0)
      const decided = sum('approved') + sum('declined')
      return {
        tab: 'quotes', title: `Quote conversion by ${GROUP_WORDS[p.by]}`,
        note: `Quotes ${BASIS_WORDS[p.basis]} in the period (a quote with no such date is left out). Win rate is approved ÷ decided (approved, turned down or expired); quotes still waiting are not misses.`,
        columns: [
          { key: 'person', label: cap(p.by === 'tech' ? 'Tech' : p.by === 'writer' ? 'Written by' : 'Salesperson') }, { key: 'quotes', label: 'Quotes', kind: 'number' }, { key: 'approved', label: 'Approved', kind: 'number' },
          { key: 'declined', label: 'Turned down or expired', kind: 'number' }, { key: 'open', label: 'Waiting', kind: 'number' }, money('approvedValue', 'Approved value'), money('sentValue', 'Sent value', { default: false }),
          { key: 'rate', label: 'Win rate', kind: 'percent' }, money('average', 'Average approved quote', { default: false }),
        ],
        rows, totals: { person: 'Total', quotes: sum('quotes'), approved: sum('approved'), declined: sum('declined'), open: sum('open'), approvedValue: dollars(rows.reduce((n, r) => n + Math.round(r.approvedValue * 100), 0)), rate: decided ? Math.round((sum('approved') / decided) * 100) : 0 },
      }
    }
    case 'quote_list': {
      const { lines, people } = await quoteLines(db, companyId, p.range, p.by, p.basis, { contactId: p.contactId, person: p.person, status: p.status })
      const rows: Row[] = lines.map((l) => ({
        quote: l.number, quoteId: l.id, name: l.name, customer: l.customer, contactId: l.contactId, person: people.get(l.person)?.name ?? bucketName('none', p.by), status: cap(l.status), total: l.total,
        drafted: day(l.createdAt), sent: day(l.sentAt), approved: day(l.approvedAt), converted: day(l.convertedAt), completed: day(l.completedAt), job: l.jobNumber, jobId: l.jobId,
      }))
      return {
        tab: 'quote_list', title: 'Quotes behind the conversion figures', note: `Quotes ${BASIS_WORDS[p.basis]} in the period, grouped by ${GROUP_WORDS[p.by]}.`,
        columns: [
          { key: 'quote', label: 'Quote', link: 'quote', idKey: 'quoteId' }, { key: 'name', label: 'Name', default: false }, { key: 'customer', label: 'Customer', link: 'contact', idKey: 'contactId' },
          { key: 'person', label: cap(p.by === 'tech' ? 'Tech' : p.by === 'writer' ? 'Written by' : 'Salesperson') }, { key: 'status', label: 'Status' }, money('total', 'Total'),
          { key: 'drafted', label: 'Drafted', kind: 'date' }, { key: 'sent', label: 'Sent', kind: 'date' }, { key: 'approved', label: 'Approved', kind: 'date' },
          { key: 'converted', label: 'Converted to job', kind: 'date' }, { key: 'completed', label: 'Job completed', kind: 'date', default: false }, { key: 'job', label: 'Job', link: 'job', idKey: 'jobId' },
        ],
        rows, totals: { quote: 'Total', total: dollars(rows.reduce((n, r) => n + Math.round(r.total * 100), 0)) },
      }
    }
  }
}
