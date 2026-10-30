// Per-client margin and caregiver turnover (item 10, care_margin_reports, not ready).
//
// MARGIN = what the client is billed for the hours worked − what the caregivers were paid for them.
//   · Hours: the payable minutes of the same payroll shift reviews payroll pays (core/payrollPay.ts), so the report agrees
//     with the pay run: a shift that is pending, flagged or excused is on neither.
//   · Billed: those hours × the client's billing rate (core.invoices.resolveClientRate — the same rule an invoice uses). A
//     client with no rate set is listed with no margin, not with a made-up one.
//   · Pay: the caregiver's regular and overtime rates (payrollPay's), with the overtime of each work week put on the
//     shifts that crossed the 40-hour line, in the order they were worked — so a client whose shifts fell past 40 hours
//     bears the overtime cost. Plus mileage paid on trips recorded against the client. Paid travel TIME between visits is
//     not in the report until the payroll item that pays it exists.
//   · Money in cents; a per-15-minute rate bills units (hours × 4), as invoices do.
//
// TURNOVER: hires, departures and headcount over a window, from the caregiver list (there is no separation date on file,
// so a departed caregiver is dated by the last visit they worked — see data/homecareMargin.ts).
import {
  payableReviewsWithClient, payableMinutesWithoutClient, mileagePaidByClient, marginClients, caregiverTenure,
} from '../../../data/homecareMargin.ts'
import { caregiverPayRates } from '../../../data/homecarePayroll.ts'
import { companyWorkWeek, workweekStartOn } from '../../payrollExport/workWeek.ts'
import type { CrmDeps } from '../../deps.ts'
import { PAYABLE_REVIEW_STATUSES, OT_WEEKLY_HOURS, OT_MULTIPLIER, FALLBACK_PAY_RATE, payCents } from './payrollPay.ts'
import type { InvoiceEngine } from './invoiceEngine.ts'

export const MARGIN_FEATURE = 'care_margin_reports'

export interface ShiftPay { id: string; clientId: string; caregiverId: string; minutes: number; regularMinutes: number; overtimeMinutes: number }

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
    return { id: s.id, clientId: s.clientId, caregiverId: s.caregiverId, minutes, regularMinutes: regular, overtimeMinutes: minutes - regular }
  })
}

export interface ClientMarginRow {
  clientId: string; clientName: string; hours: number; overtimeHours: number
  rate: number | null; rateType: string | null; billed: number | null
  pay: number; overtimePay: number; mileage: number; cost: number
  margin: number | null; marginPercent: number | null
}

const hours2 = (minutes: number) => Math.round((minutes / 60) * 100) / 100
const money = (cents: number) => Math.round(cents) / 100

export function createMargin(d: CrmDeps, deps: { invoices: InvoiceEngine }) {
  const enabled = (companyId: string) => d.features.isFeatureEnabled(companyId, MARGIN_FEATURE)

  async function clientMargin(companyId: string, start: string, end: string) {
    const { startDay } = await companyWorkWeek(d.db, companyId)
    const reviews = await payableReviewsWithClient(d.db, companyId, start, end, PAYABLE_REVIEW_STATUSES)
    const noClientMinutes = await payableMinutesWithoutClient(d.db, companyId, start, end, PAYABLE_REVIEW_STATUSES)
    const shifts: ShiftPay[] = []
    for (const caregiverId of [...new Set(reviews.map((r) => String(r.caregiverId)))]) {
      const mine = reviews.filter((r) => String(r.caregiverId) === caregiverId && r.clientId)
      shifts.push(...allocateOvertime(mine.map((r) => ({ id: String(r.id), clientId: String(r.clientId), caregiverId, date: String(r.shiftDate), minutes: Number(r.payableMinutes) })), startDay))
    }
    const caregiverIds = [...new Set(shifts.map((s) => s.caregiverId))]
    const people = await caregiverPayRates(d.db, companyId, caregiverIds, end)
    const rates = new Map(people.map((p: any) => {
      const base = Math.round((Number(p.baseRate ?? p.defaultPayRate ?? FALLBACK_PAY_RATE) || FALLBACK_PAY_RATE) * 100)
      const ot = p.overtimeRate != null && Number.isFinite(Number(p.overtimeRate)) ? Math.round(Number(p.overtimeRate) * 100) : Math.round(base * OT_MULTIPLIER)
      return [String(p.id), { base, ot }]
    }))
    const clientIds = [...new Set(shifts.map((s) => s.clientId))]
    const [clientRows, mileage] = await Promise.all([marginClients(d.db, companyId, clientIds), mileagePaidByClient(d.db, companyId, start, end)])
    const byId = new Map(clientRows.map((c: any) => [String(c.id), c]))

    const rows: ClientMarginRow[] = []
    for (const clientId of new Set([...clientIds, ...Object.keys(mileage)])) {
      const mine = shifts.filter((s) => s.clientId === clientId)
      const c: any = byId.get(clientId) ?? (await marginClients(d.db, companyId, [clientId]))[0]
      if (!c) continue
      let regPayCents = 0, otPayCents = 0, minutes = 0, otMinutes = 0
      for (const s of mine) {
        const r = rates.get(s.caregiverId) ?? { base: FALLBACK_PAY_RATE * 100, ot: Math.round(FALLBACK_PAY_RATE * 100 * OT_MULTIPLIER) }
        regPayCents += (s.regularMinutes * r.base) / 60
        otPayCents += (s.overtimeMinutes * r.ot) / 60
        minutes += s.minutes; otMinutes += s.overtimeMinutes
      }
      const resolved = await deps.invoices.resolveClientRate(companyId, c, start, end)
      const hrs = minutes / 60
      const billedDollars = resolved && resolved.rate > 0
        ? (resolved.rateType === 'hourly' ? hrs * resolved.rate : Math.round(hrs * 4 * 100) / 100 * resolved.rate)
        : null
      const payDollars = money(regPayCents + otPayCents)
      const mileageDollars = Math.round((mileage[clientId] ?? 0) * 100) / 100
      const cost = Math.round((payDollars + mileageDollars) * 100) / 100
      const billed = billedDollars === null ? null : Math.round(billedDollars * 100) / 100
      rows.push({
        clientId, clientName: `${c.firstName} ${c.lastName}`.trim(), hours: hours2(minutes), overtimeHours: hours2(otMinutes),
        rate: resolved?.rate ?? null, rateType: resolved?.rateType ?? null, billed,
        pay: payDollars, overtimePay: money(otPayCents), mileage: mileageDollars, cost,
        margin: billed === null ? null : Math.round((billed - cost) * 100) / 100,
        marginPercent: billed === null || billed <= 0 ? null : Math.round(((billed - cost) / billed) * 1000) / 10,
      })
    }
    // Lowest margin first: the clients costing the agency money are what the owner opens this for. No rate sorts last.
    rows.sort((a, b) => (a.margin ?? Infinity) - (b.margin ?? Infinity) || a.clientName.localeCompare(b.clientName))
    const sum = (f: (r: ClientMarginRow) => number) => Math.round(rows.reduce((t, r) => t + f(r), 0) * 100) / 100
    const rated = rows.filter((r) => r.billed !== null)
    return {
      period: { start, end }, clients: rows,
      totals: { hours: sum((r) => r.hours), billed: sum((r) => r.billed ?? 0), pay: sum((r) => r.pay), mileage: sum((r) => r.mileage), margin: sum((r) => r.margin ?? 0), clientsWithoutRate: rows.length - rated.length },
      hoursWithoutClient: hours2(noClientMinutes),
    }
  }

  /** Turnover over [start, end]: hires, departures, headcount, rates, and 90-day retention of the hires that have had 90 days. */
  async function turnover(companyId: string, start: string, end: string, today: string) {
    const people = await caregiverTenure(d.db, companyId)
    const day = (v: string | null) => (v ? String(v).slice(0, 10) : null)
    const add = (ymd: string, n: number) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
    const span = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000)
    const list = people.map((p: any) => {
      const hired = day(p.hired)!
      const left = p.isActive ? null : (day(p.lastWorked) ?? day(p.recordChanged))
      return { id: String(p.id), name: `${p.firstName} ${p.lastName}`.trim(), hired, left: left && left < hired ? hired : left }
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
    return {
      period: { start, end }, headcountStart: headStart, headcountEnd: headEnd, hires: hires.length, departures: departures.length,
      turnoverPercent: avg > 0 ? Math.round((departures.length / avg) * 1000) / 10 : null,
      retentionPercent: avg > 0 ? Math.round((1 - departures.length / avg) * 1000) / 10 : null,
      hiresWith90Days: eligible.length, hiresKept90Days: kept90.length,
      ninetyDayRetentionPercent: eligible.length ? Math.round((kept90.length / eligible.length) * 1000) / 10 : null,
      averageTenureDaysOfDeparted: departures.length ? Math.round(departures.reduce((t, p) => t + span(p.hired, p.left!), 0) / departures.length) : null,
      departed: departures.map((p) => ({ caregiverId: p.id, name: p.name, hired: p.hired, lastWorked: p.left as string, tenureDays: span(p.hired, p.left!) })).sort((a, b) => b.lastWorked.localeCompare(a.lastWorked)),
    }
  }

  return { enabled, clientMargin, turnover }
}
export type Margin = ReturnType<typeof createMargin>
