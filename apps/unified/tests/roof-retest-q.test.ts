// The roofing live retest of 2026-10-24, four findings, through the real server as the roof vertical:
//   1. a door logged with no name (Hail Damage → Appointment Set → Log & Done) was refused "homeownerName: Expected
//      string, received null" — every optional field now takes null, an appointment's homeowner is "Homeowner at
//      <address>", and a refusal is words, not a schema path;
//   2. the maps drew OpenStreetMap's tile servers (403, tile usage policy) — every Leaflet map draws through
//      packages/tenant-ui maps/tiles.ts;
//   3. switching a customer's portal on mailed nothing, the portal had no Jobs tab, and its tab read "Admin";
//   4. roofing's Reports had no CSV export (checked in the browser: scripts/fixq-click.ts).
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { stopRefusal, doorHomeowner } from '../server/crm/roof/field/canvassing.ts'
import { tabTitle } from '../server/http/adminScreens.ts'
import { tileUrl } from '../../../packages/tenant-ui/src/maps/tiles.ts'
import { loadVertical } from '../server/core/vertical.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId = ''
let token = ''
const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'fixq-dist-'))
const mails: Array<{ to: string; template: string; data: any }> = []
const FEATURES = ['jobs', 'contacts', 'dashboard', 'canvassing_tool', 'client_portal', 'quotes', 'invoices']

const call = async (method: string, p: string, body?: unknown) => {
  const r = await t.call(p, { method, headers: { Authorization: `Bearer ${token}` }, ...(body === undefined ? {} : { json: body }) })
  return { status: r.status, body: await r.json().catch(() => null) as any }
}

beforeAll(async () => {
  fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><html><head><title>Admin</title></head><body></body></html>')
  t = await bootTenant({ vertical: 'roofing', adminDist: dist })
  const seeded = await seedOwner(t)
  companyId = seeded.company.id
  await t.db.update(t.schema.company).set({ name: 'Summit Roofing', enabledFeatures: FEATURES } as any).where(eq(t.schema.company.id, companyId))
  token = (await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: seeded.password } })).json()).accessToken
  ;(t.services as any).crm.emailService.send = async (to: string, template: string, data: any) => { mails.push({ to, template, data }); return { success: true } }
}, 120_000)
afterAll(() => { try { fs.rmSync(dist, { recursive: true, force: true }) } catch { /* temp */ } })

describe('1. canvassing: a door with no name', () => {
  test('the retest door (empty boxes sent as null) is logged; the appointment gets "Homeowner at <address>" and its job', async () => {
    const s = await call('POST', '/api/canvassing/sessions', { name: 'Hail sweep' })
    expect(s.status).toBe(201)
    const door = await call('POST', `/api/canvassing/sessions/${s.body.id}/stops`, {
      address: '9 Elm St', city: null, state: null, zip: null, outcome: 'appointment_set', notes: '[Hail Damage]',
      homeownerName: null, phone: null, email: null, appointmentDate: '2026-10-28T10:00', doorHangerLeft: false, followUpDate: null, photos: [],
    })
    expect(door.status).toBe(201)
    const [who] = await t.db.select().from(t.schema.contact).where(eq(t.schema.contact.id, door.body.contactId))
    expect(who.name).toBe('Homeowner at 9 Elm St')
    const [job] = await t.db.select().from(t.schema.job).where(eq(t.schema.job.id, door.body.jobId))
    expect(job.inspectionDate).toBeTruthy()
    // An interested door with no way to reach it is a door, not a lead (unchanged).
    const quiet = await call('POST', `/api/canvassing/sessions/${s.body.id}/stops`, { address: '11 Elm St', outcome: 'interested', homeownerName: null, phone: null, lat: null, lng: null })
    expect(quiet.status).toBe(201)
    expect(quiet.body.contactId).toBeNull()
  })

  test('a refusal is plain words, never a field path', async () => {
    const s = await call('POST', '/api/canvassing/sessions', { name: 'Refusals' })
    const bad = await call('POST', `/api/canvassing/sessions/${s.body.id}/stops`, { outcome: 'appointment_set', phone: 'abc', address: '1 Oak' })
    expect(bad.status).toBe(400)
    expect(bad.body.error).toBe('The phone number does not look right — check it or leave it blank.')
    const odd = await call('POST', `/api/canvassing/sessions/${s.body.id}/stops`, { outcome: 'banana' })
    expect(odd.body.error).toBe('Pick how the door went.')
    expect(stopRefusal([{ path: ['lat'] }, { path: ['lng'] }])).toBe('The GPS location does not look right — check it or leave it blank.')
    expect(doorHomeowner('  ', '  ')).toBe('Homeowner')
    expect(doorHomeowner(' Ray  Fox ', '9 Elm')).toBe('Ray Fox')
  })
})

describe('2. map tiles', () => {
  test('Google tiles, the session URL with a key; no map in the app draws OpenStreetMap\'s tile servers', () => {
    expect(tileUrl('hybrid')).toBe('https://mt{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}')
    expect(tileUrl('roadmap', 'K', 'S')).toBe('https://tile.googleapis.com/v1/2dtiles/{z}/{x}/{y}?session=S&key=K')
    const roots = [path.join(import.meta.dir, '../web/src'), path.join(import.meta.dir, '../../../packages/tenant-ui/src')]
    const hits: string[] = []
    const walk = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name)
        if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p) }
        else if (/\.(tsx?|jsx?)$/.test(e.name) && /tile\.openstreetmap\.org/.test(fs.readFileSync(p, 'utf8'))) hits.push(p)
      }
    }
    roots.forEach(walk)
    expect(hits).toEqual([])
  })
})

describe('3. the customer portal', () => {
  test('switching it on mails one invite; Resend mails again; its tab is "<Business> — Customer portal"', async () => {
    const [c] = await t.db.insert(t.schema.contact).values({ companyId, name: 'Pat Home', email: 'pat@test.example', type: 'client' } as any).returning()
    mails.length = 0
    const on = await call('POST', `/api/portal/contacts/${c.id}/enable`)
    expect(on.status).toBe(200)
    expect(on.body).toMatchObject({ invited: true, sentTo: 'pat@test.example' })
    expect(mails.map((m) => `${m.to} ${m.template}`)).toEqual(['pat@test.example portalInvite'])
    expect(mails[0].data.portalUrl).toBe(on.body.portalUrl)
    const again = await call('POST', `/api/portal/contacts/${c.id}/send-link`)
    expect(again.body).toMatchObject({ success: true, sentTo: 'pat@test.example' })
    expect(mails.length).toBe(2)
    // A failed mail leaves the portal on and says why.
    ;(t.services as any).crm.emailService.send = async () => { throw new Error('smtp down') }
    const failed = await call('POST', `/api/portal/contacts/${c.id}/enable`)
    expect(failed.status).toBe(200)
    expect(failed.body.invited).toBe(false)
    expect(failed.body.inviteError).toMatch(/^Could not send the portal invite\./)
    ;(t.services as any).crm.emailService.send = async (to: string, template: string, data: any) => { mails.push({ to, template, data }); return { success: true } }

    const page = await (await t.call(new URL(failed.body.portalUrl, 'http://t').pathname)).text()
    expect(page).toContain('<title>Summit Roofing — Customer portal</title>')
    expect(tabTitle('/crm/jobs', 'Summit Roofing')).toBe('Summit Roofing · Admin')
  })

  test('the homeowner\'s Jobs tab: their job, its stage and dates, and no money', async () => {
    const [c] = await t.db.insert(t.schema.contact).values({ companyId, name: 'Jo Roof', email: 'jo@test.example', type: 'client' } as any).returning()
    const on = await call('POST', `/api/portal/contacts/${c.id}/enable`)
    const portalToken = new URL(on.body.portalUrl, 'http://t').pathname.split('/').pop()
    await t.db.insert(t.schema.job).values({ companyId, contactId: c.id, number: 'ROOF-0900', title: '5 Pine Rd', status: 'in_production', estimatedValue: '18000', inspectionDate: new Date('2026-10-20T14:00:00Z'), installDate: new Date('2026-11-02T13:00:00Z') } as any)
    const r = await t.call(`/api/portal/p/${portalToken}/my-jobs`)
    expect(r.status).toBe(200)
    const rows = await r.json() as any[]
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ number: 'ROOF-0900', status: 'in_production' })
    expect(new Date(rows[0].inspectionDate).toISOString()).toBe('2026-10-20T14:00:00.000Z')
    expect(new Date(rows[0].installDate).toISOString()).toBe('2026-11-02T13:00:00.000Z')
    for (const k of Object.keys(rows[0])) expect(k).not.toMatch(/value|revenue|price|amount|cost|notes/i)
    const roof = await loadVertical('roofing') as any
    expect(roof.screens.portal.clientNav[0]).toBe('myJobs')
    expect(roof.screens.portal.labels.myJobs).toBe('Jobs')
  })
})

describe('4. roofing Reports exports CSV', () => {
  test('every table on the page goes out through the shared CSV helper', () => {
    const src = fs.readFileSync(path.join(import.meta.dir, '../web/src/crm/pages/roof/jobs/ReportsPage.tsx'), 'utf8')
    expect(src).toContain("from '@twomiah/tenant-ui/src/reporting/csv'")
    const titles = [...src.matchAll(/<CsvButton title="([^"]+)"/g)].map((m) => m[1])
    expect(titles).toEqual(['Report summary', 'Pipeline Value by Stage', 'Jobs by Type', 'Revenue by Sales Rep', 'Revenue by Crew'])
  })
})
