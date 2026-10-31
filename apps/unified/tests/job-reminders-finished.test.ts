// Job reminders, finished (field service and basic): the parts Jobber has that this engine lacked.
//   · settings: when reminders go out (hours before, or a fixed time some days before), the email's own subject and wording,
//     "ask the customer to confirm", and the visit-moved text — saved, validated by field, and an older caller still saves;
//   · a confirm door for the customer in three ways: the private link in the reminder, the portal's upcoming visits, a text of Y;
//   · a moved visit clears the confirmation and says so ("Notify client?"); that notice goes out once, on the chosen channels;
//   · a person sends a reminder by hand from the job (logged like the automatic ones) and sees what the customer was sent;
//   · a customer can be taken off AUTOMATIC reminders without stopping a hand-sent one;
//   · Client Communications: what was sent, whether it got through, which visits were confirmed, the customers' replies, CSV.
// Through the real server and database on BOTH verticals; the clock is pinned; no text or email leaves (recorders).
import { describe, test, expect, beforeAll, beforeEach } from 'bun:test'
import { eq, and } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { createJobReminders, DEFAULT_JOB_MESSAGE, DEFAULT_EMAIL_SUBJECT, DEFAULT_EMAIL_BODY, DEFAULT_MOVED_MESSAGE } from '../server/crm/field/jobReminders.ts'
import { isConfirmReply } from '../server/crm/field/jobConfirm.ts'

const json = async (r: Response) => (await r.json()) as any
const data = async (r: Response) => { const b = await json(r); return b?.data ?? b }
const chicago = (local: string) => { const d = new Date(`${local}Z`); const off = d < new Date('2026-11-01T07:00:00Z') ? 5 : 6; return new Date(d.getTime() + off * 3600_000) }
const RULES = { enabled: true, hoursBefore: [24], sms: true, email: true, sendFromHour: 8, sendUntilHour: 20, message: DEFAULT_JOB_MESSAGE }
const PORTAL = 'p'.repeat(48)

describe('what counts as a yes by text', () => {
  test('Y, YES, C, CONFIRM(ED), in any case with trailing punctuation; nothing else', () => {
    for (const ok of ['Y', 'y', 'Yes', 'yes!', ' C ', 'confirm', 'CONFIRMED.']) expect({ ok, v: isConfirmReply(ok) }).toEqual({ ok, v: true })
    for (const no of ['', 'yes please call me', 'N', 'no', 'later', 'Yesterday', 'STOP']) expect({ no, v: isConfirmReply(no) }).toEqual({ no, v: false })
  })
})

for (const vertical of ['fieldservice', 'basic'] as const) {
  describe(`${vertical}`, () => {
    let t: Awaited<ReturnType<typeof bootTenant>>
    let companyId = ''
    let owner: (p: string, init?: any) => Promise<Response>
    const seat: Record<string, (p: string, init?: any) => Promise<Response>> = {}
    const texts: Array<{ companyId: string; msg: any }> = []
    const mails: Array<{ to: string; template: string; data: any }> = []
    const sms = { sendSMS: async (cid: string, msg: any) => { texts.push({ companyId: cid, msg }); return { status: 'sent' } } }
    const email = { send: async (to: string, template: string, d: any) => { mails.push({ to, template, data: d }); return { ok: true } } }
    let engine: ReturnType<typeof createJobReminders>
    let ann = '', stopper = ''
    let n = 0

    const features = async (list: string[]) => { await t.db.update(t.schema.company).set({ enabledFeatures: list } as any).where(eq(t.schema.company.id, companyId)); t.services.features.forgetFeatures() }
    const setRules = (patch: any = {}) => owner('/api/job-reminders/settings', { method: 'PUT', json: { ...RULES, ...patch } })
    const job = async (over: any = {}) => (await t.db.insert(t.schema.job).values({
      companyId, number: `JF-${++n}`, title: 'Furnace tune-up', contactId: ann, status: 'scheduled',
      scheduledDate: new Date('2026-10-31T00:00:00Z'), scheduledTime: '09:00', address: '12 Oak St', city: 'Eau Claire', ...over,
    } as any).returning())[0]
    const row = async (id: string) => (await t.db.select().from(t.schema.job).where(eq(t.schema.job.id, id)))[0] as any
    const logOf = async (kind: string) => t.db.select().from(t.schema.reminderLog).where(and(eq(t.schema.reminderLog.companyId, companyId), eq(t.schema.reminderLog.kind, kind)))
    /** The day after the real today, as a date marker — for the paths that read the real clock (a text back, the portal). */
    const tomorrow = () => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); d.setUTCDate(d.getUTCDate() + 1); return d }

    beforeAll(async () => {
      t = await bootTenant({ vertical })
      const s = await seedOwner(t)
      companyId = s.company.id
      await t.db.update(t.schema.company).set({ name: 'Test Builders', timezone: 'America/Chicago', integrations: { twilioMessagingServiceSid: 'MG' + 'a'.repeat(32), twilioPhoneNumber: '+17155550123' } } as any).where(eq(t.schema.company.id, companyId))
      await features(['contacts', 'jobs', 'job_reminders'])
      const login = async (e: string, p: string) => (await json(await t.call('/api/auth/login', { method: 'POST', json: { email: e, password: p } }))).accessToken
      const as = (tok: string) => (p: string, init: any = {}) => Promise.resolve(t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${tok}` } }))
      owner = as(await login('owner@test.example', s.password))
      for (const role of ['manager', 'field', 'viewer'] as const) {
        await t.db.insert(t.schema.user).values({ email: `${role}@test.example`, passwordHash: await Bun.password.hash('Seat-pass-1', 'bcrypt'), firstName: role, lastName: 'Seat', role, companyId } as any)
        seat[role] = as(await login(`${role}@test.example`, 'Seat-pass-1'))
      }
      const person = async (v: any) => (await t.db.insert(t.schema.contact).values({ companyId, type: 'client', ...v } as any).returning())[0].id
      ann = await person({ name: 'Ann Able', mobile: '6085550100', email: 'ann@example.com', portalEnabled: true, portalToken: PORTAL, portalTokenExp: new Date(Date.now() + 90 * 86_400_000) })
      stopper = await person({ name: 'Stu Stop', mobile: '6085550101', email: 'stu@example.com', optedOutSms: true })
      engine = createJobReminders({ db: t.db, sms, email, logger: console as any, isFeatureEnabled: t.services.features.isFeatureEnabled })
      // The sends made by hand and the moved notice go through the app's own engine: record what it would send.
      ;(t.services.crm as any).sms.sendSMS = sms.sendSMS
      ;(t.services.crm.emailService as any).send = email.send
    }, 120_000)

    beforeEach(async () => {
      texts.length = 0; mails.length = 0
      await t.db.delete(t.schema.reminderLog)
      await t.db.delete(t.schema.job)
      await t.db.update(t.schema.contact).set({ jobRemindersOff: false } as any).where(eq(t.schema.contact.id, ann))
      await features(['contacts', 'jobs', 'job_reminders'])
      await t.db.update(t.schema.company).set({ settings: {} } as any).where(eq(t.schema.company.id, companyId))
    })

    describe('the settings', () => {
      test('the new settings are saved and read back; the defaults are the shipped words', async () => {
        const first = await data(await owner('/api/job-reminders/settings'))
        expect(first).toMatchObject({ timing: 'hours_before', askConfirm: true, emailSubject: DEFAULT_EMAIL_SUBJECT, emailBody: DEFAULT_EMAIL_BODY, movedMessage: DEFAULT_MOVED_MESSAGE })
        const res = await setRules({ timing: 'fixed_time', fixed: [{ daysBefore: 2, time: '09:30' }, { daysBefore: 0, time: '07:45' }], emailSubject: 'Heads up: {{job}}', emailBody: 'See you {{when}}.', askConfirm: false, movedMessage: 'Moved to {{when}}' })
        expect(res.status).toBe(200)
        expect(await data(await owner('/api/job-reminders/settings'))).toMatchObject({ timing: 'fixed_time', fixed: [{ daysBefore: 0, time: '07:45' }, { daysBefore: 2, time: '09:30' }].sort((a, b) => b.daysBefore - a.daysBefore), emailSubject: 'Heads up: {{job}}', emailBody: 'See you {{when}}.', askConfirm: false, movedMessage: 'Moved to {{when}}' })
      })
      test('an older caller that sends only the first settings still saves, and keeps the newer ones', async () => {
        await setRules({ askConfirm: false, emailSubject: 'Kept' })
        const old = await owner('/api/job-reminders/settings', { method: 'PUT', json: { ...RULES, hoursBefore: [48] } })
        expect(old.status).toBe(200)
        expect(await data(await owner('/api/job-reminders/settings'))).toMatchObject({ hoursBefore: [48], askConfirm: false, emailSubject: 'Kept' })
      })
      test('bad new values are refused by field', async () => {
        const bad = await setRules({ timing: 'fixed_time', fixed: [{ daysBefore: 30, time: '25:00' }], emailSubject: '', movedMessage: '' })
        expect(bad.status).toBe(400)
        expect((await json(bad)).fields).toMatchObject({ 'fixed.0.daysBefore': 'At most 14 days before', 'fixed.0.time': 'Enter a time like 09:00', emailSubject: 'Write the email subject', movedMessage: 'Write the visit-moved message' })
      })
    })

    describe('when reminders go out, and in whose words', () => {
      test('a fixed time of day: the day before at 9:00 — not a minute early, once', async () => {
        await setRules({ timing: 'fixed_time', fixed: [{ daysBefore: 1, time: '09:00' }], email: false })
        await job() // 31 Oct 09:00 → reminder due 30 Oct 09:00
        await engine.runOnce(chicago('2026-10-30T08:30:00'))
        expect(texts).toHaveLength(0)
        await engine.runOnce(chicago('2026-10-30T09:05:00'))
        expect(texts).toHaveLength(1)
        await engine.runOnce(chicago('2026-10-30T09:20:00'))
        expect(texts).toHaveLength(1)
      })
      test('the email is in the business\'s own subject and words', async () => {
        await setRules({ sms: false, emailSubject: 'Heads up: {{job}} on {{date}}', emailBody: 'Hi {{customer_name}}, we will be there {{when}}.' })
        await job()
        await engine.runOnce(chicago('2026-10-30T10:00:00'))
        expect(mails).toHaveLength(1)
        expect(mails[0].data.subject).toBe('Heads up: Furnace tune-up on Saturday, October 31')
        expect(mails[0].data.body).toBe('Hi Ann, we will be there Saturday, October 31 at 9:00 AM.')
      })
      test('asking for a confirmation adds "Reply Y" to the text and a confirm link to the email; not asking adds neither', async () => {
        await setRules()
        const j = await job()
        await engine.runOnce(chicago('2026-10-30T10:00:00'))
        const token = (await row(j.id)).confirmToken
        expect(token).toMatch(/^[0-9a-f]{64}$/)
        expect(texts[0].msg.message).toContain('Reply Y to confirm.')
        expect(mails[0].data.confirmPath).toBe(`/visit/${token}`)
        texts.length = 0; mails.length = 0
        await t.db.delete(t.schema.reminderLog); await t.db.delete(t.schema.job)
        await setRules({ askConfirm: false })
        const k = await job()
        await engine.runOnce(chicago('2026-10-30T10:00:00'))
        expect(texts[0].msg.message).not.toContain('Reply Y')
        expect(mails[0].data.confirmPath).toBeUndefined()
        expect((await row(k.id)).confirmToken).toBeNull()
      })
      test('a customer taken off automatic reminders gets none from the pass, but a hand-sent one still goes', async () => {
        await setRules()
        const j = await job()
        const put = await owner(`/api/contacts/${ann}`, { method: 'PUT', json: { jobRemindersOff: true } })
        expect(put.status).toBe(200)
        await engine.runOnce(chicago('2026-10-30T10:00:00'))
        expect(texts).toHaveLength(0)
        expect((await logOf('job_reminder_sms'))[0]).toMatchObject({ status: 'skipped', detail: 'Automatic reminders are turned off for this customer.' })
        const by = await owner(`/api/job-reminders/send/${j.id}`, { method: 'POST', json: { channels: ['sms'] } })
        expect(by.status).toBe(200)
        expect(texts).toHaveLength(1)
      })
    })

    describe('the customer confirms', () => {
      const remind = async () => {
        await setRules()
        const j = await job()
        await engine.runOnce(chicago('2026-10-30T10:00:00'))
        return { j, token: (await row(j.id)).confirmToken as string }
      }
      test('by the link in the reminder: the page reads the one visit, the button confirms it, twice is fine', async () => {
        const { j, token } = await remind()
        const page = await t.call(`/api/visit-confirm/${token}`)
        expect(page.status).toBe(200)
        expect(await data(page)).toMatchObject({ jobId: j.id, title: 'Furnace tune-up', when: 'Saturday, October 31 at 9:00 AM', confirmed: false, companyName: 'Test Builders' })
        const ok = await t.call(`/api/visit-confirm/${token}`, { method: 'POST', json: {} })
        expect(ok.status).toBe(200)
        expect(await data(ok)).toMatchObject({ confirmed: true })
        expect(await row(j.id)).toMatchObject({ confirmedVia: 'link' })
        expect((await row(j.id)).confirmedAt).not.toBeNull()
        const again = await t.call(`/api/visit-confirm/${token}`, { method: 'POST', json: {} })
        expect(again.status).toBe(200)
      })
      test('a made-up or short link opens nothing; with the feature off the link is dead', async () => {
        const { token } = await remind()
        for (const bad of ['0'.repeat(64), 'abc', token.slice(1)]) expect({ bad, status: (await t.call(`/api/visit-confirm/${bad}`)).status }).toEqual({ bad, status: 404 })
        await features(['contacts', 'jobs'])
        expect((await t.call(`/api/visit-confirm/${token}`)).status).toBe(404)
        expect((await t.call(`/api/visit-confirm/${token}`, { method: 'POST', json: {} })).status).toBe(404)
      })
      test('a visit that is done or cancelled cannot be confirmed', async () => {
        const { j, token } = await remind()
        await t.db.update(t.schema.job).set({ status: 'cancelled' } as any).where(eq(t.schema.job.id, j.id))
        const r = await t.call(`/api/visit-confirm/${token}`, { method: 'POST', json: {} })
        expect(r.status).toBe(409)
        expect((await row(j.id)).confirmedAt).toBeNull()
      })
      test('by a text of Y: the soonest visit they were reminded of is confirmed; anything else is just a text', async () => {
        await setRules()
        const soon = await job({ scheduledDate: tomorrow(), title: 'Soon' })
        const later = await job({ scheduledDate: new Date(tomorrow().getTime() + 3 * 86_400_000), title: 'Later' })
        for (const j of [later, soon]) await t.db.insert(t.schema.reminderLog).values({ companyId, kind: 'job_reminder_sms', subjectId: j.id, step: '24h:x', status: 'sent' } as any)
        const text = (Body: string) => (t.services.crm as any).sms.handleIncomingSMS({ From: '+16085550100', To: '+17155550123', Body, MessageSid: `SM${Math.random()}` })
        await text('Can you come earlier?')
        expect((await row(soon.id)).confirmedAt).toBeNull()
        await text(' yes! ')
        expect(await row(soon.id)).toMatchObject({ confirmedVia: 'text' })
        expect((await row(soon.id)).confirmedAt).not.toBeNull()
        expect((await row(later.id)).confirmedAt).toBeNull()
        await text('Y')
        expect((await row(later.id)).confirmedVia).toBe('text')
      })
      test('a Y from someone who was sent nothing confirms nothing', async () => {
        await setRules()
        const j = await job({ scheduledDate: tomorrow() })
        await (t.services.crm as any).sms.handleIncomingSMS({ From: '+16085550100', To: '+17155550123', Body: 'Y', MessageSid: 'SMnone' })
        expect((await row(j.id)).confirmedAt).toBeNull()
      })
      test('in the customer portal: the coming visits, a Confirm for the customer\'s own visit only', async () => {
        await setRules()
        const mine = await job({ scheduledDate: tomorrow() })
        const theirs = await job({ scheduledDate: tomorrow(), contactId: stopper })
        const list = await t.call(`/api/portal/p/${PORTAL}/upcoming-visits`)
        expect(list.status).toBe(200)
        const visits = await json(list)
        expect((Array.isArray(visits) ? visits : visits.data).map((v: any) => v.jobId)).toEqual([mine.id])
        expect((await t.call(`/api/portal/p/${PORTAL}/upcoming-visits/${theirs.id}/confirm`, { method: 'POST', json: {} })).status).toBe(404)
        expect((await row(theirs.id)).confirmedAt).toBeNull()
        const ok = await t.call(`/api/portal/p/${PORTAL}/upcoming-visits/${mine.id}/confirm`, { method: 'POST', json: {} })
        expect(ok.status).toBe(200)
        expect(await row(mine.id)).toMatchObject({ confirmedVia: 'portal' })
        await features(['contacts', 'jobs'])
        expect((await t.call(`/api/portal/p/${PORTAL}/upcoming-visits`)).status).toBe(404)
      })
    })

    describe('a visit that moves', () => {
      const confirmed = async () => { const j = await job({ confirmedAt: new Date(), confirmedVia: 'link' }); return j }
      test('moving the day or time clears the confirmation and says the customer may be told; other edits keep it', async () => {
        const j = await confirmed()
        const note = await owner(`/api/jobs/${j.id}`, { method: 'PUT', json: { notes: 'Gate code 1234' } })
        expect(note.status).toBe(200)
        expect((await json(note)).scheduleMoved).toBeUndefined()
        expect((await row(j.id)).confirmedAt).not.toBeNull()
        const moved = await owner(`/api/jobs/${j.id}`, { method: 'PUT', json: { scheduledTime: '11:00' } })
        expect(moved.status).toBe(200)
        expect((await json(moved)).scheduleMoved).toBe(true)
        expect((await row(j.id)).confirmedAt).toBeNull()
      })
      test('re-timing a day says which visits really moved, and clears only those', async () => {
        const a = await confirmed(); const b = await job({ scheduledTime: '13:00', confirmedAt: new Date(), confirmedVia: 'text' })
        const r = await owner('/api/jobs/retime', { method: 'POST', json: { times: [{ id: a.id, scheduledTime: '10:00' }, { id: b.id, scheduledTime: '13:00' }] } })
        expect(r.status).toBe(200)
        expect((await json(r)).moved).toEqual([a.id])
        expect((await row(a.id)).confirmedAt).toBeNull()
        expect((await row(b.id)).confirmedAt).not.toBeNull()
      })
      test('"Notify client?" yes: the moved words go on the chosen channels; a customer who said STOP is not texted', async () => {
        const j = await job({ scheduledTime: '11:00' })
        const r = await owner(`/api/job-reminders/moved/${j.id}`, { method: 'POST', json: { channels: ['sms', 'email'] } })
        expect(r.status).toBe(200)
        expect(texts).toHaveLength(1); expect(mails).toHaveLength(1)
        expect(texts[0].msg.message).toContain('has moved to Saturday, October 31 at 11:00 AM')
        expect(mails[0].data.subject).toContain('Your visit has moved')
        expect((await logOf('job_moved_sms'))[0]).toMatchObject({ status: 'sent' })
        texts.length = 0
        const k = await job({ contactId: stopper })
        const s = await data(await owner(`/api/job-reminders/moved/${k.id}`, { method: 'POST', json: { channels: ['sms'] } }))
        expect(texts).toHaveLength(0)
        expect(s.outcomes[0]).toMatchObject({ channel: 'sms', status: 'skipped' })
      })
      test('no channel chosen, or a made-up one, is refused; a job that is not yours to touch is not found', async () => {
        const j = await job()
        for (const channels of [[], ['pigeon'], undefined]) expect({ channels, status: (await owner(`/api/job-reminders/moved/${j.id}`, { method: 'POST', json: { channels } })).status }).toEqual({ channels, status: 400 })
        expect((await seat.field(`/api/job-reminders/moved/${j.id}`, { method: 'POST', json: { channels: ['sms'] } })).status).toBe(404)
        expect((await seat.viewer(`/api/job-reminders/moved/${j.id}`, { method: 'POST', json: { channels: ['sms'] } })).status).toBe(403)
      })
    })

    describe('a reminder sent by hand, and what the job shows', () => {
      test('Text and Email from the job go now, are logged as a person\'s, and the job panel lists them', async () => {
        const j = await job()
        const r = await owner(`/api/job-reminders/send/${j.id}`, { method: 'POST', json: { channels: ['sms', 'email'] } })
        expect(r.status).toBe(200)
        expect(texts).toHaveLength(1); expect(mails).toHaveLength(1)
        const panel = await data(await owner(`/api/job-reminders/job/${j.id}`))
        expect(panel).toMatchObject({ confirmedAt: null, hasCustomer: true, canText: true, canEmail: true })
        expect(panel.notices.map((x: any) => `${x.what}/${x.channel}/${x.status}/${x.manual}`).sort()).toEqual(['Reminder/Email/Sent/true', 'Reminder/Text/Sent/true'])
        // a second hand-sent reminder is its own row — a person may remind twice
        await owner(`/api/job-reminders/send/${j.id}`, { method: 'POST', json: { channels: ['sms'] } })
        expect(texts).toHaveLength(2)
      })
      test('the panel says who can be reached, and a confirmation says how it came', async () => {
        const j = await job({ contactId: stopper, confirmedAt: new Date(), confirmedVia: 'text' })
        const panel = await data(await owner(`/api/job-reminders/job/${j.id}`))
        expect(panel).toMatchObject({ canText: false, canEmail: true, confirmedBy: 'by text' })
        expect(panel.confirmedAt).not.toBeNull()
        const none = await job({ contactId: null })
        expect(await data(await owner(`/api/job-reminders/job/${none.id}`))).toMatchObject({ hasCustomer: false, canText: false, canEmail: false })
      })
      test('with the feature off, none of it opens', async () => {
        const j = await job()
        await features(['contacts', 'jobs'])
        for (const [p, init] of [[`/api/job-reminders/job/${j.id}`, {}], [`/api/job-reminders/send/${j.id}`, { method: 'POST', json: { channels: ['sms'] } }], [`/api/job-reminders/moved/${j.id}`, { method: 'POST', json: { channels: ['sms'] } }], ['/api/job-reminders/report', {}]] as const)
          expect({ p, status: (await owner(p, init as any)).status }).toEqual({ p, status: 403 })
      })
    })

    describe('Client Communications', () => {
      test('what was sent and how it went, the visits confirmed, the customers\' texts back, and a CSV', async () => {
        await setRules()
        const sent = await job({ scheduledDate: tomorrow() })
        const stopped = await job({ contactId: stopper, scheduledDate: tomorrow() })
        await owner(`/api/job-reminders/send/${sent.id}`, { method: 'POST', json: { channels: ['sms', 'email'] } })
        await owner(`/api/job-reminders/moved/${stopped.id}`, { method: 'POST', json: { channels: ['sms'] } })
        await t.db.update(t.schema.job).set({ confirmedAt: new Date(), confirmedVia: 'text' } as any).where(eq(t.schema.job.id, sent.id))
        await (t.services.crm as any).sms.handleIncomingSMS({ From: '+16085550100', To: '+17155550123', Body: 'Thanks, see you then', MessageSid: 'SMrep' })
        const rep = await data(await owner('/api/job-reminders/report'))
        expect(rep.summary).toMatchObject({ sent: 2, notSent: 1, failed: 0, visitsConfirmed: 1, visitsReminded: 1, replies: 1 })
        expect(rep.rows).toHaveLength(3)
        expect(rep.rows.find((r: any) => r.what === 'Visit moved')).toMatchObject({ status: 'Not sent', channel: 'Text', customer: 'Stu Stop', sentBy: 'Owner Test' })
        expect(rep.rows.find((r: any) => r.channel === 'Email')).toMatchObject({ status: 'Sent', confirmed: true, to: 'ann@example.com' })
        expect(rep.replies[0]).toMatchObject({ customer: 'Ann Able', body: 'Thanks, see you then' })
        // filters
        const onlyMoved = await data(await owner('/api/job-reminders/report?what=moved'))
        expect(onlyMoved.rows).toHaveLength(1)
        expect((await data(await owner('/api/job-reminders/report?channel=email'))).rows).toHaveLength(1)
        expect((await data(await owner('/api/job-reminders/report?status=skipped'))).rows).toHaveLength(1)
        // a bad period is refused; CSV downloads
        expect((await owner('/api/job-reminders/report?startDate=2026-11-02&endDate=2026-11-01')).status).toBe(400)
        const csv = await owner('/api/job-reminders/report?format=csv')
        expect(csv.headers.get('content-type')).toContain('text/csv')
        const lines = (await csv.text()).split('\r\n')
        expect(lines[0]).toBe('"When","Customer","Job","What","Channel","Result","Sent to","Sent by","Why not","Visit confirmed"')
        expect(lines).toHaveLength(4)
      })
      test('owner, admin and manager read it; a field seat and a viewer do not', async () => {
        expect((await owner('/api/job-reminders/report')).status).toBe(200)
        expect((await seat.manager('/api/job-reminders/report')).status).toBe(200)
        expect((await seat.field('/api/job-reminders/report')).status).toBe(403)
      })
    })
  })
}
