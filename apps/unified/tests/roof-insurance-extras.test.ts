// Roofing's insurance follow-ups (server/crm/roof/insurance/extras.ts; docs/parity/roof-insurance-extras.md; roofing depth,
// gap 7), through the real server as the roofing vertical:
//   · Insurance Follow-ups is a NOT READY feature, offered to roofing and to nobody's plan; with it off nothing happens and
//     its doors are shut;
//   · held depreciation: when a job with a claim that holds depreciation is done (Final Inspection, or Invoiced / Collected
//     reached without it) ONE reminder is made — a line in the claim's trail, a note on the job and a phone notice to the
//     sales rep — by Advance, by the job form and by a payment that collects the job alike; a claim holding nothing makes none;
//   · the list of depreciation still to be got, the certificate of completion sent, and the carrier's release recorded;
//   · mortgage-company checks tracked received → sent to the mortgage company (with a tracking number) → endorsed → deposited;
//   · who may do each: a seat without the permission is refused by the server, and a seat without the books sees no amounts.
// Nothing here reaches a carrier, Expo or a real tenant.
import { describe, test, expect, beforeAll } from 'bun:test'
import { and, eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { FEATURE_REGISTRY, getAdvertisableFeaturesForTemplate, getFeaturesForPlan } from '@twomiah/tenant-backend'

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
const features = async (list: string[]) => {
  await t.db.update(t.schema.company).set({ enabledFeatures: list } as any).where(eq(t.schema.company.id, companyId))
  t.services.features.forgetFeatures()
}
const ON = ['insurance_workflow', 'insurance_extras', 'jobs', 'contacts', 'invoices']

/** An insurance job at `status` with a claim; `held` is the depreciation typed on the claim ('' for none). */
async function claimJob(status: string, address: string, held: string, extra: Record<string, unknown> = {}) {
  const [row] = await t.db.insert(t.schema.job).values({
    companyId, contactId: ids.home, number: `ROOF-${String(Math.floor(Math.random() * 90000) + 10000)}`, title: address, address, city: 'Columbus', state: 'OH', zip: '43215',
    jobType: 'insurance', status, assignedSalesRepId: ids.rep, ...extra,
  } as any).returning()
  const claim = await post('owner', '/api/insurance/claims', { jobId: row.id, claimNumber: `CLM-${row.number}`, insuranceCompany: 'Buckeye Mutual', deductible: '1000' })
  expect(claim.status).toBe(201)
  if (held) expect((await put('owner', `/api/insurance/claims/${claim.body.id}`, { rcv: '18000', acv: '14000', depreciationHeld: held })).status).toBe(200)
  return { jobId: row.id as string, claimId: claim.body.id as string }
}
const trail = async (claimId: string) => ((await get('owner', `/api/insurance/claims/${claimId}/activity`)).body.data as any[])
const reminders = async (claimId: string) => (await trail(claimId)).filter((a) => a.activityType === 'reminder')
const jobNotes = async (jobId: string) => (await t.db.select().from(t.schema.jobNote).where(eq(t.schema.jobNote.jobId, jobId))).map((n: any) => n.body as string)
const reminderNotes = async (jobId: string) => (await jobNotes(jobId)).filter((n) => /^Reminder: the roof is done/.test(n))
const claimRow = async (id: string) => (await t.db.select().from(t.schema.insuranceClaim).where(eq(t.schema.insuranceClaim.id, id)))[0]

beforeAll(async () => {
  t = await bootTenant({ vertical: 'roofing' })
  const seeded = await seedOwner(t)
  companyId = seeded.company.id
  tokens.owner = await login('owner@test.example', seeded.password)
  await features(ON)
  const hash = await Bun.password.hash(PASS, 'bcrypt')
  const seat = async (key: string, role: string, cid: string, extraPermissions: string[] = []) => {
    const [u] = await t.db.insert(t.schema.user).values({ email: `${key}@test.example`, passwordHash: hash, firstName: key, lastName: 'Seat', role, companyId: cid, extraPermissions } as any).returning()
    ids[key] = u.id
    tokens[key] = await login(`${key}@test.example`, PASS)
  }
  await seat('rep', 'manager', companyId)
  await seat('crew', 'field', companyId)
  await seat('book', 'viewer', companyId)
  // May file and read claims but never decide or edit them, and not see the books (a per-person grant).
  await seat('clerk', 'field', companyId, ['insurance:create', 'insurance:read'])
  // Trusted with the carrier's money by name, not by rank.
  await seat('lead', 'field', companyId, ['insurance:approve', 'insurance:read'])
  const [home] = await t.db.insert(t.schema.contact).values({ companyId, name: 'Dana Okafor', email: 'dana@home.example', mobile: '715-555-0101' } as any).returning()
  ids.home = home.id
  // The rep's phone: a notice is recorded when one is sent to it.
  expect((await post('rep', '/api/push/expo-token', { token: 'ExponentPushToken[rep-phone]', platform: 'ios' })).status).toBe(201)

  const [other] = await t.db.insert(t.schema.company).values({ name: 'Rival Roofing', slug: 'rival-roofing', enabledFeatures: ['insurance_workflow', 'insurance_extras'] } as any).returning()
  const [theirHome] = await t.db.insert(t.schema.contact).values({ companyId: other.id, name: 'Sam Elsewhere' } as any).returning()
  const [theirJob] = await t.db.insert(t.schema.job).values({ companyId: other.id, contactId: theirHome.id, number: 'ROOF-0001', title: '1 Far Rd', address: '1 Far Rd', jobType: 'insurance' } as any).returning()
  const [theirClaim] = await t.db.insert(t.schema.insuranceClaim).values({ companyId: other.id, jobId: theirJob.id, claimNumber: 'X-1', insuranceCompany: 'Other Mutual', depreciationHeld: '9000' } as any).returning()
  ids.theirClaim = theirClaim.id
}, 120_000)

describe('the feature is not ready', () => {
  test('Insurance Follow-ups is offered to roofing, hidden, and on no plan', () => {
    const def: any = FEATURE_REGISTRY.find((f: any) => f.id === 'insurance_extras')
    expect([def?.hidden, def?.templates]).toEqual([true, ['crm-roof']])
    expect(getAdvertisableFeaturesForTemplate('crm-roof').map((f: any) => f.id)).not.toContain('insurance_extras')
    for (const plan of ['website', 'starter10', 'team25', 'business50']) expect(getFeaturesForPlan('crm-roof', plan)).not.toContain('insurance_extras')
  })

  test('switched off, finishing a job with held depreciation makes no reminder and its doors are shut', async () => {
    await features(['insurance_workflow', 'jobs', 'contacts'])
    const { jobId, claimId } = await claimJob('in_production', '1 Off Rd', '4000')
    expect((await post('owner', `/api/jobs/${jobId}/advance`)).status).toBe(200)
    expect((await get('owner', `/api/jobs/${jobId}`)).body.status).toBe('final_inspection')
    expect(await reminders(claimId)).toHaveLength(0)
    expect((await claimRow(claimId)).depreciationRemindedAt).toBeNull()
    for (const [p, send] of [[`/api/insurance-extras/depreciation`, get], [`/api/insurance-extras/mortgage-checks`, get]] as const) {
      expect([403, 404]).toContain((await send('owner', p)).status)
    }
    expect([403, 404]).toContain((await post('owner', `/api/insurance-extras/claims/${claimId}/mortgage-checks`, { mortgageCompany: 'Lender', amount: '100' })).status)
    await features(ON)
  })
})

describe('held depreciation: the reminder', () => {
  test('Advance to Final Inspection makes one reminder — in the trail, on the job, on the rep’s phone — and later stages make no second', async () => {
    const { jobId, claimId } = await claimJob('in_production', '2 Reminder Rd', '4000')
    t.pushed.length = 0
    expect((await post('owner', `/api/jobs/${jobId}/advance`)).status).toBe(200)
    const made = await reminders(claimId)
    expect(made).toHaveLength(1)
    // Money in the trail is the books' to read; the owner's reply says how much is held.
    expect(made[0].body).toBe('The roof is done — send Buckeye Mutual the certificate of completion to release the $4,000.00 depreciation they are holding.')
    expect(await reminderNotes(jobId)).toHaveLength(1)
    expect((await claimRow(claimId)).depreciationRemindedAt).not.toBeNull()
    const note = t.pushed.filter((m) => m.to === 'ExponentPushToken[rep-phone]' && m.data?.kind === 'depreciation_reminder')
    expect(note).toHaveLength(1)
    expect(note[0]).toMatchObject({ title: 'Send the certificate of completion', data: { jobId, claimId } })
    // The notice carries no dollar figure: it lands on a lock screen.
    expect(note[0].body).not.toMatch(/\$/)
    for (let i = 0; i < 2; i++) expect((await post('owner', `/api/jobs/${jobId}/advance`)).status).toBe(200)
    expect((await get('owner', `/api/jobs/${jobId}`)).body.status).toBe('collected')
    expect(await reminders(claimId)).toHaveLength(1)
    expect(await reminderNotes(jobId)).toHaveLength(1)
  })

  test('RCV less ACV counts as held when no depreciation figure is typed; a claim holding nothing makes no reminder', async () => {
    const viaGap = await claimJob('in_production', '3 Gap Rd', '')
    expect((await put('owner', `/api/insurance/claims/${viaGap.claimId}`, { rcv: '18000', acv: '15500' })).status).toBe(200)
    expect((await post('owner', `/api/jobs/${viaGap.jobId}/advance`)).status).toBe(200)
    expect((await reminders(viaGap.claimId))[0].body).toContain('$2,500.00')
    const nothing = await claimJob('in_production', '4 Paid Up Rd', '')
    expect((await post('owner', `/api/jobs/${nothing.jobId}/advance`)).status).toBe(200)
    expect(await reminders(nothing.claimId)).toHaveLength(0)
  })

  test('the job form moving a job to Invoiced, and a payment that collects it, make the reminder too — once', async () => {
    const viaForm = await claimJob('final_inspection', '5 Form Rd', '3000')
    expect((await put('owner', `/api/jobs/${viaForm.jobId}`, { status: 'invoiced' })).status).toBe(200)
    expect(await reminders(viaForm.claimId)).toHaveLength(1)

    // A job that goes from Invoiced to Collected on payment without ever having been reminded.
    const viaPayment = await claimJob('invoiced', '6 Cheque Rd', '2000')
    const inv = await post('owner', '/api/invoices', { contactId: ids.home, jobId: viaPayment.jobId, lineItems: [{ description: 'Roof', quantity: 1, unitPrice: 9000 }] })
    expect(inv.status).toBe(201)
    expect((await post('owner', `/api/invoices/${inv.body.id}/send`)).status).toBe(200)
    expect((await post('owner', `/api/invoices/${inv.body.id}/payments`, { amount: 9000, method: 'check' })).status).toBe(201)
    for (let i = 0; i < 40; i++) { if ((await reminders(viaPayment.claimId)).length) break; await new Promise((r) => setTimeout(r, 50)) }
    expect((await get('owner', `/api/jobs/${viaPayment.jobId}`)).body.status).toBe('collected')
    expect(await reminders(viaPayment.claimId)).toHaveLength(1)
  })
})

describe('held depreciation: getting it back', () => {
  test('the list holds a claim from the day its job is done to the day the carrier releases the money', async () => {
    const mine = await claimJob('final_inspection', '7 Waiting Rd', '4000')
    const notDone = await claimJob('in_production', '8 Building Rd', '5000')
    const listed = async () => (await get('owner', '/api/insurance-extras/depreciation')).body.data as any[]
    const row = (await listed()).find((r) => r.claimId === mine.claimId)!
    expect(row).toMatchObject({ state: 'send_certificate', held: 4000, jobStatus: 'final_inspection', claimNumber: expect.stringMatching(/^CLM-/) })
    // A job still being built is not on it; neither is another company's claim.
    expect((await listed()).some((r) => r.claimId === notDone.claimId || r.claimId === ids.theirClaim)).toBe(false)
    expect((await get('owner', `/api/insurance-extras/claims/${notDone.claimId}/depreciation`)).body.state).toBe('job_not_done')

    const sent = await post('lead', `/api/insurance-extras/claims/${mine.claimId}/completion-certificate`, { sentOn: '2026-10-20', note: 'emailed to the adjuster' })
    // lead holds insurance:approve and insurance:read only; sending the certificate is insurance:create's.
    expect(sent.status).toBe(403)
    const ok = await post('owner', `/api/insurance-extras/claims/${mine.claimId}/completion-certificate`, { sentOn: '2026-10-20', note: 'emailed to the adjuster' })
    expect([ok.status, ok.body.state]).toEqual([200, 'waiting_on_carrier'])
    expect(String(ok.body.certificateSentAt)).toContain('2026-10-20')
    expect((await trail(mine.claimId)).map((a) => a.body)).toContain('Certificate of completion sent to Buckeye Mutual — emailed to the adjuster')
    expect((await listed()).find((r) => r.claimId === mine.claimId)!.state).toBe('waiting_on_carrier')

    // The carrier releases less than it held: recorded, and the trail says by how much.
    expect((await post('owner', `/api/insurance-extras/claims/${mine.claimId}/depreciation-recovered`, { amount: '-5' })).status).toBe(400)
    expect((await post('owner', `/api/insurance-extras/claims/${mine.claimId}/depreciation-recovered`, { amount: '3500', receivedOn: 'not a day' })).status).toBe(400)
    const rec = await post('lead', `/api/insurance-extras/claims/${mine.claimId}/depreciation-recovered`, { amount: '3500', receivedOn: '2026-11-02' })
    // The approver holds the carrier's decisions, not the books: the state comes back, the figure does not.
    expect([rec.status, rec.body.state, rec.body.moneyWithheld]).toEqual([200, 'recovered', true])
    expect((await get('owner', `/api/insurance-extras/claims/${mine.claimId}/depreciation`)).body.recoveredAmount).toBe(3500)
    expect((await trail(mine.claimId)).map((a) => a.body)).toContain('Held depreciation released by Buckeye Mutual — $3,500.00 — $500.00 less than the $4,000.00 held')
    expect((await listed()).some((r) => r.claimId === mine.claimId)).toBe(false)
    // …and a recovered claim takes no further reminder or certificate.
    expect((await post('owner', `/api/insurance-extras/claims/${mine.claimId}/completion-certificate`, {})).status).toBe(409)
  })

  test('who may: the office reads the list; the crew and the read-only seat are refused; only the approver records the release', async () => {
    const { claimId } = await claimJob('final_inspection', '9 Seats Rd', '1000')
    for (const who of ['crew', 'book']) {
      expect([who, (await get(who, '/api/insurance-extras/depreciation')).status]).toEqual([who, 403])
      expect([who, (await post(who, `/api/insurance-extras/claims/${claimId}/completion-certificate`, {})).status]).toEqual([who, 403])
    }
    // The clerk files and reads but cannot record the carrier's money.
    expect((await post('clerk', `/api/insurance-extras/claims/${claimId}/depreciation-recovered`, { amount: '1000' })).status).toBe(403)
    expect((await post('clerk', `/api/insurance-extras/claims/${claimId}/completion-certificate`, {})).status).toBe(200)
    // …and, without the books, sees that something is held but not how much.
    const read = await get('clerk', `/api/insurance-extras/claims/${claimId}/depreciation`)
    expect(read.status).toBe(200)
    expect(read.body.moneyWithheld).toBe(true)
    expect('held' in read.body).toBe(false)
    const listRow = ((await get('clerk', '/api/insurance-extras/depreciation')).body.data as any[]).find((r) => r.claimId === claimId)!
    expect([listRow.moneyWithheld, 'held' in listRow]).toEqual([true, false])
    expect((await get('rep', `/api/insurance-extras/claims/${ids.theirClaim}/depreciation`)).status).toBe(404)
    expect((await post('owner', `/api/insurance-extras/claims/${ids.theirClaim}/completion-certificate`, {})).status).toBe(404)
  })
})

describe('mortgage-company checks', () => {
  test('a check is tracked from the carrier to the bank: received, sent with a tracking number, endorsed, deposited', async () => {
    const { claimId } = await claimJob('in_production', '10 Lender Rd', '')
    const base = `/api/insurance-extras/claims/${claimId}/mortgage-checks`
    // The form is checked field by field.
    for (const bad of [{ amount: '100' }, { mortgageCompany: 'First Federal', amount: 'a lot' }, { mortgageCompany: 'First Federal', amount: '-5' }, { mortgageCompany: 'First Federal', amount: '100', receivedOn: 'soon' }]) {
      expect([JSON.stringify(bad), (await post('owner', base, bad)).status]).toEqual([JSON.stringify(bad), 400])
    }
    const made = await post('owner', base, { mortgageCompany: 'First Federal', loanNumber: 'LN-4471', checkNumber: '90412', amount: '9250.50', receivedOn: '2026-10-01' })
    expect([made.status, made.body.status, made.body.amount]).toEqual([201, 'received', '9250.50'])
    const id = made.body.id as string
    const open = async () => ((await get('owner', '/api/insurance-extras/mortgage-checks?open=1')).body.data as any[]).find((r) => r.id === id)

    expect((await open())).toMatchObject({ status: 'received', mortgageCompany: 'First Federal', jobNumber: expect.any(String), address: '10 Lender Rd' })
    const sent = await post('owner', `/api/insurance-extras/mortgage-checks/${id}/status`, { status: 'sent_to_mortgage', on: '2026-10-03', trackingNumber: '1Z999AA10123456784' })
    expect([sent.status, sent.body.status, sent.body.trackingNumber]).toEqual([200, 'sent_to_mortgage', '1Z999AA10123456784'])
    expect(String(sent.body.sentAt)).toContain('2026-10-03')
    expect((await post('owner', `/api/insurance-extras/mortgage-checks/${id}/status`, { status: 'endorsed', on: '2026-10-09' })).body.status).toBe('endorsed')
    // Sent back a step by mistake: the days after it did not happen.
    const back = await post('owner', `/api/insurance-extras/mortgage-checks/${id}/status`, { status: 'sent_to_mortgage' })
    expect([back.body.status, back.body.endorsedAt, back.body.trackingNumber]).toEqual(['sent_to_mortgage', null, '1Z999AA10123456784'])
    await post('owner', `/api/insurance-extras/mortgage-checks/${id}/status`, { status: 'endorsed', on: '2026-10-09' })
    const dep = await post('owner', `/api/insurance-extras/mortgage-checks/${id}/status`, { status: 'deposited', on: '2026-10-10' })
    expect([dep.body.status, String(dep.body.depositedAt)]).toEqual(['deposited', expect.stringContaining('2026-10-10')])
    expect(await open()).toBeUndefined()
    const all = ((await get('owner', `/api/insurance-extras/mortgage-checks?claimId=${claimId}`)).body.data as any[])
    expect(all.map((r) => r.id)).toEqual([id])
    // The claim's trail tells the story, in the order it happened.
    const lines = (await trail(claimId)).map((a) => a.body).reverse().filter((b) => /Mortgage-company check/.test(b))
    expect(lines[0]).toBe('Mortgage-company check received — $9,250.50 — First Federal, check 90412')
    expect(lines).toContain('Mortgage-company check ($9,250.50, First Federal): Sent to the mortgage company — tracking 1Z999AA10123456784')
    expect(lines.at(-1)).toBe('Mortgage-company check ($9,250.50, First Federal): Deposited')

    // Facts are edited apart from the status; a blank company is refused.
    const edited = await put('owner', `/api/insurance-extras/mortgage-checks/${id}`, { loanNumber: 'LN-9999', notes: 'lender wanted a second signature' })
    expect([edited.status, edited.body.loanNumber, edited.body.status]).toEqual([200, 'LN-9999', 'deposited'])
    expect((await put('owner', `/api/insurance-extras/mortgage-checks/${id}`, { mortgageCompany: '' })).status).toBe(400)
    expect((await as('owner')(`/api/insurance-extras/mortgage-checks/${id}`, { method: 'DELETE' })).status).toBe(200)
    expect((await get('owner', `/api/insurance-extras/mortgage-checks?claimId=${claimId}`)).body.data).toHaveLength(0)
  })

  test('who may: filing is insurance:create, moving and deleting are update / delete, reading is insurance:read; amounts are the books’', async () => {
    const { claimId } = await claimJob('in_production', '11 Seats Ln', '')
    const base = `/api/insurance-extras/claims/${claimId}/mortgage-checks`
    const body = { mortgageCompany: 'Credit Union', amount: '5000' }
    for (const who of ['crew', 'book']) expect([who, (await post(who, base, body)).status]).toEqual([who, 403])
    const filed = await post('clerk', base, body)
    expect(filed.status).toBe(201)
    // The clerk may file but not see the amount it just typed, and may not move or delete the check.
    expect([filed.body.moneyWithheld, 'amount' in filed.body]).toEqual([true, false])
    const id = filed.body.id as string
    expect((await post('clerk', `/api/insurance-extras/mortgage-checks/${id}/status`, { status: 'endorsed' })).status).toBe(403)
    expect((await put('clerk', `/api/insurance-extras/mortgage-checks/${id}`, { notes: 'x' })).status).toBe(403)
    expect((await as('clerk')(`/api/insurance-extras/mortgage-checks/${id}`, { method: 'DELETE' })).status).toBe(403)
    for (const who of ['crew', 'book']) expect([who, (await get(who, '/api/insurance-extras/mortgage-checks')).status]).toEqual([who, 403])
    const listed = ((await get('clerk', '/api/insurance-extras/mortgage-checks')).body.data as any[]).find((r) => r.id === id)!
    expect([listed.moneyWithheld, 'amount' in listed]).toEqual([true, false])
    const seen = ((await get('owner', '/api/insurance-extras/mortgage-checks')).body.data as any[]).find((r) => r.id === id)!
    expect(seen.amount).toBe('5000.00')
    // Another company's claim and check are not reachable.
    expect((await post('owner', `/api/insurance-extras/claims/${ids.theirClaim}/mortgage-checks`, body)).status).toBe(404)
    const [theirs] = await t.db.insert(t.schema.mortgageCheck).values({ companyId: (await t.db.select().from(t.schema.insuranceClaim).where(eq(t.schema.insuranceClaim.id, ids.theirClaim)))[0].companyId, jobId: (await t.db.select().from(t.schema.insuranceClaim).where(eq(t.schema.insuranceClaim.id, ids.theirClaim)))[0].jobId, claimId: ids.theirClaim, mortgageCompany: 'Theirs', amount: '1.00' } as any).returning()
    expect((await post('owner', `/api/insurance-extras/mortgage-checks/${theirs.id}/status`, { status: 'endorsed' })).status).toBe(404)
    expect(((await get('owner', '/api/insurance-extras/mortgage-checks')).body.data as any[]).some((r) => r.id === theirs.id)).toBe(false)
  })
})

describe('the claim keeps its old behaviour', () => {
  test('a claim read by a seat without the books also loses the recovered amount', async () => {
    const { claimId, jobId } = await claimJob('final_inspection', '12 Money Rd', '2000')
    await post('owner', `/api/insurance-extras/claims/${claimId}/depreciation-recovered`, { amount: '2000' })
    const owner = await get('owner', `/api/insurance/claims/${jobId}`)
    expect(owner.body.depreciationRecoveredAmount).toBe('2000.00')
    const clerk = await get('clerk', `/api/insurance/claims/${jobId}`)
    expect([clerk.body.moneyWithheld, 'depreciationRecoveredAmount' in clerk.body, 'depreciationHeld' in clerk.body]).toEqual([true, false, false])
    // Still there for a claim that never used any of this.
    expect(clerk.body.claimNumber).toMatch(/^CLM-/)
    void and
  })
})
