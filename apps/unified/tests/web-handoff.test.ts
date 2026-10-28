// The phone app opens a desktop page inside the app, already signed in (More menu). The sign-in handoff:
//   · a CODE — random, 60 seconds, once, bound to the person and the business — never the app's long-lived token;
//   · the business's own server turns it into the ordinary cookie web session and sends the person to the page;
//   · signing out of the app ends that web session.
import { describe, test, expect, beforeAll, setSystemTime } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'

let a: Awaited<ReturnType<typeof bootTenant>>
let b: Awaited<ReturnType<typeof bootTenant>>
let access = ''
let refresh = ''
let companyId = ''
let ownerId = ''
const authed = (t: typeof a, tok: string) => (p: string, init: any = {}) => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${tok}` } })
const call = (p: string, init: any = {}) => authed(a, access)(p, init)
const cookies = (r: Response) => Object.fromEntries((r.headers.getSetCookie?.() || []).map((c) => [c.split('=')[0], c]))

async function login(t: typeof a, password: string) {
  const r = await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password } })).json() as any
  return { access: r.accessToken as string, refresh: r.refreshToken as string }
}
const issue = async (path = '/crm/billing') => {
  const r = await call('/api/auth/web-handoff', { method: 'POST', json: { path, refreshToken: refresh } })
  return { status: r.status, body: await r.json() as any }
}

beforeAll(async () => {
  a = await bootTenant({ vertical: 'contractor' })
  const sa = await seedOwner(a)
  companyId = sa.company.id
  ownerId = (sa as any).user?.id
  ;({ access, refresh } = await login(a, sa.password))
  if (!ownerId) ownerId = (await (await call('/api/auth/me')).json() as any).user?.id ?? (await (await call('/api/auth/me')).json() as any).id
  b = await bootTenant({ vertical: 'contractor' })
  await seedOwner(b)
}, 120_000)

describe('the sign-in handoff', () => {
  test('a code opens the page signed in: cookie session, redirect to the page, no token in the address', async () => {
    const { status, body } = await issue('/crm/billing?tab=open')
    expect(status).toBe(201)
    expect(body.expiresInSeconds).toBe(60)
    expect(body.url).toMatch(/^\/api\/auth\/web-handoff\/[A-Za-z0-9_-]{40,}$/)
    expect(body.url).not.toContain(access)
    expect(body.url).not.toContain(refresh)
    const r = await a.call(body.url, { redirect: 'manual' } as any)
    expect(r.status).toBe(302)
    expect(r.headers.get('location')).toBe('/crm/billing?tab=open')
    expect(r.headers.get('cache-control')).toBe('no-store')
    expect(r.headers.get('referrer-policy')).toBe('no-referrer')
    const set = cookies(r)
    expect(set.tw_access).toMatch(/HttpOnly/i)
    expect(set.tw_access).toMatch(/SameSite=Strict/i)
    expect(set.tw_refresh).toMatch(/HttpOnly/i)
    // the cookie really is a session
    const tok = set.tw_access.split(';')[0].split('=')[1]
    const me = await a.call('/api/auth/me', { headers: { Cookie: `tw_access=${tok}` } })
    expect(me.status).toBe(200)
  })

  test('a code works once', async () => {
    const { body } = await issue()
    expect((await a.call(body.url, { redirect: 'manual' } as any)).status).toBe(302)
    expect((await a.call(body.url, { redirect: 'manual' } as any)).status).toBe(410)
  })

  test('an expired code is refused (60 seconds)', async () => {
    const { body } = await issue()
    setSystemTime(new Date(Date.now() + 61_000))
    try { expect((await a.call(body.url, { redirect: 'manual' } as any)).status).toBe(410) } finally { setSystemTime() }
    const fresh = await issue()
    setSystemTime(new Date(Date.now() + 59_000))
    try { expect((await a.call(fresh.body.url, { redirect: 'manual' } as any)).status).toBe(302) } finally { setSystemTime() }
  })

  test('another business\'s server refuses it, and so does a made-up code', async () => {
    const { body } = await issue()
    expect((await b.call(body.url, { redirect: 'manual' } as any)).status).toBe(410)
    expect((await a.call('/api/auth/web-handoff/not-a-code', { redirect: 'manual' } as any)).status).toBe(410)
    // and the real one was not spent by the wrong server
    expect((await a.call(body.url, { redirect: 'manual' } as any)).status).toBe(302)
  })

  test('wrong user: a browser already signed in as someone else is not switched; a deactivated person is refused', async () => {
    const { body } = await issue()
    const other = await a.db.insert(a.schema.user).values({ companyId, email: 'other@test.example', firstName: 'Other', lastName: 'Person', role: 'staff', passwordHash: 'x', isActive: true } as any).returning()
    const jwt = (await import('jsonwebtoken')).default
    const otherAccess = jwt.sign({ userId: other[0].id, companyId, email: 'other@test.example', role: 'staff' }, process.env.JWT_SECRET!, { expiresIn: '5m' })
    const r = await a.call(body.url, { redirect: 'manual', headers: { Cookie: `tw_access=${otherAccess}` } } as any)
    expect(r.status).toBe(403)
    expect(cookies(r).tw_access).toBeUndefined()

    const second = await issue()
    await a.db.update(a.schema.user).set({ isActive: false } as any).where(eq(a.schema.user.id, ownerId))
    try { expect((await a.call(second.body.url, { redirect: 'manual' } as any)).status).toBe(403) }
    finally { await a.db.update(a.schema.user).set({ isActive: true } as any).where(eq(a.schema.user.id, ownerId)) }
  })

  test('a password change after the code was made ends it', async () => {
    const { body } = await issue()
    await a.db.update(a.schema.user).set({ sessionsValidFrom: new Date(Date.now() + 5_000) } as any).where(eq(a.schema.user.id, ownerId))
    try { expect((await a.call(body.url, { redirect: 'manual' } as any)).status).toBe(403) }
    finally { await a.db.update(a.schema.user).set({ sessionsValidFrom: null } as any).where(eq(a.schema.user.id, ownerId)) }
  })

  test('only a page of this site: other origins, protocol-relative, backslash, control characters and API paths are refused', async () => {
    for (const path of ['https://evil.example/x', '//evil.example/x', '/\\evil.example', '/ok\r\nSet-Cookie: x=1', '/api/users', '/api', 'crm/billing', '', 42]) {
      const r = await call('/api/auth/web-handoff', { method: 'POST', json: { path } })
      expect(r.status).toBe(400)
    }
  })

  test('asking for a code needs a sign-in', async () => {
    const r = await a.call('/api/auth/web-handoff', { method: 'POST', json: { path: '/crm/billing' } })
    expect(r.status).toBe(401)
  })

  test('signing out of the app ends the web session it opened', async () => {
    const s = await login(a, 'Correct-horse-1')
    const issueFor = await authed(a, s.access)('/api/auth/web-handoff', { method: 'POST', json: { path: '/crm/billing', refreshToken: s.refresh } })
    const url = (await issueFor.json() as any).url
    const opened = await a.call(url, { redirect: 'manual' } as any)
    const refreshCookieValue = cookies(opened).tw_refresh.split(';')[0].split('=')[1]
    const before = await a.call('/api/auth/refresh', { method: 'POST', json: {}, headers: { 'X-Auth-Mode': 'cookie', Cookie: `tw_refresh=${refreshCookieValue}` } })
    expect(before.status).toBe(200)
    await authed(a, s.access)('/api/auth/logout', { method: 'POST', json: { refreshToken: s.refresh } })
    const after = await a.call('/api/auth/refresh', { method: 'POST', json: {}, headers: { 'X-Auth-Mode': 'cookie', Cookie: `tw_refresh=${refreshCookieValue}` } })
    expect(after.status).toBe(401)
  })
})
