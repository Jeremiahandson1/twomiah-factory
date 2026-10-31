// Home care parity row 18 (docs/parity/homecare-pickup-rewards.md): the pickup bonus on an open shift paid through the pay run, a points scheme
// (extra shift, on-time clock-in, weekly minimum hours) redeemable for rewards, and hours wanted saved by the caregiver. Behind
// care_pickup_rewards.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { createHomecareCore } from '../server/crm/homecare/core/index.ts'
import { addDays, sundayOfWeek } from '../server/crm/homecare/core/agencyTime.ts'
import { sanitizeRules, isOnTime, weeksMeetingMinimum, kindLabel, DEFAULT_RULES } from '../server/crm/homecare/core/pickupRewards.ts'
import { bonusNotInFile } from '../server/crm/homecare/payroll/pickupBonusFiles.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId = ''
let core: ReturnType<typeof createHomecareCore>
let W = ''      // the Sunday that starts last week: a week wholly in the past
let day1 = '', day2 = ''
const tokens: Record<string, string> = {}
const ids: Record<string, string> = {}
const login = async (email: string, password: string) =>
  (await (await t.call('/api/auth/login', { method: 'POST', json: { email, password } })).json()).accessToken as string
const send = async (who: string, method: string, path: string, body?: any) => {
  const r = await t.call(path, { method, headers: { Authorization: `Bearer ${tokens[who]}` }, ...(body !== undefined ? { json: body } : {}) })
  const text = await r.text()
  let parsed: any = null
  try { parsed = JSON.parse(text) } catch { /* a file */ }
  return { status: r.status, body: parsed, text }
}
const ins = async (table: any, values: any) => ((await t.db.insert(table).values(values).returning()) as any[])[0]
const BASE = ['contacts', 'scheduling', 'team']
const setFeatures = async (list: string[]) => {
  await t.db.update(t.schema.company).set({ enabledFeatures: list } as any).where(eq(t.schema.company.id, companyId))
  t.services.features.forgetFeatures()
}
const calc = async () => (await send('owner', 'POST', '/api/payroll/calculate', { startDate: W, endDate: addDays(W, 6) })).body.payroll.find((l: any) => l.caregiverId === ids.ann)

beforeAll(async () => {
  t = await bootTenant({ vertical: 'homecare' })
  const seeded = await seedOwner(t)
  companyId = seeded.company.id
  await t.db.update(t.schema.company).set({ timezone: 'America/Chicago' } as any).where(eq(t.schema.company.id, companyId))
  core = createHomecareCore({ services: t.services.crm } as any)
  const today = await core.time.today(companyId)
  W = addDays(sundayOfWeek(today), -7)
  day1 = addDays(W, 1); day2 = addDays(W, 2)
  tokens.owner = await login('owner@test.example', seeded.password)
  const hash = await Bun.password.hash('Caregiver-pass-1', 'bcrypt')
  ids.ann = (await ins(t.schema.user, { email: 'ann@test.example', passwordHash: hash, firstName: 'Ann', lastName: 'Carer', role: 'caregiver', companyId, defaultPayRate: '20.00' })).id
  ids.bea = (await ins(t.schema.user, { email: 'bea@test.example', passwordHash: hash, firstName: 'Bea', lastName: 'Other', role: 'caregiver', companyId, defaultPayRate: '20.00' })).id
  tokens.ann = await login('ann@test.example', 'Caregiver-pass-1')
  ids.pat = (await ins(t.schema.clients, { companyId, firstName: 'Pat', lastName: 'Client', isActive: true, isPrivatePay: true })).id
  await setFeatures([...BASE, 'care_pickup_rewards'])
  // The open shift Ann takes on day 1, with a $25.00 bonus: first to accept, so it lands on her schedule at once.
  ids.shift = (await ins(t.schema.openShifts, { companyId, clientId: ids.pat, date: day1, startTime: '09:00:00', endTime: '11:00:00', status: 'open', bonusAmount: '25.00', autoAssign: true, createdById: seeded.owner.id })).id
}, 90_000)

describe('the rules are checked (pure)', () => {
  test('a count that is not a whole number in range is refused in words; defaults stand when nothing is sent', () => {
    expect((sanitizeRules({}) as any).rules).toEqual(DEFAULT_RULES)
    expect('problem' in sanitizeRules({ pointsPerExtraShift: -1 }) && (sanitizeRules({ pointsPerExtraShift: -1 }) as any).problem).toContain('Points for an extra shift must be a whole number from 0 to 1000')
    expect((sanitizeRules({ minHoursPerWeek: 2.5 }) as any).problem).toContain('weekly minimum hours')
    expect((sanitizeRules({ pointsPerOnTime: 'lots' }) as any).problem).toContain('on-time clock-in')
    expect((sanitizeRules({ enabled: true, pointsPerOnTime: '3' }) as any).rules).toMatchObject({ enabled: true, pointsPerOnTime: 3, pointsPerExtraShift: 10 })
  })
  test('on time is no more than the grace after the start; early is fine', () => {
    expect(isOnTime(-30)).toBe(true); expect(isOnTime(7)).toBe(true); expect(isOnTime(8)).toBe(false)
  })
  test('a week counts only when it is over and reaches the minimum', () => {
    const days = [{ shiftDate: '2026-10-12', minutes: 90 }, { shiftDate: '2026-10-14', minutes: 90 }, { shiftDate: '2026-10-20', minutes: 600 }]
    expect(weeksMeetingMinimum(days, 0, 3, '2026-10-25')).toEqual(['2026-10-11', '2026-10-18'])
    expect(weeksMeetingMinimum(days, 0, 3, '2026-10-22')).toEqual(['2026-10-11'])   // the week of the 18th is not over yet
    expect(weeksMeetingMinimum(days, 0, 0, '2026-10-25')).toEqual([])               // 0 = off
    expect(kindLabel('on_time')).toBe('Clocked in on time'); expect(kindLabel('zzz')).toBe('Points')
  })
  test('an hours file refuses a bonus it cannot carry, naming who and how much', () => {
    expect(bonusNotInFile([{ firstName: 'Ann', lastName: 'Carer', bonusPay: 0 }], 'ADP file')).toBeNull()
    expect(bonusNotInFile([{ firstName: 'Ann', lastName: 'Carer', bonusPay: 25 }], 'ADP file')).toContain('Ann Carer $25.00')
  })
})

describe('the pickup bonus is paid through the pay run', () => {
  test('a worked pickup adds its bonus to the caregiver\'s line: shown apart, inside gross, in whole cents', async () => {
    // Ann takes the shift; the posting is filled and she is on the schedule.
    const claim = await send('ann', 'POST', `/api/open-shifts/${ids.shift}/claim`, {})
    expect(claim.status).toBe(200)
    expect(claim.body.assigned ?? claim.body.data?.assigned).toBe(true)
    // Not worked yet: no paid hours, so no pay line and no bonus.
    const before = (await send('owner', 'POST', '/api/payroll/calculate', { startDate: W, endDate: addDays(W, 6) })).body.payroll
    expect(before).toEqual([])
    // She worked it (two hours) and another visit that is not a pickup.
    const review = (shiftDate: string, scheduled: string, actual: string, minutes: number, clientId = ids.pat) =>
      ins(t.schema.payrollShiftReviews, { companyId, payPeriodStart: W, payPeriodEnd: addDays(W, 6), caregiverId: ids.ann, clientId, shiftDate, scheduledStart: scheduled, scheduledEnd: '23:00:00', payableMinutes: minutes, status: 'verified',
        actualStart: new Date(`${shiftDate}T${actual}:00Z`), actualEnd: new Date(`${shiftDate}T${actual}:00Z`) })
    await review(day1, '09:00:00', '09:03', 120)
    const line = await calc()
    expect(line).toMatchObject({ regularHours: 2, bonusPay: 25, bonusShifts: 1, wagesPay: 65, grossPay: 65 })
  })

  test('the approval keeps the bonus, and the payroll CSV and QuickBooks file list it on its own line', async () => {
    const ok = await send('owner', 'PUT', `/api/payroll/${ids.ann}/approve`, { startDate: W, endDate: addDays(W, 6) })
    expect(ok.status).toBe(200)
    const rec = ok.body.data ?? ok.body
    expect(Number(rec.bonusPay)).toBe(25)
    expect(Number(rec.grossPay)).toBe(65)
    const csv = await send('owner', 'POST', '/api/payroll/export', { startDate: W, endDate: addDays(W, 6), format: 'csv' })
    expect(csv.text).toContain('"Pickup bonus (1 shift)"')
    expect(csv.text).toContain(',25.00')
    const qb = await send('owner', 'GET', `/api/payroll/export/quickbooks?startDate=${W}&endDate=${addDays(W, 6)}`)
    expect(qb.text).toContain('"Pickup bonus",,,25.00')
  })

  test('an ADP or Paychex hours file is refused rather than leave the bonus off', async () => {
    await setFeatures([...BASE, 'care_pickup_rewards', 'care_payroll_rules'])
    await send('owner', 'PUT', '/api/pay-rules', { files: { adpCompanyCode: 'ABC' } })
    const adp = await send('owner', 'GET', `/api/pay-rules/export/adp?startDate=${W}&endDate=${addDays(W, 6)}`)
    expect(adp.status).toBe(400)
    expect(adp.text).toContain('pickup bonuses (Ann Carer $25.00)')
    await setFeatures([...BASE, 'care_pickup_rewards'])
  })

  test('a bonus never changes the hours, and a posting the office reopened pays nothing', async () => {
    const kept = await calc()
    expect(kept.totalHours).toBe(2)
    expect(kept.overtimeHours).toBe(0)
    // The office takes her off it: the posting is open again, so it is no longer a pickup.
    await t.db.update(t.schema.openShifts).set({ status: 'open', claimedById: null } as any).where(eq(t.schema.openShifts.id, ids.shift))
    expect((await calc()).bonusPay ?? 0).toBe(0)
    expect((await calc()).grossPay).toBe(40)
    await t.db.update(t.schema.openShifts).set({ status: 'filled', claimedById: ids.ann } as any).where(eq(t.schema.openShifts.id, ids.shift))
  })

  test('without the feature the pay run is exactly as it was', async () => {
    await setFeatures(BASE)
    const line = await calc()
    expect(line.bonusPay ?? 0).toBe(0)
    expect(line.grossPay).toBe(40)
    expect((await send('ann', 'GET', '/api/care-rewards/me')).status).toBe(403)
    await setFeatures([...BASE, 'care_pickup_rewards'])
  })

  test('the office\'s pickup list says whether the visit was worked', async () => {
    const r = await send('owner', 'GET', `/api/care-rewards/pickups?startDate=${W}&endDate=${addDays(W, 6)}`)
    expect(r.status).toBe(200)
    expect((r.body.data ?? r.body)[0]).toMatchObject({ bonusCents: 2500, worked: true, caregiverFirst: 'Ann', clientFirst: 'Pat', shiftDate: day1 })
    expect((await send('ann', 'GET', `/api/care-rewards/pickups?startDate=${W}&endDate=${addDays(W, 6)}`)).status).toBe(403)
  })
})

describe('points: earned once, from paid visits, never back-dated', () => {
  test('turning the scheme on starts it today: last week earns nothing until the start day is moved', async () => {
    const saved = await send('owner', 'PUT', '/api/care-rewards/rules', { enabled: true, pointsPerExtraShift: 10, pointsPerOnTime: 2, minHoursPerWeek: 2, pointsForMinHours: 5 })
    expect(saved.status).toBe(200)
    const today = await core.time.today(companyId)
    expect((saved.body.data ?? saved.body).startedOn).toBe(today)
    expect((await send('ann', 'GET', '/api/care-rewards/me')).body.balance).toBe(0)
    // (the test moves the start day back so last week counts)
    const [row] = await t.db.select({ settings: t.schema.company.settings }).from(t.schema.company).where(eq(t.schema.company.id, companyId))
    await t.db.update(t.schema.company).set({ settings: { ...(row.settings as any), rewards: { ...(row.settings as any).rewards, startedOn: addDays(W, -1) } } } as any).where(eq(t.schema.company.id, companyId))
  })

  test('an extra shift, an on-time clock-in and a week at the minimum each earn their points once', async () => {
    // A second, late visit: 20 minutes after the scheduled start — it counts for the hours but not for being on time.
    await ins(t.schema.payrollShiftReviews, { companyId, payPeriodStart: W, payPeriodEnd: addDays(W, 6), caregiverId: ids.ann, clientId: ids.pat, shiftDate: day2, scheduledStart: '09:00:00', scheduledEnd: '10:00:00', payableMinutes: 60, status: 'verified', actualStart: new Date(`${day2}T09:20:00Z`), actualEnd: new Date(`${day2}T10:20:00Z`) })
    const me = (await send('ann', 'GET', '/api/care-rewards/me')).body
    expect(me.balance).toBe(10 + 2 + 5)
    expect(me.history.map((h: any) => h.label).sort()).toEqual(['Clocked in on time', 'Extra shift picked up', 'Weekly minimum hours met'])
    const again = (await send('ann', 'GET', '/api/care-rewards/me')).body
    expect(again.balance).toBe(17)
    expect(again.history.length).toBe(3)
    // A visit that is not paid (flagged) earns nothing.
    await ins(t.schema.payrollShiftReviews, { companyId, payPeriodStart: W, payPeriodEnd: addDays(W, 6), caregiverId: ids.ann, clientId: ids.pat, shiftDate: addDays(W, 3), scheduledStart: '09:00:00', scheduledEnd: '10:00:00', payableMinutes: 60, status: 'flagged', actualStart: new Date(`${addDays(W, 3)}T09:00:00Z`), actualEnd: new Date(`${addDays(W, 3)}T10:00:00Z`) })
    expect((await send('ann', 'GET', '/api/care-rewards/me')).body.balance).toBe(17)
  })

  test('the office\'s board lists who has points, and adjusting needs a reason', async () => {
    const board = (await send('owner', 'GET', '/api/care-rewards/board')).body
    expect((board.data ?? board)[0]).toMatchObject({ caregiverId: ids.ann, balance: 17, earned: 17 })
    expect((await send('owner', 'POST', '/api/care-rewards/adjust', { caregiverId: ids.ann, points: 5, note: '  ' })).status).toBe(400)
    expect((await send('owner', 'POST', '/api/care-rewards/adjust', { caregiverId: ids.ann, points: 0, note: 'x' })).status).toBe(400)
    expect((await send('owner', 'POST', '/api/care-rewards/adjust', { caregiverId: 'nobody', points: 5, note: 'x' })).status).toBe(404)
    expect((await send('owner', 'POST', '/api/care-rewards/adjust', { caregiverId: ids.ann, points: 5, note: 'Covered a holiday' })).status).toBe(200)
    const me = (await send('ann', 'GET', '/api/care-rewards/me')).body
    expect(me.balance).toBe(22)
    expect(me.history.find((h: any) => h.note === 'Covered a holiday').label).toBe('Adjusted by the office')
  })
})

describe('rewards: asked for from the phone, handled by the office', () => {
  test('a caregiver can ask only for what their points cover; the points are held', async () => {
    const big = await send('owner', 'POST', '/api/care-rewards/items', { name: 'Gift card', description: '$25 grocery card', costPoints: 40 })
    const small = await send('owner', 'POST', '/api/care-rewards/items', { name: 'Coffee', costPoints: 15 })
    expect(big.status).toBe(201); expect(small.status).toBe(201)
    ids.big = (big.body.data ?? big.body).id; ids.small = (small.body.data ?? small.body).id
    expect((await send('owner', 'POST', '/api/care-rewards/items', { name: '', costPoints: 5 })).status).toBe(400)
    expect((await send('owner', 'POST', '/api/care-rewards/items', { name: 'Free', costPoints: 0 })).status).toBe(400)
    const refused = await send('ann', 'POST', '/api/care-rewards/redeem', { rewardId: ids.big })
    expect(refused.status).toBe(409)
    expect(refused.body.error ?? refused.text).toContain('You need 40 points for this reward — you have 22')
    const ok = await send('ann', 'POST', '/api/care-rewards/redeem', { rewardId: ids.small })
    expect(ok.status).toBe(201)
    expect((await send('ann', 'GET', '/api/care-rewards/me')).body.balance).toBe(7)
    // The same again cannot be afforded: 7 < 15.
    expect((await send('ann', 'POST', '/api/care-rewards/redeem', { rewardId: ids.small })).status).toBe(409)
    ids.req = (ok.body.data ?? ok.body).id
  })

  test('declining gives the points back once; handing it over closes it; a request is settled once', async () => {
    const waiting = (await send('owner', 'GET', '/api/care-rewards/requests?status=requested')).body
    expect((waiting.data ?? waiting)[0]).toMatchObject({ id: ids.req, name: 'Coffee', statusLabel: 'Waiting for the office', firstName: 'Ann' })
    expect((await send('owner', 'GET', '/api/care-rewards/summary')).body.waiting).toBe(1)
    const declined = await send('owner', 'PUT', `/api/care-rewards/requests/${ids.req}`, { action: 'decline', note: 'Out of stock' })
    expect(declined.status).toBe(200)
    expect((await send('ann', 'GET', '/api/care-rewards/me')).body.balance).toBe(22)
    expect((await send('owner', 'PUT', `/api/care-rewards/requests/${ids.req}`, { action: 'fulfil' })).status).toBe(409)
    expect((await send('ann', 'GET', '/api/care-rewards/me')).body.balance).toBe(22)
    const again = await send('ann', 'POST', '/api/care-rewards/redeem', { rewardId: ids.small })
    const done = await send('owner', 'PUT', `/api/care-rewards/requests/${(again.body.data ?? again.body).id}`, { action: 'fulfil', note: 'Left at the front desk' })
    expect(done.status).toBe(200)
    const me = (await send('ann', 'GET', '/api/care-rewards/me')).body
    expect(me.balance).toBe(7)
    expect(me.requests.map((r: any) => r.statusLabel).sort()).toEqual(['Given', 'Not given — points returned'])
    expect((await send('owner', 'PUT', `/api/care-rewards/requests/${ids.req}`, { action: 'maybe' })).status).toBe(400)
  })

  test('a switched-off reward cannot be asked for, and a caregiver cannot touch the office\'s side', async () => {
    await send('owner', 'PUT', `/api/care-rewards/items/${ids.small}`, { name: 'Coffee', costPoints: 15, isActive: false })
    expect((await send('ann', 'POST', '/api/care-rewards/redeem', { rewardId: ids.small })).status).toBe(404)
    expect((await send('ann', 'GET', '/api/care-rewards/me')).body.rewards.map((r: any) => r.name)).toEqual(['Gift card'])
    for (const [m, p, b] of [['PUT', '/api/care-rewards/rules', { enabled: false }], ['GET', '/api/care-rewards/board'], ['POST', '/api/care-rewards/items', { name: 'x', costPoints: 1 }], ['POST', '/api/care-rewards/adjust', { caregiverId: ids.ann, points: 99, note: 'x' }], ['PUT', `/api/care-rewards/requests/${ids.req}`, { action: 'fulfil' }]] as const) {
      expect((await send('ann', m, p, b as any)).status).toBe(403)
    }
  })
})

describe('hours wanted, saved by the caregiver', () => {
  test('without the feature the field is refused and never stored', async () => {
    await setFeatures(BASE)
    const r = await send('ann', 'PUT', `/api/caregiver-availability/${ids.ann}`, { hoursWanted: 20 })
    expect(r.status).toBe(403)
    expect(r.text).toContain('Hours wanted is not turned on')
    await setFeatures([...BASE, 'care_pickup_rewards'])
  })

  test('a caregiver saves their own hours wanted and days; whole hours only; never someone else\'s', async () => {
    const ok = await send('ann', 'PUT', `/api/caregiver-availability/${ids.ann}`, { hoursWanted: 24, maxHoursPerWeek: 32, mondayAvailable: true, mondayStartTime: '08:00', mondayEndTime: '16:00' })
    expect([200, 201]).toContain(ok.status)
    const got = await send('ann', 'GET', `/api/caregiver-availability/${ids.ann}`)
    expect(got.body.data?.hoursWanted ?? got.body.hoursWanted).toBe(24)
    expect((await send('ann', 'PUT', `/api/caregiver-availability/${ids.ann}`, { hoursWanted: 'lots' })).status).toBe(400)
    expect((await send('ann', 'PUT', `/api/caregiver-availability/${ids.ann}`, { hoursWanted: 200 })).status).toBe(400)
    expect((await send('ann', 'PUT', `/api/caregiver-availability/${ids.bea}`, { hoursWanted: 40 })).status).toBe(403)
    // clearing the wish is allowed
    expect((await send('ann', 'PUT', `/api/caregiver-availability/${ids.ann}`, { hoursWanted: null })).status).toBe(200)
  })
})
