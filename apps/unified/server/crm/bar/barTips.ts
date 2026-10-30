// Tip pooling and tip-out against the database (restaurant-bar-depth #9; the arithmetic is barTipMath.ts).
//
//   · The rules live on the company's settings (settings.tips): roles, who pools, tip-outs, shares of the pool.
//   · A night's figures are read, not typed: tips and sales are those of the checks each person CLOSED that night (the
//     same attribution the per-person checkout already uses), hours are their time-clock punches that night, and a
//     person's role is their scheduled position that day (else the default role).
//   · Closing the night (the close-out) records who gets what; closing it again replaces that night's rows.
//   · Tips on checks nobody closed (kiosk and website orders) are not shared; the night says how much that was.
import { and, asc, desc, eq, gte, inArray, isNotNull, lt, lte } from 'drizzle-orm'
import { barCheck, barScheduleShift, barTipPayout, company, timeEntry, user } from '../../db/schema/index.ts'
import type { BarDb } from './db.ts'
import { businessDayWindow, type BarLive } from './barLive.ts'
import { rulesRefusal, settleTips, type TipPerson, type TipRules } from './barTipMath.ts'

export class TipError extends Error { constructor(message: string, public status = 400) { super(message) } }
const DAY = /^\d{4}-\d{2}-\d{2}$/
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

export const NO_RULES: TipRules = { roles: [], tipOuts: [], defaultRole: '' }

/** What a body may say about the rules, cleaned: numbers made numbers, text trimmed. */
export function cleanRules(b: any): TipRules {
  const roles = Array.isArray(b?.roles) ? b.roles : []
  const tipOuts = Array.isArray(b?.tipOuts) ? b.tipOuts : []
  return {
    roles: roles.map((r: any) => ({
      name: String(r?.name ?? '').replace(/\s+/g, ' ').trim(),
      positions: (Array.isArray(r?.positions) ? r.positions : []).map((x: unknown) => String(x).trim()).filter(Boolean).slice(0, 10),
      mode: r?.mode === 'pools' ? 'pools' : 'keeps',
      poolPct: Number(r?.poolPct ?? 0),
    })),
    tipOuts: tipOuts.map((t: any) => ({ from: String(t?.from ?? '').trim(), to: String(t?.to ?? '').trim(), pct: Number(t?.pct), basis: t?.basis === 'sales' ? 'sales' : 'tips' })),
    defaultRole: String(b?.defaultRole ?? '').trim(),
  }
}

export function createBarTips(db: BarDb, live: BarLive) {
  async function getRules(companyId: string): Promise<TipRules> {
    const [co] = await db.select({ settings: company.settings }).from(company).where(eq(company.id, companyId)).limit(1)
    const saved = (co?.settings as any)?.tips
    return saved && typeof saved === 'object' ? { ...NO_RULES, ...cleanRules(saved) } : NO_RULES
  }

  async function setRules(companyId: string, body: unknown): Promise<{ before: TipRules; rules: TipRules }> {
    const rules = cleanRules(body)
    const problem = rulesRefusal(rules)
    if (problem) throw new TipError(problem)
    const before = await getRules(companyId)
    const [co] = await db.select({ settings: company.settings }).from(company).where(eq(company.id, companyId)).limit(1)
    await db.update(company).set({ settings: { ...((co?.settings as any) || {}), tips: rules }, updatedAt: new Date() }).where(eq(company.id, companyId))
    return { before, rules }
  }

  /** The people who earned or worked on this night, with what the rules need of each. */
  async function gather(companyId: string, day: string, rules: TipRules): Promise<{ people: TipPerson[]; unassignedTipsCents: number; stillClockedIn: string[] }> {
    if (!DAY.test(day)) throw new TipError('Which night?')
    const tz = (await live.hoursFor(companyId)).timezone!
    const { from, to } = businessDayWindow(day, tz)
    const [checks, punches, shifts] = await Promise.all([
      db.select({ by: barCheck.closedById, tip: barCheck.tipCents, sub: barCheck.subtotalCents }).from(barCheck)
        .where(and(eq(barCheck.companyId, companyId), eq(barCheck.status, 'paid'), gte(barCheck.closedAt, from), lt(barCheck.closedAt, to))),
      db.select({ userId: timeEntry.userId, clockIn: timeEntry.clockIn, clockOut: timeEntry.clockOut }).from(timeEntry)
        .where(and(eq(timeEntry.companyId, companyId), isNotNull(timeEntry.clockIn), gte(timeEntry.clockIn, from), lt(timeEntry.clockIn, to))),
      db.select({ userId: barScheduleShift.userId, position: barScheduleShift.position }).from(barScheduleShift).where(and(eq(barScheduleShift.companyId, companyId), eq(barScheduleShift.day, day))),
    ])
    const tips = new Map<string, { tip: number; sales: number }>()
    let unassigned = 0
    for (const c of checks) {
      if (!c.by) { unassigned += c.tip || 0; continue }
      const cur = tips.get(c.by) || { tip: 0, sales: 0 }
      cur.tip += c.tip || 0; cur.sales += c.sub || 0
      tips.set(c.by, cur)
    }
    const hours = new Map<string, number>()
    const stillClockedIn: string[] = []
    for (const p of punches) {
      if (!p.clockOut) { stillClockedIn.push(p.userId); continue }
      hours.set(p.userId, (hours.get(p.userId) || 0) + Math.max(0, (p.clockOut.getTime() - p.clockIn!.getTime()) / 3600000))
    }
    const ids = [...new Set([...tips.keys(), ...hours.keys(), ...stillClockedIn])]
    if (!ids.length) return { people: [], unassignedTipsCents: unassigned, stillClockedIn: [] }
    const names = await db.select({ id: user.id, first: user.firstName, last: user.lastName, email: user.email }).from(user).where(and(eq(user.companyId, companyId), inArray(user.id, ids)))
    const nameOf = new Map(names.map((u) => [u.id, [u.first, u.last].filter(Boolean).join(' ').trim() || u.email]))
    const fallback = rules.defaultRole || rules.roles[0]?.name || ''
    const roleFor = (id: string) => {
      for (const s of shifts) {
        if (s.userId !== id || !s.position) continue
        const hit = rules.roles.find((r) => r.positions.some((p) => same(p, s.position!)) || same(r.name, s.position!))
        if (hit) return hit.name
      }
      return fallback
    }
    const people = ids.filter((id) => nameOf.has(id)).map((id): TipPerson => ({
      userId: id, name: nameOf.get(id)!, role: roleFor(id),
      hours: Math.round((hours.get(id) || 0) * 100) / 100, tipsCents: tips.get(id)?.tip || 0, salesCents: tips.get(id)?.sales || 0,
    })).sort((a, b) => a.name.localeCompare(b.name))
    return { people, unassignedTipsCents: unassigned, stillClockedIn: stillClockedIn.map((id) => nameOf.get(id) || id) }
  }

  /** The night as it would settle now (the close-out screen shows it before closing). */
  async function preview(companyId: string, day: string) {
    const rules = await getRules(companyId)
    if (!rules.roles.length) return { day, rules, configured: false, payouts: [], poolCents: 0, notes: [] as string[], unassignedTipsCents: 0, stillClockedIn: [] as string[], totalTipsCents: 0 }
    const g = await gather(companyId, day, rules)
    const r = settleTips(rules, g.people)
    const notes = [...r.notes]
    if (g.unassignedTipsCents) notes.push(`${(g.unassignedTipsCents / 100).toFixed(2)} dollars in tips on kiosk and website orders belong to nobody in particular and are not shared.`)
    if (g.stillClockedIn.length) notes.push(`${g.stillClockedIn.join(', ')} ${g.stillClockedIn.length === 1 ? 'is' : 'are'} still clocked in, so ${g.stillClockedIn.length === 1 ? 'their' : 'those'} hours are not counted yet.`)
    return { day, rules, configured: true, payouts: r.payouts, poolCents: r.poolCents, notes, unassignedTipsCents: g.unassignedTipsCents, stillClockedIn: g.stillClockedIn, totalTipsCents: g.people.reduce((s, p) => s + p.tipsCents, 0) }
  }

  /** Close the night's tips: freeze who gets what. Replaces any earlier close of the same night. */
  async function record(companyId: string, day: string, closeoutId: string | null) {
    const p = await preview(companyId, day)
    if (!p.configured) return p
    await db.transaction(async (tx: any) => {
      await tx.delete(barTipPayout).where(and(eq(barTipPayout.companyId, companyId), eq(barTipPayout.businessDay, day)))
      if (p.payouts.length) await tx.insert(barTipPayout).values(p.payouts.map((x) => ({
        companyId, businessDay: day, closeoutId, userId: x.userId, name: x.name, role: x.role || '—', hoursX100: Math.round(x.hours * 100),
        tipsCents: x.tipsCents, salesCents: x.salesCents, keptCents: x.keptCents, tipOutPaidCents: x.tipOutPaidCents,
        tipOutReceivedCents: x.tipOutReceivedCents, poolShareCents: x.poolShareCents, totalCents: x.totalCents,
      })))
    })
    return p
  }

  const rangeOk = (from: string, to: string) => {
    if (!DAY.test(from) || !DAY.test(to) || from > to) throw new TipError('Pick a from and a to date.')
    if ((Date.parse(to) - Date.parse(from)) / 86400000 > 92) throw new TipError('Up to 92 nights at a time.')
  }

  /** Everyone's tips for the nights closed from…to, by person and by night. */
  async function report(companyId: string, from: string, to: string) {
    rangeOk(from, to)
    const rows = await db.select().from(barTipPayout).where(and(eq(barTipPayout.companyId, companyId), gte(barTipPayout.businessDay, from), lte(barTipPayout.businessDay, to))).orderBy(asc(barTipPayout.businessDay), asc(barTipPayout.name))
    const byPerson = new Map<string, any>()
    for (const r of rows) {
      const cur = byPerson.get(r.userId) || { userId: r.userId, name: r.name, hours: 0, tipsCents: 0, tipOutPaidCents: 0, tipOutReceivedCents: 0, poolShareCents: 0, totalCents: 0, nights: 0 }
      cur.hours += r.hoursX100 / 100; cur.tipsCents += r.tipsCents; cur.tipOutPaidCents += r.tipOutPaidCents; cur.tipOutReceivedCents += r.tipOutReceivedCents
      cur.poolShareCents += r.poolShareCents; cur.totalCents += r.totalCents; cur.nights++
      byPerson.set(r.userId, cur)
    }
    const people = [...byPerson.values()].map((p) => ({ ...p, hours: Math.round(p.hours * 100) / 100 })).sort((a, b) => b.totalCents - a.totalCents)
    return { from, to, people, nights: rows.map((r) => ({ day: r.businessDay, userId: r.userId, name: r.name, role: r.role, hours: r.hoursX100 / 100, tipsCents: r.tipsCents, tipOutPaidCents: r.tipOutPaidCents, tipOutReceivedCents: r.tipOutReceivedCents, poolShareCents: r.poolShareCents, totalCents: r.totalCents })), totalCents: people.reduce((s, p) => s + p.totalCents, 0) }
  }

  /** One person's own nights. */
  async function mine(companyId: string, userId: string, from: string, to: string) {
    rangeOk(from, to)
    const rows = await db.select().from(barTipPayout).where(and(eq(barTipPayout.companyId, companyId), eq(barTipPayout.userId, userId), gte(barTipPayout.businessDay, from), lte(barTipPayout.businessDay, to))).orderBy(desc(barTipPayout.businessDay))
    return { from, to, nights: rows.map((r) => ({ day: r.businessDay, role: r.role, hours: r.hoursX100 / 100, tipsCents: r.tipsCents, tipOutPaidCents: r.tipOutPaidCents, tipOutReceivedCents: r.tipOutReceivedCents, poolShareCents: r.poolShareCents, totalCents: r.totalCents })), totalCents: rows.reduce((s, r) => s + r.totalCents, 0) }
  }

  /** The positions the schedule uses, to offer when naming a role. */
  async function positions(companyId: string): Promise<string[]> {
    const rows = await db.selectDistinct({ p: barScheduleShift.position }).from(barScheduleShift).where(and(eq(barScheduleShift.companyId, companyId), isNotNull(barScheduleShift.position)))
    return rows.map((r) => r.p!).filter(Boolean).sort()
  }

  return { getRules, setRules, preview, record, report, mine, positions }
}
export type BarTips = ReturnType<typeof createBarTips>
