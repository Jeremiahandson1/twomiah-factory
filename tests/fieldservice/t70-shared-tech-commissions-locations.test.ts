// Field service on the shared commissions / locations / tech modules. What changed for THIS vertical:
//   · a technician's checklist could never be saved (form_submission.template_id is NOT NULL and none was sent);
//   · finishing a call from the phone skipped the job hooks — no review request, no next agreement visit;
//   · /api/tech had no feature gate and no permission; on my way could reopen a finished call;
//   · the checklist was 'hvac_inspection_checklist' for every trade — old rows must still read back.
import { Hono } from 'hono'
import { eq, and } from 'drizzle-orm'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 400)) }
}

const { setupSchema } = await import('./setup.ts')
await setupSchema()
const { db } = await import('./db/index.ts')
const S: any = await import('./db/schema.ts')
const FEATURES = ['contacts', 'jobs', 'invoices', 'team', 'commission_tracking', 'multi_location', 'tech_mobile_view', 'google_reviews']
const [co] = await db.insert(S.company).values({ name: 'May & Moss', slug: 'may-moss', email: 'o@mm.test', settings: { reviewRequestEnabled: true, googleReviewUrl: 'https://g.page/r/mm' }, enabledFeatures: FEATURES } as any).returning()
const mk = async (role: string, tag: string) => (await db.insert(S.user).values({ email: `${tag}@mm.test`, passwordHash: 'x', firstName: tag, lastName: 'T', role, companyId: co.id, isActive: true } as any).returning())[0]
const owner = await mk('owner', 'owner'), tech = await mk('field', 'tech'), viewer = await mk('viewer', 'viewer')
const [cust] = await db.insert(S.contact).values({ name: 'Pat Doe', companyId: co.id, phone: '+15555550111' } as any).returning()

const { requireEnabledFeature } = await import('./src/middleware/enabledFeature.ts')
const { authenticate } = await import('./src/middleware/auth.ts')
const app = new Hono()
for (const [p, f] of [['/api/locations', 'multi_location'], ['/api/commissions', 'commission_tracking'], ['/api/tech', 'tech_mobile_view']] as const) {
  app.use(p, authenticate, requireEnabledFeature(f)); app.use(`${p}/*`, authenticate, requireEnabledFeature(f))
}
app.route('/api/commissions', (await import('./src/routes/commissions.ts')).default)
app.route('/api/locations', (await import('./src/routes/locations.ts')).default)
app.route('/api/tech', (await import('./src/routes/tech.ts')).default)
const as = (who: any) => async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, { method, headers: { 'content-type': 'application/json', 'x-test-user': who.id }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j }
}
const O = as(owner), T = as(tech), V = as(viewer)

const today = new Date(); today.setHours(10, 0, 0, 0)
const mkJob = async (n: string, who: string, status = 'scheduled') => (await db.insert(S.job).values({ number: n, title: `Clean ${n}`, status, jobType: 'maintenance', companyId: co.id, contactId: cust.id, assignedToId: who, scheduledDate: today } as any).returning())[0]
const j1 = await mkJob('JOB-00001', tech.id), jv = await mkJob('JOB-00002', viewer.id)

{
  const items = [{ id: 'work_done', label: 'Work completed as agreed', status: 'pass' }, { id: 'cleanup', label: 'Work area cleaned up', status: 'fail', notes: 'Ran out of time' }]
  const c = await T('POST', `/api/tech/${j1.id}/checklist`, { items })
  check(`checklist: a technician's checklist SAVES (${c.status}) — every one failed on template_id before`, c.status === 201 && !!c.json?.templateId, c.json)
  const [tpl] = await db.select().from(S.formTemplate).where(and(eq(S.formTemplate.companyId, co.id), eq(S.formTemplate.category, 'service_checklist')))
  check(`checklist: the template is this CRM's "Service checklist", not HVAC (${tpl?.name})`, tpl?.name === 'Service checklist')
  // a row saved under the old type is still read back
  await db.insert(S.formSubmission).values({ companyId: co.id, templateId: tpl.id, jobId: j1.id, submittedById: tech.id, values: { type: 'hvac_inspection_checklist', items: [] }, status: 'submitted' } as any)
  const got = await T('GET', `/api/tech/${j1.id}/checklist`)
  check(`checklist: old hvac_inspection_checklist rows still read back beside new ones (${got.json?.length})`, got.status === 200 && got.json.length === 2)
}
{
  const omw = await T('POST', `/api/tech/${j1.id}/on-my-way`)
  const site = await T('POST', `/api/tech/${j1.id}/on-site`)
  const done = await T('POST', `/api/tech/${j1.id}/complete-job`)
  check('tech: on my way → on site → done', omw.json?.status === 'dispatched' && site.json?.status === 'in_progress' && done.json?.status === 'completed')
  check("tech: the completion ran this CRM's onComplete hook (its reply carries nextServiceDate, as the Jobs page's does)", done.status === 200 && 'nextServiceDate' in done.json, done.json)
  let req: any[] = []
  for (let i = 0; i < 40 && !req.length; i++) { req = await db.select().from(S.reviewRequest).where(eq(S.reviewRequest.jobId, j1.id)); if (!req.length) await new Promise((r) => setTimeout(r, 50)) }
  check('tech: …and scheduled the review request', req.length === 1)
  const back = await T('POST', `/api/tech/${j1.id}/on-my-way`)
  check(`tech: a finished call cannot be reopened as "en route" (${back.status})`, back.status === 409)
  const vw = await V('POST', `/api/tech/${jv.id}/on-my-way`)
  check(`tech: a viewer cannot move a job (${vw.status})`, vw.status === 403)
}
{
  const plan = (await O('POST', '/api/commissions/plans', { name: 'Tech standard', planType: 'flat_rate', flatRateAmount: 25, appliesToRole: 'technician' })).json
  const r = await O('POST', '/api/commissions', { userId: tech.id, planId: plan.id, jobId: j1.id })
  check(`commissions: recorded from the plan, $25.00 (${r.json?.commissionAmount})`, r.status === 201 && Number(r.json?.commissionAmount) === 25, r.json)
  const l = await O('POST', '/api/locations', { name: 'Bluffton', code: 'blf' })
  const d = await O('POST', '/api/locations', { name: 'Bluffton 2', code: 'BLF' })
  check(`locations: BLF twice is a 409, not a 500 (${l.status}, ${d.status})`, l.status === 201 && d.status === 409)
}

console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
