// Payroll export for a bar or restaurant (restaurant-bar parity #8, bar_payroll_export; Toast Payroll, 7shifts and BevSpot's pay file).
//
// A pay period's hours (from the time clock), overtime, and tips, tip-outs and pooled tips, per person, as a file for Gusto, ADP or a spreadsheet.
//
//   · HOURS and OVERTIME — time entries on the company's calendar, running clock-ins left out (they have no hours yet). Overtime is hours past
//     the venue's weekly threshold (a setting, 40 by default) in the company's work week; see barPayrollMath.ts for the rule in full.
//   · TIPS — each person's share of the nights that were closed (tips.report), counted ONCE. Cash already in their hand is shown apart and taken
//     off what is left to pay on the paycheck: cash tips rung on our register (credited to whoever closed the check, as the pool does)
//     and the cash tips they declared (tips.declaredByPerson). Declared cash on a night that was never closed is added to the person's tips and to their
//     cash, so it still reaches the tax figure; the screen says which nights were never closed.
//   · Nothing is sent anywhere: the file is a download. Neither Gusto nor ADP is reached by us.
import { and, asc, eq, gte, inArray, lt } from 'drizzle-orm'
import { companyTimeZone, storeDayRange } from '@twomiah/tenant-backend'
import { barCheck, barCheckPayment, company, timeEntry, user } from '../../db/schema/index.ts'
import { businessDayOf, businessDayWindow } from './barLive.ts'
import type { BarDb } from './db.ts'
import type { BarTips } from './barTips.ts'
import { adpCsv, adpFilename, dollars, overtimeAfterRefusal, plainCsv, plainFilename, splitHours, DEFAULT_OVERTIME_AFTER, type AdpSettings, type PayPerson } from './barPayrollMath.ts'
import { companyWorkWeek, dailyOvertimeNotice, WEEKDAY_NAMES, workweekStartOn } from '../payrollExport/workWeek.ts'

export class PayrollError extends Error { constructor(message: string, public status = 400) { super(message) } }
const DAY = /^\d{4}-\d{2}-\d{2}$/
const MAX_DAYS = 62
const MAX_PEOPLE_IDS = 300

export interface PayrollSettings {
  overtimeAfterHours: number
  adp: AdpSettings
  /** ADP's "File #" for each person, by user id. */
  adpFileNumbers: Record<string, string>
}
export const NO_ADP: AdpSettings = { companyCode: '', batchId: '', tipEarningsCode: 'T' }

const code = (v: unknown, max: number) => String(v ?? '').trim().replace(/\s+/g, '').slice(0, max)
const alnum = (s: string) => /^[A-Za-z0-9]*$/.test(s)

export function createBarPayroll(deps: { db: BarDb; tips: BarTips }) {
  const { db, tips } = deps

  async function getSettings(companyId: string): Promise<PayrollSettings> {
    const [co] = await db.select({ settings: company.settings }).from(company).where(eq(company.id, companyId)).limit(1)
    const s = ((co?.settings as any)?.barPayroll || {}) as any
    const ot = Number(s.overtimeAfterHours)
    const files: Record<string, string> = {}
    if (s.adpFileNumbers && typeof s.adpFileNumbers === 'object') for (const [k, v] of Object.entries(s.adpFileNumbers)) if (typeof v === 'string' && v) files[k] = v
    return {
      overtimeAfterHours: Number.isFinite(ot) && !overtimeAfterRefusal(ot) ? ot : DEFAULT_OVERTIME_AFTER,
      adp: { companyCode: code(s.adp?.companyCode, 8), batchId: code(s.adp?.batchId, 8), tipEarningsCode: code(s.adp?.tipEarningsCode, 4) || 'T' },
      adpFileNumbers: files,
    }
  }

  /** The venue's settings, from what a screen sent: only what it names changes. */
  async function setSettings(companyId: string, b: any): Promise<{ before: PayrollSettings; settings: PayrollSettings }> {
    const before = await getSettings(companyId)
    const next: PayrollSettings = { ...before, adp: { ...before.adp }, adpFileNumbers: { ...before.adpFileNumbers } }
    if (b?.overtimeAfterHours !== undefined) {
      const why = overtimeAfterRefusal(b.overtimeAfterHours)
      if (why) throw new PayrollError(why)
      next.overtimeAfterHours = Number(b.overtimeAfterHours)
    }
    if (b?.adp && typeof b.adp === 'object') {
      for (const [key, max, label] of [['companyCode', 8, 'ADP company code'], ['batchId', 8, 'Batch ID'], ['tipEarningsCode', 4, 'Tip earnings code']] as const) {
        if (b.adp[key] === undefined) continue
        const v = code(b.adp[key], max)
        if (!alnum(v)) throw new PayrollError(`${label} is letters and numbers only.`)
        if (key === 'tipEarningsCode' && !v) throw new PayrollError('Tip earnings code cannot be empty. ADP\'s own table says which code your tips are paid under (T is a common one).')
        next.adp[key] = v
      }
    }
    if (b?.adpFileNumbers && typeof b.adpFileNumbers === 'object' && !Array.isArray(b.adpFileNumbers)) {
      const entries = Object.entries(b.adpFileNumbers)
      if (entries.length > MAX_PEOPLE_IDS) throw new PayrollError('Too many file numbers at once.')
      const ids = entries.map(([k]) => k)
      const own = ids.length ? await db.select({ id: user.id }).from(user).where(and(eq(user.companyId, companyId), inArray(user.id, ids))) : []
      const mine = new Set(own.map((u) => u.id))
      for (const [k, v] of entries) {
        if (!mine.has(k)) throw new PayrollError('That person is not on your team.', 404)
        const n = code(v, 12)
        if (!alnum(n)) throw new PayrollError('A file number is letters and numbers only.')
        if (n) next.adpFileNumbers[k] = n; else delete next.adpFileNumbers[k]
      }
    }
    const [co] = await db.select({ settings: company.settings }).from(company).where(eq(company.id, companyId)).limit(1)
    await db.update(company).set({ settings: { ...((co?.settings as any) || {}), barPayroll: next }, updatedAt: new Date() }).where(eq(company.id, companyId))
    return { before, settings: next }
  }

  /** The words that state the overtime rule actually used: the screen, the docs and the answer all show them. */
  function ruleText(otAfter: number, startName: string) {
    const h = Number.isInteger(otAfter) ? String(otAfter) : String(otAfter)
    return `Overtime is hours worked past ${h} in a work week. The work week starts on ${startName}. Hours are counted in the order they were worked, so a week that began before this pay period brings its earlier hours along. Overtime by the day (over 8 or 12 hours in a shift) is not calculated. Your payroll provider adds the overtime pay rate; this file carries hours, never wages.`
  }

  /** Everyone's hours and tips for the period, with what is wrong with them. */
  async function build(companyId: string, from: string, to: string) {
    if (!DAY.test(from) || !DAY.test(to) || from > to) throw new PayrollError('Pick the first and last day of the pay period.')
    if ((Date.parse(to) - Date.parse(from)) / 86400000 + 1 > MAX_DAYS) throw new PayrollError(`Up to ${MAX_DAYS} days at a time.`)
    const tz = await companyTimeZone(db, companyId)
    const { startDay, state } = await companyWorkWeek(db, companyId)
    const settings = await getSettings(companyId)
    const warnings: string[] = []

    // ── Hours ──
    const early = workweekStartOn(from, startDay)
    const rows = await db.select({ userId: timeEntry.userId, date: timeEntry.date, hours: timeEntry.hours, clockIn: timeEntry.clockIn, clockOut: timeEntry.clockOut, approved: timeEntry.approved })
      .from(timeEntry)
      .where(and(eq(timeEntry.companyId, companyId), gte(timeEntry.date, storeDayRange(tz, early).start), lt(timeEntry.date, storeDayRange(tz, to).end)))
      .orderBy(asc(timeEntry.date))
    const byUser = new Map<string, Array<{ date: Date; hours: string }>>()
    const unapproved = new Map<string, number>()
    const stillIn = new Set<string>()
    const fromAt = storeDayRange(tz, from).start
    for (const r of rows) {
      if (r.clockIn && !r.clockOut) { if (r.date >= fromAt) stillIn.add(r.userId); continue }
      ;(byUser.get(r.userId) ?? byUser.set(r.userId, []).get(r.userId)!).push({ date: r.date, hours: r.hours })
      if (!r.approved && r.date >= fromAt) unapproved.set(r.userId, (unapproved.get(r.userId) || 0) + 1)
    }

    // ── Tips ──
    const report = await tips.report(companyId, from, to)
    const declared = await tips.declaredByPerson(companyId, from, to)
    const settledDays = new Set<string>(report.nights.map((n: any) => n.day))
    const declaredDays = new Map<string, Map<string, number>>()   // user → day → cents
    for (const p of declared.people) declaredDays.set(p.userId, new Map(p.days.map((d) => [d.day, d.cents])))
    // Register cash tips, credited to whoever closed the check (as the pool credits the check's tips), on the settled nights only: they are in that night's total.
    const win = { from: businessDayWindow(from, tz).from, to: businessDayWindow(to, tz).to }
    const cashRows = await db.select({ closedById: barCheck.closedById, closedAt: barCheck.closedAt, tip: barCheckPayment.tipCents })
      .from(barCheckPayment).innerJoin(barCheck, eq(barCheckPayment.checkId, barCheck.id))
      .where(and(eq(barCheck.companyId, companyId), eq(barCheck.status, 'paid'), gte(barCheck.closedAt, win.from), lt(barCheck.closedAt, win.to), eq(barCheckPayment.tender, 'cash'), gte(barCheckPayment.tipCents, 1)))
    const registerCash = new Map<string, number>()
    for (const r of cashRows) {
      if (!r.closedById || !r.closedAt || !settledDays.has(businessDayOf(r.closedAt, tz))) continue
      registerCash.set(r.closedById, (registerCash.get(r.closedById) || 0) + r.tip)
    }
    // Nights with tips on the register that were never closed: their tips are not in anyone's total.
    const tipChecks = await db.select({ closedAt: barCheck.closedAt }).from(barCheck)
      .where(and(eq(barCheck.companyId, companyId), eq(barCheck.status, 'paid'), gte(barCheck.closedAt, win.from), lt(barCheck.closedAt, win.to), gte(barCheck.tipCents, 1)))
    const openNights = [...new Set(tipChecks.filter((c) => c.closedAt).map((c) => businessDayOf(c.closedAt!, tz)))].filter((d) => !settledDays.has(d)).sort()
    if (openNights.length) warnings.push(`Tips were taken on ${openNights.length === 1 ? 'a night' : `${openNights.length} nights`} that ${openNights.length === 1 ? 'was' : 'were'} not closed with tip rules set (${openNights.join(', ')}), so those tips are not in this file. Set the tip rules and close the night, then take the file again.`)

    const tipBy = new Map<string, any>(report.people.map((p: any) => [p.userId, p]))
    const ids = [...new Set([...byUser.keys(), ...tipBy.keys(), ...declared.people.map((p) => p.userId)])]
    const names = ids.length ? await db.select({ id: user.id, first: user.firstName, last: user.lastName, email: user.email }).from(user).where(and(eq(user.companyId, companyId), inArray(user.id, ids))) : []
    const who = new Map(names.map((u) => [u.id, u]))

    const people: PayPerson[] = []
    for (const id of ids) {
      const u = who.get(id)
      if (!u) continue
      const h = splitHours(byUser.get(id) || [], tz, startDay, settings.overtimeAfterHours, from, to)
      const t = tipBy.get(id)
      const decl = declaredDays.get(id) || new Map<string, number>()
      let declaredCash = 0, declaredOpen = 0
      for (const [day, cents] of decl) { declaredCash += cents; if (!settledDays.has(day)) declaredOpen += cents }
      const settledTotal = t?.totalCents || 0
      const cash = (registerCash.get(id) || 0) + declaredCash
      const total = settledTotal + declaredOpen
      const name = [u.first, u.last].filter(Boolean).join(' ').trim() || u.email
      people.push({
        userId: id, name, firstName: u.first, lastName: u.last, email: u.email, ...h,
        tipsTotalCents: total, cashInHandCents: cash, paycheckTipsCents: total - cash,
        tipOutPaidCents: t?.tipOutPaidCents || 0, tipOutReceivedCents: t?.tipOutReceivedCents || 0, poolShareCents: t?.poolShareCents || 0,
        adpFileNumber: settings.adpFileNumbers[id] || null,
      })
    }
    people.sort((a, b) => (a.lastName || a.name).localeCompare(b.lastName || b.name) || a.name.localeCompare(b.name))

    for (const p of people) {
      if (unapproved.get(p.userId)) warnings.push(`${p.name} has ${unapproved.get(p.userId)} time ${unapproved.get(p.userId) === 1 ? 'entry' : 'entries'} not approved yet. They are counted.`)
      if (p.paycheckTipsCents < 0) warnings.push(`${p.name} holds ${dollars(-p.paycheckTipsCents)} dollars more in cash tips than their share, so nothing is paid on their paycheck. The Gusto and ADP files show 0.00 tips for them; the spreadsheet file shows the real figure.`)
    }
    if (stillIn.size) {
      const nm = [...stillIn].map((id) => { const u = who.get(id); return u ? [u.first, u.last].filter(Boolean).join(' ') || u.email : '' }).filter(Boolean)
      warnings.push(`${nm.length ? nm.join(', ') : 'Someone'} ${stillIn.size === 1 ? 'is' : 'are'} still clocked in, so ${stillIn.size === 1 ? 'that shift is' : 'those shifts are'} left out until they clock out.`)
    }
    const daily = dailyOvertimeNotice(state)
    if (daily) warnings.push(daily)
    const missingAdp = people.filter((p) => !p.adpFileNumber && (p.totalHours > 0 || p.paycheckTipsCents > 0)).map((p) => p.name)
    const adpMissing: string[] = []
    if (!settings.adp.companyCode) adpMissing.push('your ADP company code')
    if (!settings.adp.batchId) adpMissing.push('a Batch ID')
    if (missingAdp.length) adpMissing.push(`an ADP file number for ${missingAdp.join(', ')}`)

    const startName = WEEKDAY_NAMES[startDay]
    return {
      from, to, settings,
      rule: { overtimeAfterHours: settings.overtimeAfterHours, workWeekStartName: startName, text: ruleText(settings.overtimeAfterHours, startName), dailyOvertimeCalculated: false },
      people, warnings,
      totals: {
        regularHours: Math.round(people.reduce((s, p) => s + p.regularHours, 0) * 100) / 100,
        overtimeHours: Math.round(people.reduce((s, p) => s + p.overtimeHours, 0) * 100) / 100,
        tipsTotalCents: people.reduce((s, p) => s + p.tipsTotalCents, 0),
        cashInHandCents: people.reduce((s, p) => s + p.cashInHandCents, 0),
        paycheckTipsCents: people.reduce((s, p) => s + p.paycheckTipsCents, 0),
      },
      adp: { ready: adpMissing.length === 0, missing: adpMissing },
    }
  }

  /** The three files: the plain spreadsheet, Gusto's hours-and-tips upload, ADP's paydata import. */
  async function file(companyId: string, from: string, to: string, format: string) {
    const r = await build(companyId, from, to)
    const withPay = r.people.filter((p) => p.totalHours > 0 || p.tipsTotalCents !== 0 || p.cashInHandCents > 0)
    if (!withPay.length) throw new PayrollError('Nobody has hours or tips in this pay period.', 404)
    if (format === 'csv') return { r, name: plainFilename(from, to), text: plainCsv(withPay), people: withPay.length }
    if (format === 'gusto') return { r, rows: withPay, people: withPay.length }
    if (format === 'adp') {
      if (!r.adp.ready) throw new PayrollError(`ADP's file needs ${r.adp.missing.join(' and ')}. Add ${r.adp.missing.length === 1 ? 'it' : 'them'} under Settings on this page.`)
      return { r, name: adpFilename(r.settings.adp), text: adpCsv(withPay, r.settings.adp), people: withPay.length }
    }
    throw new PayrollError('Pick Gusto, ADP or a spreadsheet.')
  }

  return { getSettings, setSettings, build, file }
}
export type BarPayroll = ReturnType<typeof createBarPayroll>
