// The unified server boots on an empty database and its core holds: sign-in, the one API door, feature switches,
// the Factory's key, paging, replies in the rulebook's shapes, and an audit row for a sign-in.
import { describe, test, expect, beforeAll } from 'bun:test'
import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { mountAll } from '../server/http/registry.ts'
import { one } from '../server/http/reply.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let seeded: Awaited<ReturnType<typeof seedOwner>>

beforeAll(async () => {
  t = await bootTenant()
  seeded = await seedOwner(t)
})

const login = (password: string) => t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password } })

describe('boot', () => {
  test('every migration applies to an empty database', async () => {
    const r: any = await t.client.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY 1`)
    expect(r.rows.map((x: any) => x.table_name)).toEqual([
      'audit_log', 'company', 'contact', 'email_alias', 'lead', 'lead_source', 'mfa_challenges', 'mfa_devices',
      'page', 'page_view', 'photo', 'portfolio_item', 'post', 'site', 'user',
    ])
  })

  test('health answers', async () => {
    const res = await t.call('/health')
    expect(res.status).toBe(200)
    expect((await res.json()).status).toBe('ok')
  })

  test('an unknown API path is a JSON 404, not a page', async () => {
    const res = await t.call('/api/nothing-here')
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Route not found: GET /api/nothing-here' })
  })

  test('a bad page number is refused in the error shape', async () => {
    const res = await t.call('/api/nothing-here?page=-1')
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Invalid page: must be an integer ≥ 1', code: 'invalid_pagination' })
  })
})

describe('sign-in', () => {
  test('a wrong password is refused', async () => {
    const res = await login('wrong-password-1')
    expect(res.status).toBe(401)
    expect(typeof (await res.json()).error).toBe('string')
  })

  test('the owner signs in and /me answers who they are, as the contractor vertical', async () => {
    const res = await login(seeded.password)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(typeof body.accessToken).toBe('string')
    const me = await t.call('/api/auth/me', { headers: { Authorization: `Bearer ${body.accessToken}` } })
    expect(me.status).toBe(200)
    const who = await me.json()
    expect(JSON.stringify(who)).toContain('owner@test.example')
    expect(JSON.stringify(who)).toContain('"vertical":"contractor"')
  })

  test('the sign-in is in the audit log, with the person', async () => {
    const rows = await t.db.select().from(t.schema.auditLog).where(eq(t.schema.auditLog.action, 'login'))
    expect(rows.length).toBeGreaterThan(0)
    expect(rows[0].userEmail).toBe('owner@test.example')
    expect(rows[0].companyId).toBe(seeded.company.id)
  })

  test('two-factor enrolment needs a session', async () => {
    const res = await t.call('/api/auth/mfa-devices')
    expect(res.status).toBe(401)
  })
})

describe('the browser session in cookies (SPEC §5.3)', () => {
  const cookieLogin = () => t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: seeded.password }, headers: { 'X-Auth-Mode': 'cookie' } })
  /** name=value pairs from a response's Set-Cookie headers, plus each cookie's attributes. */
  const cookiesOf = (res: Response) => {
    const out: Record<string, { value: string; attrs: string }> = {}
    for (const line of res.headers.getSetCookie()) {
      const [pair, ...attrs] = line.split(';')
      const i = pair.indexOf('=')
      out[pair.slice(0, i).trim()] = { value: pair.slice(i + 1).trim(), attrs: attrs.join(';') }
    }
    return out
  }

  test('sign-in sets both tokens as httpOnly, SameSite=Strict cookies and leaves them out of the reply', async () => {
    const res = await cookieLogin()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.accessToken).toBeUndefined()
    expect(body.refreshToken).toBeUndefined()
    expect(body.user.email).toBe('owner@test.example')
    const c = cookiesOf(res)
    expect(c.tw_access.value.length).toBeGreaterThan(20)
    expect(c.tw_access.attrs).toMatch(/HttpOnly/i)
    expect(c.tw_access.attrs).toMatch(/SameSite=Strict/i)
    expect(c.tw_refresh.attrs).toMatch(/Path=\/api\/auth/i)
  })

  test('the cookie signs a request in; a change it signs without X-Auth-Mode is refused', async () => {
    const c = cookiesOf(await cookieLogin())
    const cookie = `tw_access=${c.tw_access.value}`
    expect((await t.call('/api/auth/me', { headers: { Cookie: cookie } })).status).toBe(200)
    const bare = await t.call('/api/auth/logout', { method: 'POST', json: {}, headers: { Cookie: cookie } })
    expect(bare.status).toBe(403)
    expect((await bare.json()).code).toBe('auth_mode_required')
  })

  test('refresh renews the access cookie from the refresh cookie; sign-out clears both and revokes the device', async () => {
    const c = cookiesOf(await cookieLogin())
    const both = `tw_access=${c.tw_access.value}; tw_refresh=${c.tw_refresh.value}`
    const refreshed = await t.call('/api/auth/refresh', { method: 'POST', json: {}, headers: { Cookie: `tw_refresh=${c.tw_refresh.value}`, 'X-Auth-Mode': 'cookie' } })
    expect(refreshed.status).toBe(200)
    expect(await refreshed.json()).toEqual({ refreshed: true })
    expect(cookiesOf(refreshed).tw_access.value.length).toBeGreaterThan(20)

    const out = await t.call('/api/auth/logout', { method: 'POST', json: {}, headers: { Cookie: both, 'X-Auth-Mode': 'cookie' } })
    expect(out.status).toBe(200)
    const cleared = cookiesOf(out)
    expect(cleared.tw_access.attrs).toMatch(/Max-Age=0/i)
    expect(cleared.tw_refresh.attrs).toMatch(/Max-Age=0/i)
    const again = await t.call('/api/auth/refresh', { method: 'POST', json: {}, headers: { Cookie: `tw_refresh=${c.tw_refresh.value}`, 'X-Auth-Mode': 'cookie' } })
    expect(again.status).toBe(401)
  })

  test('without the header, sign-in answers with the tokens as it always has (the mobile app, scripts)', async () => {
    const body = await (await login(seeded.password)).json()
    expect(typeof body.accessToken).toBe('string')
    expect(typeof body.refreshToken).toBe('string')
  })
})

describe('the one API door (registry)', () => {
  // A small app with three probe modules mounted the only way the rulebook allows.
  const probe = () => new Hono().get('/', (c) => one(c, { reached: true }))
  let app: Hono
  let token: string

  beforeAll(async () => {
    app = new Hono()
    mountAll(app, [
      { path: '/api/probe-user', access: 'user', router: probe(), feature: 'probe_feature' },
      { path: '/api/probe-public', access: 'public', router: probe(), feature: 'probe_feature' },
      { path: '/api/probe-factory', access: 'factory', router: probe() },
    ], {
      authenticate: t.services.authenticate,
      requireEnabledFeature: t.services.features.requireEnabledFeature,
      isFeatureEnabled: t.services.features.isFeatureEnabled,
      companyId: t.services.companyId,
    })
    token = (await (await login(seeded.password)).json()).accessToken
  })

  const get = (path: string, headers: Record<string, string> = {}) => app.request(path, { headers })

  test('a signed-in module refuses anyone not signed in', async () => {
    expect((await get('/api/probe-user')).status).toBe(401)
  })

  test('a switched-off module is refused at the server, signed in or public', async () => {
    const res = await get('/api/probe-user', { Authorization: `Bearer ${token}` })
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('FEATURE_NOT_ENABLED')
    expect((await get('/api/probe-public')).status).toBe(404)
  })

  test('switching the feature on opens both', async () => {
    await t.db.update(t.schema.company).set({ enabledFeatures: ['probe_feature'] }).where(eq(t.schema.company.id, seeded.company.id))
    t.services.features.forgetFeatures()
    expect((await get('/api/probe-user', { Authorization: `Bearer ${token}` })).status).toBe(200)
    expect((await get('/api/probe-public')).status).toBe(200)
  })

  test("the Factory's door: closed with no key configured, refused with a wrong key, open with the right one", async () => {
    delete process.env.FACTORY_SYNC_KEY
    expect((await get('/api/probe-factory')).status).toBe(503)
    process.env.FACTORY_SYNC_KEY = 'factory-key-for-test'
    expect((await get('/api/probe-factory', { 'X-Factory-Key': 'wrong-key-for-test!!' })).status).toBe(401)
    expect((await get('/api/probe-factory', { 'X-Factory-Key': 'factory-key-for-test' })).status).toBe(200)
  })

  test('a path declared twice is a startup error, not a silent second mount', () => {
    expect(() => mountAll(new Hono(), [
      { path: '/api/twice', access: 'public', router: probe() },
      { path: '/api/twice', access: 'public', router: probe() },
    ], {} as any)).toThrow('declared twice')
  })
})
