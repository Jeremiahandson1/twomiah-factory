// ONE CLOCK (coordinator 2026-10-23): the business's time zone is the company's (Settings › Company), and every reader
// keeps time on it — online bookings, the AI Receptionist, a salon's day, a bar's hours. Each kept a zone of its own,
// which could disagree with the reports'. Migration 0022 moves the old values with care and never silently.
import { describe, test, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { createBookingEngine } from '../server/booking/engine.ts'
import { createSalonClock } from '../server/crm/salon/days.ts'
import { createBarLive } from '../server/crm/bar/barLive.ts'
import { MIGRATIONS } from '../server/db/migrate.ts'

const MIGRATION = readFileSync(path.join(MIGRATIONS, '0022_one_time_zone.sql'), 'utf8')
/** Run 0022 again over rows made the way the old code left them (the harness has already applied it to an empty one). */
const runMigration = async (t: any) => { for (const stmt of MIGRATION.split('--> statement-breakpoint')) if (stmt.trim()) await t.client.exec(stmt) }

describe('migration 0022: the old zones move onto the company, never silently', () => {
  test('a company without a zone takes its booking zone, then the AI receptionist’s, then the bar’s; a different one is put on the audit log; bookings keep their times', async () => {
    const t = await bootTenant()
    const mk = async (name: string, timezone: string | null) => (await t.db.insert(t.schema.company).values({ name, slug: name.toLowerCase().replace(/\W+/g, '-'), timezone } as any).returning())[0]
    const a = await mk('Alpha Booked', null)          // booking zone only → takes it
    const b = await mk('Bravo Has One', 'America/New_York') // differs from its booking zone → keeps its own, says so
    const c = await mk('Charlie Receptionist', null)  // AI zone only → takes it
    const d = await mk('Delta Bar', null)             // bar hours zone only → takes it
    const e = await mk('Echo Garbage', null)          // a zone Postgres does not know → left alone
    await t.db.insert(t.schema.bookingSettings).values([
      { companyId: a.id, timezone: 'America/Denver' }, { companyId: b.id, timezone: 'America/Chicago' }, { companyId: e.id, timezone: 'Mars/Olympus' },
    ] as any)
    await t.db.insert(t.schema.aiReceptionistSettings).values({ companyId: c.id, timezone: 'America/Los_Angeles' } as any)
    await t.db.insert(t.schema.barSettings).values({ companyId: d.id, hours: { timezone: 'America/Phoenix', bar: {}, kitchen: {} } } as any)
    const startAt = new Date('2026-11-02T15:00:00Z')
    await t.db.insert(t.schema.booking).values({ companyId: b.id, startAt, endAt: new Date('2026-11-02T16:00:00Z'), customerName: 'Pat', customerEmail: 'pat@example.com', token: 'tok-bravo' } as any)

    await runMigration(t)

    const zone = async (id: string) => ((await t.db.select().from(t.schema.company).where(eq(t.schema.company.id, id)))[0] as any).timezone
    expect(await zone(a.id)).toBe('America/Denver')
    expect(await zone(b.id)).toBe('America/New_York')
    expect(await zone(c.id)).toBe('America/Los_Angeles')
    expect(await zone(d.id)).toBe('America/Phoenix')
    expect(await zone(e.id)).toBeNull()
    const said = await t.db.select().from(t.schema.auditLog).where(eq(t.schema.auditLog.companyId, b.id))
    expect(said.length).toBe(1)
    expect(JSON.stringify(said[0].metadata)).toContain('America/New_York')
    expect(JSON.stringify(said[0].metadata)).toContain('America/Chicago')
    expect((await t.db.select().from(t.schema.auditLog).where(eq(t.schema.auditLog.companyId, a.id))).length).toBe(0)
    const [kept] = await t.db.select().from(t.schema.booking).where(eq(t.schema.booking.companyId, b.id))
    expect(kept.startAt.toISOString()).toBe(startAt.toISOString())
  }, 60_000)
})

describe('every reader keeps time on the company’s zone', () => {
  test('bookings: the engine, the owner’s settings and a refused zone of their own', async () => {
    const t = await bootTenant()
    const s = await seedOwner(t)
    await t.db.update(t.schema.company).set({ timezone: 'America/Denver' } as any).where(eq(t.schema.company.id, s.company.id))
    await t.db.insert(t.schema.bookingSettings).values({ companyId: s.company.id, timezone: 'America/New_York' } as any)
    const engine = createBookingEngine({ db: t.db, requireAddressDefault: false })
    expect((await engine.settingsOf(s.company.id)).timezone).toBe('America/Denver')
    expect(engine.tzOf(await engine.settingsOf(s.company.id))).toBe('America/Denver')
    const token = (await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } })).json()).accessToken
    const as = (p: string, init: any = {}) => t.call(p, { ...init, headers: { Authorization: `Bearer ${token}` } })
    expect((await as('/api/company/features', { method: 'PUT', json: { features: ['online_booking', 'ai_receptionist'] } })).status).toBe(200)
    expect(((await (await as('/api/booking/settings')).json()) as any).timezone).toBe('America/Denver')
    // Settings › Company moves every clock at once.
    expect((await as('/api/company', { method: 'PUT', json: { timezone: 'America/Los_Angeles' } })).status).toBe(200)
    expect(((await (await as('/api/booking/settings')).json()) as any).timezone).toBe('America/Los_Angeles')
    const own = await as('/api/booking/settings', { method: 'PATCH', json: { timezone: 'America/Chicago' } })
    expect(own.status).toBe(400)
    expect((await as('/api/booking/settings', { method: 'PATCH', json: { timezone: 'America/Los_Angeles', maxDaysOut: 20 } })).status).toBe(200)

    // The AI Receptionist: the same clock, and no zone of its own.
    await t.db.insert(t.schema.aiReceptionistSettings).values({ companyId: s.company.id, timezone: 'America/Chicago' } as any)
    expect(((await (await as('/api/ai-receptionist/settings')).json()) as any).timezone).toBe('America/Los_Angeles')
    const ai = await as('/api/ai-receptionist/settings', { method: 'PUT', json: { timezone: 'America/Chicago' } })
    expect(ai.status).toBe(400)
    expect(JSON.stringify(await ai.json())).toContain('Settings › Company')
    const ok = await as('/api/ai-receptionist/settings', { method: 'PUT', json: { timezone: 'America/Los_Angeles', greetingText: 'Hi' } })
    expect(ok.status).toBe(200)
    expect(((await ok.json()) as any).timezone).toBe('America/Los_Angeles')
  }, 60_000)

  test('a salon’s day and a bar’s hours', async () => {
    const t = await bootTenant()
    const s = await seedOwner(t)
    await t.db.update(t.schema.company).set({ timezone: 'America/Denver' } as any).where(eq(t.schema.company.id, s.company.id))
    await t.db.insert(t.schema.bookingSettings).values({ companyId: s.company.id, timezone: 'America/New_York' } as any)
    await t.db.insert(t.schema.barSettings).values({ companyId: s.company.id, hours: { timezone: 'America/New_York', bar: {}, kitchen: {} } } as any)
    expect(await createSalonClock(t.db).salonTimezone(s.company.id)).toBe('America/Denver')
    expect((await createBarLive(t.db as any).hoursFor(s.company.id)).timezone).toBe('America/Denver')
  }, 60_000)
})
