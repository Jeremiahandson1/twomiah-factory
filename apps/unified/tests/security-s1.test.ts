// Security review S1 (identity and access), 2026-11-12 — docs/review/security/S1-identity-access.md. Each test is one
// finding's hole, shown closed, beside the ordinary path still working.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { generateTOTPCode } from '@twomiah/tenant-backend'
import { bootTenant, seedOwner } from './harness.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let ownerId = ''
const PASSWORD = 'Correct-horse-1'
const bearer = (tok: string) => (p: string, init: any = {}) => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${tok}` } })
const codeNow = (secret: string, stepsAhead = 0) => generateTOTPCode(secret, Math.floor(Date.now() / 30000) + stepsAhead)
/** A six-digit code that is not one of the three the server accepts right now. */
const wrongCode = (secret: string) => {
  const good = new Set([-1, 0, 1].map((i) => codeNow(secret, i)))
  for (let n = 100000; ; n++) if (!good.has(String(n))) return String(n)
}
const signIn = async () => {
  const r = await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: PASSWORD } })
  return { status: r.status, body: await r.json() as any }
}
const sendCode = async (challengeId: string, code: string) => {
  const r = await t.call('/api/auth/mfa', { method: 'POST', json: { challengeId, code } })
  return { status: r.status, body: await r.json() as any }
}
const userRow = async () => (await t.db.select().from(t.schema.user).where(eq(t.schema.user.id, ownerId)).limit(1))[0]
const unlock = () => t.db.update(t.schema.user).set({ failedLoginCount: 0, lockedUntil: null }).where(eq(t.schema.user.id, ownerId))

let secret = ''
let access = ''

beforeAll(async () => {
  t = await bootTenant({ vertical: 'contractor' })
  const seeded = await seedOwner(t, PASSWORD)
  ownerId = seeded.owner.id
  access = (await signIn()).body.accessToken
  // Two-factor on, the ordinary way: setup, then the code from the seed.
  const setup = await (await bearer(access)('/api/auth/mfa-devices/setup', { method: 'POST', json: {} })).json() as any
  secret = setup.secret
  const verified = await bearer(access)('/api/auth/mfa-devices/verify', { method: 'POST', json: { deviceId: setup.deviceId, code: codeNow(secret) } })
  expect(verified.status).toBe(200)
}, 120_000)

describe('S1-1: wrong two-factor codes count against the account', () => {
  test('a right password does not wipe the count, and ten wrong codes across sign-in requests lock the account', async () => {
    await unlock()
    const bad = wrongCode(secret)
    // First request: five tries, then it is spent.
    const first = await signIn()
    expect(first.body.mfaRequired).toBe(true)
    for (let i = 0; i < 4; i++) expect((await sendCode(first.body.challengeId, bad)).body.code).toBe('bad_code')
    expect((await sendCode(first.body.challengeId, bad)).body.code).toBe('too_many_attempts')
    expect(Number((await userRow()).failedLoginCount)).toBe(5)
    // A second request with the right password: the count is still 5, and five more wrong codes lock the account.
    const second = await signIn()
    expect(second.body.mfaRequired).toBe(true)
    expect(Number((await userRow()).failedLoginCount)).toBe(5)
    let last: any
    for (let i = 0; i < 5; i++) last = await sendCode(second.body.challengeId, bad)
    expect(last.status).toBe(423)
    expect((await userRow()).lockedUntil).toBeTruthy()
    // Locked: the right password is refused, as after ten wrong passwords.
    expect((await signIn()).status).toBe(423)
    // …and a wrong code is on the record.
    const rows = await t.db.select().from(t.schema.auditLog).where(eq(t.schema.auditLog.action, 'login_failed'))
    expect(rows.some((r: any) => r.metadata?.secondFactor === true)).toBe(true)
    await unlock()
  })

  test('codes sent at the same moment do not get more than five tries on one request', async () => {
    await unlock()
    const { body } = await signIn()
    const bad = wrongCode(secret)
    const all = await Promise.all(Array.from({ length: 12 }, () => sendCode(body.challengeId, bad)))
    expect(all.filter((r) => r.body.code === 'bad_code' || r.body.code === 'too_many_attempts').length).toBeLessThanOrEqual(5)
    // the right code no longer works on that spent request
    expect((await sendCode(body.challengeId, codeNow(secret))).status).toBe(400)
    await unlock()
  })

  test('the ordinary path: a typo, then the right code signs in and clears the count', async () => {
    await unlock()
    const { body } = await signIn()
    expect((await sendCode(body.challengeId, wrongCode(secret))).status).toBe(401)
    const ok = await sendCode(body.challengeId, codeNow(secret))
    expect(ok.status).toBe(200)
    expect(ok.body.accessToken).toBeTruthy()
    expect(Number((await userRow()).failedLoginCount) || 0).toBe(0)
    access = ok.body.accessToken
  })
})

describe('S1-2: adding an authenticator to an account that has one asks for a code from it', () => {
  test('a session alone cannot start a second enrolment', async () => {
    const none = await bearer(access)('/api/auth/mfa-devices/setup', { method: 'POST', json: {} })
    expect(none.status).toBe(400)
    expect((await none.json() as any).code).toBe('code_required')
    const wrong = await bearer(access)('/api/auth/mfa-devices/setup', { method: 'POST', json: { code: wrongCode(secret) } })
    expect(wrong.status).toBe(400)
    expect((await wrong.json() as any).secret).toBeUndefined()
  })

  test('with a live code it starts, as before', async () => {
    const ok = await bearer(access)('/api/auth/mfa-devices/setup', { method: 'POST', json: { code: codeNow(secret) } })
    expect(ok.status).toBe(201)
    expect((await ok.json() as any).secret).toBeTruthy()
  })
})

describe('S1-15: a seat that reads only its own work does not get everyone’s through the export or the search box', () => {
  const tokens: Record<string, string> = {}
  const ids: Record<string, string> = {}
  const as = (who: string) => bearer(tokens[who])

  beforeAll(async () => {
    const [co] = await t.db.select().from(t.schema.company).limit(1)
    await t.db.update(t.schema.company).set({ enabledFeatures: ['contacts', 'jobs', 'quotes', 'projects'] }).where(eq(t.schema.company.id, co.id))
    t.services.features.forgetFeatures()
    for (const role of ['manager', 'crew', 'sales_rep']) {
      const [u] = await t.db.insert(t.schema.user).values({
        email: `${role}@test.example`, passwordHash: await Bun.password.hash(PASSWORD, 'bcrypt'), firstName: role, lastName: 'Seat', role, companyId: co.id,
      }).returning()
      ids[role] = u.id
      const r = await (await t.call('/api/auth/login', { method: 'POST', json: { email: `${role}@test.example`, password: PASSWORD } })).json() as any
      tokens[role] = r.accessToken
    }
    await t.db.insert(t.schema.quote).values([
      { companyId: co.id, number: 'Q-REP', name: 'Zebra deck for the rep', createdById: ids.sales_rep },
      { companyId: co.id, number: 'Q-OTHER', name: 'Zebra roof by the office', createdById: ownerId },
    ] as any)
    await t.db.insert(t.schema.project).values([
      { companyId: co.id, number: 'P-REP', name: 'Zebra project of the rep', createdById: ids.sales_rep },
      { companyId: co.id, number: 'P-OTHER', name: 'Zebra project of the office', createdById: ownerId },
    ] as any)
  }, 60_000)

  test('the export: a crew seat is refused the customer and job lists, the rep the quote list; the office still downloads them', async () => {
    expect((await as('crew')('/api/export/contacts/csv')).status).toBe(403)
    expect((await as('crew')('/api/export/jobs/csv')).status).toBe(403)
    expect((await as('sales_rep')('/api/export/quotes/csv')).status).toBe(403)
    for (const type of ['contacts', 'jobs', 'quotes']) expect((await as('manager')(`/api/export/${type}/csv`)).status).toBe(200)
  })

  test('the search box: the rep finds its own quote and project, not the office’s; the manager finds both', async () => {
    const names = async (who: string) => ((await (await as(who)('/api/search?q=Zebra')).json() as any).results as any[]).map((r) => r.name)
    const rep = await names('sales_rep')
    expect(rep).toContain('Zebra deck for the rep')
    expect(rep).toContain('Zebra project of the rep')
    expect(rep).not.toContain('Zebra roof by the office')
    expect(rep).not.toContain('Zebra project of the office')
    const office = await names('manager')
    expect(office).toContain('Zebra roof by the office')
    expect(office).toContain('Zebra project of the office')
    const recent = ((await (await as('sales_rep')('/api/search/recent')).json() as any).data as any[]).map((r) => r.name)
    expect(recent).not.toContain('Zebra project of the office')
  })
})
