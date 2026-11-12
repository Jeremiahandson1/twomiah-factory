// Landscaping parity rows 26 and 31 — the visit-done message's office side and the customer's rating (data/visitReports.ts,
// crm/landscaping/visitReports.ts, crm/landscaping/visitFeedback.ts):
//   · 26 (Yardbook; visit_message_tools, not ready): the office's own wording with {placeholders}, a preview with nothing sent, a copy of
//     what the customer got kept on the report, services and route stops that are never messaged;
//   · 31 (Jobber's feedback survey; visit_survey, not ready): the message carries a signed link; the customer rates 1–5 with a comment,
//     once; the rating shows on the report and the office list; a low one emails the office.
// Fails without the change: none of these existed (the wording was fixed, nothing kept a copy, no link, no rating).
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { sendVisitReport, fillTemplate, templateProblem, feedbackToken, readFeedbackToken, DEFAULT_TEMPLATES, visitMessage } from '../server/data/visitReports.ts'
import { FEATURE_REGISTRY } from '../../../packages/tenant-backend/src/featureRegistry.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId: string
let owner: string
let crew: string
let crewId: string
const mails: any[] = []
const as = (token: string, path: string, init: any = {}) => t.call(path, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` } })
const ins = async (table: any, values: any) => ((await t.db.insert(table).values(values).returning()) as any[])[0]
const post = (token: string, path: string, json: any = {}) => as(token, path, { method: 'POST', json })
const put = (token: string, path: string, json: any = {}) => as(token, path, { method: 'PUT', json })
const login = async (email: string, password: string) => (await (await t.call('/api/auth/login', { method: 'POST', json: { email, password } })).json()).accessToken as string
const BASE = ['contacts', 'jobs', 'quotes', 'invoices', 'photo_capture', 'recurring_routes', 'visit_reports']
const setFeatures = async (extra: string[]) => {
  await t.db.update(t.schema.company).set({ enabledFeatures: [...BASE, ...extra] } as any).where(eq(t.schema.company.id, companyId))
  t.services.features.forgetFeatures()
}

beforeAll(async () => {
  t = await bootTenant({ vertical: 'landscaping' })
  const s = await seedOwner(t)
  companyId = s.company.id
  await t.db.update(t.schema.company).set({ name: 'Green Acres' } as any).where(eq(t.schema.company.id, companyId))
  ;(t.services.crm.emailService as any).sendRaw = async (m: any) => { mails.push(m); return { success: true } }
  await setFeatures(['visit_message_tools', 'visit_survey'])
  owner = await login('owner@test.example', s.password)
  const password = 'Correct-horse-1'
  const u = await ins(t.schema.user, { companyId, email: 'crew@test.example', firstName: 'Cam', lastName: 'Crew', role: 'field', passwordHash: await Bun.password.hash(password, 'bcrypt') })
  crewId = u.id; crew = await login('crew@test.example', password)
})

let n = 0
async function visit(contact: Record<string, any> = {}, extra: Record<string, any> = {}) {
  n++
  const ct = await ins(t.schema.contact, { companyId, name: `Pat Customer${n}`, type: 'client', phone: `+1715555${String(2000 + n)}`, email: `c${n}@example.com`, ...contact })
  const j = await ins(t.schema.job, { companyId, number: `JOB-V${n}`, title: `Mow ${n}`, status: 'scheduled', contactId: ct.id, assignedToId: crewId, scheduledDate: new Date(), ...extra })
  return { ct, job: j }
}
const reportOf = async (jobId: string) => (await t.db.select().from(t.schema.visitReport).where(eq(t.schema.visitReport.jobId, jobId)))[0]
const done = (jobId: string) => t.db.update(t.schema.job).set({ status: 'completed', completedAt: new Date() }).where(eq(t.schema.job.id, jobId))
const deps = (sent: any[] = []) => ({ pictureUrl: () => null, feedbackUrl: (c: string, r: string) => `https://app.example/api/visit-feedback/${feedbackToken(c, r)}`, sendEmail: async (m: any) => { sent.push(m) } })

describe('row 26: the wording', () => {
  test('the built-in template reads exactly as the fixed message did; an unknown placeholder or an overlong text is refused', () => {
    const w = { companyName: 'Green Acres', firstName: 'Pat', title: 'Mow', day: 'Monday, May 4', note: 'Gate latched.', photos: 2 }
    expect(fillTemplate(DEFAULT_TEMPLATES.text, w, null)).toBe(visitMessage(w).text)
    expect(fillTemplate(DEFAULT_TEMPLATES.text, { ...w, note: null, photos: 0 }, null)).toBe(visitMessage({ ...w, note: null, photos: 0 }).text)
    expect(fillTemplate(DEFAULT_TEMPLATES.subject, w, null)).toBe(visitMessage(w).subject)
    expect(templateProblem('text', 'Hi {first_name} {nickname}')).toMatch(/nickname/)
    expect(templateProblem('text', 'x'.repeat(601))).toMatch(/600/)
    expect(templateProblem('text', 'Hi {first_name}, done: {job}. Rate us {feedback_link}')).toBeNull()
  })

  test('the office saves its words; finishing a visit sends them, keeps a copy, and puts the rating link where it says', async () => {
    expect((await put(crew, '/api/visit-reports/settings', { text: 'x' })).status).toBe(403)
    const bad = await put(owner, '/api/visit-reports/settings', { text: 'Hi {nick}' })
    expect(bad.status).toBe(400)
    const ok = await put(owner, '/api/visit-reports/settings', { text: 'Hey {first_name}! {company_name} wrapped up {job}. {note} Rate us: {feedback_link}', subject: 'All done: {job}' })
    expect(ok.status).toBe(200)
    const s = await (await as(owner, '/api/visit-reports/settings')).json()
    expect(s.custom.text).toBe(true)
    expect(s.placeholders).toContain('feedback_link')

    const v = await visit()
    await done(v.job.id)
    await put(owner, `/api/visit-reports/job/${v.job.id}`, { note: 'Edges trimmed.' })
    const r = await sendVisitReport(t.db, deps(), companyId, v.job.id, { tools: true, survey: true })
    expect(r.status).toBe('queued')
    const rep = await reportOf(v.job.id)
    expect(rep.messageText).toMatch(/^Hey Pat! Green Acres wrapped up Mow \d+\. Edges trimmed\. Rate us: https:\/\/app\.example\/api\/visit-feedback\//)
    const [text] = await t.db.select().from(t.schema.scheduledText).where(eq(t.schema.scheduledText.contactId, v.ct.id))
    expect(text.body).toBe(String(rep.messageText))
    // The office reads the copy, on the visit and in the list.
    const one = await (await as(owner, `/api/visit-reports/job/${v.job.id}`)).json()
    expect(one.messageText).toBe(rep.messageText)
    const list = await (await as(owner, '/api/visit-reports')).json()
    expect(list.data.find((x: any) => x.jobId === v.job.id)?.messageText).toBe(rep.messageText)
  })

  test('an email uses the subject and opening, with the rating buttons; a copy is kept', async () => {
    await put(owner, '/api/visit-reports/settings', { email: 'Hello {first_name},\n\nWe finished {job} on {day}.' })
    const v = await visit({ phone: null })
    await done(v.job.id)
    const sent: any[] = []
    const r = await sendVisitReport(t.db, deps(sent), companyId, v.job.id, { tools: true, survey: true })
    expect(r.status).toBe('sent')
    expect(sent[0].subject).toMatch(/^All done: Mow/)
    expect(sent[0].html).toContain('<p>Hello Pat,</p>')
    expect(sent[0].html).toContain('?r=5')
    expect((await reportOf(v.job.id)).messageText).toMatch(/^Hello Pat,\n\nWe finished Mow/)
  })

  test('the preview shows what would go, nothing sent; a crew seat cannot preview', async () => {
    const v = await visit()
    await done(v.job.id)
    expect((await as(crew, `/api/visit-reports/job/${v.job.id}/preview`)).status).toBe(403)
    const p = await (await as(owner, `/api/visit-reports/job/${v.job.id}/preview`)).json()
    expect(p.channel).toBe('text')
    expect(p.text).toMatch(/^Hey Pat! Green Acres wrapped up Mow/)
    expect(p.text).toContain('(the feedback link)')
    expect(await reportOf(v.job.id)).toBeUndefined()
    expect((await t.db.select().from(t.schema.scheduledText).where(eq(t.schema.scheduledText.contactId, v.ct.id))).length).toBe(0)
  })

  test('a service on the list, or a stop marked so, is never messaged; with the switch off the list is not read', async () => {
    const ct = await ins(t.schema.contact, { companyId, name: 'Route Customer', type: 'client', phone: '+17155559999' })
    const site = await ins(t.schema.site, { companyId, name: 'Elm', contactId: ct.id, address: '1 Elm' })
    const route = await ins(t.schema.recurringRoute, { companyId, name: 'Mon A', dayOfWeek: 1 })
    const aer = await ins(t.schema.recurringRouteStop, { companyId, recurringRouteId: route.id, siteId: site.id, contactId: ct.id, serviceType: 'Aeration' })
    const mow = await ins(t.schema.recurringRouteStop, { companyId, recurringRouteId: route.id, siteId: site.id, contactId: ct.id, serviceType: 'mowing' })
    expect((await put(owner, '/api/visit-reports/settings', { skipServices: ['aeration'] })).status).toBe(200)
    const a = await visit({}, { recurringRouteStopId: aer.id })
    await done(a.job.id)
    const ra = await sendVisitReport(t.db, deps(), companyId, a.job.id, { tools: true })
    expect(ra.status).toBe('skipped')
    expect((await reportOf(a.job.id)).status).toBe('skipped')
    // Off: the service list is not read.
    const off = await visit({}, { recurringRouteStopId: aer.id, scheduledDate: new Date(Date.now() + 86_400_000) })
    await done(off.job.id)
    expect((await sendVisitReport(t.db, deps(), companyId, off.job.id, { tools: false })).status).toBe('queued')

    expect((await put(crew, `/api/visit-reports/stops/${mow.id}`, { skip: true })).status).toBe(403)
    expect((await put(owner, `/api/visit-reports/stops/${mow.id}`, { skip: true })).status).toBe(200)
    const m = await visit({}, { recurringRouteStopId: mow.id })
    await done(m.job.id)
    const rm = await sendVisitReport(t.db, deps(), companyId, m.job.id, { tools: true })
    expect(rm.status).toBe('skipped')
    expect((rm as any).reason).toMatch(/route stop/)
    // The board shows the mark.
    const detail = await (await as(owner, `/api/recurring-routes/${route.id}`)).json()
    expect(detail.stops.find((s: any) => s.id === mow.id)?.skipVisitMessage).toBe(true)
  })

  test('with visit_message_tools off the office routes are shut', async () => {
    await setFeatures(['visit_survey'])
    try {
      expect((await as(owner, '/api/visit-reports/settings')).status).toBe(404)
      expect((await put(owner, '/api/visit-reports/settings', { text: 'x' })).status).toBe(404)
    } finally { await setFeatures(['visit_message_tools', 'visit_survey']) }
  })
})

describe('row 31: the rating', () => {
  test('the link opens a page; a rating and comment are kept once; a low one emails the office; the office sees it', async () => {
    await put(owner, '/api/visit-reports/settings', { alertBelow: 3 })
    const v = await visit()
    await done(v.job.id)
    await sendVisitReport(t.db, deps(), companyId, v.job.id, { tools: true, survey: true })
    const rep = await reportOf(v.job.id)
    const token = feedbackToken(companyId, rep.id)
    expect(readFeedbackToken(token)).toEqual({ companyId, reportId: rep.id })
    expect(readFeedbackToken(token + 'x')).toBeNull()
    expect(readFeedbackToken(feedbackToken(companyId, rep.id, Date.now() - 61 * 86_400_000))).toBeNull()

    const page = await t.call(`/api/visit-feedback/${token}?r=2`)
    expect(page.status).toBe(200)
    const html = await page.text()
    expect(html).toContain('How did we do?')
    expect(html).toContain('value="2" checked')
    expect((await t.call('/api/visit-feedback/not-a-token')).status).toBe(404)

    const bad = await t.call(`/api/visit-feedback/${token}`, { method: 'POST', body: new URLSearchParams({ rating: '9' }), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })
    expect(bad.status).toBe(400)
    mails.length = 0
    const res = await t.call(`/api/visit-feedback/${token}`, { method: 'POST', body: new URLSearchParams({ rating: '2', comment: 'Missed the <back> yard' }), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('2 of 5')
    const after = await reportOf(v.job.id)
    expect(after.rating).toBe(2)
    expect(after.ratingComment).toBe('Missed the <back> yard')
    expect(mails.length).toBeGreaterThan(0)
    expect(mails[0].subject).toMatch(/rated a visit 2 of 5/)
    expect(mails[0].html).toContain('Missed the &lt;back&gt; yard')

    // A second answer keeps the first.
    const again = await t.call(`/api/visit-feedback/${token}`, { method: 'POST', body: new URLSearchParams({ rating: '5' }), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })
    expect(await again.text()).toContain('already have your answer')
    expect((await reportOf(v.job.id)).rating).toBe(2)

    const one = await (await as(owner, `/api/visit-reports/job/${v.job.id}`)).json()
    expect(one.rating).toBe(2)
    const list = await (await as(owner, '/api/visit-reports')).json()
    expect(list.data.find((x: any) => x.jobId === v.job.id)?.rating).toBe(2)
  })

  test('a good rating emails nobody; with visit_survey off the link is dead and the message carries no link', async () => {
    const v = await visit()
    await done(v.job.id)
    await sendVisitReport(t.db, deps(), companyId, v.job.id, { tools: true, survey: true })
    const rep = await reportOf(v.job.id)
    mails.length = 0
    const res = await t.call(`/api/visit-feedback/${feedbackToken(companyId, rep.id)}`, { method: 'POST', body: new URLSearchParams({ rating: '5' }), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })
    expect(res.status).toBe(200)
    expect(mails.length).toBe(0)

    await setFeatures(['visit_message_tools'])
    try {
      expect((await t.call(`/api/visit-feedback/${feedbackToken(companyId, rep.id)}`)).status).toBe(404)
      const w = await visit()
      await done(w.job.id)
      await put(owner, '/api/visit-reports/settings', { text: null })
      await sendVisitReport(t.db, deps(), companyId, w.job.id, { tools: true, survey: false })
      expect((await reportOf(w.job.id)).messageText).not.toContain('visit-feedback')
    } finally { await setFeatures(['visit_message_tools', 'visit_survey']) }
  })

  test('both switches are hidden (not ready) and landscaping only', () => {
    for (const id of ['visit_message_tools', 'visit_survey']) {
      const f = FEATURE_REGISTRY.find((x: any) => x.id === id) as any
      expect(f?.hidden).toBeFalsy()
      expect(f?.templates).toEqual(['crm-landscaping'])
    }
  })
})
