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

  test('S1-4: the code a sign-in was accepted on does not sign in a second time', async () => {
    const code = codeNow(secret, 1) // a later step than the sign-in above used
    const first = await signIn()
    const ok = await sendCode(first.body.challengeId, code)
    expect(ok.status).toBe(200)
    // Someone who saw those six digits typed, and holds the password: a new request, the same code.
    const second = await signIn()
    expect(second.body.mfaRequired).toBe(true)
    const replay = await sendCode(second.body.challengeId, code)
    expect(replay.status).toBe(401)
    expect(replay.body.code).toBe('code_already_used')
    expect(replay.body.accessToken).toBeUndefined()
    // The request stays open for the next code the app shows; nothing is counted against the account for a real code.
    const [row] = await t.db.select().from(t.schema.mfaChallenge).where(eq(t.schema.mfaChallenge.id, second.body.challengeId))
    expect(row.status).toBe('pending')
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

describe('S1-7, S1-9, S1-12: the smaller doors', () => {
  test('S1-9: a settings save cannot replace the subscription’s facts; ordinary settings still save', async () => {
    const [co] = await t.db.select().from(t.schema.company).limit(1)
    await t.db.update(t.schema.company).set({ settings: { seatLimit: 3, subscriptionStatus: 'active', plan: 'starter10' } } as any).where(eq(t.schema.company.id, co.id))
    const r = await bearer(access)('/api/company', { method: 'PUT', json: { settings: { seatLimit: 0, subscriptionStatus: 'canceled', trialEndsAt: '2099-01-01', plan: 'business50', defaultTaxRate: 5 } } })
    expect(r.status).toBe(200)
    const [after] = await t.db.select().from(t.schema.company).where(eq(t.schema.company.id, co.id)).limit(1)
    const s = after.settings as any
    expect(s.seatLimit).toBe(3)
    expect(s.subscriptionStatus).toBe('active')
    expect(s.plan).toBe('starter10')
    expect(s.trialEndsAt).toBeUndefined()
    expect(s.defaultTaxRate).toBe(5)
  })

  test('S1-12: switching a login off ends its sessions for good — switched back on, the old sign-in stays ended', async () => {
    const [co] = await t.db.select().from(t.schema.company).limit(1)
    // no seat cap here: the test above left one, and switching a login back on spends a seat
    await t.db.update(t.schema.company).set({ settings: {} } as any).where(eq(t.schema.company.id, co.id))
    const [u] = await t.db.insert(t.schema.user).values({ email: 'offon@test.example', passwordHash: await Bun.password.hash(PASSWORD, 'bcrypt'), firstName: 'Off', lastName: 'On', role: 'field', companyId: co.id }).returning()
    const s = await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'offon@test.example', password: PASSWORD } })).json() as any
    await new Promise((r) => setTimeout(r, 1100))
    expect((await bearer(access)(`/api/company/users/${u.id}`, { method: 'PUT', json: { isActive: false } })).status).toBe(200)
    expect((await bearer(access)(`/api/company/users/${u.id}`, { method: 'PUT', json: { isActive: true } })).status).toBe(200)
    expect((await bearer(s.accessToken)('/api/auth/me')).status).toBe(401)
    expect((await t.call('/api/auth/refresh', { method: 'POST', json: { refreshToken: s.refreshToken } })).status).toBe(401)
    // signing in again works
    expect((await t.call('/api/auth/login', { method: 'POST', json: { email: 'offon@test.example', password: PASSWORD } })).status).toBe(200)
  })

  test('S1-7: wrong current passwords on a password change count, and lock the account at ten', async () => {
    const [co] = await t.db.select().from(t.schema.company).limit(1)
    const [u] = await t.db.insert(t.schema.user).values({ email: 'guess@test.example', passwordHash: await Bun.password.hash(PASSWORD, 'bcrypt'), firstName: 'Guess', lastName: 'Me', role: 'field', companyId: co.id }).returning()
    const s = await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'guess@test.example', password: PASSWORD } })).json() as any
    const change = (currentPassword: string) => bearer(s.accessToken)('/api/auth/password', { method: 'PUT', json: { currentPassword, newPassword: 'Brand-new-pass-9' } })
    for (let i = 0; i < 10; i++) expect((await change(`wrong-guess-${i}`)).status).toBe(400)
    // locked: even the right current password is refused now
    expect((await change(PASSWORD)).status).toBe(423)
    await t.db.update(t.schema.user).set({ failedLoginCount: 0, lockedUntil: null }).where(eq(t.schema.user.id, u.id))
    // the ordinary path
    expect((await change(PASSWORD)).status).toBe(200)
  })

  test('S1-5: an email with no login is answered like a wrong password', async () => {
    const r = await t.call('/api/auth/login', { method: 'POST', json: { email: 'nobody@test.example', password: 'whatever-1' } })
    expect(r.status).toBe(401)
    expect((await r.json() as any).error).toBe('Invalid email or password')
  })
})

describe('S1-6: "Require two-factor for everyone" blocks a login with none until it sets one up', () => {
  const login = async (email: string) => await (await t.call('/api/auth/login', { method: 'POST', json: { email, password: PASSWORD } })).json() as any
  const policy = async () => ((await t.db.select().from(t.schema.company).limit(1))[0].settings as any)?.requireMfa
  let adminTok = ''

  beforeAll(async () => {
    const [co] = await t.db.select().from(t.schema.company).limit(1)
    await t.db.update(t.schema.company).set({ settings: {} } as any).where(eq(t.schema.company.id, co.id))
    for (const [email, role] of [['admin6@test.example', 'admin'], ['crew6@test.example', 'crew']]) {
      await t.db.insert(t.schema.user).values({ email, passwordHash: await Bun.password.hash(PASSWORD, 'bcrypt'), firstName: role, lastName: 'Six', role, companyId: co.id })
    }
    adminTok = (await login('admin6@test.example')).accessToken
  }, 60_000)

  test('it is the owner’s switch, and goes on only once the owner has two-factor', async () => {
    // An admin's save does not switch it on (nor off, below): what is stored stays.
    expect((await bearer(adminTok)('/api/company', { method: 'PUT', json: { settings: { requireMfa: true } } })).status).toBe(200)
    expect(await policy()).toBeUndefined()
    // The owner without an authenticator is told to set up their own first.
    await t.db.update(t.schema.mfaDevice).set({ isVerified: false }).where(eq(t.schema.mfaDevice.userId, ownerId))
    const early = await bearer(access)('/api/company', { method: 'PUT', json: { settings: { requireMfa: true } } })
    expect(early.status).toBe(409)
    expect((await early.json() as any).code).toBe('mfa_enrol_first')
    await t.db.update(t.schema.mfaDevice).set({ isVerified: true }).where(eq(t.schema.mfaDevice.userId, ownerId))
    expect((await bearer(access)('/api/company', { method: 'PUT', json: { settings: { requireMfa: true } } })).status).toBe(200)
    expect(await policy()).toBe(true)
    expect((await bearer(adminTok)('/api/company', { method: 'PUT', json: { settings: { requireMfa: null } } })).status).toBe(403) // the admin is now blocked (below)
    expect(await policy()).toBe(true)
  })

  test('a login with no authenticator signs in, reaches its own account, and nothing else until it enrols', async () => {
    const signedIn = await login('admin6@test.example')
    expect(signedIn.accessToken).toBeTruthy()
    expect(signedIn.mfaEnrolmentRequired).toBe(true)
    const admin = bearer(signedIn.accessToken)
    const refused = await admin('/api/contacts')
    expect(refused.status).toBe(403)
    expect((await refused.json() as any).code).toBe('MFA_ENROLMENT_REQUIRED')
    expect((await admin('/api/company/users')).status).toBe(403)
    expect((await admin('/api/auth/me')).status).toBe(200)
    // The owner, who has one, works as before.
    expect((await bearer(access)('/api/contacts')).status).toBe(200)
    // Setting it up opens everything again, on the same session.
    const setup = await (await admin('/api/auth/mfa-devices/setup', { method: 'POST', json: {} })).json() as any
    expect((await admin('/api/auth/mfa-devices/verify', { method: 'POST', json: { deviceId: setup.deviceId, code: codeNow(setup.secret) } })).status).toBe(200)
    expect((await admin('/api/contacts')).status).toBe(200)
  })

  test('switched off by the owner, a login with none works again', async () => {
    const crew = bearer((await login('crew6@test.example')).accessToken)
    expect((await crew('/api/auth/me')).status).toBe(200)
    expect((await crew('/api/jobs')).status).toBe(403)
    expect((await bearer(access)('/api/company', { method: 'PUT', json: { settings: { requireMfa: null } } })).status).toBe(200)
    expect(await policy()).toBeUndefined()
    expect((await crew('/api/jobs')).status).toBe(200)
  })
})
