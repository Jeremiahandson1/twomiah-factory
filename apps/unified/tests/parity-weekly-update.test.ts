// Parity tier 2 #9 (11/10): the weekly client update — one email a week to each client listing what is new in their portal
// (Buildertrend's client updates). Through the real server, contractor and roofing:
//   · on the chosen day and hour (the company's clock) each client with something new shared that week gets ONE email, by
//     project or job; nothing shared, not shared, older than the week, no portal, no email or unsubscribed: nothing; an old item
//     SHARED this week is news (its shared_at), and switching sharing on stamps it;
//   · later passes the same week send nothing again;
//   · the button records the first opening and goes on to the portal; the office sees each send and whether it was opened;
//   · the "like or reply" page: opening it records nothing; the client likes it (once) and writes back; both are on the client's
//     activity and beside the send in the office;
//   · settings: owner/admin change them; switched off, closed.
import { test, expect, beforeAll, describe } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { openToken } from '../server/crm/clientUpdates/weeklyUpdate.ts'

// Friday 13 Nov 2026, 5pm in Chicago (23:00Z) — the update is set for Fridays from 4pm.
const FRI_5PM = new Date('2026-11-13T23:00:00Z')
const FRI_3PM = new Date('2026-11-13T21:00:00Z')
const THU_5PM = new Date('2026-11-12T23:00:00Z')
const daysBefore = (n: number) => new Date(FRI_5PM.getTime() - n * 86_400_000)

const boot = async (vertical: string, features: string[]) => {
  process.env.FRONTEND_URL = 'https://crm.builder.example'
  const t = await bootTenant({ vertical })
  const s = await seedOwner(t)
  const companyId = s.company.id
  await t.db.update(t.schema.company).set({ timezone: 'America/Chicago', enabledFeatures: features } as any).where(eq(t.schema.company.id, companyId))
  t.services.features.forgetFeatures()
  const mails: any[] = []
  ;(t.services.crm.emailService as any).sendRaw = async (m: any) => { mails.push(m); return { success: true } }
  const owner = (await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } })).json() as any).accessToken
  const call = (p: string, init: any = {}) => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${owner}` } })
  const ins = async (table: any, values: any) => ((await t.db.insert(table).values(values).returning()) as any[])[0]
  const client = (name: string, extra: any = {}) => ins(t.schema.contact, { companyId, name, type: 'client', email: `${name.split(' ')[0].toLowerCase()}@home.example`, portalEnabled: true, portalToken: `tok-${name.split(' ')[0].toLowerCase()}-0123456789abcdef`, ...extra })
  const pass = (now: Date) => (t.services.crm as any).weeklyUpdates.runOnce(now)
  return { t, companyId, ownerId: s.owner.id as string, mails, call, ins, client, pass }
}

describe('contractor: projects', () => {
  let b: Awaited<ReturnType<typeof boot>>
  beforeAll(async () => {
    b = await boot('contractor', ['contacts', 'projects', 'daily_logs', 'documents', 'client_portal', 'client_portal_plus', 'weekly_client_update'])
  }, 120_000)

  test('settings: off until switched on; the owner sets the day and hour', async () => {
    const r = await (await b.call('/api/weekly-update')).json() as any
    expect(r.settings).toEqual({ enabled: false, weekday: 5, hour: 16 })
    expect((await b.call('/api/weekly-update/settings', { method: 'PUT', json: { enabled: true, weekday: 9, hour: 16 } })).status).toBe(400)
    const s = await (await b.call('/api/weekly-update/settings', { method: 'PUT', json: { enabled: true, weekday: 5, hour: 16 } })).json() as any
    expect(s.settings).toEqual({ enabled: true, weekday: 5, hour: 16 })
  })

  test("on the day and hour, each client with something new gets one email; nobody else; never twice", async () => {
    const { t, companyId, ownerId, ins, client, mails, pass } = b
    const pat = await client('Pat Porter')
    const quiet = await client('Quinn Quiet')
    const noPortal = await client('Nora Noportal', { portalEnabled: false })
    const unsub = await client('Una Unsub', { emailOptOut: true })
    const kitchen = await ins(t.schema.project, { companyId, number: 'PRJ-1', name: 'Kitchen remodel', contactId: pat.id })
    const deck = await ins(t.schema.project, { companyId, number: 'PRJ-2', name: 'Back deck', contactId: quiet.id })
    const np = await ins(t.schema.project, { companyId, number: 'PRJ-3', name: 'Garage', contactId: noPortal.id })
    const un = await ins(t.schema.project, { companyId, number: 'PRJ-4', name: 'Porch', contactId: unsub.id })
    for (const [p, days, shared] of [[kitchen, 1, true], [kitchen, 3, true], [kitchen, 2, false], [kitchen, 9, true], [deck, 2, false], [np, 1, true], [un, 1, true]] as const)
      await ins(t.schema.dailyLog, { companyId, userId: ownerId, projectId: p.id, date: daysBefore(days), sharedWithClient: shared, workCompleted: 'Work' })
    // Written three weeks ago, shared yesterday: news this week.
    await ins(t.schema.dailyLog, { companyId, userId: ownerId, projectId: kitchen.id, date: daysBefore(21), sharedWithClient: true, sharedAt: daysBefore(1), workCompleted: 'Framing' })
    // Written yesterday but shared last month (an edit later): not news.
    await ins(t.schema.dailyLog, { companyId, userId: ownerId, projectId: deck.id, date: daysBefore(30), sharedWithClient: true, sharedAt: daysBefore(20), workCompleted: 'Old' })
    await ins(t.schema.document, { companyId, projectId: kitchen.id, name: 'tile.jpg', filename: 'tile.jpg', originalName: 'tile.jpg', path: 'x', url: 'x', mimeType: 'image/jpeg', sharedWithCustomer: true, createdAt: daysBefore(1) })
    await ins(t.schema.document, { companyId, projectId: kitchen.id, name: 'plan.pdf', filename: 'plan.pdf', originalName: 'plan.pdf', path: 'y', url: 'y', mimeType: 'application/pdf', sharedWithCustomer: true, createdAt: daysBefore(2) })

    expect(await pass(THU_5PM)).toBe(0)
    expect(await pass(FRI_3PM)).toBe(0)
    expect(await pass(FRI_5PM)).toBe(1)
    expect(mails.length).toBe(1)
    expect(mails[0].to).toBe('pat@home.example')
    expect(mails[0].subject).toContain('Your week with')
    expect(mails[0].html).toContain('<strong>Kitchen remodel</strong>: 3 daily logs, 1 photo, 1 file')
    expect(mails[0].html).toContain('https://crm.builder.example/api/weekly-update/react/')
    expect(mails[0].html).toContain('https://crm.builder.example/api/weekly-update/open/')
    expect(await pass(new Date(FRI_5PM.getTime() + 3_600_000))).toBe(0)
  })

  test('the button records the first opening and goes to the portal; the office sees it', async () => {
    const { t, call, mails } = b
    const link = /href="(https:\/\/crm\.builder\.example\/api\/weekly-update\/open\/[^"]+)"/.exec(mails[0].html)![1]
    const token = link.split('/').pop()!
    const r = await t.call(`/api/weekly-update/open/${token}`, { redirect: 'manual' } as any)
    expect(r.status).toBe(302)
    expect(r.headers.get('location')).toBe('https://crm.builder.example/portal/tok-pat-0123456789abcdef')
    expect((await t.call(`/api/weekly-update/open/${token.slice(0, -2)}zz`)).status).toBe(404)
    const sent = (await (await call('/api/weekly-update')).json() as any).sent
    expect(sent.length).toBe(1)
    expect(sent[0]).toMatchObject({ client: 'Pat Porter', sentTo: 'pat@home.example', status: 'sent' })
    expect(sent[0].openedAt).toBeTruthy()
    expect(openToken(sent[0].id)).toBe(token)
  })

  test('the like-or-reply page: opening records nothing; a like (once) and a reply, on the activity and in the office', async () => {
    const { t, companyId, call, mails } = b
    const link = /href="https:\/\/crm\.builder\.example(\/api\/weekly-update\/react\/[^"]+)"/.exec(mails[0].html)![1]
    const page = await t.call(link)
    expect(page.status).toBe(200)
    expect(await page.text()).toContain('Like this update')
    const office = async () => (await (await call('/api/weekly-update')).json() as any).sent[0]
    expect((await office()).likedAt).toBeNull()
    const form = (body: Record<string, string>) => t.call(link, { method: 'POST', body: new URLSearchParams(body).toString(), headers: { 'content-type': 'application/x-www-form-urlencoded' } } as any)
    const liked = await form({ like: '1' })
    expect(liked.status).toBe(200)
    expect(await liked.text()).toContain('You liked this update.')
    await form({ like: '1' })
    expect((await form({ reply: '   ' })).status).toBe(400)
    expect((await form({ reply: 'Looks great — can we add a pantry light?' })).status).toBe(200)
    const sent = await office()
    expect(sent.likedAt).toBeTruthy()
    expect(sent.replies.map((r: any) => r.body)).toEqual(['Looks great — can we add a pantry light?'])
    const acts = await (t.db as any).select().from(t.schema.activity).where(eq(t.schema.activity.companyId, companyId))
    expect(acts.filter((a: any) => a.action === 'weekly_update_liked').length).toBe(1)
    expect(acts.find((a: any) => a.action === 'weekly_update_reply').description).toContain('pantry light')
    expect((await t.call(`${link.slice(0, -2)}zz`)).status).toBe(404)
  })

  test('switching sharing on stamps when; switching it on again later does not move it', async () => {
    const { t, companyId, ownerId, ins, call } = b
    const [kitchen] = await (t.db as any).select().from(t.schema.project).where(eq(t.schema.project.name, 'Kitchen remodel'))
    const log = await ins(t.schema.dailyLog, { companyId, userId: ownerId, projectId: kitchen.id, date: daysBefore(40), sharedWithClient: false, workCompleted: 'Demo' })
    expect((await call(`/api/client-portal/daily-logs/${log.id}/share`, { method: 'PUT', json: { shared: true } })).status).toBe(200)
    const [a] = await (t.db as any).select().from(t.schema.dailyLog).where(eq(t.schema.dailyLog.id, log.id))
    expect(a.sharedAt).toBeTruthy()
    await call(`/api/client-portal/daily-logs/${log.id}/share`, { method: 'PUT', json: { shared: true } })
    const [b2] = await (t.db as any).select().from(t.schema.dailyLog).where(eq(t.schema.dailyLog.id, log.id))
    expect(new Date(b2.sharedAt).getTime()).toBe(new Date(a.sharedAt).getTime())
  })

  test('switched off: the settings are closed and nothing goes', async () => {
    const { t, companyId, call, pass } = b
    await t.db.update(t.schema.company).set({ enabledFeatures: ['contacts', 'projects', 'client_portal', 'client_portal_plus'] } as any).where(eq(t.schema.company.id, companyId))
    t.services.features.forgetFeatures()
    expect([403, 404]).toContain((await call('/api/weekly-update')).status)
    expect(await pass(new Date(FRI_5PM.getTime() + 7 * 86_400_000))).toBe(0)
  })
})

describe('roofing: jobs', () => {
  test("a homeowner's week: shared photos, documents and the roofer's posts on their job", async () => {
    const b = await boot('roofing', ['contacts', 'jobs', 'portal_job_files', 'portal_posts_packets', 'weekly_client_update'])
    const { t, companyId, ins, client, mails, pass, call } = b
    await call('/api/weekly-update/settings', { method: 'PUT', json: { enabled: true, weekday: 5, hour: 16 } })
    const hal = await client('Hal Homeowner')
    const j = await ins(t.schema.job, { companyId, number: 'ROOF-0001', title: 'Roof replacement', contactId: hal.id })
    await ins(t.schema.jobPhoto, { companyId, jobId: j.id, url: 'a', takenAt: daysBefore(1), sharedWithCustomer: true })
    await ins(t.schema.jobPhoto, { companyId, jobId: j.id, url: 'b', takenAt: daysBefore(1), sharedWithCustomer: false })
    // Taken last month, shared this week: news.
    await ins(t.schema.jobPhoto, { companyId, jobId: j.id, url: 'c', takenAt: daysBefore(30), sharedWithCustomer: true, sharedAt: daysBefore(2) })
    await ins(t.schema.document, { companyId, jobId: j.id, name: 'contract.pdf', filename: 'contract.pdf', originalName: 'contract.pdf', path: 'z', url: 'z', mimeType: 'application/pdf', sharedWithCustomer: true, createdAt: daysBefore(2) })
    await ins(t.schema.roofJobPost, { companyId, jobId: j.id, body: 'Shingles arrive Monday', fromHomeowner: false, createdAt: daysBefore(1) })
    await ins(t.schema.roofJobPost, { companyId, jobId: j.id, body: 'Thanks!', fromHomeowner: true, createdAt: daysBefore(1) })
    expect(await pass(FRI_5PM)).toBe(1)
    expect(mails[0].html).toContain('<strong>Roof replacement</strong>: 2 photos, 1 file, 1 message')
    // The office's share switch stamps when.
    const old = await ins(t.schema.jobPhoto, { companyId, jobId: j.id, url: 'd', takenAt: daysBefore(60), sharedWithCustomer: false })
    expect((await call(`/api/job-files/photos/${old.id}`, { method: 'PUT', json: { shared: true } })).status).toBe(200)
    const [p] = await (t.db as any).select().from(t.schema.jobPhoto).where(eq(t.schema.jobPhoto.id, old.id))
    expect(p.sharedAt).toBeTruthy()
  }, 120_000)
})
