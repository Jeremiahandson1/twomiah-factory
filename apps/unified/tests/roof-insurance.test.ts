// Roofing's insurance claims (server/crm/roof/insurance/; docs/UNIFIED_ROOF_PLAN.md step 3b), through the real server as
// the roof vertical: a claim on an insurance job, its edits and status, supplements through submit / approve / deny and
// what each does to the claim's money (and nothing else's), the adjuster directory, the claim's trail, the Xactimate
// scope and its signed-in files, who may do each (permissions, never rank), the money rule (T63), and company scoping.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId = ''
const tokens: Record<string, string> = {}
const ids: Record<string, string> = {}
const PASS = 'Seat-pass-1'

const login = async (email: string, password: string) =>
  (await (await t.call('/api/auth/login', { method: 'POST', json: { email, password } })).json()).accessToken as string
const as = (who: string) => (p: string, init: any = {}) => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${tokens[who]}` } })
const json = async (r: Response) => ({ status: r.status, body: await r.json() as any })
const post = (who: string, p: string, body?: unknown) => as(who)(p, { method: 'POST', ...(body === undefined ? {} : { json: body }) })
const put = (who: string, p: string, body: unknown) => as(who)(p, { method: 'PUT', json: body })
const claimRow = async () => (await t.db.select().from(t.schema.insuranceClaim).where(eq(t.schema.insuranceClaim.id, ids.claim)))[0]
const supRow = async (id: string) => (await t.db.select().from(t.schema.supplement).where(eq(t.schema.supplement.id, id)))[0]
const trail = async () => ((await json(await as('owner')(`/api/insurance/claims/${ids.claim}/activity`))).body.data as any[]).map((a) => String(a.body))
const CLAIM_MONEY = ['deductible', 'rcv', 'acv', 'depreciationHeld', 'supplementAmount', 'finalApprovedAmount']

// The CRM's private store, in memory: the test app has no R2 (the store answers "not set up" until this is switched on).
const objects = new Map<string, { body: Buffer; contentType: string }>()
let storeOn = false

beforeAll(async () => {
  t = await bootTenant({ vertical: 'roofing' })
  const seeded = await seedOwner(t)
  companyId = seeded.company.id
  tokens.owner = await login('owner@test.example', seeded.password)
  await t.db.update(t.schema.company).set({ enabledFeatures: ['insurance_workflow', 'jobs', 'contacts'], state: 'OH' } as any).where(eq(t.schema.company.id, companyId))
  const hash = await Bun.password.hash(PASS, 'bcrypt')
  const seat = async (key: string, role: string, cid: string, extraPermissions: string[] = []) => {
    const [u] = await t.db.insert(t.schema.user).values({ email: `${key}@test.example`, passwordHash: hash, firstName: key, lastName: 'Seat', role, companyId: cid, extraPermissions } as any).returning()
    ids[key] = u.id
    tokens[key] = await login(`${key}@test.example`, PASS)
  }
  await seat('mgr', 'manager', companyId)
  await seat('crew', 'field', companyId)
  await seat('book', 'viewer', companyId)
  // A crew member the owner has trusted with recording the carrier's decision — by name, not by rank.
  await seat('lead', 'field', companyId, ['insurance:approve'])
  // A crew member who may write claims but not see the books (a per-person grant).
  await seat('clerk', 'field', companyId, ['insurance:create'])

  const [home] = await t.db.insert(t.schema.contact).values({ companyId, name: 'Dana Okafor' } as any).returning()
  const mkJob = async (number: string, address: string, extra: Record<string, unknown> = {}) => (await t.db.insert(t.schema.job).values({
    companyId, contactId: home.id, number, title: address, address, city: 'Columbus', state: 'OH', zip: '43215', jobType: 'insurance',
    status: 'lead', rcv: '18000', acv: '14000', deductible: '1000', estimatedValue: '17500', ...extra,
  } as any).returning())[0].id
  ids.job = await mkJob('ROOF-0001', '144 Shingle Ln', { totalSquares: '30' })
  ids.bare = await mkJob('ROOF-0002', '12 Nothing Measured Rd')
  ids.retail = await mkJob('ROOF-0003', '12 Cash Rd', { jobType: 'retail' })

  const [other] = await t.db.insert(t.schema.company).values({ name: 'Rival Roofing', slug: 'rival-roofing', enabledFeatures: ['insurance_workflow'] } as any).returning()
  ids.otherCo = other.id
  await seat('rival', 'owner', other.id)
  const [theirHome] = await t.db.insert(t.schema.contact).values({ companyId: other.id, name: 'Sam Elsewhere' } as any).returning()
  ids.theirJob = (await t.db.insert(t.schema.job).values({ companyId: other.id, contactId: theirHome.id, number: 'ROOF-0001', title: '1 Far Rd', address: '1 Far Rd', jobType: 'insurance' } as any).returning())[0].id

  const storage = (t.services as any).crm.storage
  storage.storageConfigured = () => storeOn
  storage.put = async (key: string, body: Buffer, contentType: string) => { objects.set(key, { body, contentType }) }
  storage.getObject = async (key: string) => objects.get(key) ?? null
}, 120_000)

describe('roofing insurance', () => {
  test('a claim opens on the company\'s own insurance job, once; the job carries its number', async () => {
    const make = (who: string, extra: Record<string, unknown> = {}) => post(who, '/api/insurance/claims', {
      jobId: ids.job, claimNumber: 'CLM-88213', insuranceCompany: 'Buckeye Mutual', causeOfLoss: 'hail', deductible: '1000.00', dateOfLoss: '2026-05-01', ...extra,
    })
    // Permissions: the crew and the read-only seat hold no insurance:create.
    expect((await make('crew')).status).toBe(403)
    expect((await make('book')).status).toBe(403)
    expect((await make('owner', { jobId: ids.retail })).status).toBe(400)
    expect((await make('owner', { jobId: ids.theirJob })).status).toBe(404)
    // A date that isn't one, and a figure that isn't an amount, are the box's 400 — not a 500.
    expect((await make('owner', { dateOfLoss: 'yesterday-ish' })).status).toBe(400)
    const badMoney = await json(await make('owner', { deductible: 'lots' }))
    expect(badMoney.status).toBe(400)
    expect(badMoney.body.fields).toHaveProperty('deductible')
    expect((await make('owner', { deductible: '-5' })).status).toBe(400)
    const made = await json(await make('owner'))
    expect(made.status).toBe(201)
    expect(made.body).toMatchObject({ jobId: ids.job, claimNumber: 'CLM-88213', claimStatus: 'filed', deductible: '1000.00', supplementAmount: '0.00' })
    expect(new Date(made.body.dateOfLoss).toISOString()).toBe('2026-05-01T00:00:00.000Z')
    ids.claim = made.body.id
    expect((await make('owner', { claimNumber: 'CLM-SECOND' })).status).toBe(409)
    const [j] = await t.db.select().from(t.schema.job).where(eq(t.schema.job.id, ids.job))
    expect(j.claimNumber).toBe('CLM-88213')
    expect(await trail()).toEqual(['Insurance claim filed with Buckeye Mutual — Claim #CLM-88213'])
  })

  test('reading the claim: the crew keeps it without its figures (T63); the books seat sees them; another company 404s', async () => {
    const owner = await json(await as('owner')(`/api/insurance/claims/${ids.job}`))
    expect(owner.status).toBe(200)
    expect(CLAIM_MONEY.filter((k) => k in owner.body)).toEqual(CLAIM_MONEY)
    const crew = await json(await as('crew')(`/api/insurance/claims/${ids.job}`))
    expect(crew.status).toBe(200)
    expect(crew.body).toMatchObject({ claimNumber: 'CLM-88213', insuranceCompany: 'Buckeye Mutual', moneyWithheld: true })
    expect(CLAIM_MONEY.filter((k) => k in crew.body)).toEqual([])
    const book = await json(await as('book')(`/api/insurance/claims/${ids.job}`))
    expect(book.body.deductible).toBe('1000.00')
    expect((await as('rival')(`/api/insurance/claims/${ids.job}`)).status).toBe(404)
    expect((await t.call(`/api/insurance/claims/${ids.job}`)).status).toBe(401)
  })

  test('editing the claim: figures and dates checked, the number required and mirrored, the cause from the list', async () => {
    expect((await put('crew', `/api/insurance/claims/${ids.claim}`, { rcv: '20000' })).status).toBe(403)
    expect((await put('rival', `/api/insurance/claims/${ids.claim}`, { rcv: '1' })).status).toBe(404)
    expect((await put('owner', `/api/insurance/claims/${ids.claim}`, { claimNumber: '' })).status).toBe(400)
    expect((await put('owner', `/api/insurance/claims/${ids.claim}`, { insuranceCompany: '  ' })).status).toBe(400)
    expect((await put('owner', `/api/insurance/claims/${ids.claim}`, { causeOfLoss: 'banana' })).status).toBe(400)
    expect((await put('owner', `/api/insurance/claims/${ids.claim}`, { rcv: 'twenty grand' })).status).toBe(400)
    expect((await put('owner', `/api/insurance/claims/${ids.claim}`, { adjusterInspectionDate: 'soon' })).status).toBe(400)
    const ok = await json(await put('owner', `/api/insurance/claims/${ids.claim}`, {
      rcv: '20000', acv: '15000', claimNumber: 'CLM-88214', policyNumber: '', adjusterInspectionDate: '2026-05-10T14:30:00Z', causeOfLoss: 'wind',
    }))
    expect(ok.status).toBe(200)
    expect(ok.body).toMatchObject({ rcv: '20000.00', acv: '15000.00', claimNumber: 'CLM-88214', policyNumber: null, causeOfLoss: 'wind' })
    expect(new Date(ok.body.adjusterInspectionDate).toISOString()).toBe('2026-05-10T14:30:00.000Z')
    const [j] = await t.db.select().from(t.schema.job).where(eq(t.schema.job.id, ids.job))
    expect(j.claimNumber).toBe('CLM-88214')
    // A seat that may edit but not see the books gets its reply without the figures too.
    const clerk = await json(await post('clerk', `/api/insurance/claims/${ids.claim}/status`, { status: 'adjuster_assigned' }))
    expect(clerk.status).toBe(200)
    expect(CLAIM_MONEY.filter((k) => k in clerk.body)).toEqual([])
  })

  test('the claim\'s status moves along, with a line in its trail; approval is dated', async () => {
    expect((await post('owner', `/api/insurance/claims/${ids.claim}/status`, { status: 'paid-in-full' })).status).toBe(400)
    expect((await post('crew', `/api/insurance/claims/${ids.claim}/status`, { status: 'approved' })).status).toBe(403)
    expect((await post('rival', `/api/insurance/claims/${ids.claim}/status`, { status: 'approved' })).status).toBe(404)
    const r = await json(await post('owner', `/api/insurance/claims/${ids.claim}/status`, { status: 'approved', note: 'letter received' }))
    expect(r.body.claimStatus).toBe('approved')
    expect(r.body.approvalDate).toBeTruthy()
    expect((await trail())[0]).toBe('Claim approved — letter received')
  })

  test('a supplement\'s money is its lines; it is numbered within its claim; only a draft is edited', async () => {
    const lied = await json(await post('owner', `/api/insurance/claims/${ids.claim}/supplements`, {
      reason: 'Ridge cap not in scope', totalAmount: '77777.00',
      lineItems: [{ code: 'RFG-RIDGE', description: 'Ridge cap', qty: 1, unit: 'EA', unitPrice: 200, total: 77777 }],
    }))
    expect(lied.status).toBe(201)
    expect(lied.body).toMatchObject({ supplementNumber: 'SUP-001', status: 'draft', totalAmount: '200.00' })
    expect(lied.body.lineItems[0].total).toBe(200)
    ids.supA = lied.body.id
    expect((await post('owner', `/api/insurance/claims/${ids.claim}/supplements`, { reason: 'credit', lineItems: [{ description: 'Credit', qty: 1, unit: 'EA', unitPrice: -600 }] })).status).toBe(400)
    expect((await post('crew', `/api/insurance/claims/${ids.claim}/supplements`, { reason: 'x', lineItems: [{ description: 'x', qty: 1, unit: 'EA', unitPrice: 1 }] })).status).toBe(403)
    expect((await post('rival', `/api/insurance/claims/${ids.claim}/supplements`, { reason: 'x', lineItems: [{ description: 'x', qty: 1, unit: 'EA', unitPrice: 1 }] })).status).toBe(404)
    const b = await json(await post('owner', `/api/insurance/claims/${ids.claim}/supplements`, {
      reason: 'Extra squares after tear-off',
      lineItems: [{ description: 'Shingles', qty: 12.5, unit: 'SQ', unitPrice: 88.33 }, { description: 'Underlayment', qty: 3, unit: 'RL', unitPrice: 42.10 }],
    }))
    expect(b.body).toMatchObject({ supplementNumber: 'SUP-002', totalAmount: '1230.43' })
    ids.supB = b.body.id
    // An edit recomputes from the lines and ignores the client's total.
    const edited = await json(await put('owner', `/api/insurance/supplements/${ids.supB}`, { totalAmount: '1.00', lineItems: [{ description: 'Shingles', qty: 10, unit: 'SQ', unitPrice: 100 }] }))
    expect(edited.body.totalAmount).toBe('1000.00')
    expect((await put('crew', `/api/insurance/supplements/${ids.supB}`, { reason: 'x' })).status).toBe(403)
    expect((await put('rival', `/api/insurance/supplements/${ids.supB}`, { reason: 'x' })).status).toBe(404)
  })

  test('submit, then the carrier\'s decision: a draft has none to record; approve and deny ask insurance:approve', async () => {
    const early = await json(await post('mgr', `/api/insurance/supplements/${ids.supA}/approve`, { approvedAmount: '200.00' }))
    expect(early.status).toBe(400)
    expect(early.body.code).toBe('supplement_wrong_status')
    expect(early.body.error).toMatch(/still a draft.*Submit it first/)
    expect((await post('mgr', `/api/insurance/supplements/${ids.supA}/deny`, { denialReason: 'nope' })).status).toBe(400)

    expect((await post('crew', `/api/insurance/supplements/${ids.supA}/submit`)).status).toBe(403)
    const sent = await json(await post('owner', `/api/insurance/supplements/${ids.supA}/submit`))
    expect(sent.body).toMatchObject({ status: 'submitted' })
    const twice = await json(await post('owner', `/api/insurance/supplements/${ids.supA}/submit`))
    expect(twice).toMatchObject({ status: 400, body: { code: 'supplement_wrong_status' } })
    expect(twice.body).not.toHaveProperty('allowedFrom')
    expect((await put('owner', `/api/insurance/supplements/${ids.supA}`, { reason: 'late edit' })).status).toBe(400)
    expect((await trail())[0]).toBe('Supplement SUP-001 submitted — $200.00 — Ridge cap not in scope')

    // Who records a decision: the crew and the read-only seat are refused; the manager, and a crew lead granted
    // insurance:approve by name, are not.
    for (const who of ['crew', 'book', 'clerk']) {
      expect((await post(who, `/api/insurance/supplements/${ids.supA}/approve`, { approvedAmount: '200.00' })).status).toBe(403)
      expect((await post(who, `/api/insurance/supplements/${ids.supA}/deny`, { denialReason: 'x' })).status).toBe(403)
    }
    expect((await post('rival', `/api/insurance/supplements/${ids.supA}/approve`, { approvedAmount: '99999.00' })).status).toBe(404)
    for (const bad of ['-600.00', 'lots', '']) expect((await post('mgr', `/api/insurance/supplements/${ids.supA}/approve`, { approvedAmount: bad })).status).toBe(400)
    expect(Number((await claimRow()).supplementAmount)).toBe(0)

    const first = await json(await post('lead', `/api/insurance/supplements/${ids.supA}/approve`, { approvedAmount: '1100.00' }))
    // The lead may record the decision but holds no invoices:read, so the reply comes back without its figures.
    expect(first.body).toMatchObject({ status: 'approved', moneyWithheld: true })
    expect(first.body).not.toHaveProperty('approvedAmount')
    expect((await supRow(ids.supA)).approvedAmount).toBe('1100.00')
    expect(Number((await claimRow()).supplementAmount)).toBe(1100)
    expect((await trail())[0]).toBe('Supplement SUP-001 approved — $1,100.00, which is ABOVE the $200.00 asked for')
  })

  test('the claim\'s supplement total is the approvals, counted once; a revision replaces; a denial withdraws — and nothing else moves', async () => {
    await post('owner', `/api/insurance/supplements/${ids.supB}/submit`)
    await post('mgr', `/api/insurance/supplements/${ids.supB}/approve`, { approvedAmount: '1000.00' })
    expect(Number((await claimRow()).supplementAmount)).toBe(2100)
    await post('mgr', `/api/insurance/supplements/${ids.supB}/approve`, { approvedAmount: '900.00' })
    expect(Number((await claimRow()).supplementAmount)).toBe(2000)
    expect((await trail())[0]).toBe('Supplement SUP-002 approved — $900.00 (replacing the $1,000.00 approved earlier)')

    const denied = await json(await post('mgr', `/api/insurance/supplements/${ids.supB}/deny`, { denialReason: 'Not covered' }))
    expect(denied.body).toMatchObject({ status: 'denied', approvedAmount: null, denialReason: 'Not covered' })
    expect(Number((await claimRow()).supplementAmount)).toBe(1100)
    expect((await trail())[0]).toBe('Supplement SUP-002 denied — Not covered (withdrawing the $900.00 approved earlier)')

    const again = await json(await post('mgr', `/api/insurance/supplements/${ids.supB}/approve`, { approvedAmount: '900.00' }))
    expect(again.body).toMatchObject({ status: 'approved', denialReason: null })
    expect((await trail())[0]).toBe('Supplement SUP-002 approved — $900.00 (reversing the earlier denial)')
    expect(Number((await claimRow()).supplementAmount)).toBe(2000)

    // A supplement's decision is the claim's money only: the job's figures, and the CRM's quotes and invoices, are untouched.
    const [j] = await t.db.select().from(t.schema.job).where(eq(t.schema.job.id, ids.job))
    expect({ rcv: j.rcv, acv: j.acv, deductible: j.deductible, estimatedValue: j.estimatedValue, finalRevenue: j.finalRevenue })
      .toEqual({ rcv: '18000.00', acv: '14000.00', deductible: '1000.00', estimatedValue: '17500.00', finalRevenue: null })
    expect(await t.db.select().from(t.schema.invoice)).toEqual([])
    expect(await t.db.select().from(t.schema.quote)).toEqual([])
  })

  test('supplements and the trail are lists; the crew reads them without the figures', async () => {
    const owner = await json(await as('owner')(`/api/insurance/claims/${ids.claim}/supplements`))
    expect(owner.body.pagination).toMatchObject({ page: 1, total: 2 })
    expect(owner.body.data.map((s: any) => s.supplementNumber)).toEqual(['SUP-001', 'SUP-002'])
    const crew = await json(await as('crew')(`/api/insurance/claims/${ids.claim}/supplements`))
    expect(crew.status).toBe(200)
    expect(crew.body.data[0]).toMatchObject({ supplementNumber: 'SUP-001', moneyWithheld: true, lineItems: [{ code: 'RFG-RIDGE', qty: 1 }] })
    expect(crew.body.data[0]).not.toHaveProperty('totalAmount')
    expect(crew.body.data[0].lineItems[0]).not.toHaveProperty('unitPrice')
    const act = await json(await as('crew')(`/api/insurance/claims/${ids.claim}/activity`))
    expect(act.body.pagination.total).toBeGreaterThan(5)
    expect(JSON.stringify(act.body.data)).not.toMatch(/\$\d/)
    expect(act.body.data.some((a: any) => a.body === 'Supplement SUP-001 submitted — (amount hidden) — Ridge cap not in scope')).toBe(true)
    // Another company's claim: nothing.
    expect((await json(await as('rival')(`/api/insurance/claims/${ids.claim}/supplements`))).body.data).toEqual([])
    expect((await json(await as('rival')(`/api/insurance/claims/${ids.claim}/activity`))).body.data).toEqual([])
  })

  test('a note on the trail: the office writes it, the crew can\'t, another company\'s claim is 404', async () => {
    expect((await post('crew', `/api/insurance/claims/${ids.claim}/activity`, { activityType: 'note', body: 'hi' })).status).toBe(403)
    expect((await post('owner', `/api/insurance/claims/${ids.claim}/activity`, { activityType: 'gossip', body: 'hi' })).status).toBe(400)
    expect((await post('rival', `/api/insurance/claims/${ids.claim}/activity`, { activityType: 'note', body: 'hi' })).status).toBe(404)
    const r = await json(await post('owner', `/api/insurance/claims/${ids.claim}/activity`, { activityType: 'call', body: 'Adjuster called back', metadata: { minutes: 4 } }))
    expect(r.status).toBe(201)
    expect(r.body).toMatchObject({ activityType: 'call', body: 'Adjuster called back', metadata: { minutes: 4 }, jobId: ids.job })
  })

  test('the adjuster directory: a real phone and email; an edit checked the same and kept to this company', async () => {
    expect((await post('owner', '/api/insurance/adjusters', { name: 'Pat Adjuster', insuranceCarrier: 'Buckeye Mutual', phone: 'abcdefghij' })).status).toBe(400)
    expect((await post('crew', '/api/insurance/adjusters', { name: 'Pat Adjuster', insuranceCarrier: 'Buckeye Mutual' })).status).toBe(403)
    const made = await json(await post('owner', '/api/insurance/adjusters', { name: 'Pat Adjuster', insuranceCarrier: 'Buckeye Mutual', phone: '(614) 555-0101', email: 'pat@buckeye.example' }))
    expect(made.status).toBe(201)
    ids.adj = made.body.id
    const listed = await json(await as('crew')('/api/insurance/adjusters'))
    expect(listed.body).toMatchObject({ data: [{ id: ids.adj, name: 'Pat Adjuster' }], pagination: { total: 1 } })
    expect((await json(await as('rival')('/api/insurance/adjusters'))).body.data).toEqual([])

    expect((await put('owner', `/api/insurance/adjusters/${ids.adj}`, { email: 'not-an-email' })).status).toBe(400)
    expect((await put('owner', `/api/insurance/adjusters/${ids.adj}`, { name: '' })).status).toBe(400)
    expect((await put('crew', `/api/insurance/adjusters/${ids.adj}`, { territory: 'North' })).status).toBe(403)
    expect((await put('rival', `/api/insurance/adjusters/${ids.adj}`, { territory: 'North' })).status).toBe(404)
    // The template spread the body into the row: companyId moved the adjuster to another company, and jobsWorkedTogether
    // was anyone's to set. Unknown keys are dropped now.
    const edited = await json(await put('owner', `/api/insurance/adjusters/${ids.adj}`, { territory: 'North', phone: '', companyId: ids.otherCo, jobsWorkedTogether: 99 }))
    expect(edited.status).toBe(200)
    expect(edited.body).toMatchObject({ territory: 'North', phone: null, email: 'pat@buckeye.example', companyId, jobsWorkedTogether: 0 })
  })

  test('the Xactimate scope: refused with no measurement or no store; built on the ask and the approved basis', async () => {
    const [bareClaim] = await t.db.insert(t.schema.insuranceClaim).values({ companyId, jobId: ids.bare, claimNumber: 'CLM-NM', insuranceCompany: 'Buckeye Mutual' } as any).returning()
    const none = await json(await post('owner', `/api/insurance/claims/${bareClaim.id}/xactimate-export`))
    expect(none).toMatchObject({ status: 400, body: { code: 'no_measurement' } })
    expect(none.body.error).toMatch(/squares/)
    expect((await post('crew', `/api/insurance/claims/${ids.claim}/xactimate-export`)).status).toBe(403)
    expect((await post('rival', `/api/insurance/claims/${ids.claim}/xactimate-export`)).status).toBe(404)
    expect((await json(await post('owner', `/api/insurance/claims/${ids.claim}/xactimate-export`))).body.code).toBe('storage_not_configured')

    storeOn = true
    // A draft on the claim: in neither document.
    await post('owner', `/api/insurance/claims/${ids.claim}/supplements`, { reason: 'Still writing it', lineItems: [{ description: 'Draft line', qty: 1, unit: 'EA', unitPrice: 450 }] })
    const ask = await json(await post('owner', `/api/insurance/claims/${ids.claim}/xactimate-export`))
    expect(ask.status).toBe(200)
    expect(ask.body).toMatchObject({ basis: 'ask', supplementsIncluded: 2, pdfUrl: `/api/insurance/claims/${ids.claim}/files/xactimate-scope.pdf`, csvUrl: `/api/insurance/claims/${ids.claim}/files/xactimate-export.csv` })
    expect(ask.body.lineItems).toHaveLength(7)
    // 30 squares in Ohio (midwest): tear-off 30 × $85.
    expect(ask.body.lineItems[0]).toMatchObject({ code: 'RFG 220', qty: 30, unitPrice: 85, total: 2550 })
    // The ask carries what was asked: SUP-001's $200 and SUP-002's $1,000 lines, not the draft.
    expect(ask.body.supplementItems.map((i: any) => i.total)).toEqual([200, 1000])
    expect(ask.body.totals.deductible).toBe(1000)
    expect(objects.has(`insurance/${companyId}/${ids.claim}/xactimate-scope.pdf`)).toBe(true)
    expect(String(objects.get(`insurance/${companyId}/${ids.claim}/xactimate-export.csv`)?.body)).toMatch(/^Code,Description,Qty,Unit,Unit Price,Total\nRFG 220,/)
    expect((await claimRow()).xactimateScopeUrl).toBe(ask.body.pdfUrl)
    expect((await trail())[0]).toBe('Xactimate scope generated — as requested (the ask sent to the carrier)')

    const approved = await json(await post('owner', `/api/insurance/claims/${ids.claim}/xactimate-export?basis=approved`))
    expect(approved.body).toMatchObject({ basis: 'approved', supplementsIncluded: 2, pdfUrl: `/api/insurance/claims/${ids.claim}/files/xactimate-scope-approved.pdf` })
    // Approved at 1,100 against 200 asked, and 900 against 1,000: one adjustment line each.
    expect(approved.body.supplementItems.filter((i: any) => i.code === 'ADJ').map((i: any) => i.total)).toEqual([900, -100])
    expect(approved.body.supplementItems.reduce((s: number, i: any) => s + i.total, 0)).toBe(2000)
    expect(objects.has(`insurance/${companyId}/${ids.claim}/xactimate-scope.pdf`)).toBe(true) // the ask is kept
    expect((await trail())[0]).toBe('Xactimate scope generated — APPROVED basis (2 approved supplements)')

    // A seat that may build the scope but not see the books gets codes and quantities, no prices or totals.
    const clerk = await json(await post('clerk', `/api/insurance/claims/${ids.claim}/xactimate-export`))
    expect(clerk.status).toBe(200)
    expect(clerk.body.moneyWithheld).toBe(true)
    expect(clerk.body.lineItems[0]).toEqual({ code: 'RFG 220', description: 'Remove asphalt shingles - comp.', qty: 30, unit: 'SQ' })
    expect(clerk.body).not.toHaveProperty('totals')
    expect(clerk.body.lineItems[0]).not.toHaveProperty('unitPrice')
  })

  test('the scope\'s files: signed in, the books\' permission, the claim\'s own company', async () => {
    const pdf = `/api/insurance/claims/${ids.claim}/files/xactimate-scope.pdf`
    expect((await t.call(pdf)).status).toBe(401)
    expect((await as('crew')(pdf)).status).toBe(403)
    expect((await as('rival')(pdf)).status).toBe(404)
    expect((await as('owner')(`/api/insurance/claims/${ids.claim}/files/..%2F..%2Fsecret.pdf`)).status).toBe(404)
    const mine = await as('book')(pdf)
    expect(mine.status).toBe(200)
    expect(mine.headers.get('content-type')).toBe('application/pdf')
    expect(mine.headers.get('cache-control')).toContain('no-store')
    expect(Buffer.from(await mine.arrayBuffer()).subarray(0, 5).toString()).toBe('%PDF-')
    const csv = await as('owner')(`/api/insurance/claims/${ids.claim}/files/xactimate-export.csv`)
    expect(csv.headers.get('content-disposition')).toContain('attachment')
    // The links themselves: the priced scope is the books' (T63).
    expect((await as('crew')(`/api/insurance/claims/${ids.claim}/xactimate-export`)).status).toBe(403)
    const links = await json(await as('book')(`/api/insurance/claims/${ids.claim}/xactimate-export`))
    // The clerk built the ask last, so the claim links the ask.
    expect(links.body).toEqual({ pdfUrl: pdf, csvUrl: `/api/insurance/claims/${ids.claim}/files/xactimate-export.csv` })
  })

  test('the module is behind insurance_workflow', async () => {
    await t.db.update(t.schema.company).set({ enabledFeatures: ['jobs', 'contacts'] } as any).where(eq(t.schema.company.id, companyId))
    await (t.services as any).features.forgetFeatures?.(companyId)
    expect((await as('owner')('/api/insurance/adjusters')).status).not.toBe(200)
    await t.db.update(t.schema.company).set({ enabledFeatures: ['insurance_workflow', 'jobs', 'contacts'] } as any).where(eq(t.schema.company.id, companyId))
    await (t.services as any).features.forgetFeatures?.(companyId)
  })
})
