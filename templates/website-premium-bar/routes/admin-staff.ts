/**
 * routes/admin-staff.ts — hours for payroll, under /api/admin/staff-hours
 * (admin role: rates and pay are the owner's business).
 *
 *   GET   /?start=YYYY-MM-DD          a pay period: hours (regular/overtime by workweek), tips, est. wages, labor %
 *   GET   /export.csv?start=          the same, one row per person, for the payroll service
 *   PUT   /settings                   { weekStart 0-6, periodDays 7|14, anchor }
 *   PATCH /people/:pinId              { clocksIn, hourlyCents }
 *   POST  /shifts                     { pinId, startAt, endAt, note }   a shift nobody punched
 *   PATCH /shifts/:id                 { startAt, endAt, note }          fix a punch (originals kept)
 *   POST  /shifts/:id/void            { note }
 *
 * We report hours and tips. Pay, deposits and tax filing are the payroll service's job.
 */
import { Hono } from 'hono'
import { db } from '../db'
import { barTimezone, businessDayOf } from '../lib/register/reports'
import { payrollCsv, periodFor } from '../lib/staff/hours'
import { ClockError, addShift, editShift, loadPayrollConfig, savePayrollConfig, setPerson, timesheet, voidShift } from '../lib/staff/timeclock'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DAY = /^\d{4}-\d{2}-\d{2}$/

export function staffHoursRoutes(auth: any, requireAdmin: any, audit: (c: any, e: { action: string; target?: string; meta?: any }) => Promise<void>) {
  const app = new Hono<any>()
  const who = (c: any) => String(c.get('userEmail') || 'admin')
  const body = async (c: any) => (await c.req.json().catch(() => ({}))) as Record<string, any>
  const run = async (c: any, fn: () => Promise<unknown>) => {
    try { c.header('Cache-Control', 'no-store'); return c.json(await fn()) } catch (e) {
      if (e instanceof ClockError) return c.json({ error: e.message }, e.status as any)
      throw e
    }
  }
  /** The period holding ?start= (or today's), always aligned to whole workweeks. */
  const period = async (c: any) => {
    const cfg = await loadPayrollConfig(db)
    const q = String(c.req.query('start') || '')
    const day = DAY.test(q) ? q : businessDayOf(new Date(), await barTimezone(db))
    return periodFor(day, cfg)
  }
  const g = [auth, requireAdmin] as const

  app.get('/', ...g, async (c) => run(c, async () => { const p = await period(c); return timesheet(db, p.start, p.end) }))
  app.get('/export.csv', ...g, async (c) => {
    const p = await period(c)
    const t = await timesheet(db, p.start, p.end)
    await audit(c, { action: 'payroll.export', target: p.start, meta: { people: t.people.length, openShifts: t.openShifts } })
    c.header('Content-Type', 'text/csv; charset=utf-8')
    c.header('Content-Disposition', `attachment; filename="hours-${p.start}.csv"`)
    c.header('Cache-Control', 'no-store')
    return c.body(payrollCsv(t.people.filter(x => x.total > 0 || x.cashTipsCents || x.cardTipsCents), p))
  })
  app.put('/settings', ...g, async (c) => { const b = await body(c); return run(c, async () => ({ config: await savePayrollConfig(db, b) })) })
  app.patch('/people/:pinId', ...g, async (c) => {
    const id = c.req.param('pinId')
    if (!UUID.test(id)) return c.json({ error: 'Which person?' }, 400)
    const b = await body(c)
    return run(c, async () => {
      const person = await setPerson(db, id, b)
      await audit(c, { action: 'staff.person', target: person.label, meta: { clocksIn: person.clocksIn, rateSet: person.hourlyCents !== null } })
      return { person }
    })
  })
  app.post('/shifts', ...g, async (c) => {
    const b = await body(c)
    return run(c, async () => { const shift = await addShift(db, b, who(c)); await audit(c, { action: 'timeclock.add', target: shift.id, meta: { note: b.note } }); return { shift } })
  })
  app.patch('/shifts/:id', ...g, async (c) => {
    const id = c.req.param('id')
    if (!UUID.test(id)) return c.json({ error: 'Which shift?' }, 400)
    const b = await body(c)
    return run(c, async () => { const shift = await editShift(db, id, b, who(c)); await audit(c, { action: 'timeclock.edit', target: id, meta: { note: b.note } }); return { shift } })
  })
  app.post('/shifts/:id/void', ...g, async (c) => {
    const id = c.req.param('id')
    if (!UUID.test(id)) return c.json({ error: 'Which shift?' }, 400)
    const b = await body(c)
    return run(c, async () => { const shift = await voidShift(db, id, b.note, who(c)); await audit(c, { action: 'timeclock.void', target: id, meta: { note: b.note } }); return { shift } })
  })
  return app
}
