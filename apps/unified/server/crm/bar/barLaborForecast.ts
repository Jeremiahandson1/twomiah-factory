// Sales-driven labor forecast beside the schedule (restaurant-bar parity #9, bar_labor_forecast; 7shifts' and Toast's labor-vs-sales planning).
//
//   · SALES by day and hour: the trailing same-weekday, same-clock-hour average from the register's paid checks, with the number of days it was
//     made from shown, and "not enough history" in place of a number when there are too few (barSchedulePlan.ts forecastDay holds the rule).
//   · BOOKED EVENTS (confirmed private events, the events module) are listed on their day with their guests and quoted total. They are NOT added
//     into the average: past events that were rung on the register are already in it, and ones that were not are not, so adding would count some
//     twice. A manager reads them beside the number.
//   · STAFFING per position: hours that fit forecast sales × the venue's target labor percent at the pay of the people who work each position, split
//     the way the last weeks' schedules split the hours, shown against the hours now on the schedule. Nothing is scheduled by it.
import { and, asc, eq, gte, inArray, isNotNull, lt } from 'drizzle-orm'
import { barCheck, barCheckItem, barScheduleShift, company, event } from '../../db/schema/index.ts'
import { addDays, localToUtc } from './barHours.ts'
import { businessDayOf, type BarLive } from './barLive.ts'
import { closeOn, DEFAULT_FORECAST_WEEKS, DEFAULT_TARGET_LABOR_PCT, forecastDay, hoursOf, MAX_FORECAST_WEEKS, MIN_FORECAST_WEEKS, openOn, salesGrid, staffingFor, targetPctRefusal, type PositionHistory, type SaleAt } from './barSchedulePlan.ts'
import { RotaError, type BarSchedule } from './barSchedule.ts'
import type { BarDb } from './db.ts'

export interface LaborSettings { targetPct: number; weeks: number }

export function createBarLaborForecast(deps: { db: BarDb; live: BarLive; schedule: BarSchedule; now?: () => Date }) {
  const { db, live, schedule } = deps
  const now = () => (deps.now ? deps.now() : new Date())

  async function getSettings(companyId: string): Promise<LaborSettings> {
    const [co] = await db.select({ settings: company.settings }).from(company).where(eq(company.id, companyId)).limit(1)
    const s = ((co?.settings as any)?.laborForecast || {}) as any
    const pct = Number(s.targetPct), weeks = Number(s.weeks)
    return {
      targetPct: Number.isFinite(pct) && !targetPctRefusal(pct) ? pct : DEFAULT_TARGET_LABOR_PCT,
      weeks: Number.isInteger(weeks) && weeks >= MIN_FORECAST_WEEKS && weeks <= MAX_FORECAST_WEEKS ? weeks : DEFAULT_FORECAST_WEEKS,
    }
  }

  async function setSettings(companyId: string, b: any): Promise<{ before: LaborSettings; settings: LaborSettings }> {
    const before = await getSettings(companyId)
    const next = { ...before }
    if (b?.targetPct !== undefined) {
      const why = targetPctRefusal(b.targetPct)
      if (why) throw new RotaError(why)
      next.targetPct = Number(b.targetPct)
    }
    if (b?.weeks !== undefined) {
      const w = Number(b.weeks)
      if (!Number.isInteger(w) || w < MIN_FORECAST_WEEKS || w > MAX_FORECAST_WEEKS) throw new RotaError(`Look back ${MIN_FORECAST_WEEKS} to ${MAX_FORECAST_WEEKS} weeks.`)
      next.weeks = w
    }
    const [co] = await db.select({ settings: company.settings }).from(company).where(eq(company.id, companyId)).limit(1)
    await db.update(company).set({ settings: { ...((co?.settings as any) || {}), laborForecast: next }, updatedAt: new Date() }).where(eq(company.id, companyId))
    return { before, settings: next }
  }

  /** Net sales (subtotal less gift cards sold) of every paid check closed from `from` to `to`. */
  async function salesBetween(companyId: string, from: Date, to: Date): Promise<SaleAt[]> {
    const rows = await db.select({ id: barCheck.id, closedAt: barCheck.closedAt, sub: barCheck.subtotalCents }).from(barCheck)
      .where(and(eq(barCheck.companyId, companyId), eq(barCheck.status, 'paid'), gte(barCheck.closedAt, from), lt(barCheck.closedAt, to)))
    const cards = rows.length ? await db.select({ checkId: barCheckItem.checkId, qty: barCheckItem.qty, unit: barCheckItem.unitPriceCents, state: barCheckItem.state })
      .from(barCheckItem).where(and(eq(barCheckItem.companyId, companyId), eq(barCheckItem.kind, 'giftcard'), inArray(barCheckItem.checkId, rows.map((r) => r.id)))) : []
    const cardOf = new Map<string, number>()
    for (const c of cards) if (c.state !== 'void') cardOf.set(c.checkId, (cardOf.get(c.checkId) || 0) + c.qty * c.unit)
    return rows.filter((r) => r.closedAt).map((r) => ({ at: r.closedAt as Date, cents: (r.sub || 0) - (cardOf.get(r.id) || 0) }))
  }

  /** The week of `day` (the schedule's Monday week): each day's sales by hour, its booked events, and the staffing that fits the target. */
  async function week(companyId: string, dayIn?: string | null) {
    const { start, days, tz } = await schedule.weekFor(companyId, dayIn)
    const settings = await getSettings(companyId)
    const hoursCfg = await live.hoursFor(companyId)
    const asOfDay = businessDayOf(now(), tz)
    // History: every sample date any day of this week can use (the last `weeks` same weekdays that are over), up to the start of today's business day.
    const earliest = [addDays(days[0], -7 * settings.weeks), addDays(asOfDay, -7 * settings.weeks - 7)].sort()[0]
    const sales = await salesBetween(companyId, localToUtc(earliest, '04:00', tz), localToUtc(asOfDay, '04:00', tz))
    const grid = salesGrid(sales, tz, (at) => businessDayOf(at, tz))

    const [shifts, past, events] = await Promise.all([
      db.select().from(barScheduleShift).where(and(eq(barScheduleShift.companyId, companyId), inArray(barScheduleShift.day, days))).orderBy(asc(barScheduleShift.day), asc(barScheduleShift.start)),
      db.select().from(barScheduleShift).where(and(eq(barScheduleShift.companyId, companyId), gte(barScheduleShift.day, addDays(start, -7 * settings.weeks)), lt(barScheduleShift.day, start), isNotNull(barScheduleShift.position))),
      db.select({ id: event.id, name: event.name, day: event.eventDate, startTime: event.startTime, endTime: event.endTime, guests: event.guestCount, guestsFinal: event.guestCountFinal, quoted: event.quotedTotal })
        .from(event).where(and(eq(event.companyId, companyId), eq(event.status, 'confirmed'), inArray(event.eventDate, days))).orderBy(asc(event.startTime)),
    ])
    const rates = await schedule.ratesByUserId(companyId, [...new Set([...shifts, ...past].map((s) => s.userId))])
    const rateCents = (userId: string) => (rates[userId] != null ? Math.round(rates[userId] * 100) : null)

    // What each position has been scheduled for lately, and its pay (weighted by hours, only those with a rate on file).
    const byPos = new Map<string, { hours: number; paid: number; ratedHours: number }>()
    for (const s of past) {
      const h = hoursOf(s, tz), r = rateCents(s.userId)
      const cur = byPos.get(s.position!) ?? { hours: 0, paid: 0, ratedHours: 0 }
      cur.hours += h
      if (r !== null) { cur.paid += h * r; cur.ratedHours += h }
      byPos.set(s.position!, cur)
    }
    const history: PositionHistory[] = [...byPos].map(([position, v]) => ({ position, hours: v.hours, avgWageCents: v.ratedHours > 0 ? Math.round(v.paid / v.ratedHours) : null }))

    const dayRows = days.map((day) => {
      const open = closeOn(hoursCfg, day) !== null && openOn(hoursCfg, day) !== null
      const f = forecastDay(grid, day, asOfDay, settings.weeks)
      const staffing = open ? staffingFor(f.totalCents, settings.targetPct, history) : null
      const mine = shifts.filter((s) => s.day === day)
      const scheduledByPos = new Map<string, number>()
      let wages: number | null = 0
      for (const s of mine) {
        const h = hoursOf(s, tz)
        scheduledByPos.set(s.position || '', (scheduledByPos.get(s.position || '') || 0) + h)
        const r = rateCents(s.userId)
        wages = wages === null || r === null ? null : wages + Math.round(h * r)
      }
      const positions = new Set([...(staffing?.positions.map((p) => p.position) || []), ...[...scheduledByPos.keys()]])
      return {
        day, open,
        forecast: open ? f : null,
        events: events.filter((e) => e.day === day).map((e) => ({ id: e.id, name: e.name, startTime: e.startTime, endTime: e.endTime, guests: e.guestsFinal ?? e.guests, quotedCents: e.quoted == null ? null : Math.round(Number(e.quoted) * 100) })),
        staffing: staffing && {
          budgetCents: staffing.budgetCents, totalHours: staffing.totalHours,
          positions: [...positions].sort().map((position) => {
            const suggested = staffing.positions.find((p) => p.position === position)?.hours ?? null
            const scheduled = Math.round((scheduledByPos.get(position) || 0) * 100) / 100
            return { position: position || 'No position', suggestedHours: suggested, scheduledHours: scheduled, differenceHours: suggested === null ? null : Math.round((scheduled - suggested) * 100) / 100 }
          }),
        },
        scheduledHours: Math.round([...scheduledByPos.values()].reduce((s, h) => s + h, 0) * 100) / 100,
        scheduledWagesCents: mine.length ? wages : 0,
        laborPct: open && f.totalCents && wages !== null ? Math.round((wages / f.totalCents) * 1000) / 10 : null,
      }
    })
    const openRows = dayRows.filter((r) => r.open)
    const known = openRows.filter((r) => r.forecast && !r.forecast.notEnoughHistory)
    const complete = openRows.length > 0 && known.length === openRows.length
    const weekSales = complete ? known.reduce((s, r) => s + (r.forecast!.totalCents as number), 0) : null
    const wagesAll = dayRows.every((r) => r.scheduledWagesCents !== null) ? dayRows.reduce((s, r) => s + (r.scheduledWagesCents as number), 0) : null
    return {
      weekStart: start, asOfDay, settings, minSamples: MIN_FORECAST_WEEKS,
      days: dayRows,
      totals: {
        salesCents: weekSales, daysKnown: known.length, daysOpen: openRows.length,
        budgetCents: weekSales === null ? null : Math.round((weekSales * settings.targetPct) / 100),
        scheduledWagesCents: wagesAll,
        laborPct: weekSales && wagesAll !== null ? Math.round((wagesAll / weekSales) * 1000) / 10 : null,
      },
      notes: [
        'Sales are the register\'s average for the same weekday and hour. Booked events are listed on their day and are not added to it.',
        'Staffing is the hours that fit your target labor percent at the pay of the people who work each position, split as the last weeks\' schedules were. It is a guide to a budget, not a minimum crew, and it ignores overtime.',
        ...(history.length === 0 ? ['Give shifts a position, and put an hourly pay on each person\'s Team card, and the staffing suggestion appears.'] : []),
      ],
    }
  }

  return { getSettings, setSettings, week }
}
export type BarLaborForecast = ReturnType<typeof createBarLaborForecast>
