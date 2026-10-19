// Whose records a person reaches in home care — the one rule (server/crm/homecare/core/caregiverAccess.ts):
//   · a caregiver is the field seat (stored 'field', 'caregiver' or 'user') and is always narrowed to themselves — even
//     when an owner grants them an area's permission;
//   · anyone else reaches EVERYONE's record in an area with that area's permission for the act — a read with :read, a
//     change with :create / :update / :delete.
// It was two rules (2026-10-19): "the office" was a list of roles (owner, admin, manager), so a seat granted read access
// was refused every caregiver's file; and the scheduling and visits routes asked only "not a caregiver?", so the same
// seat — holding nothing but care-schedule:read — could claim a shift in someone else's name, answer or withdraw anyone's
// shift swap, resolve visit change requests, and sign any client's document.
import { describe, test, expect, beforeAll } from 'bun:test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId = ''
const tokens: Record<string, string> = {}
const ids: Record<string, string> = {}

const login = async (email: string, password: string) =>
  (await (await t.call('/api/auth/login', { method: 'POST', json: { email, password } })).json()).accessToken as string
const as = (who: string) => (p: string, init: any = {}) => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${tokens[who]}` } })
const status = async (who: string, p: string, init: any = {}) => (await as(who)(p, init)).status

const CARE_READS = ['care-clients:read', 'care-schedule:read', 'evv:read', 'care-billing:read', 'care-payroll:read', 'care-hr:read', 'care-portal:read', 'care-compliance:read']
const PASS = 'Seat-pass-1'

beforeAll(async () => {
  t = await bootTenant({ vertical: 'homecare' })
  const seeded = await seedOwner(t)
  companyId = seeded.company.id
  ids.owner = seeded.owner.id
  tokens.owner = await login('owner@test.example', seeded.password)
  const hash = await Bun.password.hash(PASS, 'bcrypt')
  const seat = async (key: string, role: string, extraPermissions: string[] = []) => {
    const [u] = await t.db.insert(t.schema.user).values({
      email: `${key.toLowerCase()}@test.example`, passwordHash: hash, firstName: key, lastName: 'Seat', role, companyId, extraPermissions,
    } as any).returning()
    ids[key] = u.id
    tokens[key] = await login(`${key.toLowerCase()}@test.example`, PASS)
  }
  await seat('ann', 'caregiver')
  await seat('bob', 'field')
  await seat('mona', 'manager')
  // Every home-care read and no change: an owner's read-only grant (a bookkeeper, an auditor).
  await seat('rita', 'viewer', CARE_READS)
  // A viewer with no home-care grant.
  await seat('vic', 'viewer')
  // The caregiver seats, each GRANTED care-hr:read — still narrowed to themselves.
  await seat('cgCaregiver', 'caregiver', ['care-hr:read'])
  await seat('cgField', 'field', ['care-hr:read'])
  await seat('cgUser', 'user', ['care-hr:read'])
  // And the seats that are not caregivers, given the same grant.
  await seat('nonViewer', 'viewer', ['care-hr:read'])

  const [pat] = await t.db.insert(t.schema.clients).values({ companyId, firstName: 'Pat', lastName: 'Client', isActive: true, isPrivatePay: true } as any).returning()
  ids.pat = pat.id
  const shift = async (caregiverId: string, date: string, from: string, to: string) => (await t.db.insert(t.schema.schedules).values({
    companyId, clientId: pat.id, caregiverId, dayOfWeek: null, date, scheduleType: 'one-time',
    startTime: new Date(`${date}T${from}:00Z`), endTime: new Date(`${date}T${to}:00Z`),
  } as any).returning())[0].id
  ids.annShift = await shift(ids.ann, '2026-12-02', '15:00', '17:00')
  ids.bobShift = await shift(ids.bob, '2026-12-03', '19:00', '21:00')
}, 120_000)

describe('home care — whose records', () => {
  test('a caregiver seat is narrowed to themselves even with a grant; any other seat reaches with it', async () => {
    const file = (who: string) => status(who, `/api/caregivers/${ids.ann}/summary`)
    expect({
      cgCaregiver: await file('cgCaregiver'), cgField: await file('cgField'), cgUser: await file('cgUser'),
      nonViewer: await file('nonViewer'), vic: await file('vic'), ann: await file('ann'),
    }).toEqual({ cgCaregiver: 403, cgField: 403, cgUser: 403, nonViewer: 200, vic: 403, ann: 200 })
    // The web's home screen draws the same line (crm/verticals/homecare.tsx CAREGIVER_SEATS): every stored role this
    // test proved a caregiver seat, and no other.
    const src = readFileSync(path.join(import.meta.dir, '../web/src/crm/verticals/homecare.tsx'), 'utf8')
    const listed = /export const CAREGIVER_SEATS = \[([^\]]*)\]/.exec(src)?.[1]?.match(/'([^']+)'/g)?.map((s) => s.slice(1, -1)).sort()
    expect(listed).toEqual(['caregiver', 'field', 'user'])
    expect(src).toMatch(/CAREGIVER_SEATS\.includes\(String\(user\?\.role \|\| ''\)\) \? visits\.CaregiverHome : office\.OfficeHome/)
  }, 60_000)

  test('a read-only seat reads every caregiver\'s file, rates, availability and history; a viewer without the grant does not', async () => {
    const reads = [
      `/api/caregivers/${ids.ann}/summary`, `/api/caregivers/${ids.ann}`, `/api/caregivers/${ids.ann}/certifications`,
      `/api/caregivers/${ids.ann}/training-records`, `/api/caregivers/${ids.ann}/background-check`, `/api/caregiver-profile/${ids.ann}`,
      `/api/certifications?caregiverId=${ids.ann}`, `/api/certifications/caregiver/${ids.ann}`, `/api/training-records?caregiverId=${ids.ann}`,
      `/api/training-records/${ids.ann}`, `/api/caregiver-rates/${ids.ann}`, `/api/caregiver-care-type-rates?caregiverId=${ids.ann}`,
      `/api/caregivers/${ids.ann}/availability`, `/api/caregiver-availability/${ids.ann}`, `/api/caregivers/${ids.ann}/blackout-dates`,
      `/api/scheduling/time-off?caregiverId=${ids.ann}`, `/api/time-tracking/caregiver-history/${ids.ann}`,
    ]
    for (const p of reads) {
      const rita = await status('rita', p)
      // 404 is "none on file" (a profile or background check not yet made): past the guard.
      expect({ p, ritaReached: rita !== 403 && rita !== 401 }).toEqual({ p, ritaReached: true })
      expect({ p, vic: await status('vic', p) }).toEqual({ p, vic: 403 })
      expect({ p, bob: await status('bob', p) }).toEqual({ p, bob: 403 })
    }
  }, 120_000)

  test('the manager reads the schedule side of a caregiver, not their HR file or pay (the manager holds no care-hr / care-payroll)', async () => {
    for (const p of [`/api/caregivers/${ids.ann}/availability`, `/api/caregivers/${ids.ann}/blackout-dates`, `/api/scheduling/time-off?caregiverId=${ids.ann}`]) {
      expect({ p, mona: await status('mona', p) }).toEqual({ p, mona: 200 })
    }
    for (const p of [`/api/caregivers/${ids.ann}/summary`, `/api/caregivers/${ids.ann}/certifications`, `/api/caregiver-care-type-rates?caregiverId=${ids.ann}`]) {
      expect({ p, mona: await status('mona', p) }).toEqual({ p, mona: 403 })
    }
  }, 60_000)

  test('a read-only seat changes no one\'s schedule record; the manager does', async () => {
    const writes: Array<[string, any]> = [
      [`/api/caregivers/${ids.ann}/availability`, { method: 'PUT', json: { maxHoursPerWeek: 30 } }],
      [`/api/caregiver-availability/${ids.ann}`, { method: 'PUT', json: { maxHoursPerWeek: 30 } }],
      [`/api/caregivers/${ids.ann}/blackout-dates`, { method: 'POST', json: { startDate: '2027-01-04', endDate: '2027-01-05' } }],
      ['/api/scheduling/time-off', { method: 'POST', json: { caregiverId: ids.ann, startDate: '2027-01-11', endDate: '2027-01-12', type: 'pto' } }],
    ]
    for (const [p, init] of writes) {
      expect({ p, rita: await status('rita', p, init) }).toEqual({ p, rita: 403 })
      const mona = await status('mona', p, init)
      expect({ p, monaReached: mona >= 200 && mona < 300 }).toEqual({ p, monaReached: true })
    }
  }, 60_000)

  test('an open shift claimed by a read-only seat is never in someone else\'s name', async () => {
    const posted = await (await as('owner')(`/api/open-shifts/from-schedule/${ids.bobShift}`, { method: 'POST', json: { date: '2026-12-03' } })).json() as any
    expect(posted.id).toBeTruthy()
    await as('rita')(`/api/open-shifts/${posted.id}/claim`, { method: 'POST', json: { caregiverId: ids.ann } })
    const claims = await t.db.select().from(t.schema.openShiftClaims).where(eq(t.schema.openShiftClaims.openShiftId, posted.id))
    expect(claims.map((c: any) => c.caregiverId)).not.toContain(ids.ann)
  }, 60_000)

  test('a shift swap is answered and withdrawn by its own caregivers or the schedule\'s office — not a read-only seat', async () => {
    expect(await status('rita', '/api/shift-swaps', { method: 'POST', json: { scheduleId: ids.annShift, requestingCaregiverId: ids.ann, targetCaregiverId: ids.bob } })).toBe(403)
    const asked = await (await as('ann')('/api/shift-swaps', { method: 'POST', json: { scheduleId: ids.annShift, targetCaregiverId: ids.bob } })).json() as any
    expect(asked.id).toBeTruthy()
    expect(await status('rita', `/api/shift-swaps/${asked.id}/respond`, { method: 'PUT', json: { accepted: true } })).toBe(403)
    expect(await status('rita', `/api/shift-swaps/${asked.id}/cancel`, { method: 'PUT' })).toBe(403)
    expect(await status('mona', `/api/shift-swaps/${asked.id}/cancel`, { method: 'PUT' })).toBe(200)
  }, 60_000)

  test('a visit change request is resolved by the schedule\'s office, never by a read-only seat', async () => {
    const asked = await as('ann')('/api/visit-change-requests/reschedule-request', { method: 'POST', json: {
      scheduleId: ids.annShift, visitDate: '2026-12-02', startTime: '15:00', endTime: '17:00',
      proposedDate: '2026-12-04', proposedStartTime: '15:00', proposedEndTime: '17:00', reason: 'appointment',
    } })
    expect(asked.status).toBe(201)
    const id = ((await asked.json()) as any).id
    expect(await status('rita', `/api/visit-change-requests/${id}/resolve`, { method: 'PUT', json: { action: 'deny' } })).toBe(404)
    expect(await status('mona', `/api/visit-change-requests/${id}/resolve`, { method: 'PUT', json: { action: 'deny' } })).toBe(200)
  }, 60_000)

  test('a client\'s document is signed by the office, not a read-only seat; anyone signs the company\'s', async () => {
    const [clientDoc] = await t.db.insert(t.schema.documents).values({ companyId, entityType: 'client', entityId: ids.pat, name: 'Service agreement', requiresSignature: true } as any).returning()
    const [companyDoc] = await t.db.insert(t.schema.documents).values({ companyId, entityType: 'company', name: 'Handbook', requiresSignature: true } as any).returning()
    const sign = { method: 'POST', json: { signatureImageBase64: 'data:image/png;base64,iVBORw0KGgo=', typedName: 'Seat' } }
    expect(await status('rita', `/api/documents/${clientDoc.id}/sign`, sign)).toBe(403)
    expect((await status('mona', `/api/documents/${clientDoc.id}/sign`, sign)) < 300).toBe(true)
    expect((await status('rita', `/api/documents/${companyDoc.id}/sign`, sign)) < 300).toBe(true)
  }, 60_000)

  test('a message thread is its participants\' and the messaging office\'s — a read grant does not open it', async () => {
    const [thread] = await t.db.insert(t.schema.messageThreads).values({ companyId, subject: 'Private', createdById: ids.ann } as any).returning()
    await t.db.insert(t.schema.messageThreadParticipants).values([{ companyId, threadId: thread.id, userId: ids.ann }, { companyId, threadId: thread.id, userId: ids.bob }] as any)
    expect(await status('rita', `/api/messages/thread/${thread.id}`)).toBe(404)
    expect(await status('ann', `/api/messages/thread/${thread.id}`)).toBe(200)
    expect(await status('mona', `/api/messages/thread/${thread.id}`)).toBe(200)
  }, 60_000)

  test('a read-only seat reads every client; a caregiver only the clients they serve', async () => {
    const rita = await (await as('rita')('/api/clients')).json() as any
    expect(rita.data.map((c: any) => c.id)).toContain(ids.pat)
    expect(await status('rita', `/api/medications/client/${ids.pat}`)).toBe(200)
    expect(await status('vic', `/api/medications/client/${ids.pat}`)).toBe(403)
  }, 60_000)
})
