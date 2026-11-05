// Per-client margin and caregiver turnover (item 10, care_margin_reports, not ready; finished in row 11 of the parity brief).
//
// MARGIN = what the client is billed for the hours worked − what the caregivers were paid for them.
//   · Hours: the payable minutes of the same payroll shift reviews payroll pays (core/payrollPay.ts), so the report agrees
//     with the pay run: a shift that is pending, flagged or excused is on neither.
//   · Billed: those hours × the client's billing rate (core.invoices.resolveClientRate — the same rule an invoice uses). A
//     client with no rate set is listed with no margin, not with a made-up one. "Hours invoiced" beside it is what the
//     invoices actually carry for the window (invoice_line_items), so the owner sees what was worked against what was billed.
//   · Pay: the caregiver's regular and overtime rates (payrollPay's), with the overtime of each work week put on the
//     shifts that crossed the 40-hour line, in the order they were worked — so a client whose shifts fell past 40 hours
//     bears the overtime cost. Plus mileage paid on trips recorded against the client. Paid travel TIME between visits is
//     in the report for an agency with care_payroll_rules (the same figure payroll pays); without it, it is not.
//   · Money: the ledger is kept in integer cents; the per-client rows also carry the dollar fields the first screen read.
//
// Every figure comes from ONE ledger of shifts (shiftLedger), so the per-client table, the per-visit list, the trend, the
// drill-down (total → branch → team → client), the groupings by referral source / payer / department (care type) / branch,
// and the two-period comparison all add up to the same total under the same filters (client, caregiver, branch, referral
// source, payer).
//
// TURNOVER: hires, departures and headcount over a window, from the caregiver list. A caregiver who left is dated by the
// leaving date the office stored (caregiver_profiles.left_on, row 11); without one, by the last visit they worked.
// With it: applicant-to-hire, hire-to-first-shift, call-outs and missed visits per caregiver, cost per hire, payroll accuracy.
import {
  payableReviewsWithClient, payableMinutesWithoutClient, mileagePaidByClient, marginClients, caregiverTenure, caregiverGroups,
  invoicedHoursByClient, applicantCounts, hiringSpendCents, caregiverReliability, payrollAccuracy,
} from '../../../data/homecareMargin.ts'
import { caregiverPayRates } from '../../../data/homecarePayroll.ts'
import { payableVisits } from '../../../data/homecarePayRules.ts'
import { companyWorkWeek, workweekStartOn } from '../../payrollExport/workWeek.ts'
import type { CrmDeps } from '../../deps.ts'
import { addDays } from './agencyTime.ts'
import { OVERTIME_RULES, buildSegments, classifyWeek, createPayRules } from './payRules.ts'
import { PAYABLE_REVIEW_STATUSES, OT_WEEKLY_HOURS, OT_MULTIPLIER, FALLBACK_PAY_RATE } from './payrollPay.ts'
import type { InvoiceEngine } from './invoiceEngine.ts'

export const MARGIN_FEATURE = 'care_margin_reports'

export interface ShiftPay {
  id: string; clientId: string; caregiverId: string; minutes: number; regularMinutes: number; overtimeMinutes: number
  /** care_payroll_rules: minutes at double time, and whether this is the paid travel TO the client rather than a visit (travel is paid, never billed). */
  doubleTimeMinutes?: number; travel?: boolean
  date?: string
}

/**
 * Put each work week's overtime on the shifts that crossed the line. `shifts` are one caregiver's, in the order worked.
 * A shift that straddles the line is split: the minutes up to the cap are regular, the rest overtime.
 */
export function allocateOvertime(shifts: { id: string; clientId: string; caregiverId: string; date: string; minutes: number }[], startDay: number, thresholdHours = OT_WEEKLY_HOURS): ShiftPay[] {
  const cap = Math.round(thresholdHours * 60)
  const used = new Map<string, number>()
  return shifts.map((s) => {
    const week = `${s.caregiverId}|${workweekStartOn(s.date, startDay)}`
    const before = used.get(week) ?? 0
    const minutes = Math.max(0, Math.round(s.minutes))
    const regular = Math.max(0, Math.min(minutes, cap - before))
    used.set(week, before + minutes)
    return { id: s.id, clientId: s.clientId, caregiverId: s.caregiverId, minutes, regularMinutes: regular, overtimeMinutes: minutes - regular, date: s.date }
  })
}

/** The filters every margin figure honours (row 11). An unset one means "everyone". */
export interface MarginFilters { clientId?: string | null; caregiverId?: string | null; branchId?: string | null; referralSourceId?: string | null; payerId?: string | null }

export interface ClientMarginRow {
  clientId: string; clientName: string; hours: number; overtimeHours: number
  rate: number | null; rateType: string | null; billed: number | null
  pay: number; overtimePay: number; mileage: number; cost: number
  /** care_payroll_rules: pay for travel to this client's visits and for double time (both already inside `pay`). */
  travelPay: number; doubleTimePay: number
  margin: number | null; marginPercent: number | null
  /** Row 11: the same money in integer cents, the hours the invoices carry, and where the client sits. */
  billedCents: number | null; costCents: number; marginCents: number | null; hoursInvoiced: number
  branchId: string | null; branchName: string | null; department: string | null; referralSourceId: string | null; referralSourceName: string | null
  payerId: string | null; payerName: string | null
}

/** One shift of the ledger: a visit (or paid travel to it) with its cost and what it bills, in cents. */
export interface LedgerShift {
  id: string; date: string; clientId: string; caregiverId: string; minutes: number; overtimeMinutes: number; travel: boolean
  regularPayCents: number; overtimePayCents: number; doubleTimePayCents: number; payCents: number
  billedCents: number | null
}

const hours2 = (minutes: number) => Math.round((minutes / 60) * 100) / 100
const dollars = (cents: number) => Math.round(cents) / 100
/** A sum of cents, rounded to whole cents once at the end (each shift's pay is fractional cents until then). */
const sumCents = <T,>(rows: T[], f: (r: T) => number) => Math.round(rows.reduce((t, r) => t + f(r), 0))
const pct1 = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null)

/** The week (Sunday) or month a date falls in, for the trend. */
export function bucketOf(ymd: string, by: 'week' | 'month'): string {
  if (by === 'month') return ymd.slice(0, 7)
  const dow = new Date(`${ymd}T12:00:00Z`).getUTCDay()
  return addDays(ymd, -dow)
}

export function createMargin(d: CrmDeps, deps: { invoices: InvoiceEngine }) {
  const enabled = (companyId: string) => d.features.isFeatureEnabled(companyId, MARGIN_FEATURE)
  const payRules = createPayRules(d)

  /** An agency with care_payroll_rules: the same segments payroll classifies, so the report's cost adds up to the pay run's. */
  async function shiftsUnderRules(companyId: string, rules: NonNullable<Awaited<ReturnType<typeof payRules.forCompany>>>, start: string, end: string, startDay: number) {
    const rule = OVERTIME_RULES[rules.overtimeRule]
    const visits = await payableVisits(d.db, companyId, workweekStartOn(start, startDay), addDays(workweekStartOn(end, startDay), 6), PAYABLE_REVIEW_STATUSES, null)
    const shifts: ShiftPay[] = []
    let noClientMinutes = 0
    for (const caregiverId of [...new Set(visits.map((v) => v.caregiverId))]) {
      const byWeek = new Map<string, typeof visits>()
      for (const v of visits.filter((x) => x.caregiverId === caregiverId)) { const w = workweekStartOn(v.shiftDate, startDay); byWeek.set(w, [...(byWeek.get(w) ?? []), v]) }
      for (const wk of byWeek.values()) {
        for (const seg of classifyWeek(buildSegments(wk, rules.travel), rule)) {
          if (seg.date < start || seg.date > end) continue
          if (!seg.clientId) { noClientMinutes += seg.minutes; continue }
          shifts.push({ id: seg.id, clientId: seg.clientId, caregiverId, minutes: seg.minutes, regularMinutes: seg.regular, overtimeMinutes: seg.overtime, doubleTimeMinutes: seg.doubleTime, travel: seg.kind === 'travel', date: seg.date })
        }
      }
    }
    return { shifts, noClientMinutes }
  }

  /**
   * The ledger of the window: every payable shift with its pay and what it bills, the clients and caregivers it names, the
   * mileage per client — filtered. A client filter keeps only that client's shifts; a caregiver filter only theirs; branch,
   * referral source and payer are the CLIENT's (the people the agency serves from there, referred from there, paid by them).
   */
  async function shiftLedger(companyId: string, start: string, end: string, filters: MarginFilters = {}) {
    const { startDay } = await companyWorkWeek(d.db, companyId)
    const rules = await payRules.forCompany(companyId)
    let shifts: ShiftPay[] = []
    let noClientMinutes = 0
    if (rules) {
      ;({ shifts, noClientMinutes } = await shiftsUnderRules(companyId, rules, start, end, startDay))
    } else {
      const reviews = await payableReviewsWithClient(d.db, companyId, start, end, PAYABLE_REVIEW_STATUSES)
      noClientMinutes = await payableMinutesWithoutClient(d.db, companyId, start, end, PAYABLE_REVIEW_STATUSES)
      for (const caregiverId of [...new Set(reviews.map((r) => String(r.caregiverId)))]) {
        const mine = reviews.filter((r) => String(r.caregiverId) === caregiverId && r.clientId)
        shifts.push(...allocateOvertime(mine.map((r) => ({ id: String(r.id), clientId: String(r.clientId), caregiverId, date: String(r.shiftDate), minutes: Number(r.payableMinutes) })), startDay))
      }
    }
    // The caregiver filter cuts the ledger before anything is summed, so a client's margin under it is that caregiver's share.
    if (filters.caregiverId) shifts = shifts.filter((s) => s.caregiverId === filters.caregiverId)
    if (filters.clientId) shifts = shifts.filter((s) => s.clientId === filters.clientId)

    const caregiverIds = [...new Set(shifts.map((s) => s.caregiverId))]
    const [people, groups] = await Promise.all([caregiverPayRates(d.db, companyId, caregiverIds, end), caregiverGroups(d.db, companyId, caregiverIds)])
    const rates = new Map(people.map((p: any) => {
      const base = Math.round((Number(p.baseRate ?? p.defaultPayRate ?? FALLBACK_PAY_RATE) || FALLBACK_PAY_RATE) * 100)
      const ot = p.overtimeRate != null && Number.isFinite(Number(p.overtimeRate)) ? Math.round(Number(p.overtimeRate) * 100) : Math.round(base * OT_MULTIPLIER)
      return [String(p.id), { base, ot }]
    }))
    const caregivers = new Map(groups.map((g: any) => [String(g.id), {
      id: String(g.id), name: `${g.firstName ?? ''} ${g.lastName ?? ''}`.trim(), branchId: g.branchId ?? null, branchName: g.branchName ?? null,
      team: g.team ?? null, department: g.department ?? null, managerUserId: g.managerUserId ?? null,
      managerName: g.managerFirstName ? `${g.managerFirstName} ${g.managerLastName ?? ''}`.trim() : null,
    }]))

    const mileageAll = filters.caregiverId ? {} : await mileagePaidByClient(d.db, companyId, start, end)
    const clientIds = [...new Set([...shifts.map((s) => s.clientId), ...Object.keys(mileageAll)])].filter((id) => !filters.clientId || id === filters.clientId)
    const clientRows = await marginClients(d.db, companyId, clientIds)
    const clients = new Map<string, any>()
    for (const c of clientRows) {
      if (filters.branchId && c.branchId !== filters.branchId) continue
      if (filters.referralSourceId && c.referredById !== filters.referralSourceId) continue
      if (filters.payerId && c.payerId !== filters.payerId) continue
      clients.set(String(c.id), c)
    }
    shifts = shifts.filter((s) => clients.has(s.clientId))
    const mileage: Record<string, number> = {}
    for (const [id, paid] of Object.entries(mileageAll)) if (clients.has(id)) mileage[id] = Math.round(paid * 100)

    // One bill rate per client for the window, the invoice's rule.
    const billRate = new Map<string, { rate: number; rateType: string } | null>()
    for (const c of clients.values()) billRate.set(String(c.id), await deps.invoices.resolveClientRate(companyId, c, start, end))
    const billFor = (clientId: string, minutes: number): number | null => {
      const r = billRate.get(clientId)
      if (!r || !(r.rate > 0)) return null
      const hrs = minutes / 60
      return r.rateType === 'hourly' ? hrs * r.rate * 100 : Math.round(hrs * 4 * 100) / 100 * r.rate * 100
    }

    const ledger: LedgerShift[] = shifts.map((s) => {
      const r = rates.get(s.caregiverId) ?? { base: FALLBACK_PAY_RATE * 100, ot: Math.round(FALLBACK_PAY_RATE * 100 * OT_MULTIPLIER) }
      const regularPayCents = (s.regularMinutes * r.base) / 60
      const overtimePayCents = (s.overtimeMinutes * r.ot) / 60
      const doubleTimePayCents = ((s.doubleTimeMinutes ?? 0) * r.base * 2) / 60
      return {
        id: s.id, date: s.date ?? start, clientId: s.clientId, caregiverId: s.caregiverId, minutes: s.minutes,
        overtimeMinutes: s.overtimeMinutes + (s.doubleTimeMinutes ?? 0), travel: !!s.travel,
        regularPayCents, overtimePayCents, doubleTimePayCents, payCents: regularPayCents + overtimePayCents + doubleTimePayCents,
        billedCents: s.travel ? null : billFor(s.clientId, s.minutes),
      }
    })
    return { ledger, clients, caregivers, mileage, billRate, noClientMinutes, filters }
  }
  type Ledger = Awaited<ReturnType<typeof shiftLedger>>

  const clientInfo = (c: any) => ({
    branchId: c.branchId ?? null, branchName: c.branchName ?? null, department: c.careTypeName ?? null,
    referralSourceId: c.referredById ?? null, referralSourceName: c.referralSourceName ?? null, payerId: c.payerId ?? null, payerName: c.payerName ?? null,
  })

  /** The per-client rows of a ledger (lowest margin first). */
  async function clientRows(L: Ledger, companyId: string, start: string, end: string): Promise<ClientMarginRow[]> {
    const invoiced = await invoicedHoursByClient(d.db, companyId, start, end)
    const rows: ClientMarginRow[] = []
    for (const [clientId, c] of L.clients) {
      const mine = L.ledger.filter((s) => s.clientId === clientId)
      if (!mine.length && !L.mileage[clientId]) continue
      const visits = mine.filter((s) => !s.travel)
      const minutes = visits.reduce((t, s) => t + s.minutes, 0)
      const otMinutes = mine.reduce((t, s) => t + s.overtimeMinutes, 0)
      const resolved = L.billRate.get(clientId)
      const billedCents = resolved && resolved.rate > 0 ? sumCents(visits, (s) => s.billedCents ?? 0) : null
      const payCents = sumCents(mine, (s) => s.payCents)
      const mileageCents = L.mileage[clientId] ?? 0
      const costCents = payCents + mileageCents
      const marginCents = billedCents === null ? null : billedCents - costCents
      rows.push({
        clientId, clientName: `${c.firstName} ${c.lastName}`.trim(), hours: hours2(minutes), overtimeHours: hours2(otMinutes),
        rate: resolved?.rate ?? null, rateType: resolved?.rateType ?? null, billed: billedCents === null ? null : dollars(billedCents),
        pay: dollars(payCents), overtimePay: dollars(sumCents(mine, (s) => s.overtimePayCents + s.doubleTimePayCents)), mileage: dollars(mileageCents), cost: dollars(costCents),
        travelPay: dollars(sumCents(mine.filter((s) => s.travel), (s) => s.payCents)), doubleTimePay: dollars(sumCents(mine, (s) => s.doubleTimePayCents)),
        margin: marginCents === null ? null : dollars(marginCents),
        marginPercent: billedCents === null || billedCents <= 0 ? null : Math.round(((billedCents - costCents) / billedCents) * 1000) / 10,
        billedCents, costCents, marginCents, hoursInvoiced: Math.round((invoiced[clientId] ?? 0) * 100) / 100,
        ...clientInfo(c),
      })
    }
    // Lowest margin first: the clients costing the agency money are what the owner opens this for. No rate sorts last.
    rows.sort((a, b) => (a.margin ?? Infinity) - (b.margin ?? Infinity) || a.clientName.localeCompare(b.clientName))
    return rows
  }

  const totalsOf = (rows: ClientMarginRow[]) => {
    const sum = (f: (r: ClientMarginRow) => number) => Math.round(rows.reduce((t, r) => t + f(r), 0) * 100) / 100
    const cents = (f: (r: ClientMarginRow) => number) => rows.reduce((t, r) => t + f(r), 0)
    const rated = rows.filter((r) => r.billed !== null)
    const billedCents = cents((r) => r.billedCents ?? 0), costCents = cents((r) => r.costCents)
    return {
      hours: sum((r) => r.hours), hoursInvoiced: sum((r) => r.hoursInvoiced), billed: sum((r) => r.billed ?? 0), pay: sum((r) => r.pay), mileage: sum((r) => r.mileage),
      margin: sum((r) => r.margin ?? 0), clientsWithoutRate: rows.length - rated.length,
      billedCents, costCents, marginCents: cents((r) => r.marginCents ?? 0), marginPercent: pct1(billedCents - cents((r) => r.billed === null ? 0 : r.costCents), billedCents),
    }
  }

  /** A grouping of the client rows by one of their fields (referral source, payer, department, branch). */
  function groupRows(rows: ClientMarginRow[], key: (r: ClientMarginRow) => { id: string | null; name: string | null }, none: string) {
    const groups = new Map<string, { id: string | null; name: string; clients: ClientMarginRow[] }>()
    for (const r of rows) {
      const k = key(r)
      const id = k.id ?? ''
      if (!groups.has(id)) groups.set(id, { id: k.id, name: k.name ?? none, clients: [] })
      groups.get(id)!.clients.push(r)
    }
    return [...groups.values()].map((g) => {
      const t = totalsOf(g.clients)
      return { id: g.id, name: g.name, clients: g.clients.length, hours: t.hours, billedCents: t.billedCents, costCents: t.costCents, marginCents: t.marginCents, marginPercent: t.marginPercent, clientsWithoutRate: t.clientsWithoutRate }
    }).sort((a, b) => b.billedCents - a.billedCents || a.name.localeCompare(b.name))
  }

  /** The client margin report over [start, end] under the filters: the per-client table, the totals and the groupings. */
  async function clientMargin(companyId: string, start: string, end: string, filters: MarginFilters = {}) {
    const L = await shiftLedger(companyId, start, end, filters)
    const rows = await clientRows(L, companyId, start, end)
    return {
      period: { start, end }, filters, clients: rows, totals: totalsOf(rows),
      hoursWithoutClient: hours2(L.noClientMinutes),
      byReferralSource: groupRows(rows, (r) => ({ id: r.referralSourceId, name: r.referralSourceName }), 'No referral source'),
      byPayer: groupRows(rows, (r) => ({ id: r.payerId, name: r.payerName }), 'Private pay / no payer'),
      byDepartment: groupRows(rows, (r) => ({ id: r.department, name: r.department }), 'No care type'),
      byBranch: groupRows(rows, (r) => ({ id: r.branchId, name: r.branchName }), 'No branch'),
    }
  }

  /** Two windows side by side, with the change per client and in total. */
  async function compare(companyId: string, a: { start: string; end: string }, b: { start: string; end: string }, filters: MarginFilters = {}) {
    const [current, previous] = await Promise.all([clientMargin(companyId, a.start, a.end, filters), clientMargin(companyId, b.start, b.end, filters)])
    const prev = new Map(previous.clients.map((r) => [r.clientId, r]))
    const seen = new Set<string>()
    const clients = current.clients.map((r) => {
      seen.add(r.clientId)
      const p = prev.get(r.clientId) ?? null
      return { clientId: r.clientId, clientName: r.clientName, current: r, previous: p, changeCents: r.marginCents !== null && p?.marginCents != null ? r.marginCents - p.marginCents : null, hoursChange: Math.round((r.hours - (p?.hours ?? 0)) * 100) / 100 }
    })
    for (const p of previous.clients) if (!seen.has(p.clientId)) clients.push({ clientId: p.clientId, clientName: p.clientName, current: null as any, previous: p, changeCents: null, hoursChange: -p.hours })
    return {
      current: { period: current.period, totals: current.totals }, previous: { period: previous.period, totals: previous.totals },
      change: {
        billedCents: current.totals.billedCents - previous.totals.billedCents, costCents: current.totals.costCents - previous.totals.costCents,
        marginCents: current.totals.marginCents - previous.totals.marginCents, hours: Math.round((current.totals.hours - previous.totals.hours) * 100) / 100,
      },
      clients,
    }
  }

  /** The per-visit margin of a day or a month (row 11): every paid visit with what it billed, what it cost and the margin. */
  async function visitMargin(companyId: string, start: string, end: string, filters: MarginFilters = {}) {
    const L = await shiftLedger(companyId, start, end, filters)
    const visits = L.ledger.filter((s) => !s.travel).map((s) => {
      const c = L.clients.get(s.clientId), g = L.caregivers.get(s.caregiverId)
      const payCents = Math.round(s.payCents)
      const billedCents = s.billedCents === null ? null : Math.round(s.billedCents)
      return {
        id: s.id, date: s.date, clientId: s.clientId, clientName: c ? `${c.firstName} ${c.lastName}`.trim() : '', caregiverId: s.caregiverId, caregiverName: g?.name ?? '',
        hours: hours2(s.minutes), overtimeHours: hours2(s.overtimeMinutes), billedCents, payCents, marginCents: billedCents === null ? null : billedCents - payCents,
        marginPercent: billedCents === null || billedCents <= 0 ? null : Math.round(((billedCents - payCents) / billedCents) * 1000) / 10,
        ...clientInfo(c ?? {}),
      }
    }).sort((a, b) => a.date.localeCompare(b.date) || a.clientName.localeCompare(b.clientName))
    const travelCents = sumCents(L.ledger.filter((s) => s.travel), (s) => s.payCents)
    const mileageCents = Object.values(L.mileage).reduce((t, v) => t + v, 0)
    return {
      period: { start, end }, filters, visits,
      totals: {
        visits: visits.length, hours: hours2(visits.reduce((t, v) => t + v.hours * 60, 0)), billedCents: visits.reduce((t, v) => t + (v.billedCents ?? 0), 0),
        payCents: visits.reduce((t, v) => t + v.payCents, 0), travelPayCents: travelCents, mileageCents,
        marginCents: visits.reduce((t, v) => t + (v.marginCents ?? 0), 0) - travelCents - mileageCents, visitsWithoutRate: visits.filter((v) => v.billedCents === null).length,
      },
    }
  }

  /** The trend (row 11): billed, cost and margin per week or month of the window, for the chart. */
  async function trend(companyId: string, start: string, end: string, by: 'week' | 'month', filters: MarginFilters = {}) {
    const L = await shiftLedger(companyId, start, end, filters)
    const buckets = new Map<string, { bucket: string; hours: number; billedCents: number; costCents: number; marginCents: number; visits: number }>()
    const at = (k: string) => { if (!buckets.has(k)) buckets.set(k, { bucket: k, hours: 0, billedCents: 0, costCents: 0, marginCents: 0, visits: 0 }); return buckets.get(k)! }
    for (const s of L.ledger) {
      const b = at(bucketOf(s.date, by))
      if (!s.travel) { b.hours += s.minutes; b.visits++ }
      b.billedCents += s.billedCents ?? 0
      b.costCents += s.payCents
    }
    // Mileage is dated by its trip; the ledger has it per client only, so it lands on the window's last bucket as a cost.
    const mileageCents = Object.values(L.mileage).reduce((t, v) => t + v, 0)
    if (mileageCents) at(bucketOf(end, by)).costCents += mileageCents
    const points = [...buckets.values()].sort((a, b) => a.bucket.localeCompare(b.bucket)).map((b) => ({
      bucket: b.bucket, visits: b.visits, hours: hours2(b.hours), billedCents: Math.round(b.billedCents), costCents: Math.round(b.costCents),
      marginCents: Math.round(b.billedCents - b.costCents), marginPercent: pct1(b.billedCents - b.costCents, b.billedCents),
    }))
    return { period: { start, end }, by, filters, points }
  }

  /** The drill-down (row 11): total → branch (the client's) → team (the caregiver's) → client, each level with its own totals. */
  async function drillDown(companyId: string, start: string, end: string, filters: MarginFilters = {}) {
    const L = await shiftLedger(companyId, start, end, filters)
    type Node = { id: string | null; name: string; hours: number; billedCents: number; costCents: number; marginCents: number; marginPercent: number | null; children?: Node[] }
    const leaf = (id: string | null, name: string, shifts: LedgerShift[], mileageCents = 0): Node => {
      const billed = shifts.reduce((t, s) => t + (s.billedCents ?? 0), 0), cost = shifts.reduce((t, s) => t + s.payCents, 0) + mileageCents
      return { id, name, hours: hours2(shifts.filter((s) => !s.travel).reduce((t, s) => t + s.minutes, 0)), billedCents: Math.round(billed), costCents: Math.round(cost), marginCents: Math.round(billed - cost), marginPercent: pct1(billed - cost, billed) }
    }
    const roll = (nodes: Node[], id: string | null, name: string): Node => {
      const billed = nodes.reduce((t, n) => t + n.billedCents, 0), cost = nodes.reduce((t, n) => t + n.costCents, 0)
      return { id, name, hours: Math.round(nodes.reduce((t, n) => t + n.hours, 0) * 100) / 100, billedCents: billed, costCents: cost, marginCents: billed - cost, marginPercent: pct1(billed - cost, billed), children: nodes }
    }
    const byBranch = new Map<string, LedgerShift[]>()
    for (const s of L.ledger) { const k = L.clients.get(s.clientId)?.branchId ?? ''; byBranch.set(k, [...(byBranch.get(k) ?? []), s]) }
    for (const clientId of Object.keys(L.mileage)) { const k = L.clients.get(clientId)?.branchId ?? ''; if (!byBranch.has(k)) byBranch.set(k, []) }
    const branches: Node[] = []
    for (const [branchId, shifts] of byBranch) {
      const branchName = branchId ? (L.clients.get(shifts[0]?.clientId ?? '')?.branchName ?? [...L.clients.values()].find((c) => c.branchId === branchId)?.branchName ?? 'Branch') : 'No branch'
      const byTeam = new Map<string, LedgerShift[]>()
      for (const s of shifts) { const k = L.caregivers.get(s.caregiverId)?.team ?? ''; byTeam.set(k, [...(byTeam.get(k) ?? []), s]) }
      const branchClients = [...L.clients.values()].filter((c) => (c.branchId ?? '') === branchId)
      const teams: Node[] = []
      for (const [team, teamShifts] of byTeam) {
        const byClient = new Map<string, LedgerShift[]>()
        for (const s of teamShifts) byClient.set(s.clientId, [...(byClient.get(s.clientId) ?? []), s])
        const clientsNodes = [...byClient].map(([clientId, cs]) => { const c = L.clients.get(clientId); return leaf(clientId, c ? `${c.firstName} ${c.lastName}`.trim() : 'Client', cs) })
        teams.push(roll(clientsNodes.sort((a, b) => a.marginCents - b.marginCents), team || null, team || 'No team'))
      }
      // Mileage has no caregiver team: it is a cost of the client under the branch, kept in a node of its own so the branch adds up.
      const mileageCents = branchClients.reduce((t, c) => t + (L.mileage[String(c.id)] ?? 0), 0)
      if (mileageCents) teams.push(leaf(null, 'Mileage (no team)', [], mileageCents))
      branches.push(roll(teams.sort((a, b) => a.marginCents - b.marginCents), branchId || null, branchName))
    }
    return { period: { start, end }, filters, total: roll(branches.sort((a, b) => a.marginCents - b.marginCents), null, 'Whole agency') }
  }

  /** Turnover over [start, end]: hires, departures, headcount, rates, and 90-day retention of the hires that have had 90 days. */
  async function turnover(companyId: string, start: string, end: string, today: string, filters: { branchId?: string | null } = {}) {
    const people = (await caregiverTenure(d.db, companyId)).filter((p: any) => !filters.branchId || p.branchId === filters.branchId)
    const day = (v: string | null) => (v ? String(v).slice(0, 10) : null)
    const add = (ymd: string, n: number) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
    const span = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000)
    const list = people.map((p: any) => {
      const hired = day(p.hired)!
      const stored = day(p.leftOn)
      // A stored leaving date is exact and wins; otherwise someone no longer active left on their last visit.
      const left = stored ?? (p.isActive ? null : (day(p.lastWorked) ?? day(p.recordChanged)))
      return {
        id: String(p.id), name: `${p.firstName} ${p.lastName}`.trim(), hired, left: left && left < hired ? hired : left, exact: !!stored, leftReason: p.leftReason ?? null,
        firstWorked: day(p.firstWorked), branchName: p.branchName ?? null, team: p.team ?? null, managerName: p.managerFirstName ? `${p.managerFirstName} ${p.managerLastName ?? ''}`.trim() : null,
      }
    })
    const employedOn = (p: { hired: string; left: string | null }, ymd: string) => p.hired <= ymd && (!p.left || p.left > ymd)
    // headcount at the start = who was employed the day BEFORE the window opens, so a hire on the first day counts as a hire, not as already here
    const headStart = list.filter((p) => employedOn(p, add(start, -1))).length
    const headEnd = list.filter((p) => employedOn(p, end)).length
    const hires = list.filter((p) => p.hired >= start && p.hired <= end)
    const departures = list.filter((p) => p.left && p.left >= start && p.left <= end)
    const avg = (headStart + headEnd) / 2
    const eligible = hires.filter((p) => add(p.hired, 90) <= today)
    const kept90 = eligible.filter((p) => !p.left || span(p.hired, p.left) >= 90)
    // Hire to first shift: the hires of the window who have worked at least once.
    const started = hires.filter((p) => p.firstWorked && p.firstWorked >= p.hired)
    const [applicants, spendCents, reliability, accuracy] = await Promise.all([
      applicantCounts(d.db, companyId, start, end), hiringSpendCents(d.db, companyId, start, end), caregiverReliability(d.db, companyId, start, end), payrollAccuracy(d.db, companyId, start, end),
    ])
    return {
      period: { start, end }, filters, headcountStart: headStart, headcountEnd: headEnd, hires: hires.length, departures: departures.length,
      turnoverPercent: avg > 0 ? Math.round((departures.length / avg) * 1000) / 10 : null,
      retentionPercent: avg > 0 ? Math.round((1 - departures.length / avg) * 1000) / 10 : null,
      hiresWith90Days: eligible.length, hiresKept90Days: kept90.length,
      ninetyDayRetentionPercent: eligible.length ? Math.round((kept90.length / eligible.length) * 1000) / 10 : null,
      averageTenureDaysOfDeparted: departures.length ? Math.round(departures.reduce((t, p) => t + span(p.hired, p.left!), 0) / departures.length) : null,
      departed: departures.map((p) => ({ caregiverId: p.id, name: p.name, hired: p.hired, lastWorked: p.left as string, leftOn: p.left as string, exact: p.exact, leftReason: p.leftReason, tenureDays: span(p.hired, p.left!), branchName: p.branchName, team: p.team, managerName: p.managerName })).sort((a, b) => b.lastWorked.localeCompare(a.lastWorked)),
      departuresWithoutLeavingDate: departures.filter((p) => !p.exact).length,
      hiring: {
        applicants: applicants.applicants, applicantsHired: applicants.hired,
        applicantToHireRatio: applicants.hired > 0 ? Math.round((applicants.applicants / applicants.hired) * 10) / 10 : null,
        hiresWhoStarted: started.length,
        hireToFirstShiftDays: started.length ? Math.round(started.reduce((t, p) => t + span(p.hired, p.firstWorked!), 0) / started.length) : null,
        hiresNotYetStarted: hires.length - started.length,
        hiringSpendCents: spendCents, costPerHireCents: hires.length ? Math.round(spendCents / hires.length) : null,
      },
      reliability: reliability.map((r: any) => ({ caregiverId: String(r.caregiverId), name: `${r.firstName} ${r.lastName}`.trim(), absences: Number(r.absences), cancelledVisits: Number(r.cancelledVisits), missedVisits: Number(r.missedVisits) })),
      payrollAccuracy: {
        ...accuracy,
        accuracyPercent: accuracy.reviewed ? Math.round(((accuracy.reviewed - accuracy.corrected) / accuracy.reviewed) * 1000) / 10 : null,
      },
    }
  }

  return { enabled, shiftLedger, clientMargin, compare, visitMargin, trend, drillDown, turnover }
}
export type Margin = ReturnType<typeof createMargin>
