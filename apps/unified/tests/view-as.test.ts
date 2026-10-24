// View As for every vertical (server/core/viewAs.ts) — owner's live re-test 3, 2026-10-24: the testers could not check
// a manager, staff, admin or viewer login without their passwords. Through the real server, signed in through the real
// login, in the screens' cookie session and with a Bearer token.
//
//   · who may start one (users:view-as: the owner and admins), and never on the owner, yourself, a switched-off login,
//     or anyone whose access is wider than yours — an admin cannot escalate through it;
//   · while it lasts the app is exactly the person's: /me, their permissions, their refusals, their writes;
//   · it cannot touch their sign-in or access;
//   · it ends on Return (the owner's own session back, no sign-in), on timing out, and the moment its premise breaks;
//   · start, every write (allowed or refused) and the end are in the audit log with BOTH people.
import { describe, test, expect, beforeAll } from 'bun:test'
import { sql } from 'drizzle-orm'
import jwt from 'jsonwebtoken'
import { bootTenant, seedOwner } from './harness.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId = ''
const ids: Record<string, string> = {}
const PASSWORD = 'Pass-word-1'
let ownerPassword = ''
const rows = async (q: any) => ((await t.db.execute(q)) as any).rows as any[]

type Jar = Record<string, string>
const absorb = (jar: Jar, r: Response) => {
  for (const line of r.headers.getSetCookie()) {
    const [pair] = line.split(';')
    const i = pair.indexOf('=')
    const name = pair.slice(0, i), value = pair.slice(i + 1)
    if (!value || /max-age=0/i.test(line)) delete jar[name]; else jar[name] = value
  }
  return r
}
const cookieOf = (jar: Jar) => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ')
/** A browser: the screens' cookie session (X-Auth-Mode: cookie), signed in through the real login. */
async function browser(email: string, password = PASSWORD) {
  const jar: Jar = {}
  const go = async (path: string, init: any = {}) =>
    absorb(jar, await t.call(path, { ...init, headers: { 'X-Auth-Mode': 'cookie', Cookie: cookieOf(jar), ...(init.headers || {}) } }))
  const r = await go('/api/auth/login', { method: 'POST', json: { email, password } })
  expect(r.status).toBe(200)
  return { jar, go }
}
const bearerOf = async (email: string, password = PASSWORD) =>
  (await (await t.call('/api/auth/login', { method: 'POST', json: { email, password } })).json()).accessToken as string
const withToken = (token: string, path: string, init: any = {}) => t.call(path, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` } })

beforeAll(async () => {
  t = await bootTenant({ vertical: 'contractor' })
  const seeded = await seedOwner(t)
  companyId = seeded.company.id
  ids.owner = seeded.owner.id
  ownerPassword = seeded.password
  await t.db.execute(sql`UPDATE company SET enabled_features = '["contacts","jobs"]'::json WHERE id = ${companyId}`)
  t.services.features.forgetFeatures()
  for (const [key, role] of [['admin', 'admin'], ['admin2', 'admin'], ['mgr', 'manager'], ['staff', 'field'], ['viewer', 'viewer'], ['off', 'field'], ['wide', 'field']] as const) {
    const [u] = await t.db.insert(t.schema.user).values({
      email: `${key}@test.example`, passwordHash: await Bun.password.hash(PASSWORD, 'bcrypt'),
      firstName: key[0].toUpperCase() + key.slice(1), lastName: 'Person', role, companyId, isActive: key !== 'off',
    } as any).returning()
    ids[key] = u.id
  }
  // A field login the owner has granted something no admin holds: an admin viewing as them would escalate.
  await t.db.execute(sql`UPDATE "user" SET extra_permissions = '["company:delete"]'::json WHERE id = ${ids.wide}`)
  // The manager was given the user list by name (the one grant an owner can hand out): seeing logins is not acting as them.
  await t.db.execute(sql`UPDATE "user" SET extra_permissions = '["users:read"]'::json WHERE id = ${ids.mgr}`)
})

describe('who may start a View As, and of whom', () => {
  test('the owner and admins only — users:view-as, which the user-list grant does not carry', async () => {
    for (const who of ['mgr', 'staff', 'viewer']) {
      const r = await withToken(await bearerOf(`${who}@test.example`), `/api/auth/impersonate/${ids.viewer}`, { method: 'POST' })
      expect({ who, status: r.status }).toEqual({ who, status: 403 })
    }
    const owner = await bearerOf('owner@test.example', ownerPassword)
    expect((await withToken(owner, `/api/auth/impersonate/${ids.admin}`, { method: 'POST' })).status).toBe(200)
    const admin = await bearerOf('admin@test.example')
    expect((await withToken(admin, `/api/auth/impersonate/${ids.staff}`, { method: 'POST' })).status).toBe(200)
    expect((await withToken(admin, `/api/auth/impersonate/${ids.admin2}`, { method: 'POST' })).status).toBe(200)
  })

  test('never the owner, never yourself, never a switched-off login, never someone unknown', async () => {
    const admin = await bearerOf('admin@test.example')
    const owner = await bearerOf('owner@test.example', ownerPassword)
    const cases: Array<[string, string, number, string | undefined]> = [
      [admin, ids.owner, 403, 'owner_account'],
      [admin, ids.admin, 400, 'own_account'],
      [owner, ids.owner, 400, 'own_account'],
      [admin, ids.off, 400, 'inactive'],
      [admin, 'no-such-person', 404, undefined],
    ]
    for (const [token, target, status, code] of cases) {
      const r = await withToken(token, `/api/auth/impersonate/${target}`, { method: 'POST' })
      const body = await r.json()
      expect({ target, status: r.status, code: body.code }).toEqual({ target, status, code })
    }
  })

  test('an admin cannot escalate: someone holding access the admin lacks is refused; the owner may', async () => {
    const admin = await bearerOf('admin@test.example')
    const r = await withToken(admin, `/api/auth/impersonate/${ids.wide}`, { method: 'POST' })
    expect(r.status).toBe(403)
    expect((await r.json()).code).toBe('beyond_your_access')
    const owner = await bearerOf('owner@test.example', ownerPassword)
    expect((await withToken(owner, `/api/auth/impersonate/${ids.wide}`, { method: 'POST' })).status).toBe(200)
  })

  test('a Bearer start answers a 2-hour token naming both people; a start is audited before it opens', async () => {
    const owner = await bearerOf('owner@test.example', ownerPassword)
    const r = await withToken(owner, `/api/auth/impersonate/${ids.mgr}`, { method: 'POST' })
    const body = await r.json()
    const d: any = jwt.decode(body.token)
    expect(d).toMatchObject({ userId: ids.mgr, role: 'manager', impersonation: true, impersonatorId: ids.owner, impersonatedBy: 'owner@test.example' })
    expect(d.exp - d.iat).toBe(2 * 3600)
    expect(body.user).toMatchObject({ id: ids.mgr, name: 'Mgr Person', roleLabel: 'Manager' })
    const [row] = await rows(sql`SELECT action, user_id, entity_id, entity_name, metadata FROM audit_log WHERE action = 'view_as_start' AND entity_id = ${ids.mgr} ORDER BY created_at DESC LIMIT 1`)
    expect(row).toMatchObject({ action: 'view_as_start', user_id: ids.owner, entity_id: ids.mgr, entity_name: 'Mgr Person' })
    expect(row.metadata.description).toBe('Started viewing as Mgr Person (Manager)')
  })
})

describe('while viewing, the app is exactly the person’s', () => {
  test('/me, permissions and the banner are theirs; their refusals are real; Return gives the owner back without a sign-in', async () => {
    const { jar, go } = await browser('owner@test.example', ownerPassword)
    const own = await (await go('/api/auth/me')).json()
    expect(own.user.id).toBe(ids.owner)
    const staffAlone = await (await t.call('/api/auth/me', { headers: { Authorization: `Bearer ${await bearerOf('staff@test.example')}` } })).json()

    const start = await go(`/api/auth/impersonate/${ids.staff}`, { method: 'POST' })
    expect(start.status).toBe(200)
    expect('token' in (await start.json())).toBe(false)
    const set = start.headers.getSetCookie().find((l) => l.startsWith('tw_view_as='))!
    expect(set).toMatch(/HttpOnly/i)
    expect(Number(/Max-Age=(\d+)/i.exec(set)?.[1])).toBe(2 * 3600 - 60)

    const me = await (await go('/api/auth/me')).json()
    expect(me.user.id).toBe(ids.staff)
    // Exactly their permissions: the same list their own sign-in answers.
    expect([...me.permissions].sort()).toEqual([...staffAlone.permissions].sort())
    const banner = await (await go('/api/auth/impersonate')).json()
    expect(banner).toMatchObject({ active: true, name: 'Staff Person', role: 'field', roleLabel: 'Staff', impersonatedBy: 'owner@test.example', impersonatorName: 'Olive Owner' })
    expect(typeof banner.expiresAt).toBe('string')

    // A write the person may not make is refused exactly as it is for them, and recorded with both people.
    const refused = await go('/api/contacts', { method: 'POST', json: { name: 'Should Not Exist' } })
    expect(refused.status).toBe(403)
    expect((await refused.json()).yourRole).toBe('Staff')
    const [r1] = await rows(sql`SELECT user_id, impersonator_id, impersonator_email, metadata FROM audit_log WHERE action = 'view_as_refused' ORDER BY created_at DESC LIMIT 1`)
    expect(r1).toMatchObject({ user_id: ids.staff, impersonator_id: ids.owner, impersonator_email: 'owner@test.example' })
    expect(r1.metadata).toMatchObject({ method: 'POST', path: '/api/contacts', status: 403 })
    // Every read answers exactly as it does for them.
    const theirs = await bearerOf('staff@test.example')
    for (const path of ['/api/company/users', '/api/audit', '/api/contacts', '/api/jobs', '/api/company']) {
      expect({ path, status: (await go(path)).status }).toEqual({ path, status: (await withToken(theirs, path)).status })
    }
    expect((await go('/api/audit')).status).toBe(403)

    // Return.
    const back = await go('/api/auth/logout', { method: 'POST', json: {} })
    expect(back.status).toBe(200)
    expect(jar.tw_view_as).toBeUndefined()
    expect(jar.tw_access).toBeTruthy()
    expect((await (await go('/api/auth/me')).json()).user.id).toBe(ids.owner)
    expect(await (await go('/api/auth/impersonate')).json()).toEqual({ active: false })
    const [end] = await rows(sql`SELECT user_id, entity_id, metadata FROM audit_log WHERE action = 'view_as_end' ORDER BY created_at DESC LIMIT 1`)
    expect(end).toMatchObject({ user_id: ids.owner, entity_id: ids.staff })
    expect(end.metadata.reason).toBe('returned')
    // The viewed person's own sessions are untouched by Return.
    const staffToken = await bearerOf('staff@test.example')
    expect((await withToken(staffToken, '/api/auth/me')).status).toBe(200)
  })

  test('a write the person IS allowed goes through as them, recorded with both people', async () => {
    const { go } = await browser('admin@test.example')
    expect((await go(`/api/auth/impersonate/${ids.mgr}`, { method: 'POST' })).status).toBe(200)
    const made = await go('/api/contacts', { method: 'POST', json: { name: 'Made While Viewing' } })
    expect(made.status).toBe(201)
    const contact = await made.json()
    const [row] = await rows(sql`SELECT user_id, user_email, impersonator_id, impersonator_email FROM audit_log WHERE entity_id = ${contact.id} ORDER BY created_at DESC LIMIT 1`)
    expect(row).toEqual({ user_id: ids.mgr, user_email: 'mgr@test.example', impersonator_id: ids.admin, impersonator_email: 'admin@test.example' })
    // Outside a View As the column is empty.
    const plain = await withToken(await bearerOf('mgr@test.example'), '/api/contacts', { method: 'POST', json: { name: 'Made By Them' } })
    const [mine] = await rows(sql`SELECT user_id, impersonator_id FROM audit_log WHERE entity_id = ${(await plain.json()).id} LIMIT 1`)
    expect(mine).toEqual({ user_id: ids.mgr, impersonator_id: null })
    await go('/api/auth/logout', { method: 'POST', json: {} })
  })

  test('their sign-in and access are out of reach: password, profile, two-factor, their seat, ownership, push', async () => {
    const { go } = await browser('owner@test.example', ownerPassword)
    expect((await go(`/api/auth/impersonate/${ids.admin2}`, { method: 'POST' })).status).toBe(200)
    const tries: Array<[string, string, unknown]> = [
      ['PUT', '/api/auth/password', { currentPassword: PASSWORD, newPassword: 'Another-pass-9' }],
      ['PUT', '/api/auth/profile', { firstName: 'Changed', lastName: 'Name' }],
      ['POST', '/api/auth/mfa-devices/setup', { name: 'phone' }],
      ['PUT', `/api/company/users/${ids.admin2}`, { firstName: 'Changed' }],
      ['POST', `/api/company/users/${ids.admin2}/password`, { password: 'Another-pass-9' }],
      ['POST', '/api/company/transfer-ownership', { userId: ids.admin2 }],
      ['POST', '/api/push/expo-token', { token: 'ExponentPushToken[x]' }],
    ]
    for (const [method, path, json] of tries) {
      const r = await go(path, { method, json })
      expect({ path, status: r.status, code: (await r.json()).code }).toEqual({ path, status: 403, code: 'view_as_not_allowed' })
    }
    // Nor a View As from inside one.
    const nested = await go(`/api/auth/impersonate/${ids.staff}`, { method: 'POST' })
    expect(nested.status).toBe(403)
    expect((await nested.json()).code).toBe('view_as_nested')
    const [admin2] = await rows(sql`SELECT first_name FROM "user" WHERE id = ${ids.admin2}`)
    expect(admin2.first_name).toBe('Admin2')
    // The password still signs in, unchanged.
    expect(await bearerOf('admin2@test.example')).toBeTruthy()
    await go('/api/auth/logout', { method: 'POST', json: {} })
  })

  test('an admin viewing as another admin holds no more than an admin: the owner stays out of reach', async () => {
    const { go } = await browser('admin@test.example')
    expect((await go(`/api/auth/impersonate/${ids.admin2}`, { method: 'POST' })).status).toBe(200)
    expect((await go(`/api/company/users/${ids.owner}`, { method: 'PUT', json: { role: 'viewer' } })).status).toBe(403)
    expect((await go(`/api/company/users/${ids.staff}`, { method: 'PUT', json: { extraPermissions: ['users:read'] } })).status).toBe(403)
    expect((await go(`/api/auth/impersonate/${ids.owner}`, { method: 'POST' })).status).toBe(403)
    const [owner] = await rows(sql`SELECT role FROM "user" WHERE id = ${ids.owner}`)
    expect(owner.role).toBe('owner')
    await go('/api/auth/logout', { method: 'POST', json: {} })
  })
})

describe('it ends, and says so', () => {
  test('timing out: the run-out cookie is dropped, the owner carries on, the end is recorded', async () => {
    const { jar, go } = await browser('owner@test.example', ownerPassword)
    jar.tw_view_as = jwt.sign({ userId: ids.viewer, companyId, email: 'viewer@test.example', role: 'viewer', name: 'Viewer Person', impersonation: true, impersonatorId: ids.owner, impersonatedBy: 'owner@test.example', exp: Math.floor(Date.now() / 1000) - 5 }, process.env.JWT_SECRET!)
    const r = await go('/api/contacts')
    expect(r.status).toBe(401)
    expect((await r.json()).code).toBe('view_as_ended')
    expect(jar.tw_view_as).toBeUndefined()
    expect((await (await go('/api/auth/me')).json()).user.id).toBe(ids.owner)
    const [end] = await rows(sql`SELECT user_id, entity_id, metadata FROM audit_log WHERE action = 'view_as_end' AND entity_id = ${ids.viewer} ORDER BY created_at DESC LIMIT 1`)
    expect(end).toMatchObject({ user_id: ids.owner, entity_id: ids.viewer })
    expect(end.metadata.reason).toBe('timed_out')
  })

  test('the moment its premise breaks: the person given wider access, re-roled, or the opener switched off', async () => {
    const owner = await bearerOf('owner@test.example', ownerPassword)
    // Given access the admin lacks, mid-View-As.
    {
      const { go } = await browser('admin@test.example')
      expect((await go(`/api/auth/impersonate/${ids.viewer}`, { method: 'POST' })).status).toBe(200)
      expect((await go('/api/contacts')).status).toBe(200)
      await t.db.execute(sql`UPDATE "user" SET extra_permissions = '["company:delete"]'::json WHERE id = ${ids.viewer}`)
      t.services.permissions.invalidateExtraPermissions(ids.viewer)
      const r = await go('/api/contacts')
      expect(r.status).toBe(401)
      expect((await r.json()).code).toBe('view_as_ended')
      await t.db.execute(sql`UPDATE "user" SET extra_permissions = '[]'::json WHERE id = ${ids.viewer}`)
      t.services.permissions.invalidateExtraPermissions(ids.viewer)
    }
    // Re-roled.
    {
      const { go } = await browser('owner@test.example', ownerPassword)
      expect((await go(`/api/auth/impersonate/${ids.viewer}`, { method: 'POST' })).status).toBe(200)
      expect((await withToken(owner, `/api/company/users/${ids.viewer}`, { method: 'PUT', json: { role: 'manager' } })).status).toBe(200)
      expect((await go('/api/contacts')).status).toBe(401)
      expect((await withToken(owner, `/api/company/users/${ids.viewer}`, { method: 'PUT', json: { role: 'viewer' } })).status).toBe(200)
    }
    // The opener switched off.
    {
      const { go } = await browser('admin2@test.example')
      expect((await go(`/api/auth/impersonate/${ids.viewer}`, { method: 'POST' })).status).toBe(200)
      expect((await withToken(owner, `/api/company/users/${ids.admin2}`, { method: 'PUT', json: { isActive: false } })).status).toBe(200)
      const r = await go('/api/contacts')
      expect(r.status).toBe(401)
      expect((await withToken(owner, `/api/company/users/${ids.admin2}`, { method: 'PUT', json: { isActive: true } })).status).toBe(200)
    }
    const reasons = (await rows(sql`SELECT metadata FROM audit_log WHERE action = 'view_as_end' AND entity_id = ${ids.viewer}`)).map((r) => r.metadata.reason)
    expect(reasons).toEqual(expect.arrayContaining(['not_allowed', 'role_changed', 'opener_inactive']))
  })
})

describe('every vertical has it', () => {
  test('home care: an office seat writes as itself; a caregiver is read-only (first-hand care and EVV records)', async () => {
    const hc = await bootTenant({ vertical: 'homecare' })
    const seeded = await seedOwner(hc)
    const co = seeded.company.id
    const made: Record<string, string> = {}
    for (const [key, role] of [['admin', 'admin'], ['office', 'manager'], ['cg', 'caregiver']] as const) {
      const [u] = await hc.db.insert(hc.schema.user).values({ email: `${key}@test.example`, passwordHash: await Bun.password.hash(PASSWORD, 'bcrypt'), firstName: key, lastName: 'Tester', role, companyId: co } as any).returning()
      made[key] = u.id
    }
    const [client] = await hc.db.insert(hc.schema.clients).values({ companyId: co, firstName: 'Ada', lastName: 'Member' } as any).returning()
    const admin = (await (await hc.call('/api/auth/login', { method: 'POST', json: { email: 'admin@test.example', password: PASSWORD } })).json()).accessToken
    const view = async (id: string) => (await (await hc.call(`/api/auth/impersonate/${id}`, { method: 'POST', headers: { Authorization: `Bearer ${admin}` } })).json())
    const incident = { clientId: client.id, caregiverId: made.cg, incidentType: 'fall', severity: 'moderate', incidentDate: '2026-03-02', incidentTime: '10:15', description: 'Slipped in the kitchen.' }

    const office = await view(made.office)
    expect(office.user.roleLabel).toBe('Office Manager')
    const wrote = await hc.call('/api/incidents', { method: 'POST', json: incident, headers: { Authorization: `Bearer ${office.token}` } })
    expect(wrote.status).toBe(201)
    const id = (await wrote.json()).id
    const [row] = ((await hc.db.execute(sql`SELECT user_id, impersonator_id FROM audit_log WHERE entity_id = ${id} LIMIT 1`)) as any).rows
    expect(row).toEqual({ user_id: made.office, impersonator_id: made.admin })
    const [trail] = ((await hc.db.execute(sql`SELECT user_id, record_id FROM audit_logs WHERE action = 'ADMIN_IMPERSONATE' AND record_id = ${made.office}`)) as any).rows
    expect(trail).toEqual({ user_id: made.admin, record_id: made.office })

    const cg = await view(made.cg)
    expect(cg.user.roleLabel).toBe('Caregiver')
    const refused = await hc.call('/api/incidents/caregiver-report', { method: 'POST', json: { clientId: client.id, incidentType: 'fall', incidentDate: '2026-01-01', description: 'x' }, headers: { Authorization: `Bearer ${cg.token}` } })
    expect(refused.status).toBe(403)
    expect((await refused.json()).code).toBe('view_as_read_only')
    expect((await hc.call('/api/auth/me', { headers: { Authorization: `Bearer ${cg.token}` } })).status).toBe(200)
  })

  test('roofing: the field seat is called Field everywhere — the server, the screens and the banner', async () => {
    const roof = await bootTenant({ vertical: 'roofing' })
    const seeded = await seedOwner(roof)
    const [crew] = await roof.db.insert(roof.schema.user).values({ email: 'crew@test.example', passwordHash: await Bun.password.hash(PASSWORD, 'bcrypt'), firstName: 'Casey', lastName: 'Crew', role: 'field', companyId: seeded.company.id } as any).returning()
    const token = (await (await roof.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: seeded.password } })).json()).accessToken
    const start = await roof.call(`/api/auth/impersonate/${crew.id}`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } })
    expect(start.status).toBe(200)
    const { token: viewing, user } = await start.json()
    expect(user.roleLabel).toBe('Field')
    const banner = await (await roof.call('/api/auth/impersonate', { headers: { Authorization: `Bearer ${viewing}` } })).json()
    expect(banner).toMatchObject({ active: true, name: 'Casey Crew', roleLabel: 'Field' })
    const users = await (await roof.call('/api/company/users', { headers: { Authorization: `Bearer ${token}` } })).json()
    expect(users.find((u: any) => u.id === crew.id).roleLabel).toBe('Field')
  })
})
