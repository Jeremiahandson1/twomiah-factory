// Team revenue, the full set (RULEBOOK §2: raw SQL lives here):
//   - revenue per person, with the job's revenue SHARED between the people on it — equally, by the billable hours each logged on
//     the job, or by the office's own percentages (job.revenue_split) — and billable hours and revenue per hour
//   - the invoices, payments and jobs behind each number (a number can be opened)
//   - quote conversion by the person who wrote the quote, the quote's salesperson, or the tech on the job it became, counted by
//     the date the person chooses: drafted, sent, approved, converted to a job, or the job completed
// Money is added up in cents so a split never loses or gains a cent: each invoice (and each payment) is cut into whole cents by the
// largest-remainder rule, so the people's parts add back to the invoice exactly. Nothing is guessed: an invoice that reaches no job
// is `no_job`, a job nobody is on is `unassigned`, and a split the crew no longer fits says so and falls back to equal shares.
import { sql } from 'drizzle-orm'
import { rowsOf, num, r2, at, between, namesFor, INVOICE_JOB, type Range, type Person } from './teamReports.ts'

export type SplitMode = 'equal' | 'hours' | 'percent'
export interface RevenueSplit { mode: SplitMode; percents?: Record<string, number> }
export const NO_ONE = 'unassigned' as const
export const NO_JOB = 'no_job' as const

const cents = (v: unknown) => Math.round(num(v) * 100)
const dollars = (c: number) => Math.round(c) / 100
const keyOf = (userId: unknown, memberId: unknown) => (userId ? `u:${userId}` : memberId ? `m:${memberId}` : null)

/** Cut a whole number of cents between people by their shares (fractions that total 1): the parts add back to the amount exactly. */
export function splitCents(total: number, keys: string[], shares: Record<string, number>): Record<string, number> {
  const sign = total < 0 ? -1 : 1, abs = Math.abs(total)
  const raw = keys.map((k) => ({ k, exact: abs * (shares[k] ?? 0) }))
  const out: Record<string, number> = {}
  let given = 0
  for (const r of raw) { out[r.k] = Math.floor(r.exact + 1e-9); given += out[r.k] }
  let left = abs - given
  const order = [...raw].sort((a, b) => (b.exact - Math.floor(b.exact + 1e-9)) - (a.exact - Math.floor(a.exact + 1e-9)) || a.k.localeCompare(b.k))
  for (let i = 0; left > 0 && order.length; i = (i + 1) % order.length, left--) out[order[i].k] += 1
  for (const k of keys) out[k] *= sign
  return out
}

export interface JobShares {
  jobId: string; number: string; title: string; contactId: string | null; status: string; completedAt: string | null
  /** what the office asked for, and what was applied (it falls back to equal when the ask cannot be met) */
  requested: SplitMode; mode: SplitMode; fallback: string | null
  people: string[]; shares: Record<string, number>; hours: Record<string, number>
}

/** The shares of one job's revenue, from its crew, its chosen split and the billable hours logged on it. */
export function sharesOf(keys: string[], requested: SplitMode, percents: Record<string, number> | undefined, hours: Record<string, number>): { mode: SplitMode; shares: Record<string, number>; fallback: string | null } {
  if (!keys.length) return { mode: 'equal', shares: {}, fallback: null }
  const equal = (fallback: string | null) => ({ mode: 'equal' as const, shares: Object.fromEntries(keys.map((k) => [k, 1 / keys.length])), fallback })
  if (keys.length === 1) return { mode: 'equal', shares: { [keys[0]]: 1 }, fallback: null }
  if (requested === 'percent') {
    const p = percents ?? {}
    const total = keys.reduce((n, k) => n + (typeof p[k] === 'number' ? p[k] : 0), 0)
    const fits = keys.every((k) => typeof p[k] === 'number' && p[k] >= 0) && Object.keys(p).every((k) => keys.includes(k)) && Math.abs(total - 100) < 0.005
    if (!fits) return equal('The percentages no longer match the people on this job, so it is shared equally.')
    return { mode: 'percent', shares: Object.fromEntries(keys.map((k) => [k, p[k] / 100])), fallback: null }
  }
  if (requested === 'hours') {
    const total = keys.reduce((n, k) => n + (hours[k] ?? 0), 0)
    if (total <= 0) return equal('No billable hours are logged on this job yet, so it is shared equally.')
    return { mode: 'hours', shares: Object.fromEntries(keys.map((k) => [k, (hours[k] ?? 0) / total])), fallback: null }
  }
  return equal(null)
}

/** Crew, split and hours for these jobs. */
export async function jobSharesFor(db: any, companyId: string, jobIds: string[]): Promise<Map<string, JobShares>> {
  const out = new Map<string, JobShares>()
  if (!jobIds.length) return out
  const ids = sql.join(jobIds.map((i) => sql`${i}`), sql`, `)
  const jobs = rowsOf(await db.execute(sql`SELECT id, number, title, contact_id, status, completed_at, assigned_to_id, assigned_to_member_id, revenue_split FROM job WHERE company_id = ${companyId} AND id IN (${ids})`))
  const others = rowsOf(await db.execute(sql`SELECT job_id, user_id, member_id FROM job_assignee WHERE company_id = ${companyId} AND job_id IN (${ids}) ORDER BY position, id`))
  const hours = rowsOf(await db.execute(sql`SELECT job_id, user_id, COALESCE(SUM(hours::numeric), 0) AS h FROM time_entry WHERE company_id = ${companyId} AND billable AND job_id IN (${ids}) GROUP BY job_id, user_id`))
  for (const j of jobs) {
    const keys = [keyOf(j.assigned_to_id, j.assigned_to_member_id), ...others.filter((o) => o.job_id === j.id).map((o) => keyOf(o.user_id, o.member_id))].filter(Boolean) as string[]
    const people = [...new Set(keys)]
    const h: Record<string, number> = {}
    for (const r of hours) if (r.job_id === j.id && r.user_id) h[`u:${r.user_id}`] = num(r.h)
    const split = (typeof j.revenue_split === 'string' ? JSON.parse(j.revenue_split) : j.revenue_split) as RevenueSplit | null
    const requested: SplitMode = split?.mode === 'hours' || split?.mode === 'percent' ? split.mode : 'equal'
    const s = sharesOf(people, requested, split?.percents, h)
    out.set(j.id, { jobId: j.id, number: j.number, title: j.title, contactId: j.contact_id, status: j.status, completedAt: j.completed_at ? new Date(j.completed_at).toISOString() : null, requested, mode: s.mode, fallback: s.fallback, people, shares: s.shares, hours: h })
  }
  return out
}

/** One job's crew for the split screen (the lead first). */
export async function jobCrew(db: any, companyId: string, jobId: string): Promise<{ job: JobShares; people: Array<Person & { key: string; hours: number }>; split: RevenueSplit | null } | null> {
  const got = await jobSharesFor(db, companyId, [jobId])
  const job = got.get(jobId)
  if (!job) return null
  const names = await namesFor(db, companyId, job.people.filter((k) => k.startsWith('u:')).map((k) => k.slice(2)), job.people.filter((k) => k.startsWith('m:')).map((k) => k.slice(2)))
  const [row] = rowsOf(await db.execute(sql`SELECT revenue_split FROM job WHERE id = ${jobId} AND company_id = ${companyId}`))
  const raw = row?.revenue_split
  return {
    job,
    people: job.people.map((k) => ({ ...(names.get(k) ?? { id: k.slice(2), name: 'Unnamed', kind: k.startsWith('u:') ? 'user' as const : 'member' as const }), key: k, hours: job.hours[k] ?? 0 })),
    split: (typeof raw === 'string' ? JSON.parse(raw) : raw) ?? null,
  }
}

export interface Slice {
  invoiceId: string; invoiceNumber: string; contactId: string | null; customer: string; jobId: string | null; jobNumber: string | null
  /** when the invoice was made (an instant; the report shows it on the business's calendar) */
  on: string; person: string; share: number
  invoicedCents: number; collectedCents: number; invoiceTotalCents: number
  /** the invoice was made in the period (so it counts as one of the person's invoices), not only paid in it */
  madeInRange: boolean; shared: boolean
}
export interface RevenueData { slices: Slice[]; jobs: Map<string, JobShares>; people: Map<string, Person>; hours: Map<string, number> }
export interface RevenueFilter { contactId?: string }

/**
 * Invoices made in the period and payments taken in it, each cut between the people on the job it belongs to. `invoiced` is every
 * invoice that is not a draft or void, by the day made (the Reports page's rule); `collected` is the payment ledger by the day taken,
 * net of refunds. With no filter the people's parts add up to the Reports page's own totals.
 */
export async function revenueSlices(db: any, companyId: string, range: Range, f: RevenueFilter = {}): Promise<RevenueData> {
  const contact = f.contactId ? sql`AND i.contact_id = ${f.contactId}` : sql``
  const invoices = rowsOf(await db.execute(sql`
    SELECT i.id, i.number, i.contact_id, i.created_at, i.total, ${INVOICE_JOB} AS job_id, c.name AS contact_name, c.company AS contact_company
    FROM invoice i LEFT JOIN contact c ON c.id = i.contact_id
    WHERE i.company_id = ${companyId} AND i.status NOT IN ('void', 'draft') ${contact} ${between(sql.raw('i.created_at'), range)}`))
  const payments = rowsOf(await db.execute(sql`
    SELECT p.id AS payment_id, p.amount, i.id AS id, i.number, i.contact_id, i.created_at, i.total, ${INVOICE_JOB} AS job_id, c.name AS contact_name, c.company AS contact_company
    FROM payment p JOIN invoice i ON i.id = p.invoice_id LEFT JOIN contact c ON c.id = i.contact_id
    WHERE i.company_id = ${companyId} ${contact} ${between(sql.raw('p.paid_at'), range)}`))
  const jobIds = [...new Set([...invoices, ...payments].map((r) => r.job_id).filter(Boolean))] as string[]
  const jobs = await jobSharesFor(db, companyId, jobIds)
  const jobNumbers = jobs

  const bySlice = new Map<string, Slice>()
  const slot = (inv: any, personKey: string, share: number, shared: boolean, madeInRange: boolean): Slice => {
    const k = `${inv.id}|${personKey}`
    let s = bySlice.get(k)
    if (!s) {
      const jobId = inv.job_id ?? null
      s = {
        invoiceId: inv.id, invoiceNumber: inv.number, contactId: inv.contact_id ?? null, customer: inv.contact_name || inv.contact_company || 'Customer',
        jobId, jobNumber: jobId ? jobNumbers.get(jobId)?.number ?? null : null, on: new Date(inv.created_at).toISOString(),
        person: personKey, share, invoicedCents: 0, collectedCents: 0, invoiceTotalCents: cents(inv.total), madeInRange, shared,
      }
      bySlice.set(k, s)
    }
    if (madeInRange) s.madeInRange = true
    return s
  }
  /** The people an amount is cut between, with their shares: the job's crew, or one bucket. */
  const partsOf = (jobId: string | null): { keys: string[]; shares: Record<string, number>; shared: boolean } => {
    if (!jobId) return { keys: [NO_JOB], shares: { [NO_JOB]: 1 }, shared: false }
    const j = jobs.get(jobId)
    if (!j || !j.people.length) return { keys: [NO_ONE], shares: { [NO_ONE]: 1 }, shared: false }
    return { keys: j.people, shares: j.shares, shared: j.people.length > 1 }
  }
  for (const inv of invoices) {
    const p = partsOf(inv.job_id)
    const cut = splitCents(cents(inv.total), p.keys, p.shares)
    for (const k of p.keys) slot(inv, k, p.shares[k], p.shared, true).invoicedCents += cut[k]
  }
  const madeIds = new Set(invoices.map((i) => i.id))
  for (const pay of payments) {
    const p = partsOf(pay.job_id)
    const cut = splitCents(cents(pay.amount), p.keys, p.shares)
    for (const k of p.keys) slot(pay, k, p.shares[k], p.shared, madeIds.has(pay.id)).collectedCents += cut[k]
  }

  const slices = [...bySlice.values()]
  const real = [...new Set(slices.map((s) => s.person).filter((k) => k.includes(':')))]
  const people = await namesFor(db, companyId, real.filter((k) => k.startsWith('u:')).map((k) => k.slice(2)), real.filter((k) => k.startsWith('m:')).map((k) => k.slice(2)))

  // Billable hours in the period (by the entry's own day): all billable time entries, approved or not; with a customer filter,
  // only time on that customer's jobs. Roster-only crew have no login, so no time.
  const hourRows = rowsOf(await db.execute(f.contactId
    ? sql`SELECT te.user_id, COALESCE(SUM(te.hours::numeric), 0) AS h FROM time_entry te JOIN job j ON j.id = te.job_id WHERE te.company_id = ${companyId} AND te.billable AND j.contact_id = ${f.contactId} ${between(sql.raw('te.date'), range)} GROUP BY te.user_id`
    : sql`SELECT te.user_id, COALESCE(SUM(te.hours::numeric), 0) AS h FROM time_entry te WHERE te.company_id = ${companyId} AND te.billable ${between(sql.raw('te.date'), range)} GROUP BY te.user_id`))
  const hours = new Map<string, number>()
  for (const h of hourRows) if (h.user_id) hours.set(`u:${h.user_id}`, num(h.h))
  const hourNames = await namesFor(db, companyId, [...hours.keys()].map((k) => k.slice(2)), [])
  for (const [k, p] of hourNames) if (!people.has(k)) people.set(k, p)
  return { slices, jobs, people, hours }
}

export interface PersonRevenue {
  key: string; person: Person | null; bucket: 'person' | 'unassigned' | 'no_job'
  invoiced: number; collected: number; invoiceCount: number; jobCount: number; sharedInvoiced: number; hours: number | null
}

/** The revenue slices added up per person (and the two buckets), with the billable hours; the rows add up to the totals. */
export function revenuePeople(data: RevenueData): { rows: PersonRevenue[]; totals: { invoiced: number; collected: number; invoiceCount: number; hours: number } } {
  const acc = new Map<string, { inv: number; col: number; invoices: Set<string>; jobs: Set<string>; shared: number }>()
  const slot = (k: string) => { let a = acc.get(k); if (!a) { a = { inv: 0, col: 0, invoices: new Set(), jobs: new Set(), shared: 0 }; acc.set(k, a) } return a }
  for (const s of data.slices) {
    const a = slot(s.person)
    a.inv += s.invoicedCents; a.col += s.collectedCents
    if (s.madeInRange) a.invoices.add(s.invoiceId)
    if (s.jobId) a.jobs.add(s.jobId)
    if (s.shared) a.shared += s.invoicedCents
  }
  for (const k of data.hours.keys()) slot(k)
  const rows: PersonRevenue[] = [...acc.entries()].map(([k, a]) => ({
    key: k, person: data.people.get(k) ?? null,
    bucket: k === NO_JOB ? 'no_job' as const : k === NO_ONE || !data.people.get(k) ? 'unassigned' as const : 'person' as const,
    invoiced: dollars(a.inv), collected: dollars(a.col), invoiceCount: a.invoices.size, jobCount: a.jobs.size, sharedInvoiced: dollars(a.shared),
    hours: k.startsWith('u:') ? r2(data.hours.get(k) ?? 0) : null,
  }))
  const order = { person: 0, unassigned: 1, no_job: 2 }
  rows.sort((a, b) => order[a.bucket] - order[b.bucket] || b.invoiced - a.invoiced || (a.person?.name ?? '').localeCompare(b.person?.name ?? ''))
  return { rows, totals: {
    invoiced: dollars(rows.reduce((n, r) => n + Math.round(r.invoiced * 100), 0)),
    collected: dollars(rows.reduce((n, r) => n + Math.round(r.collected * 100), 0)),
    invoiceCount: new Set(data.slices.filter((s) => s.madeInRange).map((s) => s.invoiceId)).size,
    hours: r2(rows.reduce((n, r) => n + (r.hours ?? 0), 0)),
  } }
}

// ---- Quotes -----------------------------------------------------------------------------------------------------------------

export const QUOTE_BASES = ['drafted', 'sent', 'approved', 'converted', 'completed'] as const
export type QuoteBasis = typeof QUOTE_BASES[number]
export const QUOTE_GROUPS = ['salesperson', 'writer', 'tech'] as const
export type QuoteGroup = typeof QUOTE_GROUPS[number]

const JOB_OF_QUOTE = sql`COALESCE(q.job_id, q.converted_to_job_id, (SELECT j.id FROM job j WHERE j.company_id = q.company_id AND j.quote_id = q.id ORDER BY j.created_at, j.id LIMIT 1))`
/** The date a quote is counted on. A quote without that date (never sent, never converted…) is not counted for it. */
const DATE_OF: Record<QuoteBasis, ReturnType<typeof sql>> = {
  drafted: sql`q.created_at`, sent: sql`q.sent_at`, approved: sql`q.approved_at`, converted: sql`q.converted_at`,
  completed: sql`(SELECT j2.completed_at FROM job j2 WHERE j2.id = ${JOB_OF_QUOTE})`,
}

export interface QuoteFilter { contactId?: string; person?: string; status?: 'approved' | 'declined' | 'open' }
export interface QuoteLine {
  id: string; number: string; name: string; status: string; total: number; contactId: string | null; customer: string
  person: string; jobId: string | null; jobNumber: string | null
  createdAt: string; sentAt: string | null; approvedAt: string | null; convertedAt: string | null; completedAt: string | null
}
const statusClass = (s: string) => (s === 'approved' ? 'approved' : ['rejected', 'declined', 'expired'].includes(s) ? 'declined' : 'open')

/** Every quote counted on the chosen date in the period, with the person it is grouped under. */
export async function quoteLines(db: any, companyId: string, range: Range, group: QuoteGroup, basis: QuoteBasis, f: QuoteFilter = {}): Promise<{ lines: QuoteLine[]; people: Map<string, Person> }> {
  const date = DATE_OF[basis]
  const who = group === 'tech'
    ? sql`j.assigned_to_id AS user_id, j.assigned_to_member_id AS member_id`
    : group === 'writer' ? sql`q.created_by_id AS user_id, NULL::text AS member_id` : sql`q.salesperson_id AS user_id, NULL::text AS member_id`
  const rows = rowsOf(await db.execute(sql`
    SELECT q.id, q.number, q.name, q.status, q.total, q.contact_id, q.created_at, q.sent_at, q.approved_at, q.converted_at,
           ${JOB_OF_QUOTE} AS job_id, j.number AS job_number, j.completed_at AS job_completed_at, ${who}, c.name AS contact_name, c.company AS contact_company
    FROM quote q
    LEFT JOIN job j ON j.id = ${JOB_OF_QUOTE}
    LEFT JOIN contact c ON c.id = q.contact_id
    WHERE q.company_id = ${companyId} ${f.contactId ? sql`AND q.contact_id = ${f.contactId}` : sql``}
      ${basis === 'drafted' ? sql`` : sql`AND ${date} IS NOT NULL`} ${between(date as any, range)}
    ORDER BY q.created_at DESC, q.number`))
  const keys = rows.map((r) => keyOf(r.user_id, r.member_id) ?? 'none')
  const real = [...new Set(keys.filter((k) => k !== 'none'))]
  const people = await namesFor(db, companyId, real.filter((k) => k.startsWith('u:')).map((k) => k.slice(2)), real.filter((k) => k.startsWith('m:')).map((k) => k.slice(2)))
  const iso = (v: unknown) => (v ? new Date(v as any).toISOString() : null)
  let lines: QuoteLine[] = rows.map((r, i) => ({
    id: r.id, number: r.number, name: r.name, status: r.status, total: num(r.total), contactId: r.contact_id ?? null, customer: r.contact_name || r.contact_company || 'Customer',
    person: people.has(keys[i]) ? keys[i] : 'none', jobId: r.job_id ?? null, jobNumber: r.job_number ?? null,
    createdAt: iso(r.created_at)!, sentAt: iso(r.sent_at), approvedAt: iso(r.approved_at), convertedAt: iso(r.converted_at), completedAt: iso(r.job_completed_at),
  }))
  if (f.person) lines = lines.filter((l) => l.person === f.person)
  if (f.status) lines = lines.filter((l) => statusClass(l.status) === f.status)
  return { lines, people }
}

export interface QuoteGroupRow { key: string; person: Person | null; bucket: 'person' | 'not_recorded'; quotes: number; approved: number; declined: number; open: number; approvedValue: number; sentValue: number; conversionRate: number; average: number }

/** Quote conversion per person (approved ÷ decided, the Reports page's definition), for the chosen grouping and date. */
export function quoteGroups(lines: QuoteLine[], people: Map<string, Person>): QuoteGroupRow[] {
  const acc = new Map<string, { n: number; approved: number; declined: number; open: number; approvedValue: number; sentValue: number }>()
  for (const l of lines) {
    const a = acc.get(l.person) ?? { n: 0, approved: 0, declined: 0, open: 0, approvedValue: 0, sentValue: 0 }
    a.n += 1
    const c = statusClass(l.status)
    if (c === 'approved') { a.approved += 1; a.approvedValue += l.total } else if (c === 'declined') a.declined += 1; else a.open += 1
    if (l.status !== 'draft') a.sentValue += l.total
    acc.set(l.person, a)
  }
  const rows: QuoteGroupRow[] = [...acc.entries()].map(([k, a]) => {
    const decided = a.approved + a.declined
    return { key: k, person: people.get(k) ?? null, bucket: people.get(k) ? 'person' as const : 'not_recorded' as const, quotes: a.n, approved: a.approved, declined: a.declined, open: a.open,
      approvedValue: r2(a.approvedValue), sentValue: r2(a.sentValue), conversionRate: decided > 0 ? Math.round((a.approved / decided) * 100) : 0, average: a.approved ? r2(a.approvedValue / a.approved) : 0 }
  })
  rows.sort((a, b) => (a.bucket === 'person' ? 0 : 1) - (b.bucket === 'person' ? 0 : 1) || b.approvedValue - a.approvedValue || (a.person?.name ?? '').localeCompare(b.person?.name ?? ''))
  return rows
}

/** What the filters can be set to: the people who appear on jobs or quotes, and the customers with a quote or an invoice. */
export async function teamFilterOptions(db: any, companyId: string) {
  const users = rowsOf(await db.execute(sql`
    SELECT DISTINCT u.id, u.first_name, u.last_name FROM "user" u WHERE u.company_id = ${companyId} AND u.is_active ORDER BY u.first_name, u.last_name`))
  const members = rowsOf(await db.execute(sql`SELECT id, name FROM team_member WHERE company_id = ${companyId} ORDER BY name`))
  const customers = rowsOf(await db.execute(sql`
    SELECT DISTINCT c.id, c.name, c.company FROM contact c
    WHERE c.company_id = ${companyId} AND (EXISTS (SELECT 1 FROM invoice i WHERE i.contact_id = c.id) OR EXISTS (SELECT 1 FROM quote q WHERE q.contact_id = c.id))
    ORDER BY c.name LIMIT 500`))
  return {
    people: [
      ...users.map((u) => ({ key: `u:${u.id}`, name: `${u.first_name || ''} ${u.last_name || ''}`.trim() || 'Unnamed' })),
      ...members.map((m) => ({ key: `m:${m.id}`, name: m.name || 'Unnamed' })),
    ],
    customers: customers.map((x) => ({ id: x.id as string, name: (x.name || x.company || 'Customer') as string })),
  }
}
export { dollars }


// ---- The two reports the first build shipped, kept in their shape (now on the shared engine) -------------------------------

export interface RevenueRow { person: Person | null; bucket: 'person' | 'unassigned' | 'no_job'; invoiced: number; invoiceCount: number; collected: number }
export interface RevenueByTech { rows: RevenueRow[]; totals: { invoiced: number; invoiceCount: number; collected: number } }

/** Revenue per person for a period, jobs with several people shared between them (see revenueSlices). */
export async function revenueByTech(db: any, companyId: string, range: Range): Promise<RevenueByTech> {
  const { rows, totals } = revenuePeople(await revenueSlices(db, companyId, range))
  const kept = rows.filter((r) => r.invoiced !== 0 || r.collected !== 0 || r.invoiceCount > 0)
  return { rows: kept.map((r) => ({ person: r.person, bucket: r.bucket, invoiced: r.invoiced, invoiceCount: r.invoiceCount, collected: r.collected })), totals: { invoiced: totals.invoiced, invoiceCount: totals.invoiceCount, collected: totals.collected } }
}

export interface ConversionRow { person: Person | null; bucket: 'person' | 'not_recorded'; sent: number; approved: number; declined: number; open: number; approvedValue: number; sentValue: number; conversionRate: number }

/** Quote conversion per person, by the day the quote was made; `by` is who wrote it, who is its salesperson, or who is on its job. */
export async function quoteConversion(db: any, companyId: string, range: Range, by: QuoteGroup, basis: QuoteBasis = 'drafted', f: QuoteFilter = {}): Promise<ConversionRow[]> {
  const { lines, people } = await quoteLines(db, companyId, range, by, basis, f)
  return quoteGroups(lines, people).map((g) => ({ person: g.person, bucket: g.bucket, sent: g.quotes, approved: g.approved, declined: g.declined, open: g.open, approvedValue: g.approvedValue, sentValue: g.sentValue, conversionRate: g.conversionRate }))
}

/** Customer names by id. */
export async function contactNamesFor(db: any, companyId: string, ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const want = [...new Set(ids.filter(Boolean))]
  if (!want.length) return out
  for (const c of rowsOf(await db.execute(sql`SELECT id, name, company FROM contact WHERE company_id = ${companyId} AND id IN (${sql.join(want.map((i) => sql`${i}`), sql`, `)})`))) out.set(c.id, c.name || c.company || 'Customer')
  return out
}
