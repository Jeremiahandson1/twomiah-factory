// Tips from another register (restaurant-bar parity #17): a venue on Square or Toast connects it, and the tips it took join the pool and
// the tip-out. Toast and Square are FAKES of their documented APIs here (the hostnames are caught before the network): nothing in this file
// calls a live provider, and nothing can say whether the real services answer as the documents say.
import { describe, test, expect, beforeAll, afterAll, setSystemTime } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootFood } from './foodKit.ts'
import { decryptJSON } from '../server/core/crypto.ts'
import type { TipRules } from '../server/crm/bar/barTipMath.ts'

process.env.ENCRYPTION_KEY ||= 'test-encryption-key'
process.env.SQUARE_OAUTH_CLIENT_ID = 'sq0idp-twomiah'
process.env.SQUARE_OAUTH_CLIENT_SECRET = 'sq0csp-APP-SECRET'
process.env.JWT_SECRET ||= 'test-jwt-secret'

const RULES: TipRules = {
  defaultRole: 'Bartender',
  roles: [
    { name: 'Bartender', positions: ['Bar'], mode: 'pools', poolPct: 70 },
    { name: 'Barback', positions: ['Bar back'], mode: 'pools', poolPct: 30 },
    { name: 'Server', positions: ['Floor'], mode: 'keeps', poolPct: 0 },
  ],
  tipOuts: [{ from: 'Server', to: 'Barback', pct: 10, basis: 'tips' }],
}
const ON = ['contacts', 'bar_menu', 'bar_register', 'bar_schedule', 'time_tracking', 'bar_tip_pooling']
let k: Awaited<ReturnType<typeof bootFood>>
let day = ''
let realFetch: typeof fetch
const ins = async (table: any, values: any) => ((await k.t.db.insert(table).values(values).returning()) as any[])[0]
const rows = async (table: any) => (await (k.t.db as any).select().from(table)) as any[]

// ── The fakes ──────────────────────────────────────────────────────────────────────────────────────────────
const sq = {
  calls: [] as Array<{ method: string; path: string; auth: string; body?: any }>,
  token: 'sq_at_1', refresh: 'sq_rt_1', revoked: false, pageSize: 2,
  team: [
    { id: 'TM_BART', given_name: 'Bartender', family_name: 'Seat', email_address: 'bartender@bar.test', status: 'ACTIVE' },
    { id: 'TM_MGR', given_name: 'Manager', family_name: 'Seat', email_address: 'MANAGER@bar.test', status: 'ACTIVE' },
    { id: 'TM_GHOST', given_name: 'Ghost', family_name: 'Server', email_address: 'ghost@elsewhere.test', status: 'ACTIVE' },
  ],
  payments: [] as any[],
}
const toast = {
  calls: [] as Array<{ path: string; auth: string; guid: string }>,
  logins: 0, secret: 'toast-secret-XYZ', orders: [] as any[],
  staff: [
    { guid: 'EMP_BART', firstName: 'Bartender', lastName: 'Seat', email: 'bartender@bar.test', deleted: false },
    { guid: 'EMP_GONE', firstName: 'Gone', lastName: 'Away', email: 'gone@bar.test', deleted: true },
  ],
}
const json = (j: unknown, status = 200) => new Response(JSON.stringify(j), { status, headers: { 'content-type': 'application/json' } })

function fakeSquare(url: URL, init: any): Response {
  const auth = String(init?.headers?.Authorization ?? '')
  const body = init?.body ? JSON.parse(init.body) : undefined
  sq.calls.push({ method: init?.method || 'GET', path: url.pathname, auth, body })
  if (url.pathname === '/oauth2/token') {
    if (body.client_secret !== 'sq0csp-APP-SECRET') return json({ errors: [{ detail: 'bad secret' }] }, 401)
    if (body.grant_type === 'authorization_code') {
      if (body.code !== 'sq_code_1') return json({ errors: [{ detail: 'bad code' }] }, 400)
      // Ends in 3 days: inside Square's "renew at 7 days or less", so the first read must renew it.
      return json({ access_token: 'sq_at_1', token_type: 'bearer', refresh_token: 'sq_rt_1', merchant_id: 'MERCH1', expires_at: new Date(Date.now() + 3 * 86400_000).toISOString() })
    }
    if (body.grant_type === 'refresh_token' && body.refresh_token === sq.refresh) { sq.token = 'sq_at_2'; return json({ access_token: 'sq_at_2', token_type: 'bearer', refresh_token: 'sq_rt_2', merchant_id: 'MERCH1', expires_at: new Date(Date.now() + 30 * 86400_000).toISOString() }) }
    return json({ errors: [{ detail: 'invalid_grant' }] }, 400)
  }
  if (sq.revoked || auth !== `Bearer ${sq.token}`) return json({ errors: [{ code: 'UNAUTHORIZED', detail: 'no' }] }, 401)
  if (url.pathname === '/v2/team-members/search') return json({ team_members: sq.team })
  if (url.pathname === '/v2/payments') {
    const from = Date.parse(url.searchParams.get('begin_time')!), to = Date.parse(url.searchParams.get('end_time')!)
    const hits = sq.payments.filter((p) => Date.parse(p.created_at) >= from && Date.parse(p.created_at) < to)
    const start = Number(url.searchParams.get('cursor') || 0)
    const page = hits.slice(start, start + sq.pageSize)
    return json({ payments: page, ...(start + sq.pageSize < hits.length ? { cursor: String(start + sq.pageSize) } : {}) })
  }
  return json({}, 404)
}

function fakeToast(url: URL, init: any): Response {
  const headers = init?.headers || {}
  if (url.pathname === '/authentication/v1/authentication/login') {
    const b = JSON.parse(init.body)
    if (b.userAccessType !== 'TOAST_MACHINE_CLIENT' || b.clientId !== 'toast-client' || b.clientSecret !== toast.secret) return json({ message: 'bad' }, 401)
    toast.logins++
    return json({ token: { accessToken: 'toast_at_1', tokenType: 'Bearer', expiresIn: 86400 } })
  }
  toast.calls.push({ path: url.pathname + url.search, auth: String(headers.Authorization ?? ''), guid: String(headers['Toast-Restaurant-External-ID'] ?? '') })
  if (headers.Authorization !== 'Bearer toast_at_1' || headers['Toast-Restaurant-External-ID'] !== '11111111-2222-3333-4444-555555555555') return json({ message: 'no' }, 401)
  if (url.pathname === '/labor/v1/employees') return json(toast.staff)
  if (url.pathname === '/orders/v2/ordersBulk') {
    const page = Number(url.searchParams.get('page')), size = Number(url.searchParams.get('pageSize'))
    if (url.searchParams.get('businessDate') !== day.replace(/-/g, '')) return json([])
    return json(toast.orders.slice((page - 1) * size, page * size))
  }
  return json({}, 404)
}

const pay = (id: string, cents: number, who: string | null, at: string, status = 'COMPLETED') => ({ id, status, created_at: at, tip_money: { amount: cents, currency: 'USD' }, ...(who ? { team_member_id: who } : {}) })
const order = (guid: string, tip: number, server: string, extra: any = {}) => ({ guid, voided: false, deleted: false, checks: [{ guid: `${guid}-c`, voided: false, deleted: false, payments: [{ guid: `${guid}-p`, tipAmount: tip, amount: 20, paymentStatus: 'CAPTURED', server: { guid: server }, paidDate: `${day}T20:00:00.000+0000`, ...extra }] }] })

describe('tips from another register on the real server (Toast and Square are fakes)', () => {
  beforeAll(async () => {
    setSystemTime(new Date('2026-10-30T03:30:00Z'))   // 10:30 PM in Eau Claire
    k = await bootFood({ features: ON })
    realFetch = globalThis.fetch
    const outer = globalThis.fetch
    globalThis.fetch = (async (input: any, init?: any) => {
      const url = new URL(String(input?.url ?? input))
      if (url.hostname === 'connect.squareup.com') return fakeSquare(url, init)
      if (url.hostname === 'ws-api.toasttab.com') return fakeToast(url, init)
      return outer(input, init)
    }) as any
    day = (await k.O('GET', '/api/register/day')).json.day as string
    // Two nights of Square payments: tonight (inside the 4 AM-to-4 AM window) and one that belongs to the night before.
    sq.payments = [
      pay('P1', 700, 'TM_BART', '2026-10-30T01:15:00Z'),            // bartender, tonight: counts
      pay('P2', 400, 'TM_GHOST', '2026-10-30T02:00:00Z'),           // someone nobody matched: listed, not shared
      pay('P3', 900, 'TM_BART', '2026-10-30T02:10:00Z', 'CANCELED'), // never completed: not money
      pay('P4', 1100, 'TM_BART', '2026-10-28T23:00:00Z'),           // the night before
      pay('P5', 0, 'TM_BART', '2026-10-30T02:20:00Z'),              // no tip
      pay('P6', 250, null, '2026-10-30T02:30:00Z'),                 // nobody named
    ]
  }, 60_000)
  afterAll(() => { globalThis.fetch = realFetch; k.restore(); setSystemTime() })

  test('closed until the feature is on; a floor seat never gets in; Square is allowed on a signed link and the keys are kept sealed', async () => {
    expect((await k.M('GET', '/api/tip-sources')).status).toBe(403)
    await k.features([...ON, 'bar_tip_import'])
    expect((await k.B('GET', '/api/tip-sources')).status).toBe(403)       // bar:manage only
    expect((await k.pub('GET', '/api/tip-sources-return/square/callback?state=x&code=y')).status).toBe(302)
    const first = (await k.M('GET', '/api/tip-sources')).json
    expect(first.sources).toEqual([]); expect(first.available).toEqual({ square: true, toast: true })

    const auth = (await k.M('GET', '/api/tip-sources/square/auth-url')).json.url as string
    const u = new URL(auth)
    expect(u.origin + u.pathname).toBe('https://connect.squareup.com/oauth2/authorize')
    expect(u.searchParams.get('client_id')).toBe('sq0idp-twomiah'); expect(u.searchParams.get('scope')).toBe('PAYMENTS_READ EMPLOYEES_READ')
    expect(auth).not.toContain('APP-SECRET')
    const state = u.searchParams.get('state')!
    // A state that was changed, or one the server never made, connects nothing.
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(state, 'base64url').toString()), companyId: 'someone-else' })).toString('base64url')
    for (const bad of [forged, 'garbage']) {
      const r = await k.pub('GET', `/api/tip-sources-return/square/callback?state=${bad}&code=sq_code_1`)
      expect(r.headers.get('location')).toContain('square-failed')
    }
    expect((await rows(k.S.barTipSource)).length).toBe(0)
    const denied = await k.pub('GET', `/api/tip-sources-return/square/callback?state=${state}&error=access_denied`)
    expect(decodeURIComponent(denied.headers.get('location')!)).toContain('not allowed')

    const back = await k.pub('GET', `/api/tip-sources-return/square/callback?state=${state}&code=sq_code_1`)
    expect(back.headers.get('location')).toBe('/crm/tips?register=square-connected')
    const [src] = await rows(k.S.barTipSource)
    expect(src).toMatchObject({ provider: 'square', externalAccountId: 'MERCH1', status: 'connected', connectedByName: 'Manager Seat' })
    // Sealed at rest, and never in a reply: not the access token, not the refresh token, not the app's secret.
    for (const secret of ['sq_at_1', 'sq_at_2', 'sq_rt_1', 'sq_rt_2', 'APP-SECRET']) expect(src.credentialsEnc).not.toContain(secret)
    const shown = JSON.stringify([(await k.M('GET', '/api/tip-sources')).json, (await k.M('GET', '/api/tip-sources/staff')).json])
    for (const secret of ['sq_at_1', 'sq_at_2', 'sq_rt_1', 'sq_rt_2', 'APP-SECRET', 'credentialsEnc']) expect(shown).not.toContain(secret)
    // The token was inside its last 7 days, so it was renewed (refresh grant) before it was used, and the new one is what is kept.
    expect(sq.calls.some((c) => c.path === '/oauth2/token' && c.body.grant_type === 'refresh_token' && c.body.refresh_token === 'sq_rt_1')).toBe(true)
    expect(decryptJSON(src.credentialsEnc)).toMatchObject({ accessToken: 'sq_at_2', refreshToken: 'sq_rt_2' })
    expect(sq.calls.filter((c) => c.path === '/v2/team-members/search').every((c) => c.auth === 'Bearer sq_at_2')).toBe(true)
  })

  test('staff are matched by email (any capital letters), the rest are listed, and a hand match is kept', async () => {
    const s = (await k.M('GET', '/api/tip-sources/staff')).json
    const m = Object.fromEntries(s.sources[0].staff.map((x: any) => [x.externalStaffId, x]))
    expect(m.TM_BART).toMatchObject({ userId: k.ids.bartender, matchedBy: 'email' })
    expect(m.TM_MGR).toMatchObject({ userId: k.ids.manager, matchedBy: 'email' })
    expect(m.TM_GHOST).toMatchObject({ userId: null, matchedBy: null })
    expect(s.people.map((p: any) => p.id)).toContain(k.ids.owner)
    const sid = s.sources[0].id
    expect((await k.B('PUT', '/api/tip-sources/staff', { sourceId: sid, externalStaffId: 'TM_GHOST', userId: k.ids.owner })).status).toBe(403)
    expect((await k.M('PUT', '/api/tip-sources/staff', { sourceId: sid, externalStaffId: 'NOBODY', userId: k.ids.owner })).status).toBe(404)
    expect((await k.M('PUT', '/api/tip-sources/staff', { sourceId: sid, externalStaffId: 'TM_GHOST', userId: 'not-a-person' })).status).toBe(400)
  })

  test('the night counts the tips: only completed payments of THIS night, matched people share them, the unmatched are listed, twice changes nothing', async () => {
    expect((await k.M('PUT', '/api/tips/rules', RULES)).status).toBe(200)
    const tzNow = new Date()
    for (const [who, h] of [['bartender', 4], ['manager', 4], ['owner', 3]] as const) {
      const out = new Date(tzNow.getTime() - 60_000), inn = new Date(out.getTime() - h * 3600_000)
      await ins(k.S.timeEntry, { companyId: k.companyId, userId: k.ids[who], date: inn, hours: String(h), clockIn: inn, clockOut: out })
    }
    for (const [who, position] of [['bartender', 'Bar'], ['manager', 'Bar back'], ['owner', 'Floor']]) await ins(k.S.barScheduleShift, { companyId: k.companyId, userId: k.ids[who], day, start: '17:00', end: '23:00', position })

    const read = async () => (await k.M('GET', `/api/tips/night?day=${day}`)).json
    const night = await read()
    const by = Object.fromEntries(night.payouts.map((p: any) => [p.userId, p]))
    // $7.00 to the bartender; the pool is 70% bartender / 30% barback.
    expect(by[k.ids.bartender]).toMatchObject({ tipsCents: 700, importedCents: 700, declaredCents: 0, poolShareCents: 490 })
    expect(by[k.ids.manager]).toMatchObject({ poolShareCents: 210 })
    expect(night.notes.join(' ')).toContain('6.50 dollars in tips from another register belong to staff not matched')   // $4.00 ghost + $2.50 nobody named
    // Reading the same night again (the page, then the close-out) imports the same payments again and changes nothing.
    const again = await read(); expect(again.totalTipsCents).toBe(night.totalTipsCents)
    expect((await rows(k.S.barTipImport)).filter((r) => r.businessDay === day).length).toBe(3)    // P1, P2, P6
    // Square paged its answer (2 at a time here): every page was read.
    expect(sq.calls.filter((c) => c.path === '/v2/payments').length).toBeGreaterThanOrEqual(2)
    // Matching the ghost by hand brings the $4.00 in: the server keeps it and tips 10% out to the barback.
    expect((await k.M('PUT', '/api/tip-sources/staff', { sourceId: (await rows(k.S.barTipSource))[0].id, externalStaffId: 'TM_GHOST', userId: k.ids.owner })).status).toBe(200)
    const after = Object.fromEntries((await read()).payouts.map((p: any) => [p.userId, p]))
    expect(after[k.ids.owner]).toMatchObject({ importedCents: 400, tipOutPaidCents: 40, keptCents: 360, totalCents: 360 })
    expect(after[k.ids.manager]).toMatchObject({ poolShareCents: 210, tipOutReceivedCents: 40, totalCents: 250 })
    // Declared cash tips sit beside imported ones and are never counted twice: payroll's call reads the declared part only.
    await k.features([...ON, 'bar_tip_import', 'bar_declared_tips'])
    expect((await k.B('POST', '/api/tips/declared/mine', { amountCents: 1000 })).status).toBe(200)
    expect(Object.fromEntries((await read()).payouts.map((p: any) => [p.userId, p]))[k.ids.bartender]).toMatchObject({ tipsCents: 1700, importedCents: 700, declaredCents: 1000 })
    await k.B('POST', '/api/tips/declared/mine', { amountCents: 0 })
  })

  test('a payment that stops counting leaves the night; a refused connection says so instead of failing quietly; the hourly pass skips a closed night', async () => {
    const payRow = sq.payments.find((p) => p.id === 'P1')!
    payRow.status = 'CANCELED'
    const gone = Object.fromEntries((await k.M('GET', `/api/tips/night?day=${day}`)).json.payouts.map((p: any) => [p.userId, p]))
    expect(gone[k.ids.bartender]?.importedCents ?? 0).toBe(0)
    payRow.status = 'COMPLETED'
    expect((await k.M('POST', '/api/tip-sources/square/import', { day })).json.notes).toEqual([])
    expect((await k.M('POST', '/api/tip-sources/square/import', { day: 'tonight' })).status).toBe(400)

    // Square refuses (the venue removed the app): the night still reads, with a sentence saying why, and the connection asks for attention.
    sq.revoked = true
    const n = (await k.M('GET', `/api/tips/night?day=${day}`)).json
    expect(n.notes.join(' ')).toContain('Square tips are not up to date')
    const listed = (await k.M('GET', '/api/tip-sources')).json.sources[0]
    expect(listed).toMatchObject({ status: 'needs_attention' }); expect(listed.lastError).toContain('Connect Square again')
    sq.revoked = false

    // The hourly pass reads tonight and last night; once last night was closed it is left alone.
    const jobs = (k.t.services.crm as any).eventJobs
    expect(await jobs.runTipImport(new Date())).toBe(2)
    await (k.t.db as any).insert(k.S.barTipPayout).values({ companyId: k.companyId, businessDay: new Date(Date.parse(`${day}T12:00:00Z`) - 86400_000).toISOString().slice(0, 10), userId: k.ids.bartender, name: 'B', role: 'Bartender', hoursX100: 100, tipsCents: 0, salesCents: 0, keptCents: 0, tipOutPaidCents: 0, tipOutReceivedCents: 0, poolShareCents: 0, totalCents: 0 })
    expect(await jobs.runTipImport(new Date())).toBe(1)
    await k.features(ON)
    expect(await jobs.runTipImport(new Date())).toBe(0)                  // the feature is off: nothing is read
    await k.features([...ON, 'bar_tip_import', 'bar_declared_tips'])
  })

  test('Toast: the host must be Toast’s, wrong keys are caught when typed, the secret is sealed, voided and refunded payments are skipped, every page is read', async () => {
    expect((await k.M('DELETE', '/api/tip-sources/square')).json).toEqual({ disconnected: true })
    expect((await rows(k.S.barTipImport)).length).toBe(0)                 // its imports went with it
    expect((await k.M('DELETE', '/api/tip-sources/square')).status).toBe(404)
    const good = { host: 'ws-api.toasttab.com', clientId: 'toast-client', clientSecret: toast.secret, restaurantGuid: '11111111-2222-3333-4444-555555555555', label: 'Main street' }
    expect((await k.M('POST', '/api/tip-sources/toast', { ...good, host: 'evil.example.com' })).status).toBe(400)
    expect((await k.M('POST', '/api/tip-sources/toast', { ...good, host: 'toasttab.com.evil.com' })).status).toBe(400)
    expect((await k.M('POST', '/api/tip-sources/toast', { ...good, host: 'http://127.0.0.1' })).status).toBe(400)
    expect((await k.M('POST', '/api/tip-sources/toast', { ...good, restaurantGuid: 'x' })).status).toBe(400)
    const wrong = await k.M('POST', '/api/tip-sources/toast', { ...good, clientSecret: 'nope' })
    expect(wrong.status).toBe(400); expect(wrong.json.error).toContain('client ID and secret')
    expect(JSON.stringify(wrong.json)).not.toContain('nope')
    expect((await rows(k.S.barTipSource)).length).toBe(0)
    expect((await k.B('POST', '/api/tip-sources/toast', good)).status).toBe(403)

    toast.orders = [
      order('O1', 3.5, 'EMP_BART'),                                                                  // $3.50 (dollars with a decimal)
      { ...order('O2', 9, 'EMP_BART'), voided: true },                                               // voided order
      { ...order('O3', 9, 'EMP_BART'), checks: [{ ...order('O3', 9, 'EMP_BART').checks[0], deleted: true }] },   // deleted check
      order('O4', 9, 'EMP_BART', { voidInfo: { voidDate: 'x' } }),                                   // voided payment
      order('O5', 9, 'EMP_BART', { refundStatus: 'FULL' }),                                          // fully refunded
      order('O6', 9, 'EMP_BART', { paymentStatus: 'DENIED' }),
      order('O7', 0, 'EMP_BART'),                                                                    // no tip
      order('O8', 2.25, 'EMP_UNKNOWN'),                                                              // a server not in the staff list: listed
      ...Array.from({ length: 110 }, (_, i) => order(`Z${i}`, 0.01, 'EMP_BART')),                   // pushes the answer onto a second page
    ]
    const made = await k.M('POST', '/api/tip-sources/toast', good)
    expect(made.status).toBe(200)
    expect(JSON.stringify(made.json)).not.toContain(toast.secret)
    const [src] = await rows(k.S.barTipSource)
    expect(src.credentialsEnc).not.toContain(toast.secret); expect(src.credentialsEnc).not.toContain('toast_at_1')
    expect(decryptJSON(src.credentialsEnc)).toMatchObject({ clientSecret: toast.secret, accessToken: 'toast_at_1' })
    expect(JSON.stringify([(await k.M('GET', '/api/tip-sources')).json, (await k.M('GET', '/api/tip-sources/staff')).json])).not.toContain(toast.secret)
    const staff = (await k.M('GET', '/api/tip-sources/staff')).json.sources[0].staff
    expect(staff.map((s: any) => s.name)).toEqual(['Bartender Seat'])        // the deleted employee is not offered
    expect(staff[0]).toMatchObject({ userId: k.ids.bartender, matchedBy: 'email' })

    const night = (await k.M('GET', `/api/tips/night?day=${day}`)).json
    const bart = night.payouts.find((p: any) => p.userId === k.ids.bartender)
    expect(bart.importedCents).toBe(350 + 110)                                // $3.50 + 110 one-cent tips from the second page
    expect(night.notes.join(' ')).toContain('2.25 dollars in tips from another register belong to staff not matched')
    // Every Toast call carried the restaurant ID and a bearer token; the token was reused rather than logging in each time.
    expect(toast.calls.every((c) => c.auth === 'Bearer toast_at_1' && c.guid === good.restaurantGuid)).toBe(true)
    expect(toast.calls.some((c) => c.path.includes('page=2'))).toBe(true)
    expect(toast.logins).toBe(1)
    expect((await k.M('DELETE', '/api/tip-sources/toast')).status).toBe(200)
  })
})
