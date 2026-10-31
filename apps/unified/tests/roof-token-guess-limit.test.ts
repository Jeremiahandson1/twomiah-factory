// Guessing a private link's token (owner follow-up 10/30 on PR #170; roofing depth gaps 5 and 6), through the real server as
// the roofing vertical. The crew's work-order link (/api/crew-link/:token) and the inspection report's link
// (/api/inspection-report-view/:token) are public: the token is the only key. Each counts, per caller address, the lookups
// that found nothing; an address that has missed 30 times in 15 minutes is answered exactly as a wrong token is answered —
// the same status and the same words, never a 429, and that holds for a RIGHT token from that address too — while another
// address is unaffected, and lookups that find a link never count (a crew sending photos is never held up).
// Nothing here sends a text or reaches a real tenant.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { TOKEN_GUESS_MAX } from '../server/http/guards.ts'

type T = Awaited<ReturnType<typeof bootTenant>>
let t: T
let companyId = ''
let ownerToken = ''
const WORK_TOKEN = 'c'.repeat(64)
const REPORT_TOKEN = 'd'.repeat(64)
const ON = ['jobs', 'contacts', 'photo_capture', 'inspection_reports', 'roof_work_orders']

/** A request from one caller address (the limiter keys on it, as every limiter in the app does). */
const from = (ip: string, path: string, init: RequestInit = {}) => t.call(path, { ...init, headers: { ...(init.headers || {}), 'x-forwarded-for': ip } })
const answer = async (r: Response) => ({ status: r.status, body: await r.text() })
const wrongToken = (i: number) => i.toString(16).padStart(64, 'e')

beforeAll(async () => {
  t = await bootTenant({ vertical: 'roofing' })
  const seeded = await seedOwner(t)
  companyId = seeded.company.id
  await t.db.update(t.schema.company).set({ enabledFeatures: ON } as any).where(eq(t.schema.company.id, companyId))
  t.services.features.forgetFeatures()
  ownerToken = (await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: seeded.password } })).json()).accessToken
  const [home] = await t.db.insert(t.schema.contact).values({ companyId, name: 'Lee Marsh', email: 'lee@home.example', type: 'client' } as any).returning()
  const made = await t.call('/api/jobs', { method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` }, json: { contactId: home.id, jobType: 'retail', propertyAddress: '12 Gable Ln', city: 'Akron', state: 'OH', zip: '44301' } })
  expect(made.status).toBe(201)
  const jobId = (await made.json()).id as string
  await t.db.insert(t.schema.workOrder).values({ companyId, jobId, title: 'Re-roof', recipientName: 'Dale Foreman', recipientPhone: '715-555-0123', status: 'sent', publicToken: WORK_TOKEN, tokenExpiresAt: new Date(Date.now() + 7 * 86_400_000) } as any)
  await t.db.insert(t.schema.inspectionReport).values({ companyId, jobId, title: 'Hail check', sections: [], publicToken: REPORT_TOKEN } as any)
}, 120_000)

describe('the crew\'s work-order link', () => {
  test('a right token opens it, and a wrong one is "not valid"', async () => {
    expect((await from('10.0.0.1', `/api/crew-link/${WORK_TOKEN}`)).status).toBe(200)
    const wrong = await answer(await from('10.0.0.1', `/api/crew-link/${wrongToken(1)}`))
    expect(wrong.status).toBe(404)
    expect(wrong.body).toContain('This link is not valid.')
  })

  test('an address that keeps guessing is answered like a wrong token — same status, same words, no 429 — even with the right token', async () => {
    const ip = '10.0.1.1'
    const before = await answer(await from(ip, `/api/crew-link/${wrongToken(500)}`))
    // The guesses so far (the one above counts) up to the ceiling.
    for (let i = 0; i < TOKEN_GUESS_MAX; i++) {
      const r = await from(ip, `/api/crew-link/${wrongToken(i + 10)}`)
      expect(r.status).toBe(404)
    }
    // Shut out now: a wrong token reads exactly as it did, and so does the RIGHT one.
    const afterWrong = await answer(await from(ip, `/api/crew-link/${wrongToken(900)}`))
    const afterRight = await answer(await from(ip, `/api/crew-link/${WORK_TOKEN}`))
    expect(afterWrong).toEqual(before)
    expect(afterRight).toEqual(before)
    // The other doors (accept, photos) are shut the same way.
    expect((await from(ip, `/api/crew-link/${WORK_TOKEN}/accept`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Dale Foreman' }) })).status).toBe(404)
  })

  test('another address is not held up by it, and lookups that find the link never count', async () => {
    expect((await from('10.0.2.1', `/api/crew-link/${WORK_TOKEN}`)).status).toBe(200)
    for (let i = 0; i < TOKEN_GUESS_MAX + 20; i++) expect((await from('10.0.3.1', `/api/crew-link/${WORK_TOKEN}`)).status).toBe(200)
  })
})

describe('the inspection report\'s link', () => {
  const page = (ip: string, token: string, suffix = '') => from(ip, `/api/inspection-report-view/${token}${suffix}`)

  test('a right token opens it, and a wrong one is "not valid"', async () => {
    expect((await page('10.1.0.1', REPORT_TOKEN)).status).toBe(200)
    const wrong = await answer(await page('10.1.0.1', wrongToken(1)))
    expect(wrong.status).toBe(404)
    expect(wrong.body).toContain('This link is not valid.')
  })

  test('an address that keeps guessing is answered like a wrong token — page, PDF and photos alike — even with the right token', async () => {
    const ip = '10.1.1.1'
    const wrongPage = await answer(await page(ip, wrongToken(500)))
    const wrongPdf = await answer(await page(ip, wrongToken(501), '/pdf'))
    for (let i = 0; i < TOKEN_GUESS_MAX; i++) expect((await page(ip, wrongToken(i + 10))).status).toBe(404)
    expect(await answer(await page(ip, REPORT_TOKEN))).toEqual(wrongPage)
    expect(await answer(await page(ip, REPORT_TOKEN, '/pdf'))).toEqual(wrongPdf)
    expect((await page(ip, REPORT_TOKEN, '/photos/anything')).status).toBe(404)
  })

  test('another address is not held up by it, and lookups that find the link never count', async () => {
    expect((await page('10.1.2.1', REPORT_TOKEN)).status).toBe(200)
    for (let i = 0; i < TOKEN_GUESS_MAX + 20; i++) expect((await page('10.1.3.1', REPORT_TOKEN)).status).toBe(200)
  })

  test('the two links keep separate counts: shutting one door does not shut the other', async () => {
    const ip = '10.1.4.1'
    for (let i = 0; i < TOKEN_GUESS_MAX; i++) await page(ip, wrongToken(i + 10))
    expect((await page(ip, REPORT_TOKEN)).status).toBe(404)
    expect((await from(ip, `/api/crew-link/${WORK_TOKEN}`)).status).toBe(200)
  })
})
