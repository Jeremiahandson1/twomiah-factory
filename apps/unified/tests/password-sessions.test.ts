// A password change signs out every other device, and keeps the one that changed it (owner, 2026-10-19: "do it the
// right way" — as Google, Microsoft and Shopify do). Shared auth (packages/tenant-backend auth.ts PUT /password,
// middleware.ts sessionEnded) with the unified user's sessions_valid_from:
//   · device B's access token is refused on its very next request (not 15 minutes later), and its refresh token too;
//   · device A, which changed it, is given a new session in the reply and carries on; its old token is over;
//   · a browser on cookies gets the new session as cookies, not in the body;
//   · a reset by email ends every session, the one that asked included;
//   · a wrong current password changes nothing.
import { describe, test, expect, beforeAll } from 'bun:test'
import { bootTenant, seedOwner } from './harness.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let password = ''
const NEW = 'Brand-new-pass-2'
const signIn = async (pw: string) => (await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: pw } })).json()) as { accessToken: string; refreshToken: string }
const me = (access: string) => t.call('/api/auth/me', { headers: { Authorization: `Bearer ${access}` } })
const refresh = (token: string) => t.call('/api/auth/refresh', { method: 'POST', json: { refreshToken: token } })
const nextSecond = () => new Promise((r) => setTimeout(r, 1100))

beforeAll(async () => {
  t = await bootTenant({ vertical: 'store' })
  password = (await seedOwner(t)).password
}, 120_000)

describe('changing a password', () => {
  test('a wrong current password changes nothing and ends nothing', async () => {
    const a = await signIn(password)
    const r = await t.call('/api/auth/password', { method: 'PUT', json: { currentPassword: 'wrong-one', newPassword: NEW }, headers: { Authorization: `Bearer ${a.accessToken}` } })
    expect(r.status).toBe(400)
    expect((await me(a.accessToken)).status).toBe(200)
  })

  test('every other device is signed out at once; this one is given a new session', async () => {
    const a = await signIn(password)
    const b = await signIn(password)
    expect((await me(b.accessToken)).status).toBe(200)
    await nextSecond() // a token's issue time is in whole seconds
    const r = await t.call('/api/auth/password', { method: 'PUT', json: { currentPassword: password, newPassword: NEW }, headers: { Authorization: `Bearer ${a.accessToken}` } })
    expect(r.status).toBe(200)
    const body = await r.json() as any
    expect(body.message).toMatch(/signed out everywhere else/i)
    expect(typeof body.accessToken).toBe('string')
    // Device B: its access token is refused on its next request, and it cannot refresh.
    const bNow = await me(b.accessToken)
    expect(bNow.status).toBe(401)
    expect((await bNow.json() as any).code).toBe('session_ended')
    expect((await refresh(b.refreshToken)).status).toBe(401)
    // Device A: the old tokens are over too; the new session works and refreshes.
    expect((await me(a.accessToken)).status).toBe(401)
    expect((await refresh(a.refreshToken)).status).toBe(401)
    expect((await me(body.accessToken)).status).toBe(200)
    expect((await refresh(body.refreshToken)).status).toBe(200)
    // And the new password signs in.
    expect(typeof (await signIn(NEW)).accessToken).toBe('string')
    password = NEW
  })

  test('a browser on cookies gets its new session as cookies, not in the body', async () => {
    const a = await signIn(password)
    await nextSecond()
    const r = await t.call('/api/auth/password', { method: 'PUT', json: { currentPassword: password, newPassword: 'Cookie-pass-3x' }, headers: { Authorization: `Bearer ${a.accessToken}`, 'X-Auth-Mode': 'cookie' } })
    expect(r.status).toBe(200)
    const body = await r.json() as any
    expect(body.accessToken).toBeUndefined()
    const cookies = r.headers.getSetCookie().join('\n')
    expect(cookies).toContain('tw_access=')
    expect(cookies).toContain('tw_refresh=')
    password = 'Cookie-pass-3x'
  })
})

describe('a reset by email', () => {
  test('ends every session, the one that asked included', async () => {
    const a = await signIn(password)
    await nextSecond()
    await t.db.update(t.schema.user).set({ resetToken: 'reset-tok-123', resetTokenExp: new Date(Date.now() + 3600_000), lastLogin: new Date() } as any)
    const r = await t.call('/api/auth/reset-password', { method: 'POST', json: { token: 'reset-tok-123', password: 'Reset-pass-44x' } })
    expect(r.status).toBe(200)
    expect((await me(a.accessToken)).status).toBe(401)
    expect((await refresh(a.refreshToken)).status).toBe(401)
    expect(typeof (await signIn('Reset-pass-44x')).accessToken).toBe('string')
  })
})
