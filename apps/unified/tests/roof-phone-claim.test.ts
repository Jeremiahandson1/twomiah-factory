// Roofing parity row 12 (docs/parity/roof-insurance-extras.md; apps/mobile/app/(details)/job/claim.tsx, apps/mobile/src/insurance/claim.ts):
// the requests the PHONE's claim screen builds, sent to the REAL server as the roofing vertical, to prove the phone and the server agree:
//   · every save the phone queues (start the claim, a note, a supplement with lines, submit, approve with a typed amount, deny, the
//     company's status, a mortgage-company check and its four steps, the certificate, the release) is ACCEPTED, and does what the
//     desktop's claim page does;
//   · the phone offers a control only to a seat the server would let use it (claimSeat/supplementActions against the server's own
//     permission answer for the same seat), so a button is never shown that the server then refuses;
//   · a seat that does not read the books gets no figures back, and the phone says "hidden" for it, not $0.
// The phone's own rules (no signal, order, refusals kept) are tests/mobile/insurance-claim.test.ts.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import {
  addMortgageCheck, addNote, addSupplement, approveSupplement, blankLine, certificateSent, claimSeat, denySupplement, depreciationReleased, depreciationSentence,
  moveMortgageCheck, setSupplementStatus, shownMoney, startClaim, submitSupplement, supplementActions, isError, phoneDay,
  type NewCheckInput, type PhoneStatusDef,
} from '../../mobile/src/insurance/claim.ts'
import type { NewItem } from '../../mobile/src/offline/engine.ts'

type T = Awaited<ReturnType<typeof bootTenant>>
let t: T
let companyId = ''
const tokens: Record<string, string> = {}
const ids: Record<string, string> = {}
const PASS = 'Seat-pass-1'
const ON = ['insurance_workflow', 'insurance_extras', 'jobs', 'contacts', 'invoices']

const login = async (email: string, password: string) =>
  (await (await t.call('/api/auth/login', { method: 'POST', json: { email, password } })).json()).accessToken as string
const as = (who: string) => (p: string, init: any = {}) => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${tokens[who]}` } })
const json = async (r: Response) => ({ status: r.status, body: await r.json() as any })
const get = async (who: string, p: string) => json(await as(who)(p))
/** Send what the phone's queue would send: the item's method, path and JSON body, with an Idempotency-Key as the engine adds. */
const send = async (who: string, req: NewItem | { error: string }) => {
  if (isError(req)) throw new Error(`the phone refused to build it: ${req.error}`)
  return json(await as(who)(req.path, { method: req.method, headers: { 'Idempotency-Key': `phone-${Math.random()}` }, ...(req.body === undefined ? {} : { json: req.body }) }))
}
const features = async (list: string[]) => {
  await t.db.update(t.schema.company).set({ enabledFeatures: list } as any).where(eq(t.schema.company.id, companyId))
  t.services.features.forgetFeatures()
}
const insuranceJob = async (address: string) => {
  const [row] = await t.db.insert(t.schema.job).values({
    companyId, contactId: ids.home, number: `ROOF-${String(Math.floor(Math.random() * 90000) + 10000)}`, title: address, address, city: 'Columbus', state: 'OH', zip: '43215',
    jobType: 'insurance', status: 'in_production',
  } as any).returning()
  return row as any
}
const day = (d: Date) => d.toISOString().slice(0, 10)

beforeAll(async () => {
  t = await bootTenant({ vertical: 'roofing' })
  const seeded = await seedOwner(t)
  companyId = seeded.company.id
  tokens.owner = await login('owner@test.example', seeded.password)
  await features(ON)
  const hash = await Bun.password.hash(PASS, 'bcrypt')
  const seat = async (key: string, role: string, extraPermissions: string[] = []) => {
    const [u] = await t.db.insert(t.schema.user).values({ email: `${key}@test.example`, passwordHash: hash, firstName: key, lastName: 'Seat', role, companyId, extraPermissions } as any).returning()
    ids[key] = u.id
    tokens[key] = await login(`${key}@test.example`, PASS)
  }
  await seat('rep', 'manager')
  await seat('crew', 'field')
  // Files and moves checks, never sees the books: a per-person grant.
  await seat('clerk', 'field', ['insurance:read', 'insurance:update'])
  const [home] = await t.db.insert(t.schema.contact).values({ companyId, name: 'Dana Okafor' } as any).returning()
  ids.home = home.id
}, 120_000)

describe('the phone claim screen against the real server', () => {
  let job: any
  let claimId = ''
  const sup: Record<string, string> = {}
  // A day that is not today, so a day the server ignored (and stamped with now instead) cannot pass.
  const today = new Date(2026, 9, 20, 14, 0)

  test('start the claim from the phone: the server takes it, and the job and claim agree', async () => {
    job = await insuranceJob('14 Maple Ct')
    const made = await send('owner', startClaim(job.id, { claimNumber: ' CLM-1001 ', insuranceCompany: 'Buckeye Mutual', policyNumber: 'P-77', adjusterName: 'Pat Reed', adjusterPhone: '614-555-0100', deductible: '1,000' }, job.number))
    expect(made.status).toBe(201)
    claimId = made.body.id
    const read = await get('owner', `/api/insurance/claims/${job.id}`)
    expect(read.status).toBe(200)
    expect(read.body).toMatchObject({ id: claimId, claimNumber: 'CLM-1001', insuranceCompany: 'Buckeye Mutual', policyNumber: 'P-77', adjusterName: 'Pat Reed' })
    expect(Number(read.body.deductible)).toBe(1000)
    // The phone reads the claim by the job's id; a job with no claim answers 404, which is what the screen turns into "start the claim".
    const bare = await insuranceJob('2 Elm St')
    expect((await get('owner', `/api/insurance/claims/${bare.id}`)).status).toBe(404)
  })

  test('a note, and a supplement with lines: totals come from the server, not the phone', async () => {
    expect((await send('owner', addNote(job.id, claimId, '  Adjuster visit moved to Friday  '))).status).toBe(201)
    const trail = (await get('owner', `/api/insurance/claims/${claimId}/activity`)).body.data as any[]
    expect(trail.some((a) => a.body === 'Adjuster visit moved to Friday')).toBe(true)

    const lines = [
      { description: 'Re-deck 4x8 sheets', qty: '12', unit: 'SHT', unitPrice: '42.50' },
      { description: 'Ridge vent', qty: '1', unit: 'EA', unitPrice: '310' },
      blankLine(),
    ]
    const made = await send('owner', addSupplement(job.id, claimId, 'Hidden decking damage', lines, 'See photos'))
    expect(made.status).toBe(201)
    sup.a = made.body.id
    expect(made.body.status).toBe('draft')
    expect(Number(made.body.totalAmount)).toBe(12 * 42.5 + 310)
    expect(made.body.lineItems.length).toBe(2)
    const list = (await get('owner', `/api/insurance/claims/${claimId}/supplements`)).body.data as any[]
    expect(list.map((s) => s.id)).toContain(sup.a)
  })

  test('submit, then the company status on top of it, then the carrier approves a different amount', async () => {
    const submitted = await send('owner', submitSupplement(job.id, { id: sup.a, supplementNumber: 'SUP-001' }))
    expect(submitted.status).toBe(200)
    expect(submitted.body.status).toBe('submitted')

    const mk = await json(await as('owner')('/api/insurance-extras/supplement-statuses', { method: 'POST', json: { name: 'Under review', baseStatus: 'submitted' } }))
    expect(mk.status).toBe(201)
    const set = await send('owner', setSupplementStatus(job.id, { id: sup.a, supplementNumber: 'SUP-001' }, mk.body.id, 'Under review'))
    expect(set.status).toBe(200)
    const listed = (await get('owner', `/api/insurance/claims/${claimId}/supplements`)).body.data as any[]
    expect(listed.find((s) => s.id === sup.a).customStatusId).toBe(mk.body.id)

    // "850.5" typed on the phone goes as "850.50"; the supplement is approved at that, not at what was asked.
    const approved = await send('owner', approveSupplement(job.id, { id: sup.a, supplementNumber: 'SUP-001' }, '850.5'))
    expect(approved.status).toBe(200)
    expect(approved.body.status).toBe('approved')
    expect(Number(approved.body.approvedAmount)).toBe(850.5)
    expect(Number((await get('owner', `/api/insurance/claims/${job.id}`)).body.supplementAmount)).toBe(850.5)
    // Approving moves it off "submitted", so the company's status that sat under submitted is cleared by the server.
    const after = (await get('owner', `/api/insurance/claims/${claimId}/supplements`)).body.data as any[]
    expect(after.find((s) => s.id === sup.a).customStatusId ?? null).toBeNull()

    // Clearing a status that is not there is accepted too (the phone's "Take it off").
    expect((await send('owner', setSupplementStatus(job.id, { id: sup.a, supplementNumber: 'SUP-001' }, null))).status).toBe(200)
    sup.statusId = mk.body.id
  })

  test('a denial with its reason', async () => {
    const made = await send('owner', addSupplement(job.id, claimId, 'Gutter apron', [{ description: 'Apron', qty: '1', unit: 'EA', unitPrice: '99' }]))
    sup.b = made.body.id
    expect((await send('owner', submitSupplement(job.id, { id: sup.b, supplementNumber: 'SUP-002' }))).status).toBe(200)
    const denied = await send('owner', denySupplement(job.id, { id: sup.b, supplementNumber: 'SUP-002' }, ' Not storm related '))
    expect(denied.status).toBe(200)
    expect(denied.body).toMatchObject({ status: 'denied', denialReason: 'Not storm related' })
  })

  test('a mortgage-company check and its four steps, each stamped with the phone day', async () => {
    const input: NewCheckInput = { mortgageCompany: 'First Federal', amount: '9,250.5', loanNumber: 'L-1', checkNumber: '4471' }
    const made = await send('owner', addMortgageCheck(job.id, claimId, input, today))
    expect(made.status).toBe(201)
    expect(Number(made.body.amount)).toBe(9250.5)
    const check = { id: made.body.id, mortgageCompany: 'First Federal' }
    const sent = await send('owner', moveMortgageCheck(job.id, check, 'sent_to_mortgage', today, ' 1Z999 '))
    expect(sent.status).toBe(200)
    expect(sent.body).toMatchObject({ status: 'sent_to_mortgage', trackingNumber: '1Z999' })
    expect(day(new Date(sent.body.sentAt))).toBe(phoneDay(today))
    for (const step of ['endorsed', 'deposited']) expect((await send('owner', moveMortgageCheck(job.id, check, step, today))).status).toBe(200)
    expect(day(new Date(made.body.receivedAt))).toBe('2026-10-20')
    const mine = (await get('owner', `/api/insurance-extras/mortgage-checks?claimId=${claimId}`)).body.data as any[]
    expect(mine.length).toBe(1)
    expect(mine[0].status).toBe('deposited')
  })

  test('the certificate and the release of held depreciation', async () => {
    await t.db.update(t.schema.insuranceClaim).set({ depreciationHeld: '4000.00' } as any).where(eq(t.schema.insuranceClaim.id, claimId))
    await t.db.update(t.schema.job).set({ status: 'final_inspection' } as any).where(eq(t.schema.job.id, job.id))
    const before = (await get('owner', `/api/insurance-extras/claims/${claimId}/depreciation`)).body
    expect(before.state).toBe('send_certificate')
    expect(depreciationSentence(before, (d) => String(d), shownMoney)).toContain('$4,000.00 of depreciation')

    const sent = await send('owner', certificateSent(job.id, claimId, today))
    expect(sent.status).toBe(200)
    expect(sent.body.state).toBe('waiting_on_carrier')
    expect(day(new Date(sent.body.certificateSentAt))).toBe('2026-10-20')
    const released = await send('owner', depreciationReleased(job.id, claimId, '3,500', today))
    expect(released.status).toBe(200)
    expect(released.body).toMatchObject({ state: 'recovered', recoveredAmount: 3500 })
    expect(day(new Date(released.body.recoveredAt))).toBe('2026-10-20')
    // Sending the certificate again after the release is refused with words the phone shows.
    const again = await send('owner', certificateSent(job.id, claimId, today))
    expect(again.status).toBe(409)
  })

  test('the phone offers a control only to a seat the server lets use it', async () => {
    const sub = await send('owner', addSupplement(job.id, claimId, 'Flashing', [{ description: 'Step flashing', qty: '1', unit: 'EA', unitPrice: '60' }]))
    const id = sub.body.id as string
    const statuses: PhoneStatusDef[] = [{ id: sup.statusId, name: 'Under review', baseStatus: 'submitted', archived: false }]
    expect((await send('owner', submitSupplement(job.id, { id, supplementNumber: 'SUP-003' }))).status).toBe(200)

    const seen: Record<string, string[]> = {}
    for (const who of ['owner', 'rep', 'crew', 'clerk']) {
      const me = (await get(who, '/api/auth/me')).body
      const perms: string[] = (me.permissions || []).map(String)
      const can = (p: string) => perms.includes('*') || perms.includes(p) || perms.includes(`${p.split(':')[0]}:*`)
      const seat = claimSeat(can, (f) => ON.includes(f))
      const offered = supplementActions({ status: 'submitted' }, seat, statuses).map((a) => a.id)

      const reset = () => t.db.update(t.schema.supplement).set({ status: 'submitted', approvedAmount: null, denialReason: null } as any).where(eq(t.schema.supplement.id, id))
      const asSeat = async (req: NewItem | { error: string }) => { await reset(); return (await send(who, req)).status }
      const approveStatus = await asSeat(approveSupplement(job.id, { id, supplementNumber: 'SUP-003' }, '60'))
      const denyStatus = await asSeat(denySupplement(job.id, { id, supplementNumber: 'SUP-003' }, 'no'))
      const statusStatus = await asSeat(setSupplementStatus(job.id, { id, supplementNumber: 'SUP-003' }, null))

      expect(offered.includes('approve')).toBe(approveStatus === 200)
      expect(offered.includes('deny')).toBe(denyStatus === 200)
      expect(offered.includes('status')).toBe(statusStatus === 200)
      expect([200, 403]).toContain(approveStatus)
      seen[who] = offered
    }
    // The four seats really differ, so the loop above compared more than "everyone is allowed".
    expect(seen.owner).toContain('approve')
    expect(seen.crew).not.toContain('approve')
    expect(seen.clerk).toContain('status')
  })

  test('a seat that does not read the books gets no figures, and the phone says hidden, never $0', async () => {
    const claim = (await get('crew', `/api/insurance/claims/${job.id}`))
    expect(claim.status).toBe(200)
    expect(claim.body.moneyWithheld).toBe(true)
    expect(claim.body.deductible).toBeUndefined()
    const sups = (await get('crew', `/api/insurance/claims/${claimId}/supplements`)).body.data as any[]
    expect(sups.length).toBeGreaterThan(0)
    expect(sups.every((s) => s.moneyWithheld === true && s.totalAmount === undefined)).toBe(true)
    const checks = (await get('clerk', `/api/insurance-extras/mortgage-checks?claimId=${claimId}`)).body.data as any[]
    expect(checks.every((c) => c.moneyWithheld === true && c.amount === undefined)).toBe(true)
    const dep = (await get('clerk', `/api/insurance-extras/claims/${claimId}/depreciation`)).body
    expect(dep.moneyWithheld).toBe(true)
    expect(depreciationSentence(dep, (d) => String(d), shownMoney)).not.toContain('$')
  })

  test('the extras are shut when the feature is off, and the phone does not offer them', async () => {
    await features(['insurance_workflow', 'jobs', 'contacts', 'invoices'])
    try {
      expect(claimSeat(() => true, (f) => ['insurance_workflow'].includes(f)).extras).toBe(false)
      const r = await get('owner', `/api/insurance-extras/mortgage-checks?claimId=${claimId}`)
      expect(r.status).toBe(403)
      // The claim itself is still there.
      expect((await get('owner', `/api/insurance/claims/${job.id}`)).status).toBe(200)
    } finally {
      await features(ON)
    }
  })
})
