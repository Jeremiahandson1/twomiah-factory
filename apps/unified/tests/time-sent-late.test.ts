// Follow-up 10/30 to PR #169, fix 2: a clock-in or clock-out the phone tapped earlier and sent late (no signal) keeps the TAPPED
// time (within 48 hours — unchanged) and is marked "time set by phone, sent late" with how late it was, so the office sees it
// where it approves time. Through the real server and login, on BOTH field service and basic.
//   · a tap that arrives more than 5 minutes after it was made is flagged, on the side that was late (in / out), with minutes late;
//   · a tap that arrives on time, or a clock with no tapped time, carries no flag;
//   · the flag comes back on the time list the office approves from, and stays after approval;
//   · the 48-hour limit and the hours worked are as before.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'

const FEATURES = ['contacts', 'jobs', 'time_tracking']
const MIN = 60_000

for (const vertical of ['fieldservice', 'basic'] as const) {
  describe(`${vertical}`, () => {
    let t: Awaited<ReturnType<typeof bootTenant>>
    let co = ''
    const tok: Record<string, string> = {}
    const ins = async (table: any, values: any) => ((await t.db.insert(table).values(values).returning()) as any[])[0]
    const as = async (who: string, path: string, method = 'GET', json?: unknown) => {
      const r = await t.call(path, { method, json, headers: { Authorization: `Bearer ${tok[who]}` } })
      const text = await r.text(); let body: any = text
      try { body = JSON.parse(text) } catch { /* not JSON */ }
      return { status: r.status, body }
    }
    const ago = (ms: number) => new Date(Date.now() - ms).toISOString()
    const reset = async () => { await t.db.delete(t.schema.timeEntry).where(eq(t.schema.timeEntry.companyId, co)) }

    beforeAll(async () => {
      t = await bootTenant({ vertical })
      const s = await seedOwner(t)
      co = s.company.id
      await t.db.update(t.schema.company).set({ enabledFeatures: FEATURES } as any).where(eq(t.schema.company.id, co)); t.services.features.forgetFeatures()
      const login = async (e: string, p: string) => ((await (await t.call('/api/auth/login', { method: 'POST', json: { email: e, password: p } })).json()) as any).accessToken
      tok.owner = await login('owner@test.example', s.password)
      await ins(t.schema.user, { email: 'tia@test.example', passwordHash: await Bun.password.hash('Seat-pass-1', 'bcrypt'), firstName: 'Tia', lastName: 'Seat', role: 'field', companyId: co })
      tok.tia = await login('tia@test.example', 'Seat-pass-1')
    }, 120_000)

    test('a clock-in sent hours late is flagged with how late; the tapped time and the hours are kept', async () => {
      await reset()
      const inn = await as('tia', '/api/time/clock-in', 'POST', { at: ago(180 * MIN) })
      expect(inn.status).toBe(201)
      expect(inn.body.clockInLateMinutes).toBeGreaterThanOrEqual(179)
      expect(inn.body.clockInLateMinutes).toBeLessThanOrEqual(181)
      expect(inn.body.clockOutLateMinutes ?? null).toBeNull()
      expect(Math.abs(new Date(inn.body.clockIn).getTime() - (Date.now() - 180 * MIN))).toBeLessThan(10_000)
      const out = await as('tia', '/api/time/clock-out', 'POST', { at: ago(0) })
      expect(out.status).toBe(200)
      expect(Number(out.body.hours)).toBeCloseTo(3, 1)
      expect(out.body.clockInLateMinutes).toBeGreaterThanOrEqual(179)
      expect(out.body.clockOutLateMinutes ?? null).toBeNull()
    })

    test('a clock-out sent late is flagged on its own side', async () => {
      await reset()
      expect((await as('tia', '/api/time/clock-in', 'POST', { at: ago(120 * MIN) })).status).toBe(201)
      const out = await as('tia', '/api/time/clock-out', 'POST', { at: ago(30 * MIN) })
      expect(out.status).toBe(200)
      expect(out.body.clockOutLateMinutes).toBeGreaterThanOrEqual(29)
      expect(out.body.clockOutLateMinutes).toBeLessThanOrEqual(31)
      expect(Number(out.body.hours)).toBeCloseTo(1.5, 1)
    })

    test('a tap that arrives on time, or a clock with no tapped time, carries no flag', async () => {
      await reset()
      const quick = await as('tia', '/api/time/clock-in', 'POST', { at: ago(1 * MIN) })
      expect(quick.body.clockInLateMinutes ?? null).toBeNull()
      await reset()
      const plain = await as('tia', '/api/time/clock-in', 'POST', {})
      expect(plain.body.clockInLateMinutes ?? null).toBeNull()
      const justUnder = await reset().then(() => as('tia', '/api/time/clock-in', 'POST', { at: ago(4 * MIN) }))
      expect(justUnder.body.clockInLateMinutes ?? null).toBeNull()
    })

    test('the office sees the flag on the time list it approves from, and it stays after approval', async () => {
      await reset()
      await as('tia', '/api/time/clock-in', 'POST', { at: ago(240 * MIN) })
      const out = await as('tia', '/api/time/clock-out', 'POST', { at: ago(60 * MIN) })
      const list = await as('owner', '/api/time')
      const row = list.body.data.find((e: any) => e.id === out.body.id)
      expect(row.clockInLateMinutes).toBeGreaterThanOrEqual(239)
      expect(row.clockOutLateMinutes).toBeGreaterThanOrEqual(59)
      expect((await as('owner', `/api/time/${out.body.id}/approve`, 'POST')).status).toBe(200)
      const after = (await as('owner', '/api/time')).body.data.find((e: any) => e.id === out.body.id)
      expect(after.approved).toBe(true)
      expect(after.clockInLateMinutes).toBeGreaterThanOrEqual(239)
    })

    test('the 48-hour limit is as before', async () => {
      await reset()
      const old = await as('tia', '/api/time/clock-in', 'POST', { at: ago(49 * 60 * MIN) })
      expect(old.status).toBe(400)
      expect(old.body.error).toContain('48 hours')
    })
  })
}
