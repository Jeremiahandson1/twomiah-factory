// Phone notifications for every vertical (core/phonePush.ts, crm/notify/phoneRules.ts), on a contractor tenant: the
// phone's token registered at /api/push/expo-token, a job assigned or rescheduled by any path tells its person once, and
// a new lead tells the people who work leads. Sends are recorded by the harness, never sent to Expo.
import { describe, test, expect, beforeAll } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import { eq, sql } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { whenText } from '../server/crm/notify/phoneRules.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let s: Awaited<ReturnType<typeof seedOwner>>
const tok: Record<string, string> = {}
const ids: Record<string, string> = {}
const as = (who: string, p: string, init: any = {}) => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${tok[who]}` } })
const phone = (who: string) => `ExponentPushToken[${who}-phone]`
/** The messages since the last call, as "<person>: <title> — <body>". */
let seen = 0
const sentSince = () => { const out = t.pushed.slice(seen).map((m: any) => `${m.to.replace(/^ExponentPushToken\[|-phone\]$/g, '')}: ${m.title} — ${m.body}`); seen = t.pushed.length; return out }
const scan = () => t.services.phoneRules.scanJobs()

beforeAll(async () => {
  t = await bootTenant({ vertical: 'contractor' })
  s = await seedOwner(t)
  await t.db.update(t.schema.company).set({ enabledFeatures: ['contacts', 'jobs', 'lead_inbox'] }).where(eq(t.schema.company.id, s.company.id))
  tok.owner = (await (await t.call('/api/auth/login', { method: 'POST', json: { email: s.owner.email, password: s.password } })).json()).accessToken
  for (const [who, role] of [['tech', 'field'], ['tech2', 'field'], ['office', 'manager']]) {
    const [u] = await t.db.insert(t.schema.user).values({ email: `${who}@test.example`, passwordHash: await Bun.password.hash('Seat-pass-1', 'bcrypt'), firstName: who, lastName: 'Seat', role, companyId: s.company.id }).returning()
    ids[who] = u.id
    tok[who] = (await (await t.call('/api/auth/login', { method: 'POST', json: { email: `${who}@test.example`, password: 'Seat-pass-1' } })).json()).accessToken
  }
  for (const who of ['owner', 'tech', 'tech2', 'office']) {
    expect((await as(who, '/api/push/expo-token', { method: 'POST', json: { token: phone(who), platform: 'ios' } })).status).toBe(201)
  }
  // A contractor's job is for a customer (crm.jobs.requireCustomer, contractor PR #173).
  ids.customer = (await (await as('owner', '/api/contacts', { method: 'POST', json: { name: 'Deck Customer', type: 'client' } })).json()).id
  await scan(); sentSince()
})

describe('the phone token, for a trade', () => {
  test('not an Expo token: refused; another person cannot remove my phone', async () => {
    expect((await as('tech', '/api/push/expo-token', { method: 'POST', json: { token: 'abc' } })).status).toBe(400)
    expect((await (await as('tech2', '/api/push/expo-token', { method: 'DELETE', json: { token: phone('tech') } })).json()).removed).toBe(0)
  })
})

describe('jobs', () => {
  test('a job assigned to the tech tells the tech, once', async () => {
    const r = await as('owner', '/api/jobs', { method: 'POST', json: { contactId: ids.customer, title: 'Fix deck', assignedToId: ids.tech, scheduledDate: '2026-10-21', scheduledTime: '09:00' } })
    expect(r.status).toBe(201)
    ids.job = (await r.json()).id
    expect(await scan()).toBe(1)
    expect(sentSince()).toEqual([expect.stringMatching(/^tech: New job assigned to you — Fix deck \(.+\) — Wed Oct 21, 9:00 AM$/)])
    expect(await scan()).toBe(0)
    expect(sentSince()).toEqual([])
  })

  test('rescheduled: the tech is told the new time', async () => {
    await as('owner', `/api/jobs/${ids.job}`, { method: 'PUT', json: { scheduledDate: '2026-10-22', scheduledTime: '13:30' } })
    await scan()
    expect(sentSince()).toEqual([expect.stringMatching(/^tech: Your job was rescheduled — Fix deck \(.+\) — now Thu Oct 22, 1:30 PM$/)])
  })

  test('reassigned by a write that announced nothing (straight to the table): the new person is told', async () => {
    await t.db.update(t.schema.job).set({ assignedToId: ids.tech2 }).where(eq(t.schema.job.id, ids.job))
    await scan()
    expect(sentSince()).toEqual([expect.stringMatching(/^tech2: New job assigned to you — Fix deck/)])
  })

  test('unassigned, or finished: nobody is told, and it is recorded', async () => {
    await t.db.update(t.schema.job).set({ assignedToId: null }).where(eq(t.schema.job.id, ids.job))
    expect(await scan()).toBe(0)
    await t.db.update(t.schema.job).set({ assignedToId: ids.tech, status: 'completed', scheduledTime: '15:00' }).where(eq(t.schema.job.id, ids.job))
    expect(await scan()).toBe(0)
    expect(sentSince()).toEqual([])
    expect(await scan()).toBe(0)
  })

  test("migration 0015's fill is the scan's own reading: filled from existing jobs, nobody is told", async () => {
    const j = await (await as('owner', '/api/jobs', { method: 'POST', json: { contactId: ids.customer, title: 'Old work', assignedToId: ids.tech, scheduledDate: '2026-11-03' } })).json()
    await t.db.execute(sql`DELETE FROM job_push_state`)
    const file = fs.readFileSync(path.join(import.meta.dir, '../server/db/migrations/0015_job_push_state.sql'), 'utf8')
    const fill = file.slice(file.indexOf('INSERT INTO "job_push_state"'))
    await t.db.execute(sql.raw(fill))
    expect(await scan()).toBe(0)
    expect(sentSince()).toEqual([])
    expect(j.id).toBeTruthy()
  })
})

describe('leads', () => {
  test('a new lead tells the owner and the office manager, not the field seats', async () => {
    t.services.realtime.emitToCompany(s.company.id, t.services.realtime.EVENTS.LEAD_CREATED, { id: 'lead1', homeownerName: 'Dana Ruiz' })
    const end = Date.now() + 3000
    while (t.pushed.length - seen < 2 && Date.now() < end) await Bun.sleep(20)
    expect(sentSince().sort()).toEqual(['office: New lead — Dana Ruiz is waiting to hear from you', 'owner: New lead — Dana Ruiz is waiting to hear from you'])
  })
})

describe('the sender', () => {
  test('a phone the app was removed from is forgotten', async () => {
    t.services.phonePush.setTransport(async (msgs) => msgs.map(() => ({ status: 'error' as const, details: { error: 'DeviceNotRegistered' } })))
    expect(await t.services.phonePush.send(s.company.id, [ids.tech2], { title: 'x', body: 'y' })).toBe(0)
    const left = await t.db.select().from(t.schema.expoPushTokens).where(eq(t.schema.expoPushTokens.userId, ids.tech2))
    expect(left.length).toBe(0)
  })

  test('when: a calendar day and its time, no zone', () => {
    expect(whenText('2026-10-21 09:00')).toBe('Wed Oct 21, 9:00 AM')
    expect(whenText('2026-10-21 00:15')).toBe('Wed Oct 21, 12:15 AM')
    expect(whenText('2026-10-21')).toBe('Wed Oct 21')
    expect(whenText(null)).toBeNull()
  })
})
