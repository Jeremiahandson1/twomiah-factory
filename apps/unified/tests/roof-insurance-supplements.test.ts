// Roofing parity row 10 (docs/parity/roof-insurance-extras.md #2 and #3; server/crm/roof/insurance/supplementStatuses.ts), through the
// real server as the roofing vertical:
//   · the company's own supplement statuses ("Under review", "Pending re-inspection", "Need more information") are defined by the
//     company's admin, ordered, renamed, archived and deleted when nothing carries them; one may not borrow a built-in word or repeat;
//   · a company status sits ON TOP of the fixed four: it is put on a supplement that is in the fixed status it sits under, never
//     changes the fixed one, and is cleared when the fixed status moves to one it does not fit — submit, approve and deny, and the
//     claim's supplement total, all behave exactly as before;
//   · the tracker lists the supplements of EVERY claim in two columns (requested = draft, in progress = submitted), not the decided
//     ones unless asked, only this company's, with the amounts the books' (a seat without them sees none);
//   · all of it is behind the not-ready feature `insurance_extras`.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'

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
const del = async (who: string, p: string) => json(await as(who)(p, { method: 'DELETE' }))
const features = async (list: string[]) => {
  await t.db.update(t.schema.company).set({ enabledFeatures: list } as any).where(eq(t.schema.company.id, companyId))
  t.services.features.forgetFeatures()
}
const ON = ['insurance_workflow', 'insurance_extras', 'jobs', 'contacts', 'invoices']
const X = '/api/insurance-extras'

/** An insurance job with a claim. */
async function claimJob(address: string) {
  const [row] = await t.db.insert(t.schema.job).values({
    companyId, contactId: ids.home, number: `ROOF-${String(Math.floor(Math.random() * 90000) + 10000)}`, title: address, address, city: 'Columbus', state: 'OH', zip: '43215',
    jobType: 'insurance', status: 'in_production',
  } as any).returning()
  const claim = await post('owner', '/api/insurance/claims', { jobId: row.id, claimNumber: `CLM-${row.number}`, insuranceCompany: 'Buckeye Mutual' })
  expect(claim.status).toBe(201)
  return { jobId: row.id as string, claimId: claim.body.id as string }
}
/** A supplement on a claim; `to` moves it past draft. */
async function supplement(claimId: string, price = 500, to: 'draft' | 'submitted' = 'draft') {
  const made = await post('owner', `/api/insurance/claims/${claimId}/supplements`, { reason: 'Hidden decking damage', lineItems: [{ description: 'Re-deck', qty: 1, unit: 'EA', unitPrice: price }] })
  expect(made.status).toBe(201)
  if (to === 'submitted') expect((await post('owner', `/api/insurance/supplements/${made.body.id}/submit`)).status).toBe(200)
  return made.body.id as string
}
const status = async (name: string, baseStatus: string, who = 'owner') => {
  const r = await post(who, `${X}/supplement-statuses`, { name, baseStatus })
  expect(r.status).toBe(201)
  return r.body.id as string
}
const row = async (id: string) => (await t.db.select().from(t.schema.supplement).where(eq(t.schema.supplement.id, id)))[0] as any
const trail = async (claimId: string) => ((await get('owner', `/api/insurance/claims/${claimId}/activity`)).body.data as any[]).map((a) => a.body as string)
const tracker = async (who: string, q = '') => (await get(who, `${X}/supplements${q}`)).body.data as any[]

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
  await seat('admin', 'admin', companyId)
  await seat('rep', 'manager', companyId)
  await seat('crew', 'field', companyId)
  // Reads the tracker and puts a status on a supplement, but never sees the books (a per-person grant).
  await seat('clerk', 'field', companyId, ['insurance:read', 'insurance:update'])
  const [home] = await t.db.insert(t.schema.contact).values({ companyId, name: 'Dana Okafor' } as any).returning()
  ids.home = home.id
  const [other] = await t.db.insert(t.schema.company).values({ name: 'Rival Roofing', slug: 'rival-roofing', enabledFeatures: ['insurance_workflow', 'insurance_extras'] } as any).returning()
  const [theirHome] = await t.db.insert(t.schema.contact).values({ companyId: other.id, name: 'Sam Elsewhere' } as any).returning()
  const [theirJob] = await t.db.insert(t.schema.job).values({ companyId: other.id, contactId: theirHome.id, number: 'ROOF-0001', title: '1 Far Rd', address: '1 Far Rd', jobType: 'insurance' } as any).returning()
  const [theirClaim] = await t.db.insert(t.schema.insuranceClaim).values({ companyId: other.id, jobId: theirJob.id, claimNumber: 'X-1', insuranceCompany: 'Other Mutual' } as any).returning()
  const [theirSup] = await t.db.insert(t.schema.supplement).values({ companyId: other.id, jobId: theirJob.id, claimId: theirClaim.id, supplementNumber: 'SUP-001', reason: 'Theirs', lineItems: [], totalAmount: '77.00', status: 'submitted' } as any).returning()
  const [theirStatus] = await t.db.insert(t.schema.supplementStatus).values({ companyId: other.id, name: 'Their status', baseStatus: 'submitted' } as any).returning()
  ids.theirSup = theirSup.id
  ids.theirStatus = theirStatus.id
}, 120_000)

describe('the feature is the same not-ready switch', () => {
  test('with Insurance Follow-ups off, the statuses and the tracker are shut', async () => {
    await features(['insurance_workflow', 'jobs', 'contacts'])
    for (const p of [`${X}/supplement-statuses`, `${X}/supplements`]) expect([403, 404]).toContain((await get('owner', p)).status)
    expect([403, 404]).toContain((await post('owner', `${X}/supplement-statuses`, { name: 'Under review', baseStatus: 'submitted' })).status)
    await features(ON)
  })
})

describe('the company’s own statuses', () => {
  test('the admin defines them in order; the same name, in any case or spacing, or a built-in word, is refused', async () => {
    const a = await status('Under review', 'submitted', 'admin')
    const b = await status('Pending re-inspection', 'submitted')
    const c = await status('Need more information from rep', 'draft')
    const listed = (await get('crew', `${X}/supplement-statuses`)).body.data as any[]
    // Anyone signed in reads them (the claim page, which the crew opens, names them); order is the order set.
    expect(listed.map((s) => [s.name, s.baseStatus, s.sortOrder, s.supplements])).toEqual([
      ['Under review', 'submitted', 0, 0], ['Pending re-inspection', 'submitted', 1, 0], ['Need more information from rep', 'draft', 2, 0],
    ])
    const dup = await post('owner', `${X}/supplement-statuses`, { name: '  under   REVIEW ', baseStatus: 'draft' })
    expect([dup.status, dup.body.code]).toEqual([409, 'status_name_taken'])
    for (const word of ['Draft', 'submitted', 'APPROVED', 'Denied']) {
      const r = await post('owner', `${X}/supplement-statuses`, { name: word, baseStatus: 'submitted' })
      expect([word, r.status, r.body.code]).toEqual([word, 400, 'status_name_taken'])
    }
    for (const bad of [{ name: '', baseStatus: 'submitted' }, { name: 'x'.repeat(41), baseStatus: 'submitted' }, { name: 'Fine', baseStatus: 'pending' }, { name: 'Fine' }]) {
      expect([JSON.stringify(bad), (await post('owner', `${X}/supplement-statuses`, bad)).status]).toEqual([JSON.stringify(bad), 400])
    }
    // Put the last first; the whole list is the order.
    expect((await put('owner', `${X}/supplement-statuses/order`, { ids: [c, a, b] })).status).toBe(200)
    expect(((await get('owner', `${X}/supplement-statuses`)).body.data as any[]).map((s) => s.name)).toEqual(['Need more information from rep', 'Under review', 'Pending re-inspection'])
    expect((await put('owner', `${X}/supplement-statuses/order`, { ids: [c, ids.theirStatus] })).status).toBe(404)
    // Renaming keeps the rules; a name that is already another's is refused, its own name is fine.
    expect((await put('owner', `${X}/supplement-statuses/${a}`, { name: 'Pending re-inspection' })).status).toBe(409)
    expect((await put('owner', `${X}/supplement-statuses/${a}`, { name: 'Under review' })).status).toBe(200)
    expect((await put('owner', `${X}/supplement-statuses/${a}`, { name: 'In review' })).body.name).toBe('In review')
    expect((await put('owner', `${X}/supplement-statuses/${a}`, { name: 'Under review' })).status).toBe(200)
  })

  test('only the company’s set-up seat defines them (settings:update); a manager, the crew and another company are refused', async () => {
    for (const who of ['rep', 'crew', 'clerk']) {
      expect([who, (await post(who, `${X}/supplement-statuses`, { name: `By ${who}`, baseStatus: 'draft' })).status]).toEqual([who, 403])
    }
    const mine = ((await get('owner', `${X}/supplement-statuses`)).body.data as any[])[0].id as string
    expect((await put('rep', `${X}/supplement-statuses/${mine}`, { name: 'Hijacked' })).status).toBe(403)
    expect((await del('rep', `${X}/supplement-statuses/${mine}`)).status).toBe(403)
    expect((await put('rep', `${X}/supplement-statuses/order`, { ids: [mine] })).status).toBe(403)
    // Another company's status is a 404 to this one, and is not in its list.
    expect((await put('owner', `${X}/supplement-statuses/${ids.theirStatus}`, { name: 'Mine now' })).status).toBe(404)
    expect((await del('owner', `${X}/supplement-statuses/${ids.theirStatus}`)).status).toBe(404)
    expect(((await get('owner', `${X}/supplement-statuses`)).body.data as any[]).some((s) => s.id === ids.theirStatus)).toBe(false)
  })

  test('one nothing carries can be deleted; one that is carried is archived instead, keeps its name, and is not offered again', async () => {
    const { claimId } = await claimJob('20 Archive Rd')
    const sup = await supplement(claimId, 100, 'submitted')
    const id = await status('Waiting on engineer', 'submitted')
    expect((await post('rep', `${X}/supplements/${sup}/custom-status`, { statusId: id })).status).toBe(200)
    const refused = await del('owner', `${X}/supplement-statuses/${id}`)
    expect([refused.status, refused.body.code]).toEqual([409, 'status_in_use'])
    expect(refused.body.error).toContain('1 supplement is marked “Waiting on engineer”. Archive it instead')
    const archived = await put('owner', `${X}/supplement-statuses/${id}`, { archived: true })
    expect([archived.body.archived, archived.body.supplements]).toEqual([true, 1])
    // It stays on the supplement that has it …
    const shown = (await tracker('owner')).find((s) => s.id === sup)!
    expect([shown.customStatus, shown.customStatusArchived]).toEqual(['Waiting on engineer', true])
    // … is not put on another …
    const other = await supplement(claimId, 100, 'submitted')
    const no = await post('owner', `${X}/supplements/${other}/custom-status`, { statusId: id })
    expect([no.status, no.body.code]).toEqual([409, 'status_archived'])
    // … and comes back when restored.
    expect((await put('owner', `${X}/supplement-statuses/${id}`, { archived: false })).body.archived).toBe(false)
    expect((await post('owner', `${X}/supplements/${other}/custom-status`, { statusId: id })).status).toBe(200)
    // Nothing carries a fresh one, so it can go.
    const fresh = await status('Scratch', 'draft')
    expect((await del('owner', `${X}/supplement-statuses/${fresh}`)).status).toBe(200)
    expect(((await get('owner', `${X}/supplement-statuses`)).body.data as any[]).some((s) => s.id === fresh)).toBe(false)
  })
})

describe('a company status sits on top of the fixed four', () => {
  test('it is put on a supplement in the fixed status it sits under, with a line in the trail, and the fixed status is untouched', async () => {
    const { claimId } = await claimJob('21 Top Rd')
    const review = ((await get('owner', `${X}/supplement-statuses`)).body.data as any[]).find((s) => s.name === 'Under review').id as string
    const draftOnly = ((await get('owner', `${X}/supplement-statuses`)).body.data as any[]).find((s) => s.name === 'Need more information from rep').id as string
    const sup = await supplement(claimId, 1200, 'submitted')
    const ok = await post('rep', `${X}/supplements/${sup}/custom-status`, { statusId: review })
    expect([ok.status, ok.body.status, ok.body.customStatusId]).toEqual([200, 'submitted', review])
    expect((await trail(claimId))).toContain('Supplement SUP-001 marked “Under review”')
    // A status that sits under draft cannot go on a submitted supplement — the reply names both.
    const wrong = await post('rep', `${X}/supplements/${sup}/custom-status`, { statusId: draftOnly })
    expect([wrong.status, wrong.body.code]).toEqual([409, 'status_wrong_base'])
    expect(wrong.body.error).toBe('“Need more information from rep” is for a supplement that is draft, and SUP-001 is submitted.')
    expect((await row(sup)).customStatusId).toBe(review)
    // Another company's status, and a supplement of another company, are not reachable.
    expect((await post('rep', `${X}/supplements/${sup}/custom-status`, { statusId: ids.theirStatus })).status).toBe(404)
    expect((await post('owner', `${X}/supplements/${ids.theirSup}/custom-status`, { statusId: review })).status).toBe(404)
    // Who may: update, not read.
    expect((await post('crew', `${X}/supplements/${sup}/custom-status`, { statusId: null })).status).toBe(403)
    expect((await post('clerk', `${X}/supplements/${sup}/custom-status`, { statusId: null })).status).toBe(200)
    expect((await trail(claimId))).toContain('Supplement SUP-001: company status cleared')
    expect((await row(sup)).customStatusId).toBeNull()
  })

  test('submit, approve and deny work exactly as before; a status that no longer fits is cleared, one that still fits stays', async () => {
    const { claimId, jobId } = await claimJob('22 Fixed Rd')
    const all = (await get('owner', `${X}/supplement-statuses`)).body.data as any[]
    const id = (n: string) => all.find((s) => s.name === n).id as string
    const needInfo = id('Need more information from rep') // sits under draft
    const review = id('Under review') // sits under submitted
    const approvedNote = await status('Check in the mail', 'approved')

    // Draft → submit: the draft status goes (it no longer fits), the supplement is submitted as ever.
    const sup = await supplement(claimId, 1000)
    expect((await post('owner', `${X}/supplements/${sup}/custom-status`, { statusId: needInfo })).status).toBe(200)
    const submitted = await post('owner', `/api/insurance/supplements/${sup}/submit`)
    expect([submitted.status, submitted.body.status, submitted.body.customStatusId]).toEqual([200, 'submitted', null])
    // Submitted: a company status under submitted is put on; resubmitting is refused as before (the fixed rule).
    expect((await post('owner', `${X}/supplements/${sup}/custom-status`, { statusId: review })).status).toBe(200)
    expect((await post('owner', `/api/insurance/supplements/${sup}/submit`)).body.code).toBe('supplement_wrong_status')
    expect((await row(sup)).customStatusId).toBe(review)

    // Approved: "Under review" goes; the money is the fixed rule's — the claim's supplement total is the approved sum.
    const approved = await post('owner', `/api/insurance/supplements/${sup}/approve`, { approvedAmount: '900.00' })
    expect([approved.status, approved.body.status, approved.body.approvedAmount, approved.body.customStatusId]).toEqual([200, 'approved', '900.00', null])
    expect((await get('owner', `/api/insurance/claims/${jobId}`)).body.supplementAmount).toBe('900.00')
    // A status under approved is put on; approving again (a revised figure) keeps it, denying clears it.
    expect((await post('owner', `${X}/supplements/${sup}/custom-status`, { statusId: approvedNote })).status).toBe(200)
    const revised = await post('owner', `/api/insurance/supplements/${sup}/approve`, { approvedAmount: '950.00' })
    expect([revised.body.approvedAmount, revised.body.customStatusId]).toEqual(['950.00', approvedNote])
    expect((await get('owner', `/api/insurance/claims/${jobId}`)).body.supplementAmount).toBe('950.00')
    const denied = await post('owner', `/api/insurance/supplements/${sup}/deny`, { denialReason: 'Pre-existing' })
    expect([denied.status, denied.body.status, denied.body.customStatusId]).toEqual([200, 'denied', null])
    expect((await get('owner', `/api/insurance/claims/${jobId}`)).body.supplementAmount).toBe('0.00')
    // The fixed four still keep their own wrong-state refusals.
    const draft = await supplement(claimId, 10)
    expect((await post('owner', `/api/insurance/supplements/${draft}/approve`, { approvedAmount: '5' })).body.code).toBe('supplement_wrong_status')
  })

  test('moving a status under another fixed status clears it from the supplements it no longer fits', async () => {
    const { claimId } = await claimJob('23 Move Rd')
    const idm = await status('Awaiting adjuster call', 'submitted')
    const a = await supplement(claimId, 50, 'submitted')
    const b = await supplement(claimId, 60, 'submitted')
    await post('owner', `${X}/supplements/${a}/custom-status`, { statusId: idm })
    await post('owner', `${X}/supplements/${b}/custom-status`, { statusId: idm })
    // The tracker counts them; then the status is moved under draft, where neither supplement is.
    expect(((await get('owner', `${X}/supplement-statuses`)).body.data as any[]).find((s) => s.id === idm).supplements).toBe(2)
    const moved = await put('owner', `${X}/supplement-statuses/${idm}`, { baseStatus: 'draft' })
    expect([moved.body.baseStatus, moved.body.supplements]).toEqual(['draft', 0])
    expect([(await row(a)).customStatusId, (await row(b)).customStatusId]).toEqual([null, null])
  })
})

describe('the tracker across every claim', () => {
  test('requested (draft) and in progress (submitted) from every claim, the decided ones only when asked, this company only', async () => {
    const one = await claimJob('30 Tracker Rd')
    const two = await claimJob('31 Tracker Ave')
    const review = ((await get('owner', `${X}/supplement-statuses`)).body.data as any[]).find((s) => s.name === 'Under review').id as string
    const requested = await supplement(one.claimId, 300)
    const progress = await supplement(two.claimId, 800, 'submitted')
    const decided = await supplement(two.claimId, 900, 'submitted')
    expect((await post('owner', `/api/insurance/supplements/${decided}/approve`, { approvedAmount: '850' })).status).toBe(200)
    await post('owner', `${X}/supplements/${progress}/custom-status`, { statusId: review })

    const rows = await tracker('owner')
    const mine = (id: string) => rows.find((r) => r.id === id)
    expect(mine(requested)).toMatchObject({ column: 'requested', status: 'draft', claimId: one.claimId, jobId: one.jobId, address: '30 Tracker Rd', insuranceCompany: 'Buckeye Mutual', totalAmount: '300.00', customStatus: null, supplementNumber: 'SUP-001' })
    expect(mine(progress)).toMatchObject({ column: 'in_progress', status: 'submitted', claimId: two.claimId, address: '31 Tracker Ave', totalAmount: '800.00', customStatus: 'Under review' })
    expect(mine(progress).claimNumber).toMatch(/^CLM-/)
    expect(typeof mine(progress).daysOpen).toBe('number')
    // Decided ones are not work in progress; another company's supplement is never listed.
    expect(mine(decided)).toBeUndefined()
    expect(rows.some((r) => r.id === ids.theirSup)).toBe(false)
    const withDecided = await tracker('owner', '?decided=1')
    expect(withDecided.find((r) => r.id === decided)).toMatchObject({ status: 'approved', column: 'decided', approvedAmount: '850.00' })
    // Narrowed to one of the company's statuses.
    expect((await tracker('owner', `?statusId=${review}`)).map((r) => r.id)).toContain(progress)
    expect((await tracker('owner', `?statusId=${review}`)).map((r) => r.id)).not.toContain(requested)
  })

  test('the office reads it; the crew is refused; a seat without the books sees the supplements without their amounts', async () => {
    expect((await get('crew', `${X}/supplements`)).status).toBe(403)
    const listed = await tracker('clerk')
    expect(listed.length).toBeGreaterThan(0)
    for (const r of listed) expect([r.moneyWithheld, 'totalAmount' in r, 'approvedAmount' in r]).toEqual([true, false, false])
    // …and the custom-status reply to that seat carries no figure either.
    const sup = listed[0].id as string
    const review = ((await get('owner', `${X}/supplement-statuses`)).body.data as any[]).find((s) => s.name === 'Under review').id as string
    const reply = await post('clerk', `${X}/supplements/${sup}/custom-status`, { statusId: null })
    expect(reply.status).toBe(200)
    expect([reply.body.moneyWithheld, 'totalAmount' in reply.body]).toEqual([true, false])
    void review
  })
})
