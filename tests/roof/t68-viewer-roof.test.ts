// T68 — the roofing viewer round, through the real routers.
//
//   "Should the Roofing viewer see the team's canvassing? It's empty now, because of the rule that limits staff to
//    their own sessions."  — owner, 2026-10-11: yes, read-only.
//   "Measurement report cost is shown to the viewer."
//
// The viewer holds invoices:read (it reads REVENUE, by the owner's decision) and not margin:read — what the
// company PAYS. A measurement's cost, the price per report and what a roof report was charged are paid-out money,
// so they follow margin:read everywhere they are read: /api/measurements, the job detail, /api/roof-reports/:id.
import { Hono } from 'hono'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) }
}

const { setupSchema } = await import('./setup.ts')
await setupSchema()
const { db } = await import('./db/index.ts')
const { company, user, contact, job, measurementReport, roofReport, canvassingSession } = await import('./db/schema.ts')
const { eq } = await import('drizzle-orm')

const [co] = await db.insert(company).values({
  name: 'Hip & Valley', slug: 'hip-t68', email: 'hip-t68@test.local', settings: {},
  enabledFeatures: ['canvassing_tool', 'measurement_reports'], reportCredits: 4, reportPricePerReport: '11.83',
} as any).returning()
const mk = async (role: string, tag: string) => (await db.insert(user).values({ email: `${tag}@hip-t68.local`, passwordHash: 'x', firstName: tag, lastName: 'U', role, companyId: co.id, isActive: true } as any).returning())[0]
const owner = await mk('owner', 'owner'), manager = await mk('manager', 'manager'), viewer = await mk('viewer', 'viewer')
const rep1 = await mk('field', 'rep1'), rep2 = await mk('field', 'rep2')

const app = new Hono()
app.route('/api/canvassing', (await import('./src/routes/canvassing.ts')).default)
app.route('/api/measurements', (await import('./src/routes/measurements.ts')).default)
app.route('/api/jobs', (await import('./src/routes/jobs.ts')).default)
app.route('/api/roof-reports', (await import('./src/routes/roofReports.ts')).default)
app.onError((await import('./src/utils/errors.ts')).errorHandler)
const as = (who: any) => async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, { method, headers: { 'content-type': 'application/json', 'x-test-user': who.id }, body: body === undefined ? undefined : JSON.stringify(body) })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j, text: t }
}
const V = as(viewer), R1 = as(rep1), R2 = as(rep2), M = as(manager)

// ── canvassing: the viewer reads the team, writes nothing ─────────────────────────────────────────
const s1 = await R1('POST', '/api/canvassing/sessions', { name: 'Rep 1 — Oak St' })
const s2 = await R2('POST', '/api/canvassing/sessions', { name: 'Rep 2 — Pine St' })
check('two canvassers each start a session', s1.status === 201 && s2.status === 201, { s1: s1.status, s2: s2.status })
const stop = await R1('POST', `/api/canvassing/sessions/${s1.json?.id}/stops`, { outcome: 'no_answer', address: '4 Oak St' })
check('…and rep 1 logs a door', stop.status === 201, stop)

const list = await V('GET', '/api/canvassing/sessions')
check('viewer: the team list shows BOTH reps\' sessions (it was empty)', list.status === 200 && list.json?.length === 2, list.json?.map?.((s: any) => s.name))
for (const [label, path] of [['a rep\'s session', `/api/canvassing/sessions/${s1.json?.id}`], ['its doors', `/api/canvassing/sessions/${s1.json?.id}/stops`], ['its map', `/api/canvassing/sessions/${s1.json?.id}/map`]] as const) {
  const r = await V('GET', path)
  check(`viewer: reads ${label} (200)`, r.status === 200, { status: r.status, body: r.text.slice(0, 160) })
}
const mineOnly = await V('GET', '/api/canvassing/sessions?mine=1')
check('viewer: ?mine=1 is still only its own (none)', mineOnly.status === 200 && mineOnly.json?.length === 0, mineOnly.json)
for (const [m, path, body] of [
  ['POST', '/api/canvassing/sessions', { name: 'viewer session' }],
  ['PUT', `/api/canvassing/sessions/${s1.json?.id}`, { name: 'renamed by the viewer' }],
  ['POST', `/api/canvassing/sessions/${s1.json?.id}/stops`, { outcome: 'no_answer', address: '9 Oak St' }],
  ['POST', `/api/canvassing/sessions/${s1.json?.id}/end`, {}],
  ['PUT', `/api/canvassing/stops/${stop.json?.id}`, { outcome: 'not_interested' }],
] as const) {
  const r = await V(m, path, body)
  check(`viewer: ${m} ${path.replace(String(s1.json?.id), ':rep1').replace(String(stop.json?.id), ':stop')} is refused`, r.status === 403 || r.status === 404, { status: r.status })
}
const [after] = await db.select().from(canvassingSession).where(eq(canvassingSession.id, s1.json?.id))
check('viewer: …and rep 1\'s session is exactly as it was', after?.name === 'Rep 1 — Oak St' && after?.status === 'active', { name: after?.name, status: after?.status })
const r2list = await R2('GET', '/api/canvassing/sessions')
check('a canvasser still sees only their own (T63 unchanged)', r2list.status === 200 && r2list.json?.length === 1 && r2list.json[0].id === s2.json?.id, r2list.json?.map?.((s: any) => s.name))
const r2read = await R2('GET', `/api/canvassing/sessions/${s1.json?.id}`)
check('…and cannot read another rep\'s session by id', r2read.status === 404, { status: r2read.status })

// ── cost: what the company PAID follows margin:read ───────────────────────────────────────────────
const [home] = await db.insert(contact).values({ companyId: co.id, firstName: 'Ida', lastName: 'Marsh', email: 'ida-t68@test.local' } as any).returning()
const [mr] = await db.insert(measurementReport).values({ companyId: co.id, address: '12 Birch Rd', city: 'Akron', state: 'OH', zip: '44301', provider: 'google_solar', status: 'complete', cost: '11.83', totalSquares: '28', totalArea: '2800' } as any).returning()
const [j] = await db.insert(job).values({ companyId: co.id, contactId: home.id, jobNumber: 'RF-T68-1', jobType: 'retail', source: 'manual', propertyAddress: '12 Birch Rd', city: 'Akron', state: 'OH', zip: '44301', measurementReportId: mr.id } as any).returning()
const [rr] = await db.insert(roofReport).values({
  companyId: co.id, address: '12 Birch Rd', city: 'Akron', state: 'OH', zip: '44301', lat: 41.08, lng: -81.51,
  totalAreaSqft: 2800, totalSquares: 28, segmentCount: 4, imageryQuality: 'HIGH', segments: [], edges: [], measurements: {},
  status: 'paid', amountCharged: '9.99',
} as any).returning()

for (const [label, path] of [['/api/measurements/:id', `/api/measurements/${mr.id}`], ['the measurement list', '/api/measurements'], ['credits', '/api/measurements/credits/info'], ['the job detail', `/api/jobs/${j.id}`]] as const) {
  const r = await V('GET', path)
  check(`viewer: ${label} reads (200) with no 11.83 anywhere in it`, r.status === 200 && !/11\.83/.test(r.text), { status: r.status, body: r.text.slice(0, 200) })
}
const vjob = (await V('GET', `/api/jobs/${j.id}`)).json
check('viewer: the job still carries the report\'s squares', Number(vjob?.measurementReport?.totalSquares) === 28 && !('cost' in (vjob?.measurementReport || {})), vjob?.measurementReport)
const vrr = await V('GET', `/api/roof-reports/${rr.id}`)
check('viewer: a roof report reads (200) without what it was charged', vrr.status === 200 && !('amountCharged' in (vrr.json || {})) && Number(vrr.json?.totalSquares) === 28, vrr.json && Object.keys(vrr.json))

const mm = (await M('GET', `/api/measurements/${mr.id}`)).json
check('manager (margin:read): sees what the measurement cost', Number(mm?.cost) === 11.83, mm)
const mc = (await M('GET', '/api/measurements/credits/info')).json
check('manager: sees the price per report', Number(mc?.pricePerReport) === 11.83, mc)
const mj = (await M('GET', `/api/jobs/${j.id}`)).json
check('manager: sees it on the job too', Number(mj?.measurementReport?.cost) === 11.83, mj?.measurementReport)
const mrr = (await M('GET', `/api/roof-reports/${rr.id}`)).json
check('manager: sees what the roof report was charged', Number(mrr?.amountCharged) === 9.99, mrr && Object.keys(mrr))

console.log(`\nt68 viewer roof: ${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
