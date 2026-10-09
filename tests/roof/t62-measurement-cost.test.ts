// T62 Medium — "Roofing measurement reports show the cost per report" to staff.
//
// What a report cost and the company's price per report are money (invoices:read). Off every /api/measurements
// read for a crew member — list, by job, by id, credits — and off the report the job detail carries. The squares,
// area and status stay: that is the crew's information. Through the real routers.
import { Hono } from 'hono'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) }
}

const { setupSchema } = await import('./setup.ts')
await setupSchema()
const { db } = await import('./db/index.ts')
const { company, user, contact, job, measurementReport } = await import('./db/schema.ts')
const { eq } = await import('drizzle-orm')

// 13.47 per report — a figure nothing else in the payloads can produce
const [co] = await db.insert(company).values({ name: 'Ridgeline Roofing', slug: 'ridge-t62', email: 'ridge-t62@test.local', settings: {}, enabledFeatures: [], reportCredits: 5, reportPricePerReport: '13.47' } as any).returning()
const mk = async (role: string, tag: string) => (await db.insert(user).values({ email: `${tag}@ridge-t62.local`, passwordHash: 'x', firstName: tag, lastName: 'U', role, companyId: co.id, isActive: true } as any).returning())[0]
const owner = await mk('owner', 'owner'), manager = await mk('manager', 'manager'), crew = await mk('field', 'crew')
const [home] = await db.insert(contact).values({ companyId: co.id, firstName: 'Ada', lastName: 'Quill', email: 'ada-t62@test.local' } as any).returning()
const [rep] = await db.insert(measurementReport).values({ companyId: co.id, address: '9 Slate Rd', city: 'Akron', state: 'OH', zip: '44301', provider: 'google_solar', status: 'complete', cost: '13.47', totalSquares: '31.5', totalArea: '3150' } as any).returning()
const [j] = await db.insert(job).values({ companyId: co.id, contactId: home.id, jobNumber: 'RF-T62-1', jobType: 'retail', source: 'manual', propertyAddress: '9 Slate Rd', city: 'Akron', state: 'OH', zip: '44301', measurementReportId: rep.id } as any).returning()
await db.update(measurementReport).set({ jobId: j.id } as any).where(eq(measurementReport.id, rep.id))

const app = new Hono()
app.route('/api/measurements', (await import('./src/routes/measurements.ts')).default)
app.route('/api/jobs', (await import('./src/routes/jobs.ts')).default)
app.onError((await import('./src/utils/errors.ts')).errorHandler)
const get = async (who: any, path: string) => {
  const res = await app.request(path, { headers: { 'x-test-user': who.id } })
  const t = await res.text(); let js: any = t; try { js = JSON.parse(t) } catch {}
  return { status: res.status, json: js, text: t }
}

const reads: [string, string][] = [['the list', '/api/measurements'], ['by job', `/api/measurements/job/${j.id}`], ['by id', `/api/measurements/${rep.id}`], ['credits', '/api/measurements/credits/info']]
for (const [label, path] of reads) {
  const r = await get(crew, path)
  check(`the crew reads ${label} (200)`, r.status === 200, { status: r.status, body: r.text.slice(0, 160) })
  check(`…and 13.47 is nowhere in it`, !/13\.47/.test(r.text), r.text.slice(0, 200))
}
const one = await get(crew, `/api/measurements/${rep.id}`)
check('…the report keeps its squares and area', Number(one.json?.totalSquares) === 31.5 && Number(one.json?.totalArea) === 3150 && !('cost' in (one.json || {})), one.json)
const cr = await get(crew, '/api/measurements/credits/info')
check('…credits still read, without the price', cr.json?.credits === 5 && !('pricePerReport' in (cr.json || {})), cr.json)
const jd = await get(crew, `/api/jobs/${j.id}`)
check('the job detail carries the report without its cost', jd.status === 200 && Number(jd.json?.measurementReport?.totalSquares) === 31.5 && !('cost' in (jd.json?.measurementReport || {})), { status: jd.status, m: jd.json?.measurementReport })

for (const [who, label] of [[owner, 'the owner'], [manager, 'a manager']] as const) {
  const r = await get(who, `/api/measurements/${rep.id}`)
  check(`${label} sees what the report cost`, Number(r.json?.cost) === 13.47, r.json)
  const c2 = await get(who, '/api/measurements/credits/info')
  check(`${label} sees the price per report`, Number(c2.json?.pricePerReport) === 13.47, c2.json)
  const jd2 = await get(who, `/api/jobs/${j.id}`)
  check(`${label} sees it on the job too`, Number(jd2.json?.measurementReport?.cost) === 13.47, jd2.json?.measurementReport)
}

console.log(`\nt62 measurement cost: ${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
