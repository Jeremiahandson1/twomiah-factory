// Home care's caregivers-and-hiring group on the unified app (server/crm/homecare/hr): who may do what, the company's
// records only, the shapes the screens read, and the defects the move fixed.
//   · Permissions: the template's admin-only paths need a care-hr write (or read) permission, which a caregiver (stored
//     as caregiver or field) and the office manager do not hold; office logins (an admin seat, Make Admin, a password
//     reset) need the team permission. A caregiver reads their own file, certifications, training and background check.
//   · One company's caregivers, applications, checks and packets never reach another's.
//   · A caregiver made here — by the office's form or by a hire — is a `user` of the creator's company, role `field`.
//   · Fixed: the create/edit took the body into the user row (its company, its permission grants); GET
//     /api/training-records and /api/training-records/:id showed a caregiver every colleague's training.
//   · Reply shapes: lists are { data, pagination }; keys are camelCase (the compliance report's passedChecks …).
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import fs from 'node:fs'
import path from 'node:path'
import { bootTenant } from './harness.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
const tokens: Record<string, string> = {}
const ids: Record<string, string> = {}
let coA = '', coB = ''
const as = (who: string, method: string, path: string, json?: unknown) =>
  t.call(path, { method, json, headers: { Authorization: `Bearer ${tokens[who]}` } })
const body = async (r: Response) => { const s = await r.text(); try { return JSON.parse(s) } catch { return s } }

beforeAll(async () => {
  t = await bootTenant({ vertical: 'homecare' })
  const S = t.schema
  const [a] = await t.db.insert(S.company).values({ name: 'Agency A', slug: 'agency-a', state: 'MN' }).returning()
  const [b] = await t.db.insert(S.company).values({ name: 'Agency B', slug: 'agency-b' }).returning()
  coA = a.id; coB = b.id
  const hash = await Bun.password.hash('Seat-pass-1', 'bcrypt')
  const people: [string, string, string][] = [
    ['ownerA', 'owner', coA], ['adminA', 'admin', coA], ['managerA', 'manager', coA],
    ['cg1', 'caregiver', coA], ['cg2', 'field', coA], ['adminB', 'admin', coB], ['cgB', 'caregiver', coB],
  ]
  let n = 0
  for (const [who, role, companyId] of people) {
    const [u] = await t.db.insert(S.user).values({ email: `${who.toLowerCase()}@hr.example`, passwordHash: hash, firstName: who, lastName: 'Hr', role, companyId, defaultPayRate: '21.00' }).returning()
    ids[who] = u.id
    const res = await t.call('/api/auth/login', { method: 'POST', json: { email: `${who.toLowerCase()}@hr.example`, password: 'Seat-pass-1' }, headers: { 'X-Forwarded-For': `203.0.113.${++n}` } })
    tokens[who] = (await res.json()).accessToken
  }
  // Records of each agency's own.
  await t.db.insert(S.trainingRecords).values([
    { companyId: coA, caregiverId: ids.cg1, trainingName: 'CPR' },
    { companyId: coA, caregiverId: ids.cg2, trainingName: 'Dementia care' },
  ])
  await t.db.insert(S.backgroundChecks).values({ companyId: coA, caregiverId: ids.cg1, checkType: 'criminal', status: 'completed', result: 'clear' })
})

describe('permissions: hiring is the office\'s; a caregiver keeps to their own record', () => {
  const OFFICE: [string, string, unknown?][] = [
    ['GET', '/api/applications'],
    ['GET', '/api/applications/stats/summary'],
    ['POST', '/api/applications', { firstName: 'A', lastName: 'B', phone: '1' }],
    ['GET', '/api/job-postings'],
    ['POST', '/api/job-postings', { title: 'T', description: 'D' }],
    ['GET', '/api/background-checks'],
    ['GET', '/api/background-checks/reports/compliance'],
    ['POST', '/api/background-checks/poll-now'],
    ['GET', '/api/onboarding-packets'],
    ['GET', '/api/performance-reviews'],
    ['POST', '/api/caregivers', { firstName: 'N', lastName: 'C', email: 'n@hr.example', password: 'Long-pass-1' }],
    ['PUT', '/api/caregivers/someone', { firstName: 'X' }],
    ['PATCH', '/api/caregivers/someone/toggle-active'],
    ['POST', '/api/caregivers/someone/generate-ivr-pin'],
    ['POST', '/api/caregivers/someone/certifications', { certificationName: 'CNA' }],
    ['DELETE', '/api/certifications/anything'],
    ['DELETE', '/api/training-records/anything'],
    ['PUT', '/api/caregiver-profile/someone', { notes: 'x' }],
    ['POST', '/api/users/admins', { firstName: 'A', lastName: 'B', email: 'x@hr.example', password: 'Long-pass-1' }],
    ['POST', '/api/users/convert-to-admin', { userId: 'someone' }],
    ['PUT', '/api/users/someone/reset-password', { password: 'Long-pass-1' }],
  ]
  test('a caregiver (stored as caregiver or as field) and the office manager are refused the office\'s paths', async () => {
    for (const who of ['cg1', 'cg2', 'managerA']) {
      for (const [m, p, j] of OFFICE) {
        const r = await as(who, m, p, j)
        expect({ who, m, p, status: r.status }).toEqual({ who, m, p, status: 403 })
      }
    }
  })
  test('the owner and an admin get past every one', async () => {
    for (const who of ['ownerA', 'adminA']) {
      for (const [m, p, j] of OFFICE) {
        const r = await as(who, m, p, j)
        expect({ who, m, p, refused: r.status === 403 || r.status === 401 }).toEqual({ who, m, p, refused: false })
      }
    }
  })
  test('a caregiver reads their own file, certifications, training and background check — nobody else\'s', async () => {
    for (const path of ['', '/certifications', '/training-records', '/background-check', '/availability', '/blackout-dates']) {
      expect({ path, status: (await as('cg1', 'GET', `/api/caregivers/${ids.cg1}${path}`)).status }).toEqual({ path, status: 200 })
      expect({ path, status: (await as('cg1', 'GET', `/api/caregivers/${ids.cg2}${path}`)).status }).toEqual({ path, status: 403 })
    }
  })
})

describe('fixed: a caregiver no longer reads every colleague\'s training', () => {
  test('GET /api/training-records answers a caregiver their own rows only', async () => {
    const r = await body(await as('cg1', 'GET', '/api/training-records'))
    expect(r.data.map((x: any) => x.trainingName)).toEqual(['CPR'])
    expect((await as('cg1', 'GET', `/api/training-records?caregiverId=${ids.cg2}`)).status).toBe(403)
  })
  test('GET /api/training-records/:id is the office\'s or the caregiver\'s own', async () => {
    expect((await as('cg1', 'GET', `/api/training-records/${ids.cg2}`)).status).toBe(403)
    expect((await body(await as('cg1', 'GET', `/api/training-records/${ids.cg1}`))).data.length).toBe(1)
    const office = await body(await as('adminA', 'GET', '/api/training-records'))
    expect(office.data.length).toBe(2)
  })
})

describe('a caregiver is a user of the creator\'s company', () => {
  test('the office\'s form: role field, the company\'s — and the body cannot set the company or a grant (fixed)', async () => {
    const r = await as('adminA', 'POST', '/api/caregivers', {
      firstName: 'Nia', lastName: 'New', email: 'Nia.New@hr.example', password: 'Long-pass-1', defaultPayRate: '19.00',
      companyId: coB, extraPermissions: ['*'], role: 'owner', refreshToken: 'stolen', ivrPin: '1234',
      profile: { notes: 'Bilingual', companyId: coB },
    })
    expect(r.status).toBe(201)
    const made = await body(r)
    const [u] = await t.db.select().from(t.schema.user).where(eq(t.schema.user.id, made.id))
    expect({ role: u.role, companyId: u.companyId, email: u.email, grants: u.extraPermissions, refresh: u.refreshToken, pin: u.ivrPin })
      .toEqual({ role: 'field', companyId: coA, email: 'nia.new@hr.example', grants: [], refresh: null, pin: null })
    const [p] = await t.db.select().from(t.schema.caregiverProfiles).where(eq(t.schema.caregiverProfiles.caregiverId, made.id))
    expect({ notes: p.notes, companyId: p.companyId }).toEqual({ notes: 'Bilingual', companyId: coA })
  })
  test('an edit cannot move a caregiver to another company or grant them anything', async () => {
    const r = await as('adminA', 'PUT', `/api/caregivers/${ids.cg2}`, { firstName: 'Cee', companyId: coB, extraPermissions: ['*'] })
    expect(r.status).toBe(200)
    const [u] = await t.db.select().from(t.schema.user).where(eq(t.schema.user.id, ids.cg2))
    expect({ first: u.firstName, companyId: u.companyId, grants: u.extraPermissions }).toEqual({ first: 'Cee', companyId: coA, grants: [] })
  })
  test('a hire: role field, the company\'s, its application\'s company', async () => {
    const app = await body(await as('adminA', 'POST', '/api/applications', { firstName: 'Hal', lastName: 'Hire', email: 'hal@hr.example' }))
    const r = await body(await as('adminA', 'POST', `/api/applications/${app.id}/hire`, {}))
    expect(r.success).toBe(true)
    const [u] = await t.db.select().from(t.schema.user).where(eq(t.schema.user.id, r.caregiverId))
    expect({ role: u.role, companyId: u.companyId }).toEqual({ role: 'field', companyId: coA })
    // Agency B cannot hire, read or delete Agency A's application.
    expect((await as('adminB', 'GET', `/api/applications/${app.id}`)).status).toBe(404)
    expect((await as('adminB', 'DELETE', `/api/applications/${app.id}`)).status).toBe(404)
  })
  test('the caregiver list holds both stored spellings of the seat, the company\'s only, as a list reply', async () => {
    const r = await body(await as('adminA', 'GET', '/api/caregivers'))
    expect(Array.isArray(r.data) && typeof r.pagination?.total === 'number').toBe(true)
    const names = r.data.map((x: any) => x.id)
    expect(names).toContain(ids.cg1)
    expect(names).toContain(ids.cg2)
    expect(names).not.toContain(ids.cgB)
    expect(names).not.toContain(ids.adminA)
  })
})

describe('one agency never sees another\'s', () => {
  test('Agency B\'s admin: not A\'s caregiver file, training, checks or compliance rows', async () => {
    expect((await as('adminB', 'GET', `/api/caregivers/${ids.cg1}`)).status).toBe(404)
    expect((await body(await as('adminB', 'GET', `/api/caregivers/${ids.cg1}/training-records`))).data).toEqual([])
    expect((await body(await as('adminB', 'GET', '/api/background-checks'))).data).toEqual([])
    expect((await body(await as('adminB', 'GET', '/api/background-checks/reports/compliance'))).data.map((r: any) => r.id)).toEqual([ids.cgB])
    expect((await as('adminB', 'PUT', `/api/caregivers/${ids.cg1}`, { firstName: 'Taken' })).status).toBe(404)
    expect((await as('adminB', 'POST', '/api/background-checks', { caregiverId: ids.cg1, checkType: 'criminal' })).status).toBe(404)
  })
})

describe('shapes the screens read', () => {
  test('pay is the payroll\'s: a caregiver listing colleagues sees no rate; the office does', async () => {
    const cg = await body(await as('cg1', 'GET', '/api/caregivers'))
    expect(cg.data.some((x: any) => 'defaultPayRate' in x)).toBe(false)
    const office = await body(await as('adminA', 'GET', '/api/caregivers'))
    expect(office.data.find((x: any) => x.id === ids.cg1)?.defaultPayRate).toBe('21.00')
  })
  test('Users & Access lists every office login — the manager too — and no caregiver', async () => {
    const r = await as('adminA', 'GET', '/api/users/admins')
    expect(r.status).toBe(200)
    const listed = (await r.json()).data.map((u: any) => u.id)
    for (const who of ['ownerA', 'adminA', 'managerA']) expect(listed).toContain(ids[who])
    for (const who of ['cg1', 'cg2', 'adminB']) expect(listed).not.toContain(ids[who])
  })

  test('the compliance report is camelCase', async () => {
    const r = await body(await as('adminA', 'GET', '/api/background-checks/reports/compliance'))
    const row = r.data.find((x: any) => x.id === ids.cg1)
    expect(row.passedChecks).toEqual(['criminal'])
    expect(row.firstName).toBe('cg1')
  })
  test('no background check on file is a 404 with a code, not a null record', async () => {
    const r = await as('adminA', 'GET', `/api/caregivers/${ids.cg2}/background-check`)
    expect(r.status).toBe(404)
    expect((await body(r)).code).toBe('none_on_file')
  })
  test('the owner\'s login is the owner\'s: an admin may not reset it', async () => {
    const r = await as('adminA', 'PUT', `/api/users/${ids.ownerA}/reset-password`, { password: 'Long-pass-1' })
    expect(r.status).toBe(403)
    expect((await body(r)).code).toBe('owner_only')
  })
})

// The Full Profile's overview read GET /api/caregivers/:id/summary, which no server ever answered (built in the move).
describe('the caregiver Full Profile overview', () => {
  const agencyToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date())
  beforeAll(async () => {
    const S = t.schema
    const [cl] = await t.db.insert(S.clients).values({ companyId: coA, firstName: 'Ada', lastName: 'Client', address: '1 Elm', city: 'Eau Claire' } as any).returning()
    ids.client = cl.id
    await t.db.insert(S.timeEntries).values([
      { companyId: coA, caregiverId: ids.cg1, clientId: cl.id, startTime: new Date(), endTime: new Date(Date.now() + 90 * 60000), durationMinutes: 90, isComplete: true },
      { companyId: coA, caregiverId: ids.cg1, clientId: cl.id, startTime: new Date('2025-01-15T15:00:00Z'), endTime: new Date('2025-01-15T17:30:00Z'), durationMinutes: 150, isComplete: true },
      // Still clocked in: not hours yet.
      { companyId: coA, caregiverId: ids.cg1, clientId: cl.id, startTime: new Date(Date.now() - 60000), isComplete: false },
    ] as any)
    const today = agencyToday()
    await t.db.insert(S.caregiverRates).values({ companyId: coA, caregiverId: ids.cg1, rateType: 'base', hourlyRate: '24.00', effectiveDate: '2025-01-01', notes: 'Raise' } as any)
    await t.db.insert(S.payrollShiftReviews).values({ companyId: coA, caregiverId: ids.cg1, clientId: cl.id, shiftDate: today, payPeriodStart: today, payPeriodEnd: today, payableMinutes: 90, status: 'approved' } as any)
    await t.db.insert(S.schedules).values([
      { companyId: coA, caregiverId: ids.cg1, clientId: cl.id, scheduleType: 'recurring', dayOfWeek: 2, startTime: new Date('2026-01-01T09:00:00'), endTime: new Date('2026-01-01T12:30:00') },
      { companyId: coA, caregiverId: ids.cg1, clientId: cl.id, scheduleType: 'one-time', date: '2020-01-01', startTime: new Date('2020-01-01T09:00:00'), endTime: new Date('2020-01-01T10:00:00') },
      { companyId: coA, caregiverId: ids.cg1, clientId: cl.id, scheduleType: 'one-time', date: '2099-03-04', startTime: new Date('2099-03-04T13:00:00'), endTime: new Date('2099-03-04T15:00:00') },
    ] as any)
  })

  test('hours, clients, recent visits and the schedule from today on', async () => {
    const r = await as('adminA', 'GET', `/api/caregivers/${ids.cg1}/summary`)
    expect(r.status).toBe(200)
    const s = await body(r)
    expect(s.earnings.hoursThisMonth).toBe(1.5)
    expect(s.earnings.hoursThisWeek).toBe(1.5)
    expect(s.earnings.totalHours).toBe(4)
    expect(s.earnings.avgShiftHours).toBe(2)
    expect(s.clients).toHaveLength(1)
    expect(s.clients[0]).toMatchObject({ id: ids.client, firstName: 'Ada', shiftCount: 2, totalHours: 4, lastVisit: agencyToday() })
    expect(s.recentShifts).toHaveLength(3)
    // Newest first: today's finished visit, the open one a minute before it, then January's.
    expect(s.recentShifts.map((x: any) => [x.isComplete, x.hours])).toEqual([[true, 1.5], [false, null], [true, 2.5]])
    expect(s.recentShifts[0].clientFirst).toBe('Ada')
    const days = s.schedule.map((x: any) => x.dayOfWeek ?? x.date).sort()
    expect(days).toEqual([2, '2099-03-04'].sort() as any)
    expect(s.schedule.find((x: any) => x.dayOfWeek === 2)).toMatchObject({ startTime: '09:00:00', endTime: '12:30:00', shiftHours: 3.5, clientFirst: 'Ada' })
  })

  test('pay is the paycheck: approved reviews at the rate in force, to the payroll and the person only', async () => {
    const office = await body(await as('adminA', 'GET', `/api/caregivers/${ids.cg1}/summary`))
    expect(office.earnings.earningsThisMonth).toBe(36) // 90 approved minutes × $24.00
    expect(office.payRates).toEqual([expect.objectContaining({ rate: '24.00', effectiveDate: '2025-01-01', notes: 'Raise' })])
    const own = await body(await as('cg1', 'GET', `/api/caregivers/${ids.cg1}/summary`))
    expect(own.earnings.earningsThisMonth).toBe(36)
    const manager = await as('managerA', 'GET', `/api/caregivers/${ids.cg1}/summary`)
    expect(manager.status).toBe(200)
    const m = await body(manager)
    expect('earningsThisMonth' in m.earnings).toBe(false)
    expect('payRates' in m).toBe(false)
    expect(m.earnings.totalHours).toBe(4)
  })

  test('a colleague is refused; another agency finds no such caregiver', async () => {
    expect((await as('cg2', 'GET', `/api/caregivers/${ids.cg1}/summary`)).status).toBe(403)
    expect((await as('adminB', 'GET', `/api/caregivers/${ids.cg1}/summary`)).status).toBe(404)
  })

  test('the visit history\'s From / To are the agency\'s days (they were ignored)', async () => {
    const all = await body(await as('adminA', 'GET', `/api/time-entries/caregiver-history/${ids.cg1}`))
    expect(all.data).toHaveLength(3)
    const jan = await body(await as('adminA', 'GET', `/api/time-entries/caregiver-history/${ids.cg1}?startDate=2025-01-15&endDate=2025-01-15`))
    expect(jan.data.map((e: any) => e.durationMinutes)).toEqual([150])
    // Each visit says how many GPS points it has, so the history offers its route; and where the client lives.
    const [visit] = await t.db.select().from(t.schema.timeEntries).where(eq(t.schema.timeEntries.durationMinutes, 150))
    await t.db.insert(t.schema.gpsTracking).values([0, 1].map((i) => ({ companyId: coA, caregiverId: ids.cg1, timeEntryId: visit.id, latitude: '44.8', longitude: '-91.5', timestamp: new Date(Date.UTC(2025, 0, 15, 15, i)) })) as any)
    const withGps = await body(await as('adminA', 'GET', `/api/time-entries/caregiver-history/${ids.cg1}?startDate=2025-01-15&endDate=2025-01-15`))
    expect(withGps.data[0]).toMatchObject({ gpsPointCount: 2, clientAddress: '1 Elm', clientCity: 'Eau Claire' })
    expect(all.data.filter((e: any) => e.gpsPointCount === 0)).toHaveLength(3)
    const none = await body(await as('adminA', 'GET', `/api/time-entries/caregiver-history/${ids.cg1}?startDate=2025-01-16&endDate=2025-01-31`))
    expect(none.data).toHaveLength(0)
  })
})

// The hire dialog and the public pages' browser tab (tests/homecare/hire-credentials.test.ts's screen half, on the
// moved screens): the template's checks read templates/crm-homecare/frontend, which the unified app does not ship.
const HC = path.resolve(import.meta.dir, '..', 'web', 'src', 'crm', 'pages', 'homecare')
const screen = (p: string) => fs.readFileSync(path.join(HC, p), 'utf8').replace(/\r\n/g, '\n')

describe("the hire's login on screen, and the public pages' tabs (the moved screens)", () => {
  test('the hire dialog says "Login details emailed to" when the email went, and shows the password only when it did not', () => {
    const dash = screen('people/ApplicationsDashboard.tsx')
    expect(dash).toMatch(/hireResult\.credentialsEmailed \?/)
    expect(dash).toMatch(/Login details emailed to/)
    expect(dash).toMatch(/\{hireResult\.tempPassword && <div[^>]*><strong>Temp Password:<\/strong>/)
    expect(dash.match(/Temp Password:/g)).toHaveLength(1)
    expect(dash.indexOf('Temp Password:')).toBeGreaterThan(dash.indexOf('Login details emailed to'))
  })
  test('the application page adds the password only when the email did not go', () => {
    expect(screen('people/ApplicationDetail.tsx')).toMatch(/!data\.credentialsEmailed && data\.tempPassword/)
  })
  test('the careers page and the onboarding packet name their tab for the agency, not "<agency> · Admin"', () => {
    const careers = screen('people/CareersPage.tsx')
    expect(careers).toContain('const companyName = pageCompanyName()')
    expect(careers).toContain("usePageTitle(slug && posting?.title ? `${posting.title} — Careers at ${companyName}` : `Careers — ${companyName}`)")
    expect(screen('people/OnboardingPacketPage.tsx')).toContain('usePageTitle(`Your onboarding — ${pageCompanyName()}`)')
  })
  test('the client portal, the family portal and paying an invoice name their tab', () => {
    const pub = screen('portals/public.tsx')
    expect(pub).toContain('const name = (what: string) => (agency ? `${what} — ${agency}` : what)')
    for (const title of ['Pay your invoice', 'Payment received', 'Client portal', 'Family portal']) expect(pub).toContain(`<Titled title={name('${title}')}>`)
    expect(pub).toMatch(/function Titled\([^)]*\) \{\s*usePageTitle\(title\)/)
  })
  test('the agency name comes from the page the server writes, escaped — never pasted into the source', () => {
    for (const f of ['people/shared.ts', 'portals/portalHttp.ts']) expect(screen(f)).toContain(`querySelector('meta[name="company-name"]')`)
    const server = fs.readFileSync(path.resolve(import.meta.dir, '..', 'server', 'http', 'adminScreens.ts'), 'utf8')
    expect(server).toContain('<meta name="company-name" content="${escHtml(name)}">')
    const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : /\.tsx?$/.test(e.name) ? [path.join(d, e.name)] : [])
    expect(walk(HC).filter((f) => fs.readFileSync(f, 'utf8').split('\n').some((l) => !/^\s*\/\//.test(l) && /\{\{COMPANY_NAME\}\}/.test(l))).map((f) => path.relative(HC, f))).toEqual([])
  })
  test('the title is put back when the page closes', () => {
    expect(screen('lib/usePageTitle.ts')).toMatch(/return \(\) => \{ document\.title = before; \};/)
  })
})
