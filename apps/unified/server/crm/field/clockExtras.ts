// The clock, finished (Field Service / Basic): what sits around the clock core in tenant-backend time/time.ts.
//
// Settings (company.settings.timeClock — Settings › Time Clock; read by anyone who reads time, changed by company:update):
//   · automatic timekeeping (ServiceTitan's model): "On my way" starts the person's timesheet, or "Arrive/Start" does, and
//     "Complete" ends it. Only the tech who is on the job and tapped the move is clocked, only when nobody is already on the
//     clock, and only a clock the job itself opened is closed by Complete. The moment a phone tapped offline is the time kept.
//   · overtime alerts: a daily and a weekly limit on the business's own clock. A pass every 5 minutes tells the person (and
//     the managers) on their phones when someone is close to a limit and when they reach it, once each, claimed in
//     reminder_log before it is sent. GET /overtime is the same numbers for the office.
//   · kiosk: a shared tablet, signed in by a manager, where each person types their own PIN to clock in/out or take a break.
//     The PIN is the person's user.pin_hash (the same PIN the bar's till uses); five wrong PINs per tablet per ten minutes.
//
// Mounted at /api/time-clock under Time Tracking (no feature id of its own).
import { Hono } from 'hono'
import { z } from 'zod'
import { and, eq, gte, lt, isNotNull, isNull, inArray } from 'drizzle-orm'
import { createTimeClock, companyRowTimeZone, storeDateString, dayMarker } from '@twomiah/tenant-backend'
import { company, user, job, jobAssignee, timeEntry, project, teamMember, reminderLog } from '../../db/schema/index.ts'
import type { AppEnv } from '../../http/env.ts'
import { one, fail } from '../../http/reply.ts'
import { invalid } from '../../http/errors.ts'
import type { CrmDeps } from '../deps.ts'
import type { JobMoment } from '../services.ts'

export type AutomaticMode = 'off' | 'on_my_way' | 'arrive'
export interface ClockSettings {
  automatic: { mode: AutomaticMode }
  overtime: { enabled: boolean; dailyHours: number; weeklyHours: number; warnMinutes: number }
  kiosk: { enabled: boolean }
}
export const DEFAULT_CLOCK_SETTINGS: ClockSettings = {
  automatic: { mode: 'off' },
  overtime: { enabled: false, dailyHours: 8, weeklyHours: 40, warnMinutes: 30 },
  kiosk: { enabled: false },
}
const num = (v: unknown, lo: number, hi: number, fallback: number) => { const n = Number(v); return Number.isFinite(n) && n >= lo && n <= hi ? n : fallback }

/** The business's clock settings with every gap filled in with what the engine really uses. */
export function clockSettings(settings: unknown): ClockSettings {
  let s: any = settings
  if (typeof s === 'string') { try { s = JSON.parse(s) } catch { s = null } }
  const r = s?.timeClock || {}
  const mode = r.automatic?.mode
  return {
    automatic: { mode: mode === 'on_my_way' || mode === 'arrive' ? mode : 'off' },
    overtime: {
      enabled: r.overtime?.enabled === true,
      dailyHours: num(r.overtime?.dailyHours, 1, 24, DEFAULT_CLOCK_SETTINGS.overtime.dailyHours),
      weeklyHours: num(r.overtime?.weeklyHours, 1, 168, DEFAULT_CLOCK_SETTINGS.overtime.weeklyHours),
      warnMinutes: [0, 15, 30, 60].includes(Number(r.overtime?.warnMinutes)) ? Number(r.overtime.warnMinutes) : DEFAULT_CLOCK_SETTINGS.overtime.warnMinutes,
    },
    kiosk: { enabled: r.kiosk?.enabled === true },
  }
}

const settingsSchema = z.object({
  automatic: z.object({ mode: z.enum(['off', 'on_my_way', 'arrive'], { error: 'Pick when the timesheet starts' }) }),
  overtime: z.object({
    enabled: z.boolean(),
    dailyHours: z.number({ error: 'Enter the daily limit in hours' }).min(1, 'At least 1 hour a day').max(24, 'At most 24 hours a day'),
    weeklyHours: z.number({ error: 'Enter the weekly limit in hours' }).min(1, 'At least 1 hour a week').max(168, 'At most 168 hours a week'),
    warnMinutes: z.number().refine((n) => [0, 15, 30, 60].includes(n), { message: 'Warn 0, 15, 30 or 60 minutes ahead' }),
  }),
  kiosk: z.object({ enabled: z.boolean() }),
})

const MANAGERS = new Set(['owner', 'admin', 'manager'])
const round2 = (n: number) => Math.round(n * 100) / 100
const nameOf = (u: { firstName?: string | null; lastName?: string | null; email?: string | null }) => [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email || 'Someone'
const hoursText = (h: number) => `${round2(h)} hour${round2(h) === 1 ? '' : 's'}`

/** Monday of the week a calendar day (YYYY-MM-DD) is in. */
const mondayOf = (ymd: string) => {
  const d = new Date(`${ymd}T00:00:00Z`)
  const back = (d.getUTCDay() + 6) % 7
  d.setUTCDate(d.getUTCDate() - back)
  return d.toISOString().slice(0, 10)
}

export interface Worked { today: number; week: number; onTheClock: boolean; onBreak: boolean }

export function createClockExtras(d: CrmDeps) {
  const { db, audit, logger } = d
  const { requirePermission } = d.permissions
  const clock = createTimeClock({ db, tables: { timeEntry, user, job, project, teamMember }, audit } as any)

  const settingsOf = async (companyId: string) => {
    const [co] = await db.select({ settings: company.settings }).from(company).where(eq(company.id, companyId)).limit(1)
    return clockSettings(co?.settings)
  }

  /** Hours a person has worked today and this week on the business's clock, counting the clock that is open right now. */
  async function workedBy(companyId: string, userIds: string[], tz: string, now = new Date()): Promise<Map<string, Worked>> {
    const out = new Map<string, Worked>()
    if (!userIds.length) return out
    const today = storeDateString(now, tz)
    const rows: any[] = await db.select().from(timeEntry).where(and(
      eq(timeEntry.companyId, companyId), inArray(timeEntry.userId, userIds),
      gte(timeEntry.date, dayMarker(mondayOf(today))), lt(timeEntry.date, new Date(dayMarker(today).getTime() + 86_400_000)),
    ))
    const todayStart = dayMarker(today).getTime()
    for (const id of userIds) out.set(id, { today: 0, week: 0, onTheClock: false, onBreak: false })
    for (const r of rows) {
      const w = out.get(r.userId)!
      let hours = Number(r.hours) || 0
      if (r.clockIn && !r.clockOut) {
        // The open clock: the time since it started, less breaks taken and the one running now.
        const since = new Date(r.clockIn).getTime()
        const running = r.breakStartedAt ? Math.max(0, now.getTime() - new Date(r.breakStartedAt).getTime()) / 60000 : 0
        hours = Math.max(0, (now.getTime() - since) / 60000 - (r.breakMinutes || 0) - running) / 60
        w.onTheClock = true
        w.onBreak = !!r.breakStartedAt
      }
      w.week += hours
      if (new Date(r.date).getTime() >= todayStart) w.today += hours
    }
    for (const w of out.values()) { w.today = round2(w.today); w.week = round2(w.week) }
    return out
  }

  // ── the office's view of overtime ───────────────────────────────────────────────────────────────
  async function overtimeRows(companyId: string, now = new Date()) {
    const [co] = await db.select({ settings: company.settings, timezone: company.timezone, state: company.state, id: company.id }).from(company).where(eq(company.id, companyId)).limit(1)
    const cfg = clockSettings(co?.settings)
    const tz = companyRowTimeZone(co)
    const people: any[] = await db.select({ id: user.id, firstName: user.firstName, lastName: user.lastName, email: user.email }).from(user).where(and(eq(user.companyId, companyId), eq(user.isActive, true)))
    const worked = await workedBy(companyId, people.map((p) => p.id), tz, now)
    const rows = people.map((p) => {
      const w = worked.get(p.id)!
      return {
        userId: p.id, name: nameOf(p), todayHours: w.today, weekHours: w.week, onTheClock: w.onTheClock, onBreak: w.onBreak,
        overDaily: cfg.overtime.enabled && w.today >= cfg.overtime.dailyHours,
        overWeekly: cfg.overtime.enabled && w.week >= cfg.overtime.weeklyHours,
        nearDaily: cfg.overtime.enabled && w.onTheClock && w.today < cfg.overtime.dailyHours && (cfg.overtime.dailyHours - w.today) * 60 <= cfg.overtime.warnMinutes,
        nearWeekly: cfg.overtime.enabled && w.onTheClock && w.week < cfg.overtime.weeklyHours && (cfg.overtime.weeklyHours - w.week) * 60 <= cfg.overtime.warnMinutes,
      }
    }).filter((r) => r.weekHours > 0 || r.onTheClock)
    return { settings: cfg, people: rows.sort((a, b) => b.weekHours - a.weekHours) }
  }

  // ── the alerts ──────────────────────────────────────────────────────────────────────────────────
  async function claim(companyId: string, kind: string, subjectId: string, step: string): Promise<boolean> {
    const fresh = await db.insert(reminderLog).values({ companyId, kind, subjectId, step, status: 'sent' })
      .onConflictDoNothing({ target: [reminderLog.companyId, reminderLog.kind, reminderLog.subjectId, reminderLog.step] }).returning({ id: reminderLog.id })
    return !!fresh[0]
  }

  /** One pass: everyone on the clock who is near or over a limit is told, once per limit per day/week. */
  async function overtimePass(now = new Date()): Promise<{ alerts: number }> {
    let alerts = 0
    const companies: any[] = await db.select({ id: company.id, settings: company.settings, timezone: company.timezone, state: company.state, enabledFeatures: company.enabledFeatures }).from(company)
    for (const co of companies) {
      try {
        if (!((co.enabledFeatures || []) as string[]).includes('time_tracking')) continue
        const cfg = clockSettings(co.settings)
        if (!cfg.overtime.enabled) continue
        const open: any[] = await db.select({ userId: timeEntry.userId }).from(timeEntry)
          .where(and(eq(timeEntry.companyId, co.id), isNotNull(timeEntry.clockIn), isNull(timeEntry.clockOut)))
        if (!open.length) continue
        const tz = companyRowTimeZone(co)
        const ids = [...new Set(open.map((o) => o.userId as string))]
        const worked = await workedBy(co.id, ids, tz, now)
        const people: any[] = await db.select({ id: user.id, firstName: user.firstName, lastName: user.lastName, email: user.email, role: user.role }).from(user).where(and(eq(user.companyId, co.id), eq(user.isActive, true)))
        const managers = people.filter((p) => MANAGERS.has(p.role)).map((p) => p.id as string)
        const today = storeDateString(now, tz)
        const week = mondayOf(today)
        for (const id of ids) {
          const w = worked.get(id)!
          const who = people.find((p) => p.id === id)
          if (!who) continue
          const checks: Array<{ limit: 'daily' | 'weekly'; have: number; cap: number; period: string; label: string }> = [
            { limit: 'daily', have: w.today, cap: cfg.overtime.dailyHours, period: today, label: 'today' },
            { limit: 'weekly', have: w.week, cap: cfg.overtime.weeklyHours, period: week, label: 'this week' },
          ]
          for (const k of checks) {
            const reached = k.have >= k.cap
            const near = !reached && cfg.overtime.warnMinutes > 0 && (k.cap - k.have) * 60 <= cfg.overtime.warnMinutes
            if (!reached && !near) continue
            const step = `${reached ? 'over' : 'near'}:${k.period}`
            if (!(await claim(co.id, `overtime_${k.limit}`, id, step))) continue
            alerts++
            const mine = reached ? `You have worked ${hoursText(k.have)} ${k.label} — that is the ${k.cap}-hour limit.` : `You are close to the ${k.cap}-hour limit ${k.label}: ${hoursText(k.have)} so far.`
            const theirs = reached ? `${nameOf(who)} has reached the ${k.cap}-hour ${k.limit} limit (${hoursText(k.have)} ${k.label}) and is still on the clock.` : `${nameOf(who)} is close to the ${k.cap}-hour ${k.limit} limit (${hoursText(k.have)} ${k.label}).`
            await d.phonePush.send(co.id, [id], { title: reached ? 'Overtime' : 'Almost overtime', body: mine, data: { screen: 'clock' } }).catch(() => 0)
            await d.phonePush.send(co.id, managers.filter((m) => m !== id), { title: reached ? 'Overtime' : 'Almost overtime', body: theirs, data: { screen: 'time' } }).catch(() => 0)
          }
        }
      } catch (err) { logger.warn('[time] overtime pass failed for one company', { error: (err as Error)?.message }) }
    }
    return { alerts }
  }

  // ── automatic timekeeping, from the job's moments ───────────────────────────────────────────────
  const automaticStep: JobMoment = async (kind, ctx) => {
    const { job: j, companyId, userId } = ctx
    if (kind === 'created') return
    const features = await d.features.enabledFeaturesFor(companyId).catch(() => [] as string[])
    if (!features.includes('time_tracking')) return
    const cfg = await settingsOf(companyId)
    if (cfg.automatic.mode === 'off') return
    const at: Date | undefined = (ctx as any).tappedAt ?? undefined
    if (kind === 'dispatched' || kind === 'started') {
      // "On my way" starts the timesheet only when that is the setting; "Arrive/Start" starts it in both.
      if (kind === 'dispatched' && cfg.automatic.mode !== 'on_my_way') return
      // Only the person who is on the job and tapped it: the office dispatching a job does not put the office on the clock.
      const crew: any[] = await db.select({ userId: jobAssignee.userId }).from(jobAssignee).where(eq(jobAssignee.jobId, j.id)).catch(() => [])
      const onIt = j.assignedToId === userId || crew.some((c) => c.userId === userId)
      if (!onIt) return
      const r = await clock.clockIn({ userId, companyId }, { jobId: j.id, at, auto: true, source: 'job', description: `On the clock for ${j.title || 'a job'}` })
      if (!r.ok && r.status !== 409) logger.warn('[time] automatic clock-in not kept', { error: r.error })
      return
    }
    // Paused / resumed: the job's own clock takes a break and ends it (the person's hours stop while they are paused).
    if (kind === 'paused' || kind === 'resumed') {
      const open = await clock.activeEntry(userId, companyId)
      if (!open || open.clockSource !== 'job' || open.jobId !== j.id) return
      const r = kind === 'paused' ? (open.breakStartedAt ? { ok: true } : await clock.startBreak({ userId, companyId }, { at })) : (open.breakStartedAt ? await clock.endBreak({ userId, companyId }, { at }) : { ok: true })
      if (!r.ok) logger.warn('[time] automatic break not kept', { error: (r as any).error })
      return
    }
    if (kind === 'completed') {
      const open = await clock.activeEntry(userId, companyId)
      // Only the clock this job opened: a clock the person started by hand, or for another job, is theirs to close.
      if (!open || open.clockSource !== 'job' || open.jobId !== j.id) return
      const r = await clock.clockOut({ userId, companyId }, { at })
      if (!r.ok) logger.warn('[time] automatic clock-out not kept', { error: r.error })
    }
  }

  // ── kiosk ───────────────────────────────────────────────────────────────────────────────────────
  const attempts = new Map<string, number[]>()
  const WINDOW = 10 * 60 * 1000
  const PIN = /^\d{4,8}$/

  const app = new Hono<AppEnv>()

  app.get('/settings', requirePermission('time:read'), async (c) => one(c, await settingsOf(c.get('user').companyId)))

  app.put('/settings', requirePermission('company:update'), async (c) => {
    const parsed = settingsSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return invalid(c, parsed.error)
    const companyId = c.get('user').companyId
    const [co] = await db.select({ settings: company.settings }).from(company).where(eq(company.id, companyId)).limit(1)
    const settings: any = (typeof co?.settings === 'string' ? JSON.parse(co.settings || '{}') : co?.settings) || {}
    const before = clockSettings(settings)
    const next = clockSettings({ timeClock: parsed.data })
    await db.update(company).set({ settings: { ...settings, timeClock: next }, updatedAt: new Date() } as any).where(eq(company.id, companyId))
    audit.log({ action: audit.ACTIONS.UPDATE, entity: 'company', entityId: companyId, metadata: { timeClock: { before, after: next } }, req: c })
    return one(c, next)
  })

  /** Who is at or near a limit: the office sees everyone; anyone else sees themselves. */
  app.get('/overtime', requirePermission('time:read'), async (c) => {
    const u = c.get('user')
    const r = await overtimeRows(u.companyId)
    return one(c, MANAGERS.has(u.role) ? r : { settings: r.settings, people: r.people.filter((p) => p.userId === u.userId) })
  })

  app.get('/kiosk/pin', requirePermission('time:create'), async (c) => {
    const u = c.get('user')
    const [r] = await db.select({ pinHash: user.pinHash }).from(user).where(and(eq(user.id, u.userId), eq(user.companyId, u.companyId))).limit(1)
    return one(c, { hasPin: !!r?.pinHash })
  })

  app.put('/kiosk/pin', requirePermission('time:create'), async (c) => {
    const u = c.get('user')
    const pin = String((await c.req.json().catch(() => ({})) as any)?.pin ?? '').trim()
    if (!PIN.test(pin)) return fail(c, 400, 'A PIN is 4 to 8 digits.')
    const others: any[] = await db.select({ id: user.id, pinHash: user.pinHash }).from(user).where(and(eq(user.companyId, u.companyId), isNotNull(user.pinHash)))
    for (const o of others) if (o.id !== u.userId && o.pinHash && await Bun.password.verify(pin, o.pinHash)) return fail(c, 409, 'Somebody here already uses that PIN. Pick another.')
    await db.update(user).set({ pinHash: await Bun.password.hash(pin, 'bcrypt'), updatedAt: new Date() }).where(and(eq(user.id, u.userId), eq(user.companyId, u.companyId)))
    audit.log({ action: audit.ACTIONS.UPDATE, entity: 'user', entityId: u.userId, metadata: { pin: 'set' }, req: c })
    return one(c, { hasPin: true })
  })

  app.delete('/kiosk/pin', requirePermission('time:create'), async (c) => {
    const u = c.get('user')
    await db.update(user).set({ pinHash: null, updatedAt: new Date() }).where(and(eq(user.id, u.userId), eq(user.companyId, u.companyId)))
    return one(c, { hasPin: false })
  })

  /**
   * The shared tablet: the person whose PIN this is clocks in or out (or starts/ends a break) — not whoever the tablet is
   * signed in as. The tablet must be signed in by a manager and the business must have switched the kiosk on.
   */
  app.post('/kiosk/punch', requirePermission('time:create'), async (c) => {
    const u = c.get('user')
    if (!MANAGERS.has(u.role)) return fail(c, 403, 'A manager has to sign in on this tablet first.')
    if (!(await settingsOf(u.companyId)).kiosk.enabled) return fail(c, 403, 'The time clock kiosk is switched off. Turn it on in Settings › Time Clock.')
    const body: any = await c.req.json().catch(() => ({}))
    const pin = String(body?.pin ?? '').replace(/\D/g, '')
    if (pin.length < 4) return fail(c, 400, 'Type your PIN.')
    const now = Date.now()
    const tries = (attempts.get(u.userId) || []).filter((x) => now - x < WINDOW)
    if (tries.length >= 5) return fail(c, 429, 'Too many wrong PINs. Wait a few minutes.')
    const rows: any[] = await db.select({ id: user.id, firstName: user.firstName, lastName: user.lastName, email: user.email, pinHash: user.pinHash })
      .from(user).where(and(eq(user.companyId, u.companyId), eq(user.isActive, true), isNotNull(user.pinHash)))
    let who: any = null
    for (const r of rows) if (r.pinHash && await Bun.password.verify(pin, r.pinHash)) { who = r; break }
    if (!who) { tries.push(now); attempts.set(u.userId, tries); return fail(c, 400, "That PIN didn't match anyone.") }
    attempts.delete(u.userId)
    const person = { userId: who.id, companyId: u.companyId }
    const open = await clock.activeEntry(who.id, u.companyId)
    if (body?.break === true) {
      if (!open) return fail(c, 400, `${nameOf(who)} is not clocked in.`)
      const r = open.breakStartedAt ? await clock.endBreak(person) : await clock.startBreak(person)
      if (!r.ok) return fail(c, r.status, r.error)
      return one(c, { name: nameOf(who), action: open.breakStartedAt ? 'break_end' : 'break_start' })
    }
    const r = open ? await clock.clockOut(person) : await clock.clockIn(person, { description: 'Time clock kiosk', source: 'kiosk' })
    if (!r.ok) return fail(c, r.status, r.error)
    if (r.discarded) return one(c, { name: nameOf(who), action: 'discarded', message: r.message })
    return one(c, { name: nameOf(who), action: open ? 'out' : 'in', hours: open ? Number((r as any).entry.hours) : 0 })
  })

  return { routes: app, overtimePass, overtimeRows, automaticStep, workedBy }
}
