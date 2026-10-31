// Sales-driven labor forecast beside the schedule (restaurant-bar parity #9, bar_labor_forecast; 7shifts / Toast labor planning).
//   · pure, with known numbers: the same-weekday, same-clock-hour average, its sample size, "not enough history" instead of a number, a closed
//     day not counting as a day of no sales, hours after midnight belonging to the night before, and the staffing that fits a target labor %;
//   · on the real server: the register's paid checks (gift cards sold left out) become the week's forecast, booked events are listed apart, and
//     the suggested hours per position sit beside the hours on the schedule.
import { describe, test, expect, beforeAll, afterAll, setSystemTime } from 'bun:test'
import { bootFood } from './foodKit.ts'
import { DEFAULT_TARGET_LABOR_PCT, forecastDay, salesGrid, staffingFor, targetPctRefusal, type SaleAt } from '../server/crm/bar/barSchedulePlan.ts'
import { businessDayOf } from '../server/crm/bar/barLive.ts'
import { FEATURE_MAP } from '@twomiah/tenant-backend'

const TZ = 'America/Chicago'
// A Chicago wall-clock moment in October 2026 (CDT, UTC-5).
const at = (day: number, hhmm: string) => new Date(`2026-10-${String(day).padStart(2, '0')}T${hhmm}:00-05:00`)
const gridOf = (sales: SaleAt[]) => salesGrid(sales, TZ, (d) => businessDayOf(d, TZ))

describe('sales by day and hour (pure)', () => {
  // Fridays the 9th, 16th and 23rd; the 30th is "today" and not over.
  const sales: SaleAt[] = [
    { at: at(9, '18:30'), cents: 12000 }, { at: at(9, '19:10'), cents: 18000 }, { at: at(10, '00:30'), cents: 8000 },   // Fri 9th: 38000 (the 00:30 is Friday night's)
    { at: at(16, '18:05'), cents: 14000 }, { at: at(16, '19:45'), cents: 22000 },                                       // Fri 16th: 36000
    { at: at(23, '18:20'), cents: 7500 }, { at: at(23, '19:00'), cents: 20000 }, { at: at(24, '00:30'), cents: 5000 },  // Fri 23rd: 32500
    { at: at(30, '18:00'), cents: 99999 },                                                                              // today: never a sample
  ]
  const grid = gridOf(sales)
  test('hours after midnight belong to the night before, on the company clock', () => {
    expect([...grid.get('2026-10-09')!].sort()).toEqual([[0, 8000], [18, 12000], [19, 18000]])
  })
  test('the mean of the same weekday and clock hour, with the number of days it was made from', () => {
    const f = forecastDay(grid, '2026-11-06', '2026-10-30', 4)
    expect(f.sampleDays).toEqual(['2026-10-23', '2026-10-16', '2026-10-09'])
    expect(f.samples).toBe(3); expect(f.weeksLookedBack).toBe(4); expect(f.notEnoughHistory).toBe(false)
    // 18h: (7500 + 14000 + 12000) / 3; 19h: (20000 + 22000 + 18000) / 3; 0h: (5000 + 0 + 8000) / 3. The bar's hours run 4 AM to 3 AM.
    expect(f.hours).toEqual([{ hour: 18, cents: 11167 }, { hour: 19, cents: 20000 }, { hour: 20, cents: 0 }, { hour: 21, cents: 0 }, { hour: 22, cents: 0 }, { hour: 23, cents: 0 }, { hour: 0, cents: 4333 }])
    expect(f.totalCents).toBe(35500)                       // (32500 + 36000 + 38000) / 3
  })
  test('with too few days there is no number, and the words say how many there were', () => {
    const f = forecastDay(grid, '2026-11-06', '2026-10-30', 2)       // only the 23rd and the 16th: two is enough
    expect(f.samples).toBe(2); expect(f.totalCents).toBe(34250)
    const one = forecastDay(gridOf([{ at: at(24, '19:00'), cents: 5000 }]), '2026-11-07', '2026-10-30', 4)
    expect(one).toMatchObject({ samples: 1, totalCents: null, hours: [], notEnoughHistory: true })
    expect(one.reason).toBe('Not enough history: 1 of the last 4 same weekdays had sales, and at least 2 are needed.')
    expect(forecastDay(new Map(), '2026-11-07', '2026-10-30', 4).samples).toBe(0)
  })
  test('a day the register took nothing (shut) is not a day of zero sales; the day being planned and today are never samples', () => {
    const sparse = gridOf(sales.filter((s) => s.at.getDate() !== 16))           // the 16th was shut
    const f = forecastDay(sparse, '2026-11-06', '2026-10-30', 4)
    expect(f.sampleDays).toEqual(['2026-10-23', '2026-10-09']); expect(f.totalCents).toBe(35250)   // (32500 + 38000) / 2, not / 3
    expect(forecastDay(grid, '2026-10-30', '2026-10-30', 4).sampleDays).toEqual(['2026-10-23', '2026-10-16', '2026-10-09'])
    expect(forecastDay(grid, '2026-10-23', '2026-10-30', 1).sampleDays).toEqual(['2026-10-16'])
    // Planning a week ahead does not spend a week of the look-back on Friday the 30th, which has not happened: two weeks back from the 6th is the 23rd and the 16th.
    expect(forecastDay(grid, '2026-11-06', '2026-10-30', 2).sampleDays).toEqual(['2026-10-23', '2026-10-16'])
  })
})

describe('staffing that fits the target labor percent (pure)', () => {
  const history = [{ position: 'Bar', hours: 24, avgWageCents: 1500 }, { position: 'Bar back', hours: 8, avgWageCents: 1200 }, { position: 'Floor', hours: 10, avgWageCents: null }]
  test('hours per position from sales × target at the pay of the people who work it, split as the hours were', () => {
    const s = staffingFor(35500, 30, history)!
    expect(s.budgetCents).toBe(10650); expect(s.blendedWageCents).toBe(1425)       // (24 × 1500 + 8 × 1200) / 32
    expect(s.totalHours).toBe(7.5)                                                  // 10650 / 1425 = 7.47 → quarter hours
    expect(s.positions).toEqual([{ position: 'Bar', hours: 5.5 }, { position: 'Bar back', hours: 1.75 }])   // a position with no pay on file is left out, not guessed
    expect(staffingFor(35500, 40, history)!.budgetCents).toBe(14200)
  })
  test('nothing to suggest without a sales number or a pay to go on', () => {
    expect(staffingFor(null, 30, history)).toBeNull()
    expect(staffingFor(35500, 30, [])).toBeNull()
    expect(staffingFor(35500, 30, [{ position: 'Bar', hours: 10, avgWageCents: null }])).toBeNull()
  })
  test('what a venue may set', () => {
    for (const ok of [5, 27.5, 30, 80, '30']) expect(targetPctRefusal(ok)).toBeNull()
    for (const bad of [4, 81, 27.3, 'x', null, '', true]) expect(targetPctRefusal(bad)).not.toBeNull()
    expect(DEFAULT_TARGET_LABOR_PCT).toBe(30)
  })
})

let k: Awaited<ReturnType<typeof bootFood>>
const ON = ['contacts', 'bar_menu', 'bar_register', 'bar_schedule', 'time_tracking']
const ins = async (table: any, values: any) => ((await k.t.db.insert(table).values(values).returning()) as any[])[0]
const FRI = '2026-11-06', SAT = '2026-11-07', WEEK = '2026-11-02'

describe('the week\'s forecast on the real server', () => {
  beforeAll(async () => {
    setSystemTime(new Date('2026-10-30T03:30:00Z'))   // 10:30 PM Thursday the 29th in Eau Claire
    k = await bootFood({ features: ON })
    const wk = { mon: [{ open: '16:00', close: '02:00' }], tue: [{ open: '16:00', close: '02:00' }], wed: [{ open: '16:00', close: '02:00' }], thu: [{ open: '16:00', close: '02:00' }], fri: [{ open: '16:00', close: '02:00' }], sat: [{ open: '16:00', close: '02:00' }] }
    await ins(k.S.barSettings, { companyId: k.companyId, hours: { timezone: TZ, bar: wk, kitchen: wk, holidays: [] } })
    // The register's history: Fridays the 9th, 16th, 23rd (a gift card sold on the 23rd is not sales); Saturday only the 24th.
    let n = 0
    const check = async (when: Date, subtotalCents: number, card = 0) => {
      const c = await ins(k.S.barCheck, { companyId: k.companyId, number: ++n, kind: 'walkup', label: 'Walk-up', status: 'paid', subtotalCents, totalCents: subtotalCents, tipCents: 0, openedAt: when, closedAt: when })
      if (card) await ins(k.S.barCheckItem, { companyId: k.companyId, checkId: c.id, name: 'Gift card', qty: 1, unitPriceCents: card, kind: 'giftcard', state: 'sent' })
    }
    for (const [w, c] of [[at(9, '18:30'), 12000], [at(9, '19:10'), 18000], [at(10, '00:30'), 8000], [at(16, '18:05'), 14000], [at(16, '19:45'), 22000], [at(23, '18:20'), 10000], [at(23, '19:00'), 20000], [at(24, '00:30'), 5000]] as Array<[Date, number]>) await check(w, c, c === 10000 ? 2500 : 0)
    await check(at(24, '19:00'), 5000)
    // Pay and past positions: the bartender $15 on the bar, the manager $12 behind it, six and two hours every Friday of the four before.
    await ins(k.S.teamMember, { companyId: k.companyId, name: 'Bartender Seat', email: 'bartender@bar.test', hourlyRate: '15.00' })
    await ins(k.S.teamMember, { companyId: k.companyId, name: 'Manager Seat', email: 'manager@bar.test', hourlyRate: '12.00' })
    for (const d of ['2026-10-09', '2026-10-16', '2026-10-23', '2026-10-30']) {
      await ins(k.S.barScheduleShift, { companyId: k.companyId, userId: k.ids.bartender, day: d, start: '17:00', end: '23:00', position: 'Bar' })
      await ins(k.S.barScheduleShift, { companyId: k.companyId, userId: k.ids.manager, day: d, start: '17:00', end: '19:00', position: 'Bar back' })
    }
    // This week: Friday's schedule, and a confirmed event and a tentative one.
    await ins(k.S.barScheduleShift, { companyId: k.companyId, userId: k.ids.bartender, day: FRI, start: '17:00', end: '23:00', position: 'Bar' })
    await ins(k.S.barScheduleShift, { companyId: k.companyId, userId: k.ids.manager, day: FRI, start: '17:00', end: '21:00', position: 'Bar back' })
    await ins(k.S.event, { companyId: k.companyId, name: 'Rehearsal dinner', status: 'confirmed', eventDate: FRI, startTime: '18:00', endTime: '21:00', guestCount: 40, quotedTotal: '2400.00' })
    await ins(k.S.event, { companyId: k.companyId, name: 'Maybe party', status: 'tentative', eventDate: FRI, startTime: '19:00', guestCount: 10, quotedTotal: '500.00' })
  }, 60_000)
  afterAll(() => { k.restore(); setSystemTime() })

  test('the feature id is registered hidden; the forecast is closed until it is on and for anyone without bar:update', async () => {
    const f = (FEATURE_MAP as any)['bar_labor_forecast'] || (FEATURE_MAP as any).get?.('bar_labor_forecast')
    expect(f).toBeTruthy(); expect(f.hidden).toBe(true)
    expect((await k.M('GET', `/api/schedule/labor-forecast?day=${FRI}`)).status).toBe(403)
    await k.features([...ON, 'bar_labor_forecast'])
    expect((await k.B('GET', `/api/schedule/labor-forecast?day=${FRI}`)).status).toBe(403)
    expect((await k.B('PUT', '/api/schedule/labor-forecast/settings', { targetPct: 25 })).status).toBe(403)
    expect((await k.M('GET', `/api/schedule/labor-forecast?day=${FRI}`)).status).toBe(200)
  })

  test('Friday: sales by hour from the register, the sample size, booked events apart, and the hours that fit 30% beside the schedule', async () => {
    const r = (await k.M('GET', `/api/schedule/labor-forecast?day=${FRI}`)).json
    expect(r.weekStart).toBe(WEEK); expect(r.asOfDay).toBe('2026-10-29'); expect(r.settings).toEqual({ targetPct: 30, weeks: 4 })
    const fri = r.days.find((d: any) => d.day === FRI)
    expect(fri.forecast).toMatchObject({ samples: 3, weeksLookedBack: 4, totalCents: 35500, notEnoughHistory: false, sampleDays: ['2026-10-23', '2026-10-16', '2026-10-09'] })
    expect(fri.forecast.hours.find((h: any) => h.hour === 18).cents).toBe(11167)         // the gift card sold is not sales: (7500 + 14000 + 12000) / 3
    expect(fri.forecast.hours.find((h: any) => h.hour === 0).cents).toBe(4333)
    // Events are listed, the confirmed one only, and not added to the sales.
    expect(fri.events).toEqual([{ id: expect.any(String), name: 'Rehearsal dinner', startTime: '18:00', endTime: '21:00', guests: 40, quotedCents: 240000 }])
    // 35500 × 30% = 10650 at $14.25 an hour = 7.5 hours: Bar 5.5, Bar back 1.75. The schedule has Bar 6 and Bar back 4.
    expect(fri.staffing.budgetCents).toBe(10650); expect(fri.staffing.totalHours).toBe(7.5)
    expect(fri.staffing.positions).toEqual([
      { position: 'Bar', suggestedHours: 5.5, scheduledHours: 6, differenceHours: 0.5 },
      { position: 'Bar back', suggestedHours: 1.75, scheduledHours: 4, differenceHours: 2.25 },
    ])
    expect(fri.scheduledWagesCents).toBe(6 * 1500 + 4 * 1200)                              // 13800
    expect(fri.laborPct).toBe(38.9)                                                         // 13800 / 35500
  })

  test('Saturday has one past Saturday: no number, and it says so; the week total waits for every open day', async () => {
    const r = (await k.M('GET', `/api/schedule/labor-forecast?day=${FRI}`)).json
    const sat = r.days.find((d: any) => d.day === SAT)
    expect(sat.forecast).toMatchObject({ samples: 1, totalCents: null, notEnoughHistory: true })
    expect(sat.forecast.reason).toContain('Not enough history'); expect(sat.staffing).toBeNull()
    const sun = r.days.find((d: any) => d.day === '2026-11-08')
    expect(sun.open).toBe(false); expect(sun.forecast).toBeNull()                           // the bar is shut Sundays: no forecast, no invented zero
    expect(r.totals).toMatchObject({ salesCents: null, daysOpen: 6, daysKnown: 1, budgetCents: null, laborPct: null })
  })

  test('the target and the weeks looked back are the venue\'s to set, and change the answer', async () => {
    for (const bad of [{ targetPct: 3 }, { targetPct: 'x' }, { weeks: 1 }, { weeks: 9 }, { weeks: 2.5 }]) expect((await k.M('PUT', '/api/schedule/labor-forecast/settings', bad)).status).toBe(400)
    expect((await k.M('PUT', '/api/schedule/labor-forecast/settings', { targetPct: 40 })).json.settings).toEqual({ targetPct: 40, weeks: 4 })
    const fri = (await k.M('GET', `/api/schedule/labor-forecast?day=${FRI}`)).json.days.find((d: any) => d.day === FRI)
    expect(fri.staffing.budgetCents).toBe(14200)
    await k.M('PUT', '/api/schedule/labor-forecast/settings', { targetPct: 30, weeks: 2 })
    const two = (await k.M('GET', `/api/schedule/labor-forecast?day=${FRI}`)).json.days.find((d: any) => d.day === FRI)
    expect(two.forecast).toMatchObject({ samples: 2, weeksLookedBack: 2, totalCents: 34250 })     // the 23rd and the 16th: (32500 + 36000) / 2
    await k.M('PUT', '/api/schedule/labor-forecast/settings', { weeks: 4 })
  })
})
