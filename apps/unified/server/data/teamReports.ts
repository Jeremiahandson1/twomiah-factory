// Shared pieces of the people reports (RULEBOOK §2: raw SQL lives here), and the first three plan reports:
//   - revenue per person and quote conversion are data/teamRevenue.ts (crews sharing a job, salesperson, date basis)
//   - service-plan reports    — plans sold per person, renewals coming due, plans that ended (the rest: data/planReports.ts)
//
// The money rules are the Reports page's (packages/tenant-backend reporting/reporting.ts), so a figure here can be set
// beside the Reports page's and agree: "invoiced" is every invoice that is not a draft or void, in the period it was
// made (a refunded sale was still invoiced); "collected" is the payment ledger by the day the payment was taken, where a
// refund is a negative row, so it is already net of refunds.
//
// Nothing is guessed. An invoice that reaches no job, or a job nobody is on, or a quote or plan made before the app
// recorded who wrote it, is its own row — so every report adds up to the business's own total and says what it could
// not place. (Accounts receivable aging is not here: that is the invoices report.)
import { sql } from 'drizzle-orm'

export const rowsOf = (r: any): any[] => ((r as any)?.rows || r) as any[]
export const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0 }
export const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

export interface Range { gte?: Date; lte?: Date }

/** A bound as a timestamp-without-zone literal in UTC, which is how every timestamp column here is stored. */
export const at = (d: Date) => sql`${d.toISOString()}::timestamp`
export const between = (col: ReturnType<typeof sql.raw>, range: Range) => sql`${range.gte ? sql`AND ${col} >= ${at(range.gte)}` : sql``} ${range.lte ? sql`AND ${col} <= ${at(range.lte)}` : sql``}`

export interface Person { id: string; name: string; kind: 'user' | 'member' }
export interface PersonRow { person: Person | null; bucket: 'none' | 'unplaced'; [k: string]: unknown }

/** Names for users (login) and roster-only crew (team_member), by id. */
export async function namesFor(db: any, companyId: string, userIds: string[], memberIds: string[]): Promise<Map<string, Person>> {
  const out = new Map<string, Person>()
  if (userIds.length) {
    const rows = rowsOf(await db.execute(sql`SELECT id, first_name, last_name FROM "user" WHERE company_id = ${companyId} AND id IN (${sql.join(userIds.map((i) => sql`${i}`), sql`, `)})`))
    for (const u of rows) out.set(`u:${u.id}`, { id: u.id, name: `${u.first_name || ''} ${u.last_name || ''}`.trim() || 'Unnamed', kind: 'user' })
  }
  if (memberIds.length) {
    const rows = rowsOf(await db.execute(sql`SELECT id, name FROM team_member WHERE company_id = ${companyId} AND id IN (${sql.join(memberIds.map((i) => sql`${i}`), sql`, `)})`))
    for (const m of rows) out.set(`m:${m.id}`, { id: m.id, name: m.name || 'Unnamed', kind: 'member' })
  }
  return out
}

/**
 * An invoice's job: the job named on it; else the job its quote became — the quote it was billed from (a deposit,
 * progress or final bill) or its own. ONE job per invoice, the earliest, so an invoice is never counted twice.
 */
export const INVOICE_JOB = sql`COALESCE(i.job_id, (SELECT j.id FROM job j WHERE j.company_id = i.company_id AND j.quote_id = COALESCE(i.billed_quote_id, i.quote_id) ORDER BY j.created_at, j.id LIMIT 1))`

// ----------------------------------------------------------------------------------------------------------------
// Service plans

const MONTHS_PER_BILL: Record<string, number> = { monthly: 1, quarterly: 3, 'semi-annual': 6, annual: 12 }
/** What a plan brings in over a year: its price per bill, times the bills in a year. */
export const yearlyValue = (amount: unknown, frequency: string) => r2(num(amount) * 12 / (MONTHS_PER_BILL[frequency] ?? 1))

export interface PlanFilter { name?: string; sellerId?: string; contactId?: string; status?: string }

/** The plan filters as SQL on a plan alias. A seller of 'none' is the plans made before the seller was recorded. */
export const planWhere = (f: PlanFilter, a = 'a') => {
  const al = sql.raw(a)
  return sql`${f.name ? sql`AND ${al}.name = ${f.name}` : sql``}
    ${f.sellerId ? (f.sellerId === 'none' ? sql`AND ${al}.sold_by_id IS NULL` : sql`AND ${al}.sold_by_id = ${f.sellerId}`) : sql``}
    ${f.contactId ? sql`AND ${al}.contact_id = ${f.contactId}` : sql``}
    ${f.status ? sql`AND ${al}.status = ${f.status}` : sql``}`
}

export interface PlanSoldRow { person: Person | null; bucket: 'person' | 'not_recorded'; sold: number; yearlyValue: number; stillActive: number }

/** Plans sold in the period (by the day the plan was made), per person who sold it; plans made before 0041 are `not_recorded`. */
export async function planSales(db: any, companyId: string, range: Range, f: PlanFilter = {}): Promise<PlanSoldRow[]> {
  const rows = rowsOf(await db.execute(sql`
    SELECT a.sold_by_id AS user_id, a.status, a.amount, a.billing_frequency FROM service_agreement a
    WHERE a.company_id = ${companyId} ${between(sql.raw('a.created_at'), range)} ${planWhere(f)}`))
  const acc = new Map<string, { sold: number; yearly: number; active: number }>()
  for (const r of rows) {
    const k = r.user_id ? `u:${r.user_id}` : 'none'
    const a = acc.get(k) ?? { sold: 0, yearly: 0, active: 0 }
    a.sold += 1; a.yearly += yearlyValue(r.amount, r.billing_frequency); if (r.status === 'active') a.active += 1
    acc.set(k, a)
  }
  const people = await namesFor(db, companyId, [...acc.keys()].filter((k) => k.startsWith('u:')).map((k) => k.slice(2)), [])
  const out: PlanSoldRow[] = [...acc.entries()].map(([k, a]) => {
    const person = people.get(k) ?? null
    return { person, bucket: person ? 'person' as const : 'not_recorded' as const, sold: a.sold, yearlyValue: r2(a.yearly), stillActive: a.active }
  })
  out.sort((a, b) => (a.bucket === 'person' ? 0 : 1) - (b.bucket === 'person' ? 0 : 1) || b.yearlyValue - a.yearlyValue)
  return out
}

export interface RenewalRow { id: string; number: string; name: string; contactId: string; customer: string; endDate: string; daysLeft: number; renewal: 'auto' | 'manual'; autopay: boolean; yearlyValue: number }

/**
 * Plans whose term ends within `days` days of `today` (a day marker, midnight UTC, on the company's calendar) — the
 * ones still active. `auto` renews itself; `manual` lapses unless someone renews it, which is the list to call.
 */
export async function renewalsDue(db: any, companyId: string, today: Date, days: number, f: PlanFilter = {}): Promise<RenewalRow[]> {
  const until = new Date(today.getTime() + (days + 1) * 86_400_000 - 1)
  const rows = rowsOf(await db.execute(sql`
    SELECT a.id, a.number, a.name, a.contact_id, a.end_date, a.renewal_type, a.autopay, a.amount, a.billing_frequency,
           c.name AS contact_name, c.company AS contact_company
    FROM service_agreement a LEFT JOIN contact c ON c.id = a.contact_id
    WHERE a.company_id = ${companyId} AND a.status = 'active' AND a.end_date IS NOT NULL
      AND a.end_date >= ${at(today)} AND a.end_date <= ${at(until)} ${planWhere(f)}
    ORDER BY a.end_date, a.number`))
  return rows.map((r) => ({
    id: r.id, number: r.number, name: r.name, contactId: r.contact_id,
    customer: r.contact_name || r.contact_company || 'Customer',
    endDate: new Date(r.end_date).toISOString().slice(0, 10),
    daysLeft: Math.max(0, Math.round((new Date(r.end_date).getTime() - today.getTime()) / 86_400_000)),
    renewal: r.renewal_type === 'manual' ? 'manual' as const : 'auto' as const,
    autopay: !!r.autopay, yearlyValue: yearlyValue(r.amount, r.billing_frequency),
  }))
}

export interface ChurnRow { id: string; number: string; name: string; customer: string; how: 'cancelled' | 'expired'; endedOn: string; dateKnown: boolean; reason: string | null; soldBy: Person | null; yearlyValue: number }

/**
 * Plans that ended in the period: cancelled by someone, or run out their term without a renewal. The day is `ended_at`
 * where the app recorded it; a plan that ended before 0041 is dated by its last change and flagged `dateKnown: false`.
 */
export async function churnedPlans(db: any, companyId: string, range: Range, f: PlanFilter = {}): Promise<ChurnRow[]> {
  const when = sql`COALESCE(a.ended_at, a.updated_at)`
  const rows = rowsOf(await db.execute(sql`
    SELECT a.id, a.number, a.name, a.status, a.ended_how, a.ended_at, a.updated_at, a.cancel_reason, a.sold_by_id, a.amount, a.billing_frequency,
           c.name AS contact_name, c.company AS contact_company
    FROM service_agreement a LEFT JOIN contact c ON c.id = a.contact_id
    WHERE a.company_id = ${companyId} AND a.status IN ('cancelled', 'expired') ${between(when as any, range)} ${planWhere(f)}
    ORDER BY ${when} DESC, a.number`))
  const people = await namesFor(db, companyId, [...new Set(rows.map((r) => r.sold_by_id).filter(Boolean))] as string[], [])
  return rows.map((r) => ({
    id: r.id, number: r.number, name: r.name,
    customer: r.contact_name || r.contact_company || 'Customer',
    how: (r.ended_how === 'expired' || (!r.ended_how && r.status === 'expired')) ? 'expired' as const : 'cancelled' as const,
    endedOn: new Date(r.ended_at ?? r.updated_at).toISOString().slice(0, 10),
    dateKnown: !!r.ended_at, reason: r.cancel_reason || null,
    soldBy: r.sold_by_id ? people.get(`u:${r.sold_by_id}`) ?? null : null,
    yearlyValue: yearlyValue(r.amount, r.billing_frequency),
  }))
}
