// A job's money reaches a person only through the permission it sits under — on EVERY route, not just /api/jobs.
//
// The rule is one list (packages/tenant-backend/src/jobs/jobMoney.ts): quotes:read unlocks a job's quoted value;
// invoices:read roofing's revenue and the claim's money (final revenue, deductible, RCV, ACV, approved scope);
// margin:read what the job cost (material, labour). Roofing's columns joined the shared `job` table
// (migrations/0012_roof.sql), so every route that returns a job row — whole, spread, joined or named — is a door
// the rule has to stand in. A grep for `.from(job)` is blind to aliases, spreads and `.returning()`, so this asks
// the real server: a job carrying a distinctive value in every money column, then every GET route in the app's own
// route table, called as a seat that holds jobs:read and other reads but none of those three permissions.
// (2026-10-19)
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { FEATURE_REGISTRY, JOB_MONEY } from '@twomiah/tenant-backend'
import { bootTenant, seedOwner } from './harness.ts'

/** Every money column on the job, each with a value no other figure in the tenant could be. */
const MONEY: Record<string, string> = {
  estimatedValue: '91111.11',
  finalRevenue: '92222.22',
  deductible: '93333.33',
  rcv: '91919.19',
  acv: '94444.44',
  approvedScope: 'SCOPE-91919-ZETA',
  materialCost: '95555.55',
  laborCost: '96666.66',
}
/** What a figure looks like in a reply: "91919.19" as a string, or 91919.19 as a number. */
const shows = (body: string, value: string) => body.includes(value)

const PASS = 'Seat-pass-1'
let t: Awaited<ReturnType<typeof bootTenant>>
const ids: Record<string, string> = {}
const tokens: Record<string, string> = {}
let portalToken = ''
let subToken = ''
let gets: string[] = []
const realFetch = globalThis.fetch
const outbound: string[] = []

/** What a route's path parameter is filled with. A parameter not named here is skipped, and the skip is listed. */
const BY_NAME: Record<string, () => string[]> = {
  jobId: () => [ids.job], contactId: () => [ids.contact], projectId: () => [ids.project], quoteId: () => [ids.quote],
  invoiceId: () => [ids.invoice], userId: () => [ids.fred], token: () => [portalToken], entityType: () => ['job'],
  entityId: () => [ids.job], type: () => ['jobs'],
}
/** `:id` by the resource it follows; an unknown resource is tried with every seeded id. */
const ID_BY_RESOURCE: Record<string, () => string> = {
  jobs: () => ids.job, tech: () => ids.job, projects: () => ids.project, contacts: () => ids.contact,
  quotes: () => ids.quote, invoices: () => ids.invoice,
}
const PARAM = /:(\w+)(\{[^}]*\})?/g

/** Every concrete URL a route pattern is called with, or the parameter that could not be filled. */
function fill(pattern: string): { urls: string[] } | { skip: string } {
  let urls = [pattern]
  for (const m of [...pattern.matchAll(PARAM)]) {
    const [whole, name] = m
    let values: string[]
    if (name === 'id') {
      const before = pattern.slice(0, m.index).split('/').filter(Boolean).pop() || ''
      values = ID_BY_RESOURCE[before] ? [ID_BY_RESOURCE[before]()] : [ids.job, ids.project, ids.contact, ids.quote, ids.invoice]
    } else if (BY_NAME[name]) values = BY_NAME[name]()
    else return { skip: name }
    urls = urls.flatMap((u) => values.map((v) => u.replace(whole, encodeURIComponent(v))))
  }
  return { urls }
}

beforeAll(async () => {
  // No test reaches the internet: a weather, map or mail call answers "unavailable" and is recorded.
  globalThis.fetch = (async (input: any) => { outbound.push(String(input?.url ?? input)); return new Response('{}', { status: 503 }) }) as any
  t = await bootTenant({ vertical: 'contractor' })
  const s = await seedOwner(t)
  const companyId = s.company.id
  // Every feature the registry offers this vertical (contractor is the base CRM, featureSet 'crm'): a module switched
  // off answers 403 FEATURE_NOT_ENABLED, which would pass for a door that is shut.
  const offeredNow = FEATURE_REGISTRY.filter((f) => f.templates.includes('crm')).map((f) => f.id)
  // …and the modules no industry is offered any more (no screen — scripts/check-unified-feature-has-screen.ts) whose API
  // is still mounted behind its switch: a door stays walked for money while it exists.
  const offered = [...offeredNow, 'route_optimization', 'map_view', 'consumer_financing']
  await t.db.update(t.schema.company).set({ enabledFeatures: offered }).where(eq(t.schema.company.id, companyId))
  t.services.features.forgetFeatures()

  const hash = await Bun.password.hash(PASS, 'bcrypt')
  const seat = async (key: string, role: string, extraPermissions: string[]) => {
    const [u] = await t.db.insert(t.schema.user).values({
      email: `${key}@money.example`, passwordHash: hash, firstName: key, lastName: 'Seat', role, companyId, extraPermissions,
    } as any).returning()
    ids[key] = u.id
    tokens[key] = (await (await t.call('/api/auth/login', { method: 'POST', json: { email: `${key}@money.example`, password: PASS } })).json()).accessToken
    expect(tokens[key]).toBeTruthy()
  }
  // The crew: the field role (jobs:read, contacts:read, projects:read, schedule:read, …) and a few more reads that
  // open more of the app — none of them quotes:read, invoices:read or margin:read.
  await seat('fred', 'field', ['team:read', 'warranties:read', 'equipment:read', 'agreements:read', 'inventory:read', 'change-orders:read', 'bookings:read'])
  // A crew lead who may also raise a job from an approved quote (jobs:create), still without quotes:read.
  await seat('cole', 'field', ['jobs:create'])
  // The same crew seat with the reports: reports:read and revenue:read are not invoices:read or margin:read.
  await seat('rhea', 'field', ['reports:read', 'revenue:read', 'team:read'])

  const sc = t.schema
  portalToken = 'portal-' + 'a'.repeat(56)
  const [contact] = await t.db.insert(sc.contact).values({
    companyId, name: 'Hal Homeowner', type: 'client', email: 'hal@money.example', address: '1 Oak St', city: 'Eau Claire', state: 'WI', zip: '54701',
    portalEnabled: true, portalToken, portalTokenExp: new Date(Date.now() + 30 * 86400000),
  }).returning()
  ids.contact = contact.id
  const [project] = await t.db.insert(sc.project).values({ companyId, number: 'PRJ-00001', name: 'Oak St roof', contactId: contact.id, status: 'active' }).returning()
  ids.project = project.id
  const [quote] = await t.db.insert(sc.quote).values({ companyId, number: 'QTE-00001', name: 'Oak St roof', status: 'approved', contactId: contact.id, projectId: project.id, subtotal: '100', total: '100' }).returning()
  ids.quote = quote.id
  const [job] = await t.db.insert(sc.job).values({
    companyId, number: 'JOB-00001', title: '1 Oak St', status: 'scheduled', contactId: contact.id, projectId: project.id, quoteId: quote.id,
    assignedToId: ids.fred, createdById: s.owner.id, scheduledDate: new Date(), scheduledTime: '09:00', estimatedHours: '4',
    address: '1 Oak St', city: 'Eau Claire', state: 'WI', zip: '54701', lat: 44.81, lng: -91.5,
    claimNumber: 'CLM-1', insuranceCompany: 'Acme Mutual', totalSquares: '32',
    ...MONEY,
  }).returning()
  ids.job = job.id
  for (const [k, v] of Object.entries(MONEY)) expect(String((job as any)[k])).toBe(v)
  await t.db.update(sc.quote).set({ jobId: job.id }).where(eq(sc.quote.id, quote.id))
  const [invoice] = await t.db.insert(sc.invoice).values({ companyId, number: 'INV-00001', status: 'sent', contactId: contact.id, projectId: project.id, jobId: job.id, subtotal: '100', total: '100' }).returning()
  ids.invoice = invoice.id
  // For the write replies: a subcontractor's job in the portal, and an approved quote not yet made a job.
  subToken = 'portal-' + 'b'.repeat(56)
  const [sub] = await t.db.insert(sc.contact).values({
    companyId, name: 'Sam Sub', type: 'subcontractor', portalEnabled: true, portalToken: subToken, portalTokenExp: new Date(Date.now() + 30 * 86400000),
  }).returning()
  const [subJob] = await t.db.insert(sc.job).values({
    companyId, number: 'JOB-00002', title: '2 Elm St', status: 'scheduled', contactId: contact.id, subcontractorId: sub.id, ...MONEY,
  }).returning()
  ids.subJob = subJob.id
  const [toConvert] = await t.db.insert(sc.quote).values({ companyId, number: 'QTE-00002', name: '3 Ash St', status: 'approved', contactId: contact.id, subtotal: '97777.77', total: '97777.77' }).returning()
  ids.toConvert = toConvert.id

  const seen = new Set<string>()
  for (const r of t.app.routes as { method: string; path: string }[]) if (r.method === 'GET' && r.path.startsWith('/api/')) seen.add(r.path)
  gets = [...seen].sort()
}, 120_000)

afterAll(() => { globalThis.fetch = realFetch })

/** Walk every GET route as `who`; return each place one of `fields` showed, and the routes that could not be filled. */
async function walk(who: string, fields: string[], checkKeys: boolean) {
  const leaks: string[] = []
  const skipped: string[] = []
  const answered: Record<string, number> = {}
  const keyLeak = (node: any, url: string, trail: string) => {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) { node.forEach((n, i) => keyLeak(n, url, `${trail}[${i}]`)); return }
    for (const [k, v] of Object.entries(node)) {
      if (fields.includes(k) && v !== null && v !== undefined) leaks.push(`${url} → ${trail}.${k} = ${JSON.stringify(v)}`)
      else keyLeak(v, url, `${trail}.${k}`)
    }
  }
  for (const pattern of gets) {
    if (pattern.includes('*')) { skipped.push(`${pattern} (wildcard)`); continue }
    const filled = fill(pattern)
    if ('skip' in filled) { skipped.push(`${pattern} (:${filled.skip})`); continue }
    for (const url of filled.urls) {
      const r = await t.call(url, { headers: { Authorization: `Bearer ${tokens[who]}` } })
      const body = await r.text()
      answered[url] = r.status
      for (const f of fields) if (shows(body, MONEY[f])) leaks.push(`${url} (${r.status}) → shows ${f} ${MONEY[f]}`)
      if (checkKeys && (r.headers.get('content-type') || '').includes('json')) {
        try { keyLeak(JSON.parse(body), url, '$') } catch { /* not JSON after all */ }
      }
    }
  }
  return { leaks: [...new Set(leaks)], skipped, answered }
}

// Figures the rule withholds that are no job column (nothing to seed): actualValue, and a roofing job's quotedValue / invoicedValue, summed
// from its own quotes and invoices (server/crm/roof/jobs.ts documentValues).
const DERIVED = ['actualValue', 'quotedValue', 'invoicedValue']
const ALL_FIELDS = Object.keys(MONEY)
const ROOF_FIELDS = [...JOB_MONEY['invoices:read'], ...JOB_MONEY['margin:read']].filter((f) => MONEY[f])

describe("a job's money, on every route", () => {
  test('the rule names every money column this test seeds, and the walk reads the app itself', () => {
    expect([...new Set(Object.values(JOB_MONEY).flat())].filter((f) => !DERIVED.includes(f)).sort()).toEqual(ALL_FIELDS.slice().sort())
    expect(gets.length).toBeGreaterThan(400)
    for (const p of ['/api/jobs', '/api/jobs/:id', '/api/tech/my-jobs', '/api/projects/:id', '/api/routing/optimize-day']) expect(gets).toContain(p)
  })

  test('a crew seat without quotes:read, invoices:read or margin:read sees none of a job\'s money on any GET route', async () => {
    const { leaks, skipped, answered } = await walk('fred', ALL_FIELDS, true)
    const ok = Object.values(answered).filter((s) => s < 300).length
    console.log(`[job-money-walk] fred: ${Object.keys(answered).length} calls (${ok} answered 2xx), ${skipped.length} routes skipped:\n  ${skipped.join('\n  ')}`)
    expect(leaks).toEqual([])
    // Not a vacuous walk: the job's own reads answered, with the job in them.
    for (const u of ['/api/jobs', `/api/jobs/${ids.job}`, '/api/jobs/today', '/api/tech/my-jobs', `/api/projects/${ids.project}`, '/api/routing/optimize-day']) {
      expect(`${u} ${answered[u]}`).toBe(`${u} 200`)
    }
    const seesJob = async (u: string) => (await (await t.call(u, { headers: { Authorization: `Bearer ${tokens.fred}` } })).text()).includes(ids.job)
    for (const u of [`/api/jobs/${ids.job}`, '/api/tech/my-jobs', `/api/projects/${ids.project}`, '/api/routing/optimize-day']) expect(`${u} ${await seesJob(u)}`).toBe(`${u} true`)
  }, 300_000)

  test("reports:read and revenue:read do not reach roofing's claim money or its costs", async () => {
    const { leaks } = await walk('rhea', ROOF_FIELDS, false)
    expect(leaks).toEqual([])
  }, 300_000)

  test("a write's reply is a read: the crew's own buttons hand back no money", async () => {
    const as = (method: string, url: string, json: unknown = {}) => t.call(url, { method, json, headers: { Authorization: `Bearer ${tokens.fred}` } })
    const replies: Record<string, string> = {}
    for (const [method, url, json] of [
      ['PUT', `/api/jobs/${ids.job}`, { notes: 'gutters too' }],
      ['POST', `/api/tech/${ids.job}/on-my-way`, {}],
      ['POST', `/api/tech/${ids.job}/on-site`, {}],
      ['POST', `/api/jobs/${ids.job}/complete`, {}],
      ['POST', `/api/jobs/${ids.job}/start`, {}],
    ] as const) {
      const r = await as(method, url, json)
      const body = await r.text()
      replies[`${method} ${url}`] = `${r.status} ${ALL_FIELDS.filter((f) => shows(body, MONEY[f])).join(',')}`
    }
    expect(replies).toEqual({
      [`PUT /api/jobs/${ids.job}`]: '200 ',
      [`POST /api/tech/${ids.job}/on-my-way`]: '200 ',
      [`POST /api/tech/${ids.job}/on-site`]: '200 ',
      [`POST /api/jobs/${ids.job}/complete`]: '200 ',
      [`POST /api/jobs/${ids.job}/start`]: '200 ',
    })

    // A job raised from a quote by a seat with jobs:create and no quotes:read: its value is the quote's, withheld.
    const made = await t.call(`/api/quotes/${ids.toConvert}/convert-to-job`, { method: 'POST', json: {}, headers: { Authorization: `Bearer ${tokens.cole}` } })
    const madeBody = await made.text()
    expect({ status: made.status, value: madeBody.includes('97777.77'), key: 'estimatedValue' in JSON.parse(madeBody) }).toEqual({ status: 201, value: false, key: false })

    // A subcontractor finishing their job in the portal holds no permission at all.
    const done = await t.call(`/api/portal/p/${subToken}/my-jobs/${ids.subJob}/complete`, { method: 'POST', json: {} })
    const doneBody = await done.text()
    expect(`${done.status} ${ALL_FIELDS.filter((f) => shows(doneBody, MONEY[f])).join(',')}`).toBe('200 ')
  }, 60_000)
})
