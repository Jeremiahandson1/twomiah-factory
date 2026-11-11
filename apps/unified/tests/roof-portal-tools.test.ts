// Roofing parity row 21 — the homeowner portal's office tools (AccuLynx; data/homeownerPortal.ts, crm/roof/portalFiles/office.ts;
// portal_tools, not ready). Fails without the change: none of these routes existed and Collected never closed a portal.
//   · see exactly what the homeowner sees for the job (the portal's own list), and when they last opened their portal;
//   · tell the homeowner (a text, or an email with no mobile) with their portal link; refused when their portal is off;
//   · close the portal on Collected (a setting): only once their last open job is Collected;
//   · off: the routes are shut and Collected closes nothing.
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { FEATURE_REGISTRY } from '../../../packages/tenant-backend/src/featureRegistry.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId = ''
let owner = ''
const texts: any[] = []
const mails: any[] = []
const saved: Record<string, string | undefined> = {}
const setEnv = (k: string, v: string) => { if (!(k in saved)) saved[k] = process.env[k]; process.env[k] = v }
const json = async (r: Response) => ({ status: r.status, body: await r.json() as any })
const auth = (p: string, init: any = {}) => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${owner}` } })
const setFeatures = async (extra: string[]) => {
  await t.db.update(t.schema.company).set({ enabledFeatures: ['jobs', 'contacts', 'documents', 'photo_capture', 'client_portal', 'portal_job_files', ...extra] } as any).where(eq(t.schema.company.id, companyId))
  t.services.features.forgetFeatures()
}
const contactRow = async (fields: any) => ((await t.db.insert(t.schema.contact).values({ companyId, type: 'client', portalEnabled: true, portalToken: `tok${Math.random().toString(36).slice(2)}`, ...fields } as any).returning()) as any[])[0]
const jobRow = async (contactId: string, status = 'in_production') => ((await t.db.insert(t.schema.job).values({ companyId, number: `J-${Math.random().toString(36).slice(2, 7)}`, title: 'Roof', contactId, status, jobType: 'retail' } as any).returning()) as any[])[0]

beforeAll(async () => {
  setEnv('FRONTEND_URL', 'https://app.roofer.example')
  t = await bootTenant({ vertical: 'roofing' })
  const s = await seedOwner(t)
  companyId = s.company.id
  await setFeatures(['portal_tools'])
  owner = (await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } })).json()).accessToken
  ;(t.services as any).crm.sms.sendSMS = async (_c: string, args: any) => { texts.push(args); return { success: true } }
  ;(t.services.crm.emailService as any).sendRaw = async (m: any) => { mails.push(m); return { success: true } }
}, 120_000)
afterAll(() => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v } })

describe('row 21', () => {
  test('what the homeowner sees for the job, and their last visit', async () => {
    const ct = await contactRow({ name: 'Lee Marsh', mobile: '715-555-0101', lastPortalVisit: new Date('2026-11-03T16:12:00Z') })
    const j = await jobRow(ct.id)
    await t.db.insert(t.schema.jobPhoto).values([
      { companyId, jobId: j.id, url: '/media/a.jpg', caption: 'Ridge done', sharedWithCustomer: true },
      { companyId, jobId: j.id, url: '/media/b.jpg', caption: 'Internal only', sharedWithCustomer: false },
    ] as any)
    const r = await json(await auth(`/api/job-files/homeowner?jobId=${j.id}`))
    expect(r.status).toBe(200)
    expect(r.body.homeowner).toMatchObject({ name: 'Lee Marsh', portalOn: true, lastVisit: '2026-11-03T16:12:00.000Z' })
    expect(r.body.sees.map((f: any) => f.name)).toEqual(['Ridge done'])
    // With the portal's messages on (row 22), each job has a line of its own in the portal for its thread — not a file, so not here:
    // it showed as a blank "(Job)" (roofing live test 11/07).
    await setFeatures(['portal_tools', 'portal_posts_packets'])
    const withPosts = await json(await auth(`/api/job-files/homeowner?jobId=${j.id}`))
    expect(withPosts.body.sees.map((f: any) => [f.kind, f.name])).toEqual([['photo', 'Ridge done']])
    await setFeatures(['portal_tools'])
  })

  test('tell the homeowner: a text with their portal link; an email with no mobile; refused when the portal is off', async () => {
    const ct = await contactRow({ name: 'Sam Rivera', mobile: '715-555-0102' })
    const j = await jobRow(ct.id)
    expect((await auth('/api/job-files/notify', { method: 'POST', json: { jobId: j.id } })).status).toBe(200)
    expect(texts.at(-1).message).toMatch(new RegExp(`^Hi Sam, .* added new photos and documents for your project\\. See them at https://app\\.roofer\\.example/portal/${ct.portalToken}$`))
    const mailOnly = await contactRow({ name: 'Pat Mail', email: 'pat@home.example' })
    const j2 = await jobRow(mailOnly.id)
    const r = await json(await auth('/api/job-files/notify', { method: 'POST', json: { jobId: j2.id } }))
    expect(r.body.sent).toBe('email')
    expect(mails.at(-1).to).toBe('pat@home.example')
    const off = await contactRow({ name: 'Off Portal', mobile: '715-555-0103', portalEnabled: false })
    const j3 = await jobRow(off.id)
    expect((await auth('/api/job-files/notify', { method: 'POST', json: { jobId: j3.id } })).status).toBe(409)
  })

  test("texting not set up: never \"Texted\" — the email instead, or said why (live test 11/11)", async () => {
    const real = (t.services as any).crm.sms.sendSMS
    ;(t.services as any).crm.sms.sendSMS = async () => ({ status: 'refused', refused: true, errorMessage: 'Texting is not set up for this business yet — turn it on under Settings › Texting.' })
    try {
      const both = await contactRow({ name: 'Dee Both', mobile: '715-555-0104', email: 'dee@home.example' })
      const r = await json(await auth('/api/job-files/notify', { method: 'POST', json: { jobId: (await jobRow(both.id)).id } }))
      expect([r.status, r.body.sent, mails.at(-1).to]).toEqual([200, 'email', 'dee@home.example'])
      const phoneOnly = await contactRow({ name: 'Ray Phone', mobile: '715-555-0105' })
      const n = await json(await auth('/api/job-files/notify', { method: 'POST', json: { jobId: (await jobRow(phoneOnly.id)).id } }))
      expect(n.status).toBe(409)
      expect(n.body.error).toContain('Texting is not set up')
    } finally { (t.services as any).crm.sms.sendSMS = real }
  })

  test('close on Collected: only with the setting, only once the last open job is Collected', async () => {
    expect((await json(await auth('/api/job-files/settings', { method: 'PUT', json: { closeOnCollected: true } }))).body.closeOnCollected).toBe(true)
    const ct = await contactRow({ name: 'Two Jobs', mobile: '715-555-0104' })
    const a = await jobRow(ct.id, 'invoiced')
    const b = await jobRow(ct.id, 'invoiced')
    const portalOn = async () => (await t.db.select().from(t.schema.contact).where(eq(t.schema.contact.id, ct.id)))[0].portalEnabled
    // The real Advance (it calls stageReached): Invoiced → Collected.
    expect((await auth(`/api/jobs/${a.id}/advance`, { method: 'POST', json: {} })).status).toBeLessThan(300)
    expect((await t.db.select().from(t.schema.job).where(eq(t.schema.job.id, a.id)))[0].status).toBe('collected')
    expect(await portalOn()).toBe(true) // the other job is still going
    expect((await auth(`/api/jobs/${b.id}/advance`, { method: 'POST', json: {} })).status).toBeLessThan(300)
    expect(await portalOn()).toBe(false) // their last job is Collected
    // Setting off: nothing closes.
    await auth('/api/job-files/settings', { method: 'PUT', json: { closeOnCollected: false } })
    const other = await contactRow({ name: 'Setting Off', mobile: '715-555-0105' })
    const c3 = await jobRow(other.id, 'invoiced')
    await auth(`/api/jobs/${c3.id}/advance`, { method: 'POST', json: {} })
    expect((await t.db.select().from(t.schema.contact).where(eq(t.schema.contact.id, other.id)))[0].portalEnabled).toBe(true)
  })

  test('off: shut; the switch is hidden and roofing’s', async () => {
    await setFeatures([])
    try { expect((await auth('/api/job-files/settings', { method: 'PUT', json: { closeOnCollected: false } })).status).toBeGreaterThanOrEqual(403) } finally { await setFeatures(['portal_tools']) }
    const f = FEATURE_REGISTRY.find((x: any) => x.id === 'portal_tools') as any
    expect([f?.hidden, f?.templates]).toEqual([true, ['crm-roof']])
  })
})
