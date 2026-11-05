// Roofing parity row 11 (docs/parity/roof-insurance-extras.md #8; server/crm/roof/insurance/permits.ts), through the real server as the
// roofing vertical:
//   · Permits is a NOT READY feature (`roof_permits`), offered to roofing and to nobody's plan; with it off its doors are shut;
//   · a permit on a job keeps its type, issuing office, number, FEE in whole cents and the days it was applied for, issued, expires and
//     was finaled; the fee and the days are checked field by field;
//   · its status moves needed → applied → issued → finaled (or rejected), each step stamped with its day ON THE COMPANY'S CLOCK, going back
//     a step clears the later days, and every move is a line on the job's notes;
//   · an issued permit past its expiry day is flagged expired, on the company's day;
//   · the board across jobs lists every permit the seat can see (a field seat only the jobs it is on), narrowed by status;
//   · the fee is the shop's cost: a seat that does not read cost sees the permit without it and cannot set it;
//   · who may: read jobs:read, add jobs:create, move and edit jobs:update, remove jobs:delete; another company's permit is a 404.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { FEATURE_REGISTRY, getAdvertisableFeaturesForTemplate, getFeaturesForPlan, storeDateString } from '@twomiah/tenant-backend'

type T = Awaited<ReturnType<typeof bootTenant>>
let t: T
let companyId = ''
const tokens: Record<string, string> = {}
const ids: Record<string, string> = {}
const PASS = 'Seat-pass-1'

const login = async (email: string, password: string) =>
  (await (await t.call('/api/auth/login', { method: 'POST', json: { email, password } })).json()).accessToken as string
const as = (who: string) => (p: string, init: any = {}) => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${tokens[who]}` } })
const json = async (r: Response) => ({ status: r.status, body: await r.json() as any })
const get = async (who: string, p: string) => json(await as(who)(p))
const post = async (who: string, p: string, body?: unknown) => json(await as(who)(p, { method: 'POST', ...(body === undefined ? {} : { json: body }) }))
const put = async (who: string, p: string, body: unknown) => json(await as(who)(p, { method: 'PUT', json: body }))
const del = async (who: string, p: string) => json(await as(who)(p, { method: 'DELETE' }))
const features = async (list: string[]) => {
  await t.db.update(t.schema.company).set({ enabledFeatures: list } as any).where(eq(t.schema.company.id, companyId))
  t.services.features.forgetFeatures()
}
const ON = ['roof_permits', 'jobs', 'contacts']
const addDays = (ymd: string, n: number) => { const d = new Date(`${ymd}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const setZone = async (tz: string) => { await t.db.update(t.schema.company).set({ timezone: tz } as any).where(eq(t.schema.company.id, companyId)) }
const jobNotes = async (jobId: string) => (await t.db.select().from(t.schema.jobNote).where(eq(t.schema.jobNote.jobId, jobId))).map((n: any) => n.body as string)

async function makeJob(address: string, extra: Record<string, unknown> = {}) {
  const [row] = await t.db.insert(t.schema.job).values({
    companyId, contactId: ids.home, number: `ROOF-${String(Math.floor(Math.random() * 90000) + 10000)}`, title: address, address, city: 'Eau Claire', state: 'WI', zip: '54701', jobType: 'retail', status: 'signed', ...extra,
  } as any).returning()
  return row.id as string
}
const permit = async (jobId: string, body: Record<string, unknown> = {}, who = 'owner') => {
  const r = await post(who, '/api/permits', { jobId, permitType: 'Building', jurisdiction: 'City of Eau Claire', permitNumber: '24-0113', ...body })
  expect(r.status).toBe(201)
  return r.body
}

beforeAll(async () => {
  t = await bootTenant({ vertical: 'roofing' })
  const seeded = await seedOwner(t)
  companyId = seeded.company.id
  tokens.owner = await login('owner@test.example', seeded.password)
  await features(ON)
  await setZone('America/Chicago')
  const hash = await Bun.password.hash(PASS, 'bcrypt')
  const seat = async (key: string, role: string, extraPermissions: string[] = []) => {
    const [u] = await t.db.insert(t.schema.user).values({ email: `${key}@test.example`, passwordHash: hash, firstName: key, lastName: 'Seat', role, companyId, extraPermissions } as any).returning()
    ids[key] = u.id
    tokens[key] = await login(`${key}@test.example`, PASS)
  }
  await seat('rep', 'manager')
  await seat('crew', 'field')
  await seat('clerk', 'field', ['jobs:create']) // may add a permit, never sees what the shop pays
  await seat('book', 'viewer')
  const [home] = await t.db.insert(t.schema.contact).values({ companyId, name: 'Dana Okafor' } as any).returning()
  ids.home = home.id
  ids.crewJob = await makeJob('1 Crew Rd', { assignedSalesRepId: ids.crew })
  ids.otherJob = await makeJob('2 Elsewhere Rd')
  const [other] = await t.db.insert(t.schema.company).values({ name: 'Rival Roofing', slug: 'rival-roofing', enabledFeatures: ['roof_permits'] } as any).returning()
  const [theirHome] = await t.db.insert(t.schema.contact).values({ companyId: other.id, name: 'Sam Elsewhere' } as any).returning()
  const [theirJob] = await t.db.insert(t.schema.job).values({ companyId: other.id, contactId: theirHome.id, number: 'ROOF-0001', title: '1 Far Rd', address: '1 Far Rd' } as any).returning()
  const [theirPermit] = await t.db.insert(t.schema.jobPermit).values({ companyId: other.id, jobId: theirJob.id, permitNumber: 'THEIRS-1', feeCents: 9999 } as any).returning()
  ids.theirJob = theirJob.id
  ids.theirPermit = theirPermit.id
}, 120_000)

describe('the feature is not ready', () => {
  test('Permits is offered to roofing, hidden, and on no plan', () => {
    const def: any = FEATURE_REGISTRY.find((f: any) => f.id === 'roof_permits')
    expect([def?.hidden, def?.templates]).toEqual([true, ['crm-roof']])
    expect(getAdvertisableFeaturesForTemplate('crm-roof').map((f: any) => f.id)).not.toContain('roof_permits')
    for (const plan of ['website', 'starter10', 'team25', 'business50']) expect(getFeaturesForPlan('crm-roof', plan)).not.toContain('roof_permits')
  })

  test('switched off, the permit doors are shut', async () => {
    await features(['jobs', 'contacts'])
    expect([403, 404]).toContain((await get('owner', '/api/permits')).status)
    expect([403, 404]).toContain((await post('owner', '/api/permits', { jobId: ids.crewJob })).status)
    await features(ON)
  })
})

describe('a permit on a job', () => {
  test('keeps its facts, the fee in whole cents and the days as days; the job’s notes say it was added', async () => {
    const made = await permit(ids.crewJob, { feeCents: 12550, feePaidOn: '2026-10-20', expiresOn: '2027-04-20', notes: 'Counter on 3rd floor' })
    expect(made).toMatchObject({
      jobId: ids.crewJob, permitType: 'Building', jurisdiction: 'City of Eau Claire', permitNumber: '24-0113', status: 'needed', statusLabel: 'Needed',
      feeCents: 12550, feePaidOn: '2026-10-20', expiresOn: '2027-04-20', appliedOn: null, issuedOn: null, finaledOn: null, expired: false, notes: 'Counter on 3rd floor',
    })
    // The row holds whole cents (no dollars-and-float), and the days are calendar-day markers.
    const [row] = await t.db.select().from(t.schema.jobPermit).where(eq(t.schema.jobPermit.id, made.id))
    expect(row.feeCents).toBe(12550)
    expect(new Date(row.expiresOn as Date).toISOString()).toBe('2027-04-20T00:00:00.000Z')
    expect(await jobNotes(ids.crewJob)).toContain('Permit 24-0113 (Building) added — needed · City of Eau Claire')
    const listed = (await get('owner', `/api/permits?jobId=${ids.crewJob}`)).body.data as any[]
    expect(listed.map((p) => p.id)).toContain(made.id)
    expect(listed.find((p) => p.id === made.id)).toMatchObject({ jobNumber: expect.stringMatching(/^ROOF-/), address: '1 Crew Rd', homeowner: 'Dana Okafor' })
  })

  test('is checked field by field: the fee in whole cents, real days, a known job and status', async () => {
    const bad: Array<[string, Record<string, unknown>]> = [
      ['a fee with a fraction of a cent', { feeCents: 12.5 }], ['a negative fee', { feeCents: -1 }], ['a fee too large', { feeCents: 1_000_000_001 }],
      ['a fee in words', { feeCents: '12' }], ['a day that is not one', { expiresOn: '2026-13-45' }], ['a day in the wrong shape', { issuedOn: '11/04/2026' }],
      ['a status that is not one', { status: 'approved' }], ['a number too long', { permitNumber: 'x'.repeat(81) }],
    ]
    for (const [what, body] of bad) {
      const r = await post('owner', '/api/permits', { jobId: ids.crewJob, ...body })
      expect([what, r.status]).toEqual([what, 400])
    }
    expect((await post('owner', '/api/permits', { jobId: 'no-such-job' })).status).toBe(404)
    // Another company's job is not reachable, nor its permit.
    expect((await post('owner', '/api/permits', { jobId: ids.theirJob })).status).toBe(404)
    expect((await put('owner', `/api/permits/${ids.theirPermit}`, { permitNumber: 'MINE' })).status).toBe(404)
    expect((await post('owner', `/api/permits/${ids.theirPermit}/status`, { status: 'issued' })).status).toBe(404)
    expect((await del('owner', `/api/permits/${ids.theirPermit}`)).status).toBe(404)
    const [still] = await t.db.select().from(t.schema.jobPermit).where(eq(t.schema.jobPermit.id, ids.theirPermit))
    expect(still.permitNumber).toBe('THEIRS-1')
  })

  test('edit changes the facts and clears a day or a note with an empty value; the status is not changed by an edit', async () => {
    const p = await permit(ids.otherJob, { permitNumber: 'E-1', feeCents: 5000, expiresOn: '2027-01-01', notes: 'first' })
    const edited = await put('owner', `/api/permits/${p.id}`, { permitNumber: 'E-2', feeCents: 7500, expiresOn: '', notes: '', status: 'finaled' })
    expect(edited.status).toBe(200)
    expect(edited.body).toMatchObject({ permitNumber: 'E-2', feeCents: 7500, expiresOn: null, notes: null, status: 'needed' })
    expect((await put('owner', `/api/permits/${p.id}`, { feeCents: 'a lot' })).status).toBe(400)
    expect((await put('owner', '/api/permits/nope', { notes: 'x' })).status).toBe(404)
  })
})

describe('status: needed, applied for, issued, finaled, or rejected', () => {
  test('each step is stamped with its day, going back clears the later days, and every move is a line on the job', async () => {
    const jobId = await makeJob('3 Steps Rd')
    const p = await permit(jobId, { permitNumber: 'S-1' })
    const move = async (status: string, on?: string) => (await post('owner', `/api/permits/${p.id}/status`, { status, ...(on ? { on } : {}) })).body
    const today = storeDateString(new Date(), 'America/Chicago')
    const applied = await move('applied')
    expect([applied.status, applied.appliedOn]).toEqual(['applied', today]) // no day named: today on the company's clock
    const issued = await move('issued', '2026-11-02')
    expect([issued.status, issued.statusLabel, issued.issuedOn, issued.appliedOn]).toEqual(['issued', 'Issued', '2026-11-02', today])
    const finaled = await move('finaled', '2026-11-20')
    expect([finaled.status, finaled.finaledOn]).toEqual(['finaled', '2026-11-20'])
    // Back to issued by mistake: the final inspection did not happen yet.
    const back = await move('issued')
    expect([back.status, back.finaledOn, back.issuedOn]).toEqual(['issued', null, today])
    // Turned down: what came after "applied for" did not happen.
    const rejected = await move('rejected')
    expect([rejected.status, rejected.statusLabel, rejected.appliedOn, rejected.issuedOn, rejected.finaledOn]).toEqual(['rejected', 'Rejected', today, null, null])
    // Starting over from needed clears every day.
    const again = await move('needed')
    expect([again.status, again.appliedOn, again.issuedOn, again.finaledOn]).toEqual(['needed', null, null, null])
    expect((await post('owner', `/api/permits/${p.id}/status`, { status: 'closed' })).status).toBe(400)
    expect((await post('owner', `/api/permits/${p.id}/status`, { status: 'applied', on: 'tomorrow' })).status).toBe(400)
    const notes = await jobNotes(jobId)
    expect(notes).toContain('Permit S-1 (Building) — applied for')
    expect(notes).toContain('Permit S-1 (Building) — issued')
    expect(notes).toContain('Permit S-1 (Building) — finaled')
    expect(notes).toContain('Permit S-1 (Building) — rejected')
    // A move to the status it already has writes no second line.
    const before = (await jobNotes(jobId)).length
    await move('needed')
    expect((await jobNotes(jobId)).length).toBe(before)
  })

  test('the day a step is stamped is the COMPANY’s day, not the server’s', async () => {
    // Two zones 25 hours apart: at any moment at least one is on a different calendar day from UTC.
    const zones = ['Pacific/Kiritimati', 'Pacific/Pago_Pago']
    const utc = new Date().toISOString().slice(0, 10)
    expect(zones.some((z) => storeDateString(new Date(), z) !== utc)).toBe(true)
    for (const tz of zones) {
      await setZone(tz)
      const p = await permit(ids.otherJob, { permitNumber: `Z-${tz}` })
      const r = await post('owner', `/api/permits/${p.id}/status`, { status: 'applied' })
      expect([tz, r.body.appliedOn]).toEqual([tz, storeDateString(new Date(), tz)])
    }
    await setZone('America/Chicago')
  })

  test('an issued permit past its expiry day is flagged expired, on the company’s day; the day itself is still good', async () => {
    const today = storeDateString(new Date(), 'America/Chicago')
    const make = async (n: string, expiresOn: string, status: string) => {
      const p = await permit(ids.otherJob, { permitNumber: n, expiresOn })
      await post('owner', `/api/permits/${p.id}/status`, { status })
      return p.id as string
    }
    const past = await make('X-PAST', addDays(today, -1), 'issued')
    const onDay = await make('X-TODAY', today, 'issued')
    const future = await make('X-FUTURE', addDays(today, 30), 'issued')
    const notIssued = await make('X-APPLIED', addDays(today, -5), 'applied')
    const finaled = await make('X-DONE', addDays(today, -5), 'finaled')
    const all = (await get('owner', '/api/permits')).body.data as any[]
    const expired = (id: string) => all.find((p) => p.id === id).expired
    expect([past, onDay, future, notIssued, finaled].map(expired)).toEqual([true, false, false, false, false])
  })
})

describe('the board across jobs', () => {
  test('lists every permit of every job with its job, address and homeowner, narrowed by status, never another company’s', async () => {
    const all = (await get('owner', '/api/permits')).body.data as any[]
    expect(all.length).toBeGreaterThan(3)
    expect(all.some((p) => p.id === ids.theirPermit)).toBe(false)
    for (const p of all) expect(p).toMatchObject({ jobNumber: expect.any(String), homeowner: 'Dana Okafor' })
    const issued = (await get('owner', '/api/permits?status=issued')).body.data as any[]
    expect(issued.length).toBeGreaterThan(0)
    expect(new Set(issued.map((p) => p.status))).toEqual(new Set(['issued']))
    expect((await get('owner', '/api/permits?status=bogus')).status).toBe(400)
    // Newest first.
    const times = all.map((p) => Date.parse(p.createdAt))
    expect(times).toEqual([...times].sort((a, b) => b - a))
  })

  test('a field seat reads the permits of the jobs it is on, and no other', async () => {
    const mine = (await get('crew', '/api/permits')).body.data as any[]
    expect(mine.length).toBeGreaterThan(0)
    expect(new Set(mine.map((p) => p.jobId))).toEqual(new Set([ids.crewJob]))
    expect((await get('crew', `/api/permits?jobId=${ids.otherJob}`)).body.data).toHaveLength(0)
    // …and cannot reach one of the other job's permits by its id.
    const someoneElses = ((await get('owner', `/api/permits?jobId=${ids.otherJob}`)).body.data as any[])[0]
    expect((await post('crew', `/api/permits/${someoneElses.id}/status`, { status: 'applied' })).status).toBe(404)
    // The read-only seat sees every job's.
    expect(((await get('book', '/api/permits')).body.data as any[]).some((p) => p.jobId === ids.otherJob)).toBe(true)
  })
})

describe('the fee is the shop’s cost', () => {
  test('a seat that does not read cost sees the permit without a fee, flagged, and cannot set one', async () => {
    const p = await permit(ids.crewJob, { permitNumber: 'F-1', feeCents: 4200 })
    for (const who of ['crew', 'book']) {
      const row = ((await get(who, `/api/permits?jobId=${ids.crewJob}`)).body.data as any[]).find((x) => x.id === p.id)
      expect([who, !!row, row?.moneyWithheld, row && 'feeCents' in row]).toEqual([who, true, true, false])
    }
    const seen = ((await get('rep', `/api/permits?jobId=${ids.crewJob}`)).body.data as any[]).find((x) => x.id === p.id)
    expect([seen.feeCents, 'moneyWithheld' in seen]).toEqual([4200, false])
    const clerkJob = await makeJob('4 Clerk Rd', { assignedSalesRepId: ids.clerk })
    const refusedAdd = await post('clerk', '/api/permits', { jobId: clerkJob, feeCents: 100 })
    expect([refusedAdd.status, refusedAdd.body.code]).toEqual([403, 'permit_fee_not_permitted'])
    const refusedEdit = await put('crew', `/api/permits/${p.id}`, { feeCents: 1 })
    expect([refusedEdit.status, refusedEdit.body.code]).toEqual([403, 'permit_fee_not_permitted'])
    // …but may add and change everything else, and the fee is left as it was.
    const added = await post('clerk', '/api/permits', { jobId: clerkJob, permitType: 'Electrical' })
    expect([added.status, added.body.moneyWithheld, 'feeCents' in added.body]).toEqual([201, true, false])
    expect((await put('crew', `/api/permits/${p.id}`, { notes: 'posted in the window' })).status).toBe(200)
    const [row] = await t.db.select().from(t.schema.jobPermit).where(eq(t.schema.jobPermit.id, p.id))
    expect([row.feeCents, row.notes]).toEqual([4200, 'posted in the window'])
  })
})

describe('who may', () => {
  test('adding is jobs:create, moving and editing jobs:update, removing jobs:delete', async () => {
    // The crew (field) holds jobs:read and jobs:update only.
    expect((await post('crew', '/api/permits', { jobId: ids.crewJob })).status).toBe(403)
    expect((await post('book', '/api/permits', { jobId: ids.crewJob })).status).toBe(403)
    const p = await permit(ids.crewJob, { permitNumber: 'W-1' }, 'rep')
    expect((await post('crew', `/api/permits/${p.id}/status`, { status: 'applied' })).status).toBe(200)
    expect((await post('book', `/api/permits/${p.id}/status`, { status: 'issued' })).status).toBe(403)
    expect((await put('book', `/api/permits/${p.id}`, { notes: 'x' })).status).toBe(403)
    expect((await del('crew', `/api/permits/${p.id}`)).status).toBe(403)
    expect((await del('book', `/api/permits/${p.id}`)).status).toBe(403)
    expect((await del('rep', `/api/permits/${p.id}`)).status).toBe(200)
    expect((await get('owner', `/api/permits?jobId=${ids.crewJob}`)).body.data.some((x: any) => x.id === p.id)).toBe(false)
    expect(await jobNotes(ids.crewJob)).toContain('Permit W-1 (Building) removed')
  })
})
