// Home care's office group on the unified app (server/crm/homecare/office): the incident case file, compliance, the
// clinical audit trail, View As and server-side sign-out, and home care's company columns on the shared /api/company.
// Through the real server, signed in with real tokens — the behaviour the template suite's files assert in the
// template's shapes (tests/unified/harness/unified-divergences.ts names each), held here in the unified ones.
import { describe, test, expect, beforeAll } from 'bun:test'
import { sql } from 'drizzle-orm'
import jwt from 'jsonwebtoken'
import { bootTenant, seedOwner } from './harness.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId = ''
const ids: Record<string, string> = {}
const tokens: Record<string, string> = {}
const PASSWORD = 'Pass-word-1'

const signIn = async (email: string, password: string) => (await (await t.call('/api/auth/login', { method: 'POST', json: { email, password } })).json()).accessToken as string
const withToken = (token: string, path: string, init: any = {}) => t.call(path, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` } })
const as = (who: string, path: string, init: any = {}) => withToken(tokens[who], path, init)
const rows = async (q: any) => ((await t.db.execute(q)) as any).rows as any[]
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

beforeAll(async () => {
  t = await bootTenant({ vertical: 'homecare' })
  const seeded = await seedOwner(t)
  companyId = seeded.company.id
  ids.owner = seeded.owner.id
  for (const [role, email] of [['admin', 'admin@test.example'], ['caregiver', 'cg@test.example'], ['caregiver', 'cg2@test.example']] as const) {
    const [u] = await t.db.insert(t.schema.user).values({ email, passwordHash: await Bun.password.hash(PASSWORD, 'bcrypt'), firstName: email.split('@')[0], lastName: 'Tester', role, companyId }).returning()
    ids[email.split('@')[0]] = u.id
  }
  tokens.owner = await signIn('owner@test.example', seeded.password)
  tokens.admin = await signIn('admin@test.example', PASSWORD)
  tokens.cg = await signIn('cg@test.example', PASSWORD)
  tokens.cg2 = await signIn('cg2@test.example', PASSWORD)
  const [served] = await t.db.insert(t.schema.clients).values({ companyId, firstName: 'Ada', lastName: 'Member' } as any).returning()
  const [stranger] = await t.db.insert(t.schema.clients).values({ companyId, firstName: 'Eve', lastName: 'Stranger' } as any).returning()
  ids.served = served.id
  ids.stranger = stranger.id
  await t.db.insert(t.schema.clientAssignments).values({ companyId, clientId: served.id, caregiverId: ids.cg, assignmentDate: '2026-01-01', status: 'active' } as any)
})

const incident = (over: Record<string, unknown> = {}) => ({
  clientId: ids.served, caregiverId: ids.cg, incidentType: 'fall', severity: 'moderate', incidentDate: '2026-03-02',
  incidentTime: '10:15', description: 'Slipped in the kitchen.', ...over,
})

describe('the incident case file is the office\'s', () => {
  test('a caregiver holds no care-compliance permission: every office path is refused', async () => {
    for (const [method, path] of [['GET', '/api/incidents'], ['GET', '/api/incidents/summary'], ['POST', '/api/incidents'], ['GET', '/api/incidents/x1/pdf'], ['POST', '/api/incidents/x1/remove-caregiver']]) {
      const r = await as('cg', path, { method, json: method === 'POST' ? incident() : undefined })
      expect({ path, status: r.status }).toEqual({ path, status: 403 })
    }
    expect((await t.call('/api/incidents')).status).toBe(401)
  })

  test('numbered IR-<year>-<nnn> per company, never reused after a delete; replies are camelCase', async () => {
    const a = await (await as('admin', '/api/incidents', { method: 'POST', json: incident() })).json()
    expect(a.incidentNumber).toBe('IR-2026-001')
    expect(a.investigationStatus).toBe('open')
    expect(a.reportedById).toBe(ids.admin)
    expect(a.companyId).toBe(companyId)
    expect('trainingAckSignature' in a).toBe(false)
    const b = await (await as('owner', '/api/incidents', { method: 'POST', json: incident({ description: 'Second.' }) })).json()
    expect(b.incidentNumber).toBe('IR-2026-002')
    expect((await as('admin', `/api/incidents/${b.id}`, { method: 'DELETE' })).status).toBe(200)
    const c = await (await as('admin', '/api/incidents', { method: 'POST', json: incident({ description: 'Third.' }) })).json()
    expect(c.incidentNumber).toBe('IR-2026-003')
    const counters = await rows(sql`SELECT company_id, year, last_number FROM incident_number_counters`)
    expect(counters).toEqual([{ company_id: companyId, year: 2026, last_number: 3 }])
  })

  test('validation answers in the template\'s words', async () => {
    const r = await as('admin', '/api/incidents', { method: 'POST', json: incident({ incidentType: 'nope' }) })
    expect(r.status).toBe(400)
    expect(await r.json()).toEqual({ error: 'Incident type is not valid' })
  })

  test('the list is a list reply with counts, and never carries the signature', async () => {
    const r = await (await as('admin', '/api/incidents')).json()
    expect(Array.isArray(r.data)).toBe(true)
    expect(r.pagination.total).toBe(r.data.length)
    const row = r.data[0]
    expect(row.clientName).toBe('Ada Member')
    expect(typeof row.noteCount).toBe('number')
    expect(row.hasTrainingAckSignature).toBe(false)
    expect('trainingAckSignature' in row).toBe(false)
    expect(row.incidentDateYmd).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  test('a caregiver files a field report only for a client they serve, naming themselves; the office is told', async () => {
    // A day already past on every clock (the agency's is America/Chicago until it says otherwise).
    const today = new Date(Date.now() - 2 * 86400_000).toISOString().slice(0, 10)
    const no = await as('cg', '/api/incidents/caregiver-report', { method: 'POST', json: { clientId: ids.stranger, incidentType: 'fall', incidentDate: today, description: 'x' } })
    expect(no.status).toBe(403)
    expect((await no.json()).error).toBe('You can only report incidents for your own clients')
    const mine = await (await as('cg', '/api/incidents/my-clients')).json()
    expect(mine.data.map((c: any) => c.firstName)).toEqual(['Ada'])
    const office = await (await as('admin', '/api/incidents/my-clients')).json()
    expect(office.data.length).toBe(2)
    const r = await as('cg', '/api/incidents/caregiver-report', { method: 'POST', json: { clientId: ids.served, caregiverId: ids.cg2, incidentType: 'fall', incidentDate: today, description: 'Slipped.', photos: [{ dataUri: PNG }] } })
    expect(r.status).toBe(201)
    const body = await r.json()
    expect(body.incidentNumber).toMatch(/^IR-\d{4}-\d{3}$/)
    const [row] = await rows(sql`SELECT caregiver_id, company_id FROM incidents WHERE id = ${body.id}`)
    expect(row).toEqual({ caregiver_id: ids.cg, company_id: companyId })
    const told = await rows(sql`SELECT user_id, company_id FROM notifications WHERE type = 'incident_alert'`)
    expect(new Set(told.map((n) => n.user_id))).toEqual(new Set([ids.owner, ids.admin]))
    expect(told.every((n) => n.company_id === companyId)).toBe(true)
    const att = await (await as('admin', `/api/incidents/${body.id}/attachments`)).json()
    expect(att.data.length).toBe(1)
    expect('fileData' in att.data[0]).toBe(false)
  })

  test('every change is in the clinical audit trail, in the company, and the trail is office-only', async () => {
    const trail = await (await as('admin', '/api/audit-logs?tableName=incidents')).json()
    expect(trail.data.length).toBeGreaterThan(0)
    expect(trail.data.every((r: any) => r.tableName === 'incidents')).toBe(true)
    expect(trail.pagination.page).toBe(1)
    expect((await as('cg', '/api/audit-logs')).status).toBe(403)
    const [n] = await rows(sql`SELECT COUNT(*)::int AS n FROM audit_logs WHERE company_id IS DISTINCT FROM ${companyId}`)
    expect(n.n).toBe(0)
  })
})

describe('compliance', () => {
  test('a rating takes its own fields only, and both people must be this company\'s', async () => {
    const r = await as('admin', '/api/compliance/ratings', { method: 'POST', json: { caregiverId: ids.cg, clientId: ids.served, satisfactionScore: 5, id: 'chosen-id', companyId: 'someone-else' } })
    expect(r.status).toBe(201)
    const rating = await r.json()
    expect(rating.id).not.toBe('chosen-id')
    expect(rating.companyId).toBe(companyId)
    expect((await as('admin', '/api/compliance/ratings', { method: 'POST', json: { caregiverId: 'nobody', clientId: ids.served } })).status).toBe(404)
    const list = await (await as('admin', '/api/compliance/ratings')).json()
    expect(list.data[0].client).toEqual({ firstName: 'Ada', lastName: 'Member' })
    expect((await as('cg', '/api/compliance/dashboard')).status).toBe(403)
    const dash = await (await as('owner', '/api/compliance/dashboard')).json()
    expect(dash.activeCaregiversCount).toBe(2)
  })
})

describe('the company: home care\'s own columns on the shared /api/company', () => {
  test('the mileage rate and the time zone save, refused when they are not one; the zone in use is named', async () => {
    const ok = await as('admin', '/api/company', { method: 'PUT', json: { mileageRate: '0.725', timezone: 'America/Denver' } })
    expect(ok.status).toBe(200)
    const body = await ok.json()
    expect(Number(body.mileageRate)).toBe(0.725)
    expect(body.effectiveTimezone).toBe('America/Denver')
    for (const bad of ['-1', 'abc', '9']) expect((await as('admin', '/api/company', { method: 'PUT', json: { mileageRate: bad } })).status).toBe(400)
    expect((await as('admin', '/api/company', { method: 'PUT', json: { timezone: 'Mars/Olympus' } })).status).toBe(400)
    const cleared = await (await as('admin', '/api/company', { method: 'PUT', json: { timezone: '' } })).json()
    expect(cleared.timezone).toBe(null)
    expect((await as('cg', '/api/company', { method: 'PUT', json: { mileageRate: '2.00' } })).status).toBe(403)
  })

  // r5-agency-clock: the template's /me named the zone; the unified screens read it from GET /api/company
  // (web/src/crm/pages/homecare/lib/HomecareFrame.tsx), which every signed-in role reads — a caregiver included.
  test('every role, a caregiver included, reads the zone in use at GET /api/company: the state\'s, or the agency\'s own', async () => {
    await t.db.execute(sql`UPDATE company SET state = 'WI', timezone = NULL WHERE id = ${companyId}`)
    const fromState = await as('cg', '/api/company')
    expect(fromState.status).toBe(200)
    expect((await fromState.json()).effectiveTimezone).toBe('America/Chicago')
    await t.db.execute(sql`UPDATE company SET timezone = 'America/Denver' WHERE id = ${companyId}`)
    expect((await (await as('cg', '/api/company')).json()).effectiveTimezone).toBe('America/Denver')
    expect((await (await as('admin', '/api/company')).json()).effectiveTimezone).toBe('America/Denver')
    await t.db.execute(sql`UPDATE company SET timezone = NULL WHERE id = ${companyId}`)
  })

  test('the Sandata password never leaves the server', async () => {
    await t.db.execute(sql`UPDATE company SET sandata_password_encrypted = 'secret-blob' WHERE id = ${companyId}`)
    const text = await (await as('owner', '/api/company')).text()
    expect(text.includes('secret-blob')).toBe(false)
    expect(text.includes('sandataPasswordEncrypted')).toBe(false)
    // …and a PUT cannot write it (the template's PUT stored whatever the body held).
    expect((await as('owner', '/api/company', { method: 'PUT', json: { sandataPasswordEncrypted: 'overwritten', mileageRate: '0.70' } })).status).toBe(200)
    const [row] = await rows(sql`SELECT sandata_password_encrypted FROM company WHERE id = ${companyId}`)
    expect(row.sandata_password_encrypted).toBe('secret-blob')
  })
})

describe('View As and signing out', () => {
  test('the picker and View As are owner/admin; nobody views as a higher rung', async () => {
    expect((await as('cg', '/api/auth/users')).status).toBe(403)
    expect((await as('cg', `/api/auth/impersonate/${ids.cg2}`, { method: 'POST' })).status).toBe(403)
    expect((await as('admin', `/api/auth/impersonate/${ids.owner}`, { method: 'POST' })).status).toBe(403)
    expect((await as('owner', `/api/auth/impersonate/${ids.admin}`, { method: 'POST' })).status).toBe(200)
    expect((await as('admin', '/api/auth/impersonate/nope', { method: 'POST' })).status).toBe(404)
    const picker = await (await as('admin', '/api/auth/users')).json()
    expect(picker.data.length).toBe(4)
  })

  test('a View As session reads, cannot write, and signing out of it ends only itself', async () => {
    const r = await as('admin', `/api/auth/impersonate/${ids.cg}`, { method: 'POST' })
    const { token } = await r.json()
    const decoded: any = jwt.decode(token)
    expect(decoded.impersonation).toBe(true)
    expect(decoded.userId).toBe(ids.cg)
    const [audited] = await rows(sql`SELECT action, company_id FROM audit_logs WHERE action = 'ADMIN_IMPERSONATE' ORDER BY timestamp DESC LIMIT 1`)
    expect(audited.company_id).toBe(companyId)
    expect((await withToken(token, '/api/incidents/my-clients')).status).toBe(200)
    const w = await withToken(token, '/api/incidents/caregiver-report', { method: 'POST', json: { clientId: ids.served, incidentType: 'fall', incidentDate: '2026-01-01', description: 'x' } })
    expect(w.status).toBe(403)
    expect((await w.json()).code).toBe('view_as_read_only')
    expect((await withToken(token, '/api/auth/logout', { method: 'POST', json: {} })).status).toBe(200)
    const [cg] = await rows(sql`SELECT last_logout_at FROM "user" WHERE id = ${ids.cg}`)
    expect(cg.last_logout_at).toBe(null)
    expect((await as('cg', '/api/incidents/my-clients')).status).toBe(200)
  })

  test('signing out ends every session from before it, on every device', async () => {
    const earlier = jwt.sign({ userId: ids.cg2, companyId, email: 'cg2@test.example', role: 'caregiver', iat: Math.floor(Date.now() / 1000) - 30 }, process.env.JWT_SECRET!, { expiresIn: '1h' })
    expect((await withToken(earlier, '/api/incidents/my-clients')).status).toBe(200)
    expect((await as('cg2', '/api/auth/logout', { method: 'POST', json: {} })).status).toBe(200)
    const [row] = await rows(sql`SELECT last_logout_at FROM "user" WHERE id = ${ids.cg2}`)
    expect(row.last_logout_at).not.toBe(null)
    const after = await withToken(earlier, '/api/incidents/my-clients')
    expect(after.status).toBe(401)
    expect((await after.json()).error).toBe('Invalid or expired token')
    const fresh = await signIn('cg2@test.example', PASSWORD)
    expect((await withToken(fresh, '/api/incidents/my-clients')).status).toBe(200)
  })
})

// The unified screens keep the session in cookies the page cannot read (tenant-backend auth/cookieSession.ts). View As
// fits that: the View As session is its own httpOnly cookie, the office's session stays beneath it, Exit drops it.
describe('View As in a cookie session', () => {
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
  const browser = (jar: Jar) => async (path: string, init: any = {}) =>
    absorb(jar, await t.call(path, { ...init, headers: { 'X-Auth-Mode': 'cookie', Cookie: cookieOf(jar), ...(init.headers || {}) } }))
  const signedIn = async (email: string, password: string) => {
    const jar: Jar = {}
    const go = browser(jar)
    expect((await go('/api/auth/login', { method: 'POST', json: { email, password } })).status).toBe(200)
    expect(jar.tw_access).toBeTruthy()
    return { jar, go }
  }

  test('the View As session is a cookie no script can read; the office is back on Exit', async () => {
    const { jar, go } = await signedIn('admin@test.example', PASSWORD)
    const r = await go(`/api/auth/impersonate/${ids.cg}`, { method: 'POST' })
    expect(r.status).toBe(200)
    const body = await r.json()
    expect('token' in body).toBe(false)
    expect(body.user.id).toBe(ids.cg)
    const set = r.headers.getSetCookie().find((l) => l.startsWith('tw_view_as='))!
    expect(set).toMatch(/HttpOnly/i)
    expect(set).toMatch(/SameSite=Strict/i)
    expect(Number(/Max-Age=(\d+)/i.exec(set)?.[1])).toBe(2 * 3600 - 60)

    expect((await (await go('/api/auth/me')).json()).user.id).toBe(ids.cg)
    expect(await (await go('/api/auth/impersonate')).json()).toMatchObject({ active: true, name: 'cg Tester', role: 'caregiver', impersonatedBy: 'admin@test.example' })
    const w = await go('/api/incidents/caregiver-report', { method: 'POST', json: { clientId: ids.served, incidentType: 'fall', incidentDate: '2026-01-01', description: 'x' } })
    expect(w.status).toBe(403)
    expect((await w.json()).code).toBe('view_as_read_only')
    // Starting another View As from inside one is a write: refused.
    expect((await go(`/api/auth/impersonate/${ids.cg2}`, { method: 'POST' })).status).toBe(403)

    // Exit.
    expect((await go('/api/auth/logout', { method: 'POST', json: {} })).status).toBe(200)
    expect(jar.tw_view_as).toBeUndefined()
    expect(jar.tw_access).toBeTruthy()
    expect((await (await go('/api/auth/me')).json()).user.id).toBe(ids.admin)
    expect(await (await go('/api/auth/impersonate')).json()).toEqual({ active: false })
    const [admin] = await rows(sql`SELECT last_logout_at FROM "user" WHERE id = ${ids.admin}`)
    expect(admin.last_logout_at).toBe(null)
  })

  test('a View As cookie that no longer holds a live View As is dropped, and the office carries on', async () => {
    const { jar, go } = await signedIn('admin@test.example', PASSWORD)
    const ran = jwt.sign({ userId: ids.cg, companyId, email: 'cg@test.example', role: 'caregiver', impersonation: true, impersonatedBy: 'admin@test.example', exp: Math.floor(Date.now() / 1000) - 5 }, process.env.JWT_SECRET!)
    const plain = jwt.sign({ userId: ids.cg, companyId, email: 'cg@test.example', role: 'caregiver' }, process.env.JWT_SECRET!, { expiresIn: '1h' })
    for (const stale of [ran, plain, 'not-a-token']) {
      jar.tw_view_as = stale
      const r = await go('/api/incidents/my-clients')
      expect(r.status).toBe(401)
      expect(jar.tw_view_as).toBeUndefined()
      expect((await (await go('/api/auth/me')).json()).user.id).toBe(ids.admin)
    }
  })

  test('the banner asks any session; outside View As the answer is no', async () => {
    expect(await (await as('cg', '/api/auth/impersonate')).json()).toEqual({ active: false })
    expect((await t.call('/api/auth/impersonate')).status).toBe(401)
  })
})

describe('call tracking: a home-care caller is a client (CrmSettings.callers)', () => {
  test('a first call makes a client from the caller; the next call is matched to them; the log filters by client', async () => {
    await t.db.execute(sql`UPDATE company SET enabled_features = '["call_tracking","ai_receptionist"]'::json, timezone = 'America/Chicago' WHERE id = ${companyId}`)
    t.services.features.forgetFeatures()
    const first = await as('admin', '/api/calltracking/calls', { method: 'POST', json: { callerNumber: '+16085550123', callerName: 'Grace Hopper Smith', status: 'missed' } })
    expect(first.status).toBe(201)
    expect((await first.json()).firstTimeCaller).toBe(true)
    const made = await rows(sql`SELECT id, first_name, last_name, phone, notes, company_id FROM clients WHERE phone = '+16085550123'`)
    expect(made.length).toBe(1)
    expect(made[0]).toMatchObject({ first_name: 'Grace', last_name: 'Hopper Smith', company_id: companyId })
    expect(made[0].notes).toMatch(/^First call: \d{4}-\d{2}-\d{2}$/)
    expect((await rows(sql`SELECT id FROM contact`)).length).toBe(0)
    const again = await (await as('admin', '/api/calltracking/calls', { method: 'POST', json: { callerNumber: '+16085550123', status: 'completed' } })).json()
    expect(again.firstTimeCaller).toBe(false)
    expect(again.clientId).toBe(made[0].id)
    const log = await (await as('admin', `/api/calltracking/calls?clientId=${made[0].id}`)).json()
    expect(log.data.length).toBe(1)
    expect(log.data[0].clientFirstName).toBe('Grace')
    expect((await as('cg', '/api/calltracking/calls')).status).toBe(403)
  })
})

describe('home care on the shared modules (the suite files that read the template\'s own copies)', () => {
  test('a caregiver is refused by the real permission check, in its words (smoke, admin-model, leads)', async () => {
    const r = await as('cg', '/api/incidents')
    expect(r.status).toBe(403)
    expect((await r.json()).error).toBe('Permission denied')
  })

  test('/me tells a caregiver the agency\'s lock and no secret (account-lock)', async () => {
    await t.db.execute(sql`UPDATE company SET settings = '{"stripeSecretKey":"sk_live_x","accountLock":null}'::json WHERE id = ${companyId}`)
    const me = await (await as('cg', '/api/auth/me')).json()
    expect('accountLock' in (me.company?.settings || {})).toBe(true)
    expect(JSON.stringify(me).includes('sk_live_x')).toBe(false)
  })

  test('two-factor rows carry the company; a sign-in\'s refresh token is one /refresh accepts (mfa-sign-in)', async () => {
    expect((await as('admin', '/api/auth/mfa-devices/setup', { method: 'POST', json: {} })).status).toBe(201)
    const devices = await rows(sql`SELECT DISTINCT company_id FROM mfa_devices WHERE user_id = ${ids.admin}`)
    expect(devices).toEqual([{ company_id: companyId }])
    const login = await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'admin@test.example', password: PASSWORD } })).json()
    const refreshed = await t.call('/api/auth/refresh', { method: 'POST', json: { refreshToken: login.refreshToken } })
    expect(refreshed.status).toBe(200)
  })

  test('help articles are the knowledge base: the office writes them, a caregiver reads them (write-gates)', async () => {
    expect((await as('cg', '/api/support/kb', { method: 'POST', json: { title: 't', content: 'c' } })).status).toBe(403)
    const made = await as('owner', '/api/support/kb', { method: 'POST', json: { title: 'How to clock in', content: 'Tap Clock In.' } })
    expect(made.status).toBe(201)
    const article = await made.json()
    expect(article.companyId).toBe(companyId)
    const read = await (await as('cg', '/api/support/kb')).json()
    expect(read.data.some((a: any) => a.id === article.id)).toBe(true)
    expect((await as('cg', `/api/support/kb/${article.id}`, { method: 'PUT', json: { title: 'x' } })).status).toBe(403)
    expect((await as('owner', '/api/support/kb', { method: 'POST', json: {} })).status).toBe(400)
  })

  test('the office opens any of its clients\' cards; an id that is not one of them is refused like another company\'s (fixes)', async () => {
    expect((await as('admin', `/api/clients/${ids.stranger}/caregiver-view`)).status).toBe(200)
    expect((await as('admin', '/api/clients/nope/caregiver-view')).status).toBe(403)
  })
})

describe('the login-activity monitor reads the sign-ins the app records', () => {
  test('a sign-in and a failed attempt both show, with who and why; a caregiver cannot read it', async () => {
    await t.call('/api/auth/login', { method: 'POST', json: { email: 'cg2@test.example', password: 'not-the-password' } })
    await signIn('cg2@test.example', PASSWORD)
    const res = await as('admin', '/api/compliance/login-activity')
    expect(res.status).toBe(200)
    const mine = (await res.json()).data.filter((r: any) => r.email === 'cg2@test.example')
    expect(mine.some((r: any) => r.success === true)).toBe(true)
    expect(mine.some((r: any) => r.success === false && /Wrong password/.test(r.failReason))).toBe(true)
    expect(mine[0].user).toMatchObject({ firstName: 'cg2', role: 'caregiver' })
    expect((await as('cg', '/api/compliance/login-activity')).status).toBe(403)
  })
})
