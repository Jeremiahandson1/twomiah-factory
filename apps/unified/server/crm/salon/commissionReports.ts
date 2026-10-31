// Commission reports and the payroll file (salon parity row 16; Boulevard "Commission summary" and "Commission line items", Square and Fresha
// payroll exports). Built on the commission rows the salon already earns (./commissions.ts), so nothing here changes what anyone is owed.
//   summary  one line per stylist for a period: how many commissions, the sales they were on, and the money by status (waiting, approved,
//            paid, disputed) and in all; cancelled and voided commissions are shown apart and never added in
//   lines    every commission in the period, one row each: date, bill, client, stylist, plan, kind, sales, rate, amount, status
//   payroll  a CSV of what each stylist is owed, in the shape Gusto's CSV upload or ADP's pay-data import reads
// A period is the salon's own days, by the day the commission was earned. The payroll file takes only APPROVED, unpaid commissions unless asked
// otherwise, so a file taken twice for the same period cannot pay a commission that was already marked paid in between.
import { and, asc, eq, gte, inArray, lt } from 'drizzle-orm'
import { commission, commissionPlan, contact, invoice, user, company } from '../../db/schema/index.ts'
import type { CrmDeps } from '../deps.ts'
import { calendarDateIn, createSalonClock, salonDayStart, shiftDays } from './days.ts'

export const PAYROLL_FORMATS = ['gusto', 'adp'] as const
export type PayrollFormat = (typeof PAYROLL_FORMATS)[number]
export const FILE_NUMBERS_KEY = 'payrollFileNumbers'
export const COUNTED = ['pending', 'approved', 'paid', 'disputed'] as const
const MAX_DAYS = 731
export const LINE_CAP = 20000
const money = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
const realDay = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(`${s}T00:00:00Z`).getTime()) && shiftDays(s, 0) === s

export class CommissionReportError extends Error { constructor(message: string, public field: string, public status: 400 | 409 = 400) { super(message) } }

/** A text cell: quoted, and a leading = + - @ made harmless so a name can never run as a spreadsheet formula (as the Gusto hours file does). */
const text = (v: unknown) => { const s = String(v ?? ''); return `"${(/^[=+\-@\t\r]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"` }
const amount = (n: number) => n.toFixed(2)

export interface CommissionLine {
  id: string; date: string; bill: string | null; client: string | null; stylistId: string; stylist: string; plan: string | null
  kind: string; sales: number; rate: number | null; amount: number; status: string; note: string | null
}

export function createCommissionReports(d: CrmDeps) {
  const { db } = d
  const clock = createSalonClock(db)

  async function windowOf(companyId: string, q: { from?: string; to?: string }) {
    const tz = await clock.salonTimezone(companyId)
    const today = calendarDateIn(new Date(), tz)
    const to = q.to || today
    const from = q.from || shiftDays(to, -29)
    if (!realDay(to)) throw new CommissionReportError('Choose a real end date.', 'to')
    if (!realDay(from)) throw new CommissionReportError('Choose a real start date.', 'from')
    if (from > to) throw new CommissionReportError('The start date is after the end date.', 'from')
    if (Math.round((salonDayStart(shiftDays(to, 1), tz).getTime() - salonDayStart(from, tz).getTime()) / 86400_000) > MAX_DAYS) throw new CommissionReportError('Choose two years or less.', 'from')
    return { tz, from, to, start: salonDayStart(from, tz), end: salonDayStart(shiftDays(to, 1), tz) }
  }

  async function linesOf(companyId: string, w: { start: Date; end: Date; tz: string }, opts: { userId?: string; statuses?: readonly string[] } = {}): Promise<{ lines: CommissionLine[]; truncated: boolean }> {
    const where = [eq(commission.companyId, companyId), gte(commission.earnedAt, w.start), lt(commission.earnedAt, w.end)]
    if (opts.userId) where.push(eq(commission.userId, opts.userId))
    if (opts.statuses) where.push(inArray(commission.status, [...opts.statuses]))
    const rows = await db.select({
      c: commission, plan: commissionPlan.name, firstName: user.firstName, lastName: user.lastName, email: user.email, bill: invoice.number, client: contact.name,
    }).from(commission)
      .leftJoin(commissionPlan, eq(commission.planId, commissionPlan.id))
      .leftJoin(user, eq(commission.userId, user.id))
      .leftJoin(invoice, eq(commission.invoiceId, invoice.id))
      .leftJoin(contact, eq(invoice.contactId, contact.id))
      .where(and(...where)).orderBy(asc(commission.earnedAt), asc(commission.id)).limit(LINE_CAP + 1)
    const truncated = rows.length > LINE_CAP
    const lines = (truncated ? rows.slice(0, LINE_CAP) : rows).map((r: any): CommissionLine => ({
      id: r.c.id, date: calendarDateIn(new Date(r.c.earnedAt), w.tz), bill: r.bill ?? null, client: r.client ?? null, stylistId: r.c.userId,
      stylist: [r.firstName, r.lastName].filter(Boolean).join(' ').trim() || r.email || 'Former team member', plan: r.plan ?? null,
      kind: r.c.source === 'reversal' ? 'Taken back' : r.c.source === 'manual' ? 'Entered by hand' : 'Earned on a paid bill',
      sales: money(Number(r.c.baseAmount || 0)), rate: r.c.rateApplied == null ? null : Number(r.c.rateApplied), amount: money(Number(r.c.commissionAmount || 0)), status: r.c.status, note: r.c.notes ?? null,
    }))
    return { lines, truncated }
  }

  async function summary(companyId: string, q: { from?: string; to?: string }) {
    const w = await windowOf(companyId, q)
    const { lines, truncated } = await linesOf(companyId, w)
    const by = new Map<string, { id: string; name: string; lines: number; sales: number; pending: number; approved: number; paid: number; disputed: number; total: number; setAside: number }>()
    for (const l of lines) {
      const e = by.get(l.stylistId) || { id: l.stylistId, name: l.stylist, lines: 0, sales: 0, pending: 0, approved: 0, paid: 0, disputed: 0, total: 0, setAside: 0 }
      if ((COUNTED as readonly string[]).includes(l.status)) {
        e.lines++; e.sales = money(e.sales + l.sales); e.total = money(e.total + l.amount)
        ;(e as any)[l.status] = money((e as any)[l.status] + l.amount)
      } else e.setAside = money(e.setAside + l.amount)
      by.set(l.stylistId, e)
    }
    const stylists = [...by.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name))
    const totals = stylists.reduce((t, s) => ({ lines: t.lines + s.lines, sales: money(t.sales + s.sales), pending: money(t.pending + s.pending), approved: money(t.approved + s.approved), paid: money(t.paid + s.paid), disputed: money(t.disputed + s.disputed), total: money(t.total + s.total) }), { lines: 0, sales: 0, pending: 0, approved: 0, paid: 0, disputed: 0, total: 0 })
    return { range: { from: w.from, to: w.to }, truncated, stylists, totals }
  }

  async function lineItems(companyId: string, q: { from?: string; to?: string; userId?: string }) {
    const w = await windowOf(companyId, q)
    const { lines, truncated } = await linesOf(companyId, w, { userId: q.userId })
    return { range: { from: w.from, to: w.to }, truncated, lines }
  }

  /** The file numbers the salon keeps per stylist for ADP ("File #"), by login id. */
  async function fileNumbers(companyId: string): Promise<Record<string, string>> {
    const [co] = await db.select({ settings: company.settings }).from(company).where(eq(company.id, companyId)).limit(1)
    const saved = (co?.settings as any)?.[FILE_NUMBERS_KEY]
    return saved && typeof saved === 'object' ? saved : {}
  }
  async function saveFileNumbers(companyId: string, raw: unknown): Promise<{ saved: Record<string, string> } | { problem: string }> {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { problem: 'Send the file numbers as { loginId: number }.' }
    const ids = Object.keys(raw as object)
    const people = ids.length ? await db.select({ id: user.id }).from(user).where(and(eq(user.companyId, companyId), inArray(user.id, ids))) : []
    const known = new Set(people.map((p: any) => p.id))
    const out: Record<string, string> = {}
    for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
      if (!known.has(id)) return { problem: 'One of those people is not on your team.' }
      const s = String(v ?? '').trim()
      if (s.length > 20 || /[",\r\n]/.test(s)) return { problem: 'A file number is up to 20 characters, with no commas or quotes.' }
      if (s) out[id] = s
    }
    const [co] = await db.select({ settings: company.settings }).from(company).where(eq(company.id, companyId)).limit(1)
    await db.update(company).set({ settings: { ...((co?.settings as any) || {}), [FILE_NUMBERS_KEY]: out }, updatedAt: new Date() } as any).where(eq(company.id, companyId))
    return { saved: out }
  }

  /**
   * What each stylist is owed for the period, as a CSV. Gusto: First Name, Last Name, Email, Commission (its upload matches columns by name).
   * ADP: Co Code, Batch Id, File #, Batch Description, Earning 3 Code, Earning 3 Amount (the pay-data import layout). Only approved commissions
   * unless `statuses` asks for others; people owed nothing (or a net of nothing) are left out, and people ADP could not match (no File #) are named.
   */
  async function payroll(companyId: string, q: { from?: string; to?: string; format?: string; statuses?: string; coCode?: string; earningCode?: string }) {
    const format = (q.format || 'gusto') as PayrollFormat
    if (!(PAYROLL_FORMATS as readonly string[]).includes(format)) throw new CommissionReportError('Choose Gusto or ADP.', 'format')
    const w = await windowOf(companyId, q)
    const asked = q.statuses ? q.statuses.split(',').map((s) => s.trim()).filter(Boolean) : ['approved']
    if (!asked.length || asked.some((s) => !(COUNTED as readonly string[]).includes(s))) throw new CommissionReportError('Choose from waiting (pending), approved, disputed or paid.', 'statuses')
    const { lines, truncated } = await linesOf(companyId, w, { statuses: asked })
    if (truncated) throw new CommissionReportError('This period has more commissions than a file can hold. Choose a shorter period.', 'from', 409)
    const by = new Map<string, { id: string; name: string; total: number }>()
    for (const l of lines) { const e = by.get(l.stylistId) || { id: l.stylistId, name: l.stylist, total: 0 }; e.total = money(e.total + l.amount); by.set(l.stylistId, e) }
    const owed = [...by.values()].filter((e) => e.total !== 0).sort((a, b) => a.name.localeCompare(b.name))
    const people = owed.length ? await db.select({ id: user.id, firstName: user.firstName, lastName: user.lastName, email: user.email }).from(user).where(and(eq(user.companyId, companyId), inArray(user.id, owed.map((e) => e.id)))) : []
    const person = new Map<string, any>(people.map((p: any) => [p.id, p]))
    const warnings: string[] = []
    let csv: string, filename: string
    if (format === 'gusto') {
      csv = [['First Name', 'Last Name', 'Email', 'Commission'].join(','), ...owed.map((e) => { const p = person.get(e.id); return [text(p?.firstName), text(p?.lastName), text(p?.email), amount(e.total)].join(',') })].join('\n')
      filename = `gusto-commission-${w.from}-to-${w.to}.csv`
    } else {
      const numbers = await fileNumbers(companyId)
      const code = (q.earningCode || 'COMM').trim()
      const co = (q.coCode || '').trim()
      if (!co) throw new CommissionReportError('Enter your ADP company code (Co Code).', 'coCode')
      if (!/^[A-Za-z0-9 _-]{1,20}$/.test(code)) throw new CommissionReportError('The earnings code is letters and numbers, up to 20.', 'earningCode')
      if (!/^[A-Za-z0-9 _-]{1,20}$/.test(co)) throw new CommissionReportError('The company code is letters and numbers, up to 20.', 'coCode')
      const batch = `${w.to.slice(5, 7)}${w.to.slice(8, 10)}${w.to.slice(2, 4)}COMM`     // pay period end MMDDYY, as ADP's batch ids are made
      const rows = owed.filter((e) => { if (numbers[e.id]) return true; warnings.push(`${e.name} has no ADP File # yet, so is not in the file.`); return false })
      csv = [['Co Code', 'Batch Id', 'File #', 'Batch Description', 'Earning 3 Code', 'Earning 3 Amount'].join(','), ...rows.map((e) => [text(co), text(batch), text(numbers[e.id]), text(`Commission ${w.from} to ${w.to}`), text(code), amount(e.total)].join(','))].join('\n')
      filename = `adp-commission-${w.from}-to-${w.to}.csv`
    }
    return { csv, filename, people: owed.length, total: money(owed.reduce((t, e) => t + e.total, 0)), warnings, range: { from: w.from, to: w.to } }
  }

  return { summary, lineItems, payroll, fileNumbers, saveFileNumbers }
}
export type CommissionReports = ReturnType<typeof createCommissionReports>
