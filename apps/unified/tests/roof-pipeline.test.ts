// A roofing company names its own pipeline stages and keeps separate Retail and Insurance boards (server/crm/roof/pipeline.ts;
// docs/parity/roof-pipeline.md; roofing depth, gap 8), through the real server as the roofing vertical:
//   · Pipeline Stages & Boards is a NOT READY feature offered to roofing and to nobody's plan; off, the doors are shut and the
//     page carries no names, so a business reads exactly what it read before;
//   · on, with nothing renamed, every name is today's; a rename changes the DISPLAY NAME only — every job keeps its stage key, and
//     no migration or save rewrites a stored status;
//   · THE RULES THAT ARE KEYED ON A STAGE STILL WORK with Invoiced and Collected renamed: Advance still texts the homeowner
//     "your invoice is ready"; a paid job still goes from `invoiced` to `collected`, texts "payment received" and makes the
//     review request; the measurement stage is still off the pipeline while Measurement Reports is off;
//   · the timeline says the company's names (an Insurance job in the Insurance board's words), the page carries them to the
//     screens, and a name is checked (a real stage, a sensible length, not another stage's name, not HTML);
//   · only whoever may change the company changes the names; a seat without that is refused by the server.
// Nothing here reaches a carrier, a phone company, Stripe or a real tenant.
import { describe, test, expect, beforeAll } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { FEATURE_REGISTRY, getAdvertisableFeaturesForTemplate, getFeaturesForPlan } from '@twomiah/tenant-backend'
import { PIPELINE_STATUSES } from '../server/crm/roof/validation.ts'
import { STAGE_LABELS } from '../server/crm/roof/jobRecord.ts'

type T = Awaited<ReturnType<typeof bootTenant>>
let t: T
let companyId = ''
const tokens: Record<string, string> = {}
const ids: Record<string, string> = {}
const PASS = 'Seat-pass-1'
const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'roof-pipeline-'))
fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><html><head><title>Admin</title></head><body><div id="root"></div></body></html>')
/** The texts the homeowner would be sent, and the review requests made (neither is ever delivered from a test). */
const texts: Array<{ message: string; jobId?: string }> = []
const reviews: string[] = []

const login = async (email: string, password: string) =>
  (await (await t.call('/api/auth/login', { method: 'POST', json: { email, password } })).json()).accessToken as string
const as = (who: string) => (p: string, init: any = {}) => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${tokens[who]}` } })
const json = async (r: Response) => ({ status: r.status, body: await r.json() as any })
const get = async (who: string, p: string) => json(await as(who)(p))
const post = async (who: string, p: string, body?: unknown) => json(await as(who)(p, { method: 'POST', ...(body === undefined ? {} : { json: body }) }))
const put = async (who: string, p: string, body: unknown) => json(await as(who)(p, { method: 'PUT', json: body }))
const features = async (list: string[]) => {
  await t.db.update(t.schema.company).set({ enabledFeatures: list } as any).where(eq(t.schema.company.id, companyId))
  t.services.features.forgetFeatures()
}
const BASE = ['jobs', 'contacts', 'invoices', 'two_way_texting', 'google_reviews', 'insurance_workflow']
const ON = [...BASE, 'pipeline_boards']
const PIPE = '/api/roof-pipeline'
/** What the page hands the screens (the JSON element the server writes into the admin page). */
const pageData = async () => {
  const html = await (await t.call('/crm')).text()
  const raw = /<script type="application\/json" id="vertical-screens">([\s\S]*?)<\/script>/.exec(html)?.[1] ?? '{}'
  return JSON.parse(raw.replace(/\\u003c/g, '<'))
}
const statusOf = async (id: string) => (await t.db.select().from(t.schema.job).where(eq(t.schema.job.id, id)))[0].status as string
const allStatuses = async () => Object.fromEntries((await t.db.select().from(t.schema.job)).map((j: any) => [j.id, j.status])) as Record<string, string>

async function jobAt(status: string, address: string, jobType = 'retail') {
  const made = await post('owner', '/api/jobs', {
    contactId: ids.home, jobType, propertyAddress: address, city: 'Akron', state: 'OH', zip: '44301', estimatedRevenue: 12000, totalSquares: 30,
  })
  expect([address, made.status]).toEqual([address, 201])
  await t.db.update(t.schema.job).set({ status } as any).where(eq(t.schema.job.id, made.body.id))
  return made.body.id as string
}
const timelineOf = async (jobId: string) => ((await get('owner', `/api/jobs/${jobId}/timeline`)).body.data as any[]).map((e) => String(e.body))

beforeAll(async () => {
  t = await bootTenant({ vertical: 'roofing', adminDist: dist })
  const seeded = await seedOwner(t)
  companyId = seeded.company.id
  tokens.owner = await login('owner@test.example', seeded.password)
  await features(ON)
  const hash = await Bun.password.hash(PASS, 'bcrypt')
  const seat = async (key: string, role: string) => {
    const [u] = await t.db.insert(t.schema.user).values({ email: `${key}@test.example`, passwordHash: hash, firstName: key, lastName: 'Seat', role, companyId } as any).returning()
    ids[key] = u.id
    tokens[key] = await login(`${key}@test.example`, PASS)
  }
  await seat('manager', 'manager')
  await seat('crew', 'field')
  await seat('book', 'viewer')
  ;(t.services as any).crm.sms.sendSMS = async (_cid: string, args: any) => { texts.push({ message: args.message, jobId: args.jobId }); return { success: true } }
  ;(t.services as any).crm.reviews.scheduleReviewRequest = async (jobId: string) => { reviews.push(jobId) }
  const [home] = await t.db.insert(t.schema.contact).values({ companyId, name: 'Lee Marsh', email: 'lee@home.example', mobile: '715-555-0101', type: 'client' } as any).returning()
  ids.home = home.id

  const [other] = await t.db.insert(t.schema.company).values({ name: 'Rival Roofing', slug: 'rival-roofing', enabledFeatures: ['jobs', 'pipeline_boards'] } as any).returning()
  const [u] = await t.db.insert(t.schema.user).values({ email: 'rival@test.example', passwordHash: hash, firstName: 'Rae', lastName: 'Rival', role: 'owner', companyId: other.id } as any).returning()
  ids.rival = u.id
  tokens.rival = await login('rival@test.example', PASS)
}, 120_000)

describe('the feature is not ready', () => {
  test('Pipeline Stages & Boards is offered to roofing, hidden, and on no plan', () => {
    const def: any = FEATURE_REGISTRY.find((f: any) => f.id === 'pipeline_boards')
    expect([def?.hidden, def?.templates]).toEqual([true, ['crm-roof']])
    expect(getAdvertisableFeaturesForTemplate('crm-roof').map((f: any) => f.id)).not.toContain('pipeline_boards')
    for (const plan of ['website', 'starter10', 'team25', 'business50']) expect(getFeaturesForPlan('crm-roof', plan)).not.toContain('pipeline_boards')
  })

  test('switched off: the door is shut, the page carries no names, and the timeline speaks today’s names', async () => {
    await features(BASE)
    expect([403, 404]).toContain((await get('owner', PIPE)).status)
    expect([403, 404]).toContain((await put('owner', PIPE, { stageLabels: { invoiced: 'Billed' } })).status)
    expect((await pageData()).pipeline ?? null).toBeNull()
    // Even a name left in the table from when it was on is not read while it is off.
    await t.db.insert(t.schema.roofPipelineConfig).values({ companyId, config: { stageLabels: { invoiced: 'Billed' } } } as any)
    const jobId = await jobAt('final_inspection', '1 Off Rd')
    expect((await post('owner', `/api/jobs/${jobId}/advance`)).status).toBe(200)
    expect(await timelineOf(jobId)).toContain('Stage moved from Final Inspection to Invoiced')
    await t.db.delete(t.schema.roofPipelineConfig).where(eq(t.schema.roofPipelineConfig.companyId, companyId))
    await features(ON)
  })
})

describe('nothing renamed is today', () => {
  test('every stage and both boards carry today’s names, in the pipeline’s order', async () => {
    const r = await get('owner', PIPE)
    expect(r.status).toBe(200)
    expect(r.body.stages.map((s: any) => s.key)).toEqual([...PIPELINE_STATUSES])
    for (const s of PIPELINE_STATUSES) {
      expect([s, r.body.stageLabels[s]]).toEqual([s, STAGE_LABELS[s]])
      for (const b of r.body.boards) expect([b.id, s, b.stageLabels[s]]).toEqual([b.id, s, STAGE_LABELS[s]])
    }
    expect(r.body.boards.map((b: any) => [b.id, b.name])).toEqual([['retail', 'Retail'], ['insurance', 'Insurance']])
    expect(r.body.overrides).toEqual({})
    // The page hands the screens the same, so they can draw a name with no further request.
    expect((await pageData()).pipeline.stageLabels.invoiced).toBe('Invoiced')
  })
})

describe('renaming Invoiced and Collected breaks nothing that is keyed on a stage', () => {
  test('the rename is saved, shown, and rewrites no job’s stage', async () => {
    const before = await jobAt('invoiced', '2 Existing Rd')
    const snapshot = await allStatuses()
    const r = await put('owner', PIPE, { stageLabels: { invoiced: 'Billed', collected: 'Paid in full' } })
    expect([r.status, r.body.stageLabels.invoiced, r.body.stageLabels.collected, r.body.overrides]).toEqual([200, 'Billed', 'Paid in full', { invoiced: 'Billed', collected: 'Paid in full' }])
    expect(await allStatuses()).toEqual(snapshot)
    expect(await statusOf(before)).toBe('invoiced')
    expect((await get('owner', PIPE)).body.stageLabels.invoiced).toBe('Billed')
    expect((await pageData()).pipeline.stageLabels).toMatchObject({ invoiced: 'Billed', collected: 'Paid in full', inspected: 'Inspected' })
    // …and the stored status is still what a filter by stage finds, under its key.
    const found = await get('owner', '/api/jobs?status=invoiced')
    expect((found.body.data as any[]).some((j) => j.id === before)).toBe(true)
  })

  test('Advance into the renamed Invoiced still texts "your invoice is ready"; the timeline says the new name', async () => {
    const jobId = await jobAt('final_inspection', '3 Advance Rd')
    texts.length = 0
    expect((await post('owner', `/api/jobs/${jobId}/advance`)).body.status).toBe('invoiced')
    expect(texts.some((m) => m.jobId === jobId && /^Hi Lee, your invoice is ready/.test(m.message))).toBe(true)
    expect(await timelineOf(jobId)).toContain('Stage moved from Final Inspection to Billed')
    // The note on the job is still the stage KEYS, which is what the timeline reads.
    const notes = (await t.db.select().from(t.schema.jobNote).where(eq(t.schema.jobNote.jobId, jobId))).map((n: any) => n.body)
    expect(notes).toContain('Status changed: final_inspection → invoiced')
  })

  test('a paid job still goes Invoiced → Collected, texts "payment received" and makes the review request', async () => {
    const jobId = await jobAt('invoiced', '4 Paid Rd')
    const inv = await post('owner', '/api/invoices', { contactId: ids.home, jobId, lineItems: [{ description: 'Roof replacement', quantity: 1, unitPrice: 6000 }] })
    expect(inv.status).toBe(201)
    expect((await post('owner', `/api/invoices/${inv.body.id}/send`)).status).toBe(200)
    texts.length = 0
    reviews.length = 0
    expect((await post('owner', `/api/invoices/${inv.body.id}/payments`, { amount: 6000, method: 'check' })).status).toBe(201)
    for (let i = 0; i < 40 && (await statusOf(jobId)) !== 'collected'; i++) await new Promise((r) => setTimeout(r, 50))
    expect(await statusOf(jobId)).toBe('collected')
    expect(texts.some((m) => m.jobId === jobId && /^Hi Lee, payment received/.test(m.message))).toBe(true)
    expect(reviews).toEqual([jobId])
    const line = await timelineOf(jobId)
    expect(line).toContain('Stage moved from Billed to Paid in full')
  })

  test('Advance into the renamed Collected asks for the review as well', async () => {
    const jobId = await jobAt('invoiced', '5 Hand Rd')
    reviews.length = 0
    expect((await post('owner', `/api/jobs/${jobId}/advance`)).body.status).toBe('collected')
    expect(reviews).toEqual([jobId])
  })

  test('the measurement stage stays off the pipeline while Measurement Reports is off — renamed or not', async () => {
    expect((await put('owner', PIPE, { stageLabels: { measurement_ordered: 'Satellite Measure' } })).status).toBe(200)
    const jobId = await jobAt('inspected', '6 Measure Rd')
    expect((await post('owner', `/api/jobs/${jobId}/advance`)).body.status).toBe('proposal_sent')
    const refused = await put('owner', `/api/jobs/${jobId}`, { status: 'measurement_ordered' })
    expect([refused.status, refused.body.code]).toEqual([400, 'stage_off'])
    // With Measurement Reports on the stage is walked again, under its new name.
    await features([...ON, 'measurement_reports'])
    const second = await jobAt('inspected', '7 Measure Ln')
    expect((await post('owner', `/api/jobs/${second}/advance`)).body.status).toBe('measurement_ordered')
    expect(await timelineOf(second)).toContain('Stage moved from Inspected to Satellite Measure')
    await features(ON)
    expect((await put('owner', PIPE, { stageLabels: { measurement_ordered: '' } })).status).toBe(200)
  })
})

describe('separate Retail and Insurance boards', () => {
  test('a board can rename the board and its stages; an insurance job reads its board’s words, a retail job the company’s', async () => {
    const r = await put('owner', PIPE, { boards: { insurance: { name: 'Claims', stageLabels: { signed: 'Claim approved', proposal_sent: 'Estimate to adjuster' } } } })
    expect(r.status).toBe(200)
    const ins = r.body.boards.find((b: any) => b.id === 'insurance')
    const retail = r.body.boards.find((b: any) => b.id === 'retail')
    expect([ins.name, ins.stageLabels.signed, ins.stageLabels.invoiced, retail.name, retail.stageLabels.signed]).toEqual(['Claims', 'Claim approved', 'Billed', 'Retail', 'Signed'])
    expect(r.body.stageLabels.signed).toBe('Signed')

    const insured = await jobAt('proposal_sent', '8 Claim Rd', 'insurance')
    const cash = await jobAt('proposal_sent', '9 Cash Rd', 'commercial')
    expect((await post('owner', `/api/jobs/${insured}/advance`)).body.status).toBe('signed')
    expect((await post('owner', `/api/jobs/${cash}/advance`)).body.status).toBe('signed')
    expect(await timelineOf(insured)).toContain('Stage moved from Estimate to adjuster to Claim approved')
    expect(await timelineOf(cash)).toContain('Stage moved from Proposal Sent to Signed')
    // The page carries both boards' words for the screens.
    const page = (await pageData()).pipeline
    expect(page.boards.find((b: any) => b.id === 'insurance').stageLabels.signed).toBe('Claim approved')
    // The stage texts are still chosen by key: the insurance job's "signed" text is the contract text.
    expect(texts.some((m) => m.jobId === insured && /your contract is signed/.test(m.message))).toBe(true)
  })

  test('clearing a name puts it back; a name equal to today’s is not kept', async () => {
    const cleared = await put('owner', PIPE, { boards: { insurance: { name: '', stageLabels: { signed: '', proposal_sent: null } } }, stageLabels: { invoiced: 'Invoiced' } })
    expect(cleared.status).toBe(200)
    const ins = cleared.body.boards.find((b: any) => b.id === 'insurance')
    expect([ins.name, ins.stageLabels.signed, ins.overrides]).toEqual(['Insurance', 'Signed', {}])
    expect(cleared.body.overrides).toEqual({ collected: 'Paid in full' })
  })
})

describe('a name is checked', () => {
  const refuses = async (body: unknown, code?: string) => {
    const before = JSON.stringify((await get('owner', PIPE)).body)
    const r = await put('owner', PIPE, body)
    expect([JSON.stringify(body), r.status]).toEqual([JSON.stringify(body), 400])
    if (code) expect(r.body.code).toBe(code)
    expect(typeof r.body.error).toBe('string')
    expect(JSON.stringify((await get('owner', PIPE)).body)).toBe(before)
  }

  test('only a real stage, a name of a sensible length, one stage’s own name, two different boards', async () => {
    await refuses({ stageLabels: { banana: 'Peeled' } })
    await refuses({ stageLabels: { lost: 'Gone' } })
    await refuses({ stageLabels: { signed: 'x'.repeat(41) } })
    await refuses({ stageLabels: { signed: 'Invoiced' } }, 'duplicate_stage_name')
    await refuses({ stageLabels: { signed: ' paid IN full ' } }, 'duplicate_stage_name')
    await refuses({ boards: { insurance: { stageLabels: { lead: 'Inspected' } } } }, 'duplicate_stage_name')
    await refuses({ boards: { insurance: { name: 'retail' } } }, 'duplicate_board_name')
    await refuses({ boards: { insurance: { name: 'y'.repeat(31) } } })
    await refuses({ boards: { commercial: { name: 'More' } } })
    await refuses({ somethingElse: true })
    await refuses({ stageLabels: { signed: 5 } })
    expect((await as('owner')(PIPE, { method: 'PUT', body: 'not json', headers: { 'content-type': 'application/json' } })).status).toBe(400)
  })

  test('markup in a name is taken out before it is kept', async () => {
    const r = await put('owner', PIPE, { stageLabels: { lead: '<b>New</b> Inquiry<script>x()</script>' } })
    expect(r.status).toBe(200)
    expect(r.body.stageLabels.lead).not.toMatch(/[<>]/)
    expect(r.body.stageLabels.lead).toContain('New')
    expect((await put('owner', PIPE, { stageLabels: { lead: '' } })).body.stageLabels.lead).toBe('Lead')
  })
})

describe('who may', () => {
  test('anyone who reads jobs reads the names; only whoever may change the company changes them', async () => {
    for (const who of ['owner', 'manager', 'crew', 'book']) expect([who, (await get(who, PIPE)).status]).toEqual([who, 200])
    const before = JSON.stringify((await get('owner', PIPE)).body)
    for (const who of ['manager', 'crew', 'book']) {
      expect([who, (await put(who, PIPE, { stageLabels: { signed: 'Won' } })).status]).toEqual([who, 403])
    }
    expect(JSON.stringify((await get('owner', PIPE)).body)).toBe(before)
    expect((await t.call(PIPE)).status).toBe(401)
  })

  test('one company’s names are not another’s', async () => {
    const theirs = await get('rival', PIPE)
    expect(theirs.status).toBe(200)
    expect(theirs.body.overrides).toEqual({})
    expect((await put('rival', PIPE, { stageLabels: { signed: 'Won' } })).status).toBe(200)
    expect((await get('owner', PIPE)).body.stageLabels.signed).toBe('Signed')
    expect((await get('rival', PIPE)).body.stageLabels.signed).toBe('Won')
  })
})
