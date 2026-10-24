// The live role tests of 2026-10-24 (contractor, HVAC, roofing, home care), through the real server and the real login:
//   1. deactivating then reactivating a login leaves its jobs on it (assignedToId and job_assignee), and the job form
//      still names a switched-off person rather than reading "Unassigned";
//   2. a field seat runs its own job (status, notes) but may not reassign it or move its date or time — jobs:dispatch,
//      on the shared job routes, roofing's own, the day re-time and the bulk tools — and the screens ask the same word;
//   3. a field seat has no Reports, on the server and in roofing's menu;
//   4. home care's Billing Schedule offers the cadence only to care-billing:update, and a refusal is an error banner;
//   5. a canvassing session started without the phone's location is centred on the business, and a door logged by its
//      address is placed (a stub geocoder — never the network);
//   6. the caregiver's "Client N/A" button says what it does; 7. "3 Pricing tierss".
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { and, eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'

const PASSWORD = 'Role-tests-1024v'
const ROOT = join(import.meta.dir, '..', '..', '..')
const src = (p: string) => readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n')

async function setUp(vertical: string, features: string[], company: Record<string, unknown> = {}) {
  const t = await bootTenant({ vertical })
  const s = await seedOwner(t)
  const co = s.company.id
  await t.db.update(t.schema.company).set({ timezone: 'America/Chicago', enabledFeatures: features, ...company } as any).where(eq(t.schema.company.id, co))
  const tokens: Record<string, string> = {}
  const ids: Record<string, string> = { owner: s.owner.id }
  tokens.owner = ((await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } })).json()) as any).accessToken
  for (const [key, role] of Object.entries({ tech: 'field', other: 'field', manager: 'manager' })) {
    const email = `${key}@test.example`
    const [u] = await t.db.insert(t.schema.user).values({ email, passwordHash: await Bun.password.hash(PASSWORD, 'bcrypt'), firstName: key, lastName: 'Tester', role, companyId: co } as any).returning()
    ids[key] = u.id
    tokens[key] = ((await (await t.call('/api/auth/login', { method: 'POST', json: { email, password: PASSWORD } })).json()) as any).accessToken
  }
  const as = async (who: string, path: string, method = 'GET', json?: unknown) => {
    const r = await t.call(path, { method, json, headers: { Authorization: `Bearer ${tokens[who]}` } })
    const text = await r.text()
    let body: any = text
    try { body = JSON.parse(text) } catch { /* not JSON */ }
    return { status: r.status, body }
  }
  return { t, co, ids, as }
}

describe('contractor: deactivate, reactivate, and the field seat on its own job', () => {
  let x: Awaited<ReturnType<typeof setUp>>
  let job: any
  beforeAll(async () => {
    x = await setUp('contractor', ['contacts', 'jobs', 'team', 'tech_mobile_view', 'dashboard', 'reports'])
    ;[job] = await x.t.db.insert(x.t.schema.job).values({ companyId: x.co, number: 'JOB-00003', title: 'Deck', status: 'scheduled', scheduledDate: new Date('2026-10-28T00:00:00Z'), scheduledTime: '09:00', assignedToId: x.ids.tech } as any).returning()
    await x.t.db.insert(x.t.schema.jobAssignee).values({ companyId: x.co, jobId: job.id, userId: x.ids.other } as any)
  }, 120_000)

  test('1. switching a login off and on again leaves the job on them — lead and crew', async () => {
    for (const who of ['tech', 'other']) {
      expect((await x.as('owner', `/api/company/users/${x.ids[who]}`, 'PUT', { isActive: false })).status).toBe(200)
      expect((await x.as('owner', `/api/company/users/${x.ids[who]}`, 'PUT', { isActive: true })).status).toBe(200)
    }
    const [row] = await x.t.db.select().from(x.t.schema.job).where(eq(x.t.schema.job.id, job.id))
    expect(row.assignedToId).toBe(x.ids.tech)
    const crew = await x.t.db.select().from(x.t.schema.jobAssignee).where(eq(x.t.schema.jobAssignee.jobId, job.id))
    expect(crew.map((r: any) => r.userId)).toEqual([x.ids.other])
    const read = await x.as('owner', `/api/jobs/${job.id}`)
    expect(read.body.assignees.map((a: any) => a.id).sort()).toEqual([x.ids.tech, x.ids.other].sort())
  })

  test('2. the field seat changes its job\'s status and notes, and posting the record back unchanged is never refused', async () => {
    const mine = await x.as('tech', `/api/jobs/${job.id}`)
    expect(mine.status).toBe(200)
    const echo = await x.as('tech', `/api/jobs/${job.id}`, 'PUT', { ...mine.body, status: 'in_progress', notes: 'Gate code 1234' })
    expect(echo.status).toBe(200)
    expect(echo.body.status).toBe('in_progress')
  })

  test('2. …and may not reassign it, add someone to it, or move its date or time (jobs:dispatch)', async () => {
    for (const change of [{ assignedToId: x.ids.manager }, { otherAssigneeIds: [x.ids.manager] }, { scheduledDate: '2026-10-29' }, { scheduledTime: '13:00' }]) {
      const r = await x.as('tech', `/api/jobs/${job.id}`, 'PUT', change)
      expect({ change, status: r.status, code: r.body.code }).toEqual({ change, status: 403, code: 'job_dispatch_not_permitted' })
    }
    const [row] = await x.t.db.select().from(x.t.schema.job).where(eq(x.t.schema.job.id, job.id))
    expect([row.assignedToId, row.scheduledTime, new Date(row.scheduledDate).toISOString().slice(0, 10)]).toEqual([x.ids.tech, '09:00', '2026-10-28'])
    expect((await x.as('tech', '/api/jobs/retime', 'POST', { times: [{ id: job.id, scheduledTime: '07:00' }] })).status).toBe(403)
    for (const p of ['/api/bulk/jobs/assign', '/api/bulk/jobs/reschedule', '/api/bulk/jobs/update', '/api/bulk/jobs/status'])
      expect({ p, s: (await x.as('tech', p, 'POST', { ids: [job.id], assignedToId: x.ids.tech, scheduledDate: '2026-10-30', status: 'completed', updates: { assignedToId: x.ids.tech } })).status }).toEqual({ p, s: 403 })
  })

  test('2. the office still dispatches: the manager moves and reassigns it', async () => {
    const r = await x.as('manager', `/api/jobs/${job.id}`, 'PUT', { assignedToId: x.ids.manager, scheduledDate: '2026-10-29', scheduledTime: '13:00' })
    expect(r.status).toBe(200)
    expect([r.body.assignedToId, r.body.scheduledTime]).toEqual([x.ids.manager, '13:00'])
  })

  test('3. a field seat has no Reports on the server; the manager has', async () => {
    expect((await x.as('tech', '/api/reports/dashboard')).status).toBe(403)
    expect((await x.as('manager', '/api/reports/dashboard')).status).toBe(200)
  })
})

describe('roofing: the field seat on its own job, Reports, and canvassing on the business', () => {
  let x: Awaited<ReturnType<typeof setUp>>
  let job: any
  const realFetch = globalThis.fetch
  const asked: string[] = []
  beforeAll(async () => {
    x = await setUp('roofing', ['jobs', 'contacts', 'dashboard', 'canvassing_tool', 'crews', 'reports'], { address: null, city: 'Eau Claire', state: 'WI', zip: '54701' })
    const [contact] = await x.t.db.insert(x.t.schema.contact).values({ companyId: x.co, name: 'Hal Homeowner', type: 'client' } as any).returning()
    ;[job] = await x.t.db.insert(x.t.schema.job).values({ companyId: x.co, number: 'ROOF-0001', title: '1 Elm St', address: '1 Elm St', status: 'lead', contactId: contact.id, scheduledDate: new Date('2026-10-28T05:00:00Z'), assignedSalesRepId: x.ids.tech } as any).returning()
    // A stub geocoder — the tests blank NOMINATIM_URL (noLiveKeys.ts); this suite points it at a host nobody serves.
    process.env.NOMINATIM_URL = 'http://geo.stub'
    globalThis.fetch = (async (input: any, init?: any) => {
      const url = String(input?.url ?? input)
      if (!url.startsWith('http://geo.stub/')) return realFetch(input, init)
      asked.push(decodeURIComponent(new URL(url).searchParams.get('q') || ''))
      return new Response(JSON.stringify([{ lat: '44.8113', lon: '-91.4985', display_name: 'Eau Claire, WI', type: 'city' }]), { headers: { 'content-type': 'application/json' } })
    }) as any
  }, 120_000)
  afterAll(() => { globalThis.fetch = realFetch; process.env.NOMINATIM_URL = '' })

  test('2. the field seat keeps its notes and may not move the crew, the rep or the dates', async () => {
    expect((await x.as('tech', `/api/jobs/${job.id}`, 'PUT', { notes: 'Ladder on the north side' })).status).toBe(200)
    for (const change of [{ assignedSalesRepId: x.ids.other }, { scheduledDate: '2026-10-30' }, { scheduledTime: '10:00' }, { installDate: '2026-11-02' }]) {
      const r = await x.as('tech', `/api/jobs/${job.id}`, 'PUT', change)
      expect({ change, status: r.status, code: r.body.code }).toEqual({ change, status: 403, code: 'job_dispatch_not_permitted' })
    }
    expect((await x.as('tech', `/api/jobs/${job.id}`, 'PUT', { estimatedRevenue: 1 })).status).toBe(403)
    expect((await x.as('manager', `/api/jobs/${job.id}`, 'PUT', { scheduledDate: '2026-10-30', estimatedRevenue: 9000 })).status).toBe(200)
  })

  test('3. a Field seat has no Reports: the server refuses it, and roofing\'s menu asks reports:read', async () => {
    expect((await x.as('tech', '/api/reports/dashboard')).status).toBe(403)
    const menu = src('apps/unified/web/src/crm/pages/roof/jobs/index.tsx')
    expect(menu).toContain(`'/crm/reports': 'reports:read'`)
    expect(menu).toContain(`label: 'Reports', features: ['reports'], permission: 'reports:read'`)
  })

  test('5. a session started without the phone\'s location opens on the business; a door is placed by its address', async () => {
    const s = await x.as('tech', '/api/canvassing/sessions', 'POST', { name: 'After the hail' })
    expect(s.status).toBe(201)
    expect([Number(s.body.centerLat), Number(s.body.centerLng)]).toEqual([44.8113, -91.4985])
    expect(asked).toContain('Eau Claire, WI 54701')
    const phone = await x.as('tech', '/api/canvassing/sessions', 'POST', { name: 'On the street', centerLat: 44.9, centerLng: -91.3 })
    expect([Number(phone.body.centerLat), Number(phone.body.centerLng)]).toEqual([44.9, -91.3])
    const door = await x.as('tech', `/api/canvassing/sessions/${s.body.id}/stops`, 'POST', { outcome: 'no_answer', address: '103 Test St', city: 'Eau Claire', state: 'WI', zip: '54701' })
    expect(door.status).toBe(201)
    expect([Number(door.body.lat), Number(door.body.lng)]).toEqual([44.8113, -91.4985])
    expect(asked).toContain('103 Test St, Eau Claire, WI 54701')
    const map = await x.as('tech', `/api/canvassing/sessions/${s.body.id}/map`)
    expect(map.body.data.map((p: any) => p.address)).toEqual(['103 Test St'])
  })
})

describe('the screens ask what the server asks', () => {
  test('2. every job screen offers moving and reassigning to jobs:dispatch only', () => {
    expect(src('packages/tenant-ui/src/jobs/JobsPage.tsx')).toContain(`useMayWrite('jobs:dispatch')`)
    expect(src('packages/tenant-ui/src/schedule/SchedulePage.tsx')).toContain(`const mayMoveJobs = useMayWrite('jobs:dispatch')`)
    expect(src('apps/unified/web/src/crm/pages/fieldservice/DispatchBoard.tsx')).toContain(`const draggable = mayDispatch &&`)
    expect(src('apps/unified/web/src/crm/pages/roof/jobs/JobDetailPage.tsx')).toContain(`disabled={!mayWorkJob || !mayDispatchJob}`)
  })
  test('4. the Billing Schedule cadence is a box only for care-billing:update; a ✗ message is the error banner', () => {
    const b = src('apps/unified/web/src/crm/pages/homecare/billing/BillingDashboard.tsx')
    expect(b).toContain('{may.update\n')
    expect(b).not.toContain(`disabled={!may.update}>`)
    expect(b).toContain(`message.startsWith('✗') ? 'alert-error' : 'alert-success'`)
  })
  test('6 and 7. the caregiver\'s button and the tier count read as words', () => {
    expect(src('apps/unified/web/src/crm/pages/homecare/visits/CaregiverDashboard.tsx')).not.toContain('Client N/A</button>')
    const pb = src('packages/tenant-ui/src/pricebook/PricebookPage.tsx')
    expect(pb).not.toMatch(/tiersTitle \|\| '[^']*'\}\{[^}]*=== 1 \? '' : 's'\}/)
  })
})
