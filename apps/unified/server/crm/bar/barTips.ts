// Tip pooling and tip-out against the database (restaurant-bar-depth #9; the arithmetic is barTipMath.ts).
//
//   · The rules live on the company's settings (settings.tips): roles, who pools, tip-outs, shares of the pool.
//   · A night's figures are read, not typed: tips and sales are those of the checks each person CLOSED that night (the
//     same attribution the per-person checkout already uses), hours are their time-clock punches that night, and a
//     person's role is their scheduled position that day (else the default role).
//   · Closing the night (the close-out) records who gets what; closing it again replaces that night's rows.
//   · Tips on checks nobody closed (kiosk and website orders) are not shared; the night says how much that was.
//   · DECLARED CASH TIPS (restaurant-bar parity #16, 'bar_declared_tips'): a person declares the cash tips they were handed outside the
//     register at clock-out; the day's total is kept per person, a manager corrects it, and it joins the person's tips in the pool and
//     the tip-out. Cash tips rung on OUR register are already on the checks and are never declared again. `declaredByPerson` hands the
//     payroll export the declared tips per person for a pay period.
//   · TIPS FROM ANOTHER REGISTER (parity #17, 'bar_tip_import'): tips imported from Toast or Square (barTipSources.ts) for the people they
//     are matched to join the same pool; tips from staff nobody matched yet are listed, not shared.
import { and, asc, desc, eq, gte, inArray, isNotNull, lt, lte } from 'drizzle-orm'
import { barCheck, barCheckPayment, barDeclaredTip, barScheduleShift, barTipImport, barTipPayout, barTipStaffMap, company, timeEntry, user } from '../../db/schema/index.ts'
import type { BarDb } from './db.ts'
import { addDays } from './barHours.ts'
import { businessDayOf, businessDayWindow, type BarLive } from './barLive.ts'
import { roleForPositions, rulesRefusal, settleTips, type TipPerson, type TipRules } from './barTipMath.ts'

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
    // Present only when the owner has set it (even as nothing: then no position counts as any role).
    ...(b?.positionRoles && typeof b.positionRoles === 'object' && !Array.isArray(b.positionRoles)
      ? { positionRoles: Object.fromEntries(Object.entries(b.positionRoles as Record<string, unknown>).map(([k, v]) => [k.replace(/\s+/g, ' ').trim(), String(v ?? '').trim()]).filter(([k]) => k)) }
      : {}),
  }
}

/** The most a person can declare for one day: $10,000. Money is whole cents. */
export const MAX_DECLARED_CENTS = 1_000_000
const nameOf = (u: { first: string | null; last: string | null; email: string }) => [u.first, u.last].filter(Boolean).join(' ').trim() || u.email

export function createBarTips(db: BarDb, live: BarLive) {
  /** Set by barTipSources.ts: brings in a night's tips from another register just before they are counted. Returns notes to show. */
  let refreshExternal: ((companyId: string, day: string) => Promise<string[]>) | null = null
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
  async function gather(companyId: string, day: string, rules: TipRules): Promise<{ people: TipPerson[]; unassignedTipsCents: number; unmatchedImportedCents: number; stillClockedIn: string[] }> {
    if (!DAY.test(day)) throw new TipError('Which night?')
    const tz = (await live.hoursFor(companyId)).timezone!
    const { from, to } = businessDayWindow(day, tz)
    const [checks, punches, shifts, declaredRows, importRows] = await Promise.all([
      db.select({ by: barCheck.closedById, tip: barCheck.tipCents, sub: barCheck.subtotalCents }).from(barCheck)
        .where(and(eq(barCheck.companyId, companyId), eq(barCheck.status, 'paid'), gte(barCheck.closedAt, from), lt(barCheck.closedAt, to))),
      db.select({ userId: timeEntry.userId, clockIn: timeEntry.clockIn, clockOut: timeEntry.clockOut }).from(timeEntry)
        .where(and(eq(timeEntry.companyId, companyId), isNotNull(timeEntry.clockIn), gte(timeEntry.clockIn, from), lt(timeEntry.clockIn, to))),
      db.select({ userId: barScheduleShift.userId, position: barScheduleShift.position }).from(barScheduleShift).where(and(eq(barScheduleShift.companyId, companyId), eq(barScheduleShift.day, day))),
      db.select({ userId: barDeclaredTip.userId, cents: barDeclaredTip.amountCents }).from(barDeclaredTip).where(and(eq(barDeclaredTip.companyId, companyId), eq(barDeclaredTip.businessDay, day))),
      db.select({ source: barTipImport.sourceId, staff: barTipImport.externalStaffId, cents: barTipImport.tipCents }).from(barTipImport).where(and(eq(barTipImport.companyId, companyId), eq(barTipImport.businessDay, day))),
    ])
    const tips = new Map<string, { tip: number; sales: number }>()
    let unassigned = 0
    for (const c of checks) {
      if (!c.by) { unassigned += c.tip || 0; continue }
      const cur = tips.get(c.by) || { tip: 0, sales: 0 }
      cur.tip += c.tip || 0; cur.sales += c.sub || 0
      tips.set(c.by, cur)
    }
    // Cash tips the person declared, and tips another register reported for the person it is matched to.
    const declared = new Map<string, number>(declaredRows.map((r) => [r.userId, r.cents]))
    const imported = new Map<string, number>()
    let unmatched = 0
    if (importRows.length) {
      const maps = await db.select({ source: barTipStaffMap.sourceId, staff: barTipStaffMap.externalStaffId, userId: barTipStaffMap.userId }).from(barTipStaffMap).where(eq(barTipStaffMap.companyId, companyId))
      const who = new Map(maps.filter((m) => m.userId).map((m) => [`${m.source}|${m.staff}`, m.userId as string]))
      for (const r of importRows) {
        const uid = r.staff ? who.get(`${r.source}|${r.staff}`) : undefined
        if (uid) imported.set(uid, (imported.get(uid) || 0) + r.cents); else unmatched += r.cents
      }
    }
    const hours = new Map<string, number>()
    const stillClockedIn: string[] = []
    for (const p of punches) {
      if (!p.clockOut) { stillClockedIn.push(p.userId); continue }
      hours.set(p.userId, (hours.get(p.userId) || 0) + Math.max(0, (p.clockOut.getTime() - p.clockIn!.getTime()) / 3600000))
    }
    const ids = [...new Set([...tips.keys(), ...hours.keys(), ...stillClockedIn, ...[...declared].filter(([, c]) => c > 0).map(([u]) => u), ...imported.keys()])]
    if (!ids.length) return { people: [], unassignedTipsCents: unassigned, unmatchedImportedCents: unmatched, stillClockedIn: [] }
    const names = await db.select({ id: user.id, first: user.firstName, last: user.lastName, email: user.email }).from(user).where(and(eq(user.companyId, companyId), inArray(user.id, ids)))
    const nameOf = new Map(names.map((u) => [u.id, [u.first, u.last].filter(Boolean).join(' ').trim() || u.email]))
    const fallback = rules.defaultRole || rules.roles[0]?.name || ''
    const roleFor = (id: string) => roleForPositions(rules, shifts.filter((s) => s.userId === id && s.position).map((s) => s.position as string), fallback)
    const people = ids.filter((id) => nameOf.has(id)).map((id): TipPerson => ({
      userId: id, name: nameOf.get(id)!, role: roleFor(id),
      hours: Math.round((hours.get(id) || 0) * 100) / 100, tipsCents: (tips.get(id)?.tip || 0) + (declared.get(id) || 0) + (imported.get(id) || 0), salesCents: tips.get(id)?.sales || 0,
      declaredCents: declared.get(id) || 0, importedCents: imported.get(id) || 0,
    })).sort((a, b) => a.name.localeCompare(b.name))
    return { people, unassignedTipsCents: unassigned, unmatchedImportedCents: unmatched, stillClockedIn: stillClockedIn.map((id) => nameOf.get(id) || id) }
  }

  /** The night as it would settle now (the close-out screen shows it before closing). */
  async function preview(companyId: string, day: string) {
    const rules = await getRules(companyId)
    if (!rules.roles.length) return { day, rules, configured: false, payouts: [], poolCents: 0, notes: [] as string[], unassignedTipsCents: 0, stillClockedIn: [] as string[], totalTipsCents: 0 }
    const fresh = refreshExternal ? await refreshExternal(companyId, day) : []
    const g = await gather(companyId, day, rules)
    const r = settleTips(rules, g.people)
    const notes = [...r.notes, ...fresh]
    if (g.unmatchedImportedCents) notes.push(`${(g.unmatchedImportedCents / 100).toFixed(2)} dollars in tips from another register belong to staff not matched to a person yet, so they are not shared. Match them on the Tips page.`)
    if (g.people.some((p) => (p.importedCents || 0) > 0) && rules.tipOuts.some((t) => t.basis === 'sales')) notes.push('Tip-outs set as a share of sales use the sales rung on this register only; sales from another register are not read.')
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
        tipsCents: x.tipsCents, declaredCents: x.declaredCents || 0, importedCents: x.importedCents || 0, salesCents: x.salesCents, keptCents: x.keptCents, tipOutPaidCents: x.tipOutPaidCents,
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
      const cur = byPerson.get(r.userId) || { userId: r.userId, name: r.name, hours: 0, tipsCents: 0, declaredCents: 0, importedCents: 0, tipOutPaidCents: 0, tipOutReceivedCents: 0, poolShareCents: 0, totalCents: 0, nights: 0 }
      cur.hours += r.hoursX100 / 100; cur.tipsCents += r.tipsCents; cur.declaredCents += r.declaredCents; cur.importedCents += r.importedCents; cur.tipOutPaidCents += r.tipOutPaidCents; cur.tipOutReceivedCents += r.tipOutReceivedCents
      cur.poolShareCents += r.poolShareCents; cur.totalCents += r.totalCents; cur.nights++
      byPerson.set(r.userId, cur)
    }
    const people = [...byPerson.values()].map((p) => ({ ...p, hours: Math.round(p.hours * 100) / 100 })).sort((a, b) => b.totalCents - a.totalCents)
    return { from, to, people, nights: rows.map((r) => ({ day: r.businessDay, userId: r.userId, name: r.name, role: r.role, hours: r.hoursX100 / 100, tipsCents: r.tipsCents, declaredCents: r.declaredCents, importedCents: r.importedCents, tipOutPaidCents: r.tipOutPaidCents, tipOutReceivedCents: r.tipOutReceivedCents, poolShareCents: r.poolShareCents, totalCents: r.totalCents })), totalCents: people.reduce((s, p) => s + p.totalCents, 0) }
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

  // ─── Declared cash tips ────────────────────────────────────────────────────────────────────────────────────
  type DeclaredRow = typeof barDeclaredTip.$inferSelect
  const declaredView = (r: DeclaredRow, name?: string) => ({
    id: r.id, userId: r.userId, ...(name !== undefined ? { name } : {}), day: r.businessDay, amountCents: r.amountCents, originalCents: r.originalCents,
    corrected: r.originalCents !== r.amountCents && !!r.correctedByName, correctedByName: r.correctedByName, note: r.note, declaredVia: r.declaredVia, declaredAt: r.declaredAt.toISOString(),
  })
  function centsOf(v: unknown): number {
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > MAX_DECLARED_CENTS) throw new TipError('Cash tips are a whole number of cents, from 0 up to $10,000.')
    return v
  }
  const tzOf = async (companyId: string) => (await live.hoursFor(companyId)).timezone!

  /** A night that was already closed is worked out again from the declared figure that just changed, so the frozen rows never disagree with it. */
  async function refreeze(companyId: string, day: string) {
    const [closed] = await db.select({ closeoutId: barTipPayout.closeoutId }).from(barTipPayout).where(and(eq(barTipPayout.companyId, companyId), eq(barTipPayout.businessDay, day))).limit(1)
    if (closed) await record(companyId, day, closed.closeoutId)
  }

  async function writeDeclared(companyId: string, userId: string, day: string, cents: number, via: string, by: { name: string } | null, note: string | null, mode: 'set' | 'add') {
    const [cur] = await db.select().from(barDeclaredTip).where(and(eq(barDeclaredTip.companyId, companyId), eq(barDeclaredTip.userId, userId), eq(barDeclaredTip.businessDay, day))).limit(1)
    const amount = cur && mode === 'add' ? cur.amountCents + cents : cents
    if (amount > MAX_DECLARED_CENTS) throw new TipError('That is more than $10,000 in cash tips for one day. Check the amount.')
    let row: DeclaredRow
    if (cur) {
      // The person's own figure is the "original"; a manager's correction leaves it as it was, and a person saying it again starts over.
      ;[row] = await db.update(barDeclaredTip).set({ amountCents: amount, declaredVia: via, updatedAt: new Date(), ...(by ? { correctedByName: by.name, correctedAt: new Date(), ...(note !== null ? { note } : {}) } : { originalCents: amount, correctedByName: null, correctedAt: null }) }).where(eq(barDeclaredTip.id, cur.id)).returning()
    } else {
      ;[row] = await db.insert(barDeclaredTip).values({ companyId, userId, businessDay: day, amountCents: amount, originalCents: amount, declaredVia: via, note, ...(by ? { correctedByName: by.name } : {}) }).returning()
    }
    await refreeze(companyId, day)
    return row
  }

  /**
   * I declare the cash tips I was handed outside the register, for the day of `at` (the moment I clocked out; the phone sends it so a
   * save made without signal lands on the right night) or today. 'set' makes it the day's total (a phone's box shows what is
   * declared already); 'add' adds to it (the tablet, which cannot show it). Up to 7 days back; never the future.
   */
  async function declareMine(companyId: string, userId: string, b: { amountCents?: unknown; at?: unknown; day?: unknown; mode?: unknown }, via: string) {
    const cents = centsOf(b.amountCents)
    const tz = await tzOf(companyId)
    const now = new Date()
    let day: string
    if (b.day !== undefined && b.day !== null && b.day !== '') {
      if (!DAY.test(String(b.day))) throw new TipError('Which night?')
      day = String(b.day)
    } else if (b.at !== undefined && b.at !== null && b.at !== '') {
      const at = new Date(String(b.at))
      if (Number.isNaN(at.getTime()) || at.getTime() > now.getTime() + 10 * 60_000) throw new TipError('That time is not right.')
      day = businessDayOf(at, tz)
    } else day = businessDayOf(now, tz)
    const today = businessDayOf(now, tz)
    if (day > today) throw new TipError('You cannot declare tips for a night that has not happened.')
    if (day < addDays(today, -7)) throw new TipError('That night is more than a week ago. Ask a manager to add it.')
    const row = await writeDeclared(companyId, userId, day, cents, via, null, null, b.mode === 'add' ? 'add' : 'set')
    return declaredView(row)
  }

  /** My own declared nights, with the cash tips already on the register for each (so nothing is declared twice). */
  async function mineDeclared(companyId: string, userId: string, fromIn: string, toIn: string) {
    const tz = await tzOf(companyId)
    // No range: tonight, on the company's own clock.
    const [from, to] = !fromIn && !toIn ? [businessDayOf(new Date(), tz), businessDayOf(new Date(), tz)] : [fromIn, toIn]
    rangeOk(from, to)
    const rows = await db.select().from(barDeclaredTip).where(and(eq(barDeclaredTip.companyId, companyId), eq(barDeclaredTip.userId, userId), gte(barDeclaredTip.businessDay, from), lte(barDeclaredTip.businessDay, to))).orderBy(desc(barDeclaredTip.businessDay))
    const { from: a } = businessDayWindow(from, tz), { to: z } = businessDayWindow(to, tz)
    const pays = await db.select({ at: barCheckPayment.takenAt, tip: barCheckPayment.tipCents }).from(barCheckPayment)
      .where(and(eq(barCheckPayment.companyId, companyId), eq(barCheckPayment.takenById, userId), eq(barCheckPayment.tender, 'cash'), gte(barCheckPayment.takenAt, a), lt(barCheckPayment.takenAt, z)))
    const onRegister: Record<string, number> = {}
    for (const p of pays) { if (!p.tip) continue; const d = businessDayOf(p.at, tz); onRegister[d] = (onRegister[d] || 0) + p.tip }
    return { from, to, nights: rows.map((r) => ({ ...declaredView(r), onRegisterCents: onRegister[r.businessDay] || 0 })), onRegisterByDay: onRegister, totalCents: rows.reduce((s, r) => s + r.amountCents, 0) }
  }

  /** For a manager: everyone's declared nights, by person. */
  async function listDeclared(companyId: string, from: string, to: string) {
    rangeOk(from, to)
    const rows = await db.select().from(barDeclaredTip).where(and(eq(barDeclaredTip.companyId, companyId), gte(barDeclaredTip.businessDay, from), lte(barDeclaredTip.businessDay, to))).orderBy(desc(barDeclaredTip.businessDay))
    const people = rows.length ? await db.select({ id: user.id, first: user.firstName, last: user.lastName, email: user.email }).from(user).where(and(eq(user.companyId, companyId), inArray(user.id, [...new Set(rows.map((r) => r.userId))]))) : []
    const nm = new Map(people.map((u) => [u.id, nameOf(u)]))
    return { from, to, nights: rows.map((r) => declaredView(r, nm.get(r.userId) || '?')), totalCents: rows.reduce((s, r) => s + r.amountCents, 0) }
  }

  /** A manager adds a night a person forgot to declare, or sets it outright. */
  async function declareFor(actorName: string, companyId: string, b: { userId?: unknown; day?: unknown; amountCents?: unknown; note?: unknown }) {
    const cents = centsOf(b.amountCents)
    if (!DAY.test(String(b.day ?? ''))) throw new TipError('Which night?')
    const [u] = await db.select({ id: user.id }).from(user).where(and(eq(user.id, String(b.userId ?? '')), eq(user.companyId, companyId))).limit(1)
    if (!u) throw new TipError('Who is that?', 404)
    const row = await writeDeclared(companyId, u.id, String(b.day), cents, 'manager', { name: actorName }, String(b.note ?? '').trim().slice(0, 200) || null, 'set')
    return declaredView(row)
  }

  /** A manager corrects a declared figure; the first figure the person gave is kept beside it. */
  async function correctDeclared(actorName: string, companyId: string, id: string, b: { amountCents?: unknown; note?: unknown }) {
    const cents = centsOf(b.amountCents)
    const [cur] = await db.select().from(barDeclaredTip).where(and(eq(barDeclaredTip.id, id), eq(barDeclaredTip.companyId, companyId))).limit(1)
    if (!cur) throw new TipError('That is gone.', 404)
    const row = await writeDeclared(companyId, cur.userId, cur.businessDay, cents, cur.declaredVia, { name: actorName }, String(b.note ?? '').trim().slice(0, 200) || null, 'set')
    return { before: declaredView(cur), entry: declaredView(row) }
  }

  /**
   * THE PAYROLL EXPORT'S CALL (restaurant-bar parity #8 reads this): the cash tips each person declared, per person, for the nights
   * from..to (company business days, inclusive), after any manager correction. Cents. Only people who declared more than nothing.
   * Cash tips rung on our own register are NOT in it (they are on the checks, and the report's cashTipsCents shows them).
   */
  async function declaredByPerson(companyId: string, from: string, to: string): Promise<{ from: string; to: string; people: Array<{ userId: string; name: string; declaredCents: number; days: Array<{ day: string; cents: number }> }>; totalCents: number }> {
    if (!DAY.test(from) || !DAY.test(to) || from > to) throw new TipError('Pick a from and a to date.')
    const rows = await db.select().from(barDeclaredTip).where(and(eq(barDeclaredTip.companyId, companyId), gte(barDeclaredTip.businessDay, from), lte(barDeclaredTip.businessDay, to), gte(barDeclaredTip.amountCents, 1))).orderBy(asc(barDeclaredTip.businessDay))
    const people = rows.length ? await db.select({ id: user.id, first: user.firstName, last: user.lastName, email: user.email }).from(user).where(and(eq(user.companyId, companyId), inArray(user.id, [...new Set(rows.map((r) => r.userId))]))) : []
    const nm = new Map(people.map((u) => [u.id, nameOf(u)]))
    const by = new Map<string, { userId: string; name: string; declaredCents: number; days: Array<{ day: string; cents: number }> }>()
    for (const r of rows) {
      const cur = by.get(r.userId) || { userId: r.userId, name: nm.get(r.userId) || '?', declaredCents: 0, days: [] }
      cur.declaredCents += r.amountCents; cur.days.push({ day: r.businessDay, cents: r.amountCents })
      by.set(r.userId, cur)
    }
    const list = [...by.values()].sort((a, b) => a.name.localeCompare(b.name))
    return { from, to, people: list, totalCents: list.reduce((s, p) => s + p.declaredCents, 0) }
  }

  return { getRules, setRules, preview, record, report, mine, positions, declareMine, mineDeclared, listDeclared, declareFor, correctDeclared, declaredByPerson, checkCents: centsOf, setExternalRefresh: (fn: typeof refreshExternal) => { refreshExternal = fn } }
}
export type BarTips = ReturnType<typeof createBarTips>
