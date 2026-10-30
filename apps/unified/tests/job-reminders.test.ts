// Automatic reminders for the jobs the office books (server/crm/field/jobReminders.ts). Item 4 of the field-service depth
// brief: the reminder runner was the salon's alone, so a job the office put on the Schedule was never reminded. Through the
// real server and database, on BOTH field service and basic; the clock is pinned (each pass is handed its `now`); no text
// or email leaves — the texting and email services are recorders.
//   · off until the business switches it on, and the feature itself is NOT READY (the owner's Features save cannot turn it on);
//   · on: one text and one email per job and step, once — a second pass sends nothing, a moved visit earns its own;
//   · nothing outside the sending hours; a reminder that came due overnight goes when the hours open;
//   · a customer who texted STOP is never texted, one who unsubscribed is never emailed; no number / address → skipped, logged;
//   · texting refused (not set up, wallet empty) is held and tried again; the email is not repeated;
//   · a job with no time is reminded the day before; only office-booked, scheduled jobs; a later step supersedes an earlier;
//   · the settings door: validated by field, owner/admin only, closed when the feature is off.
import { describe, test, expect, beforeAll, beforeEach } from 'bun:test'
import { eq, and } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { createJobReminders, jobReminderSettings, DEFAULT_JOB_MESSAGE, DEFAULT_JOB_REMINDERS } from '../server/crm/field/jobReminders.ts'

const json = async (r: Response) => (await r.json()) as any
/** A moment on the Chicago clock (CDT until 1 Nov 2026, CST after). */
const chicago = (local: string) => { const d = new Date(`${local}Z`); const off = d < new Date('2026-11-01T07:00:00Z') ? 5 : 6; return new Date(d.getTime() + off * 3600_000) }
const RULES = { enabled: true, hoursBefore: [24], sms: true, email: true, sendFromHour: 8, sendUntilHour: 20, message: DEFAULT_JOB_MESSAGE }

describe('the settings, as the engine reads them', () => {
  test('off by default; every gap filled; bad stored values fall back', () => {
    expect(jobReminderSettings({})).toEqual(DEFAULT_JOB_REMINDERS)
    expect(DEFAULT_JOB_REMINDERS.enabled).toBe(false)
    expect(jobReminderSettings({ jobReminders: { enabled: true, hoursBefore: [24, 48, 72, 24], sendFromHour: 30, sendUntilHour: 3 } }))
      .toMatchObject({ enabled: true, hoursBefore: [72, 48], sendFromHour: 8, sendUntilHour: 20 })
    // A window that ends before it starts is no window: the default hours.
    expect(jobReminderSettings({ jobReminders: { sendFromHour: 22, sendUntilHour: 22 } })).toMatchObject({ sendFromHour: 8, sendUntilHour: 20 })
    expect(jobReminderSettings({ jobReminders: { sendFromHour: 6, sendUntilHour: 18 } })).toMatchObject({ sendFromHour: 6, sendUntilHour: 18 })
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
    let reply: any = { status: 'sent' }
    const sms = { sendSMS: async (cid: string, msg: any) => { texts.push({ companyId: cid, msg }); return typeof reply === 'function' ? reply() : reply } }
    const email = { send: async (to: string, template: string, data: any) => { mails.push({ to, template, data }); return { ok: true } } }
    let engine: ReturnType<typeof createJobReminders>
    let ann = '', stopper = '', unsub = '', nobody = ''
    let n = 0

    const features = async (list: string[]) => { await t.db.update(t.schema.company).set({ enabledFeatures: list } as any).where(eq(t.schema.company.id, companyId)); t.services.features.forgetFeatures() }
    const setRules = (patch: any = {}) => owner('/api/job-reminders/settings', { method: 'PUT', json: { ...RULES, ...patch } })
    /** A job the office booked: a date marker (midnight UTC) and a wall-clock time, like the Schedule writes. */
    const job = async (over: any = {}) => (await t.db.insert(t.schema.job).values({
      companyId, number: `JR-${++n}`, title: 'Furnace tune-up', contactId: ann, status: 'scheduled',
      scheduledDate: new Date('2026-10-31T00:00:00Z'), scheduledTime: '09:00', address: '12 Oak St', city: 'Eau Claire', ...over,
    } as any).returning())[0]
    const logOf = async (kind: string) => t.db.select().from(t.schema.reminderLog).where(and(eq(t.schema.reminderLog.companyId, companyId), eq(t.schema.reminderLog.kind, kind)))

    beforeAll(async () => {
      t = await bootTenant({ vertical })
      const s = await seedOwner(t)
      companyId = s.company.id
      await t.db.update(t.schema.company).set({ name: 'Test Builders', timezone: 'America/Chicago' } as any).where(eq(t.schema.company.id, companyId))
      await features(['contacts', 'jobs', 'job_reminders'])
      const login = async (e: string, p: string) => (await json(await t.call('/api/auth/login', { method: 'POST', json: { email: e, password: p } }))).accessToken
      const as = (tok: string) => (p: string, init: any = {}) => Promise.resolve(t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${tok}` } }))
      owner = as(await login('owner@test.example', s.password))
      for (const role of ['manager', 'field', 'viewer'] as const) {
        await t.db.insert(t.schema.user).values({ email: `${role}@test.example`, passwordHash: await Bun.password.hash('Seat-pass-1', 'bcrypt'), firstName: role, lastName: 'Seat', role, companyId } as any)
        seat[role] = as(await login(`${role}@test.example`, 'Seat-pass-1'))
      }
      const person = async (v: any) => (await t.db.insert(t.schema.contact).values({ companyId, type: 'client', ...v } as any).returning())[0].id
      ann = await person({ name: 'Ann Able', mobile: '6085550100', email: 'ann@example.com' })
      stopper = await person({ name: 'Stu Stop', mobile: '6085550101', email: 'stu@example.com', optedOutSms: true })
      unsub = await person({ name: 'Una Unsub', mobile: '6085550102', email: 'una@example.com', emailOptOut: true })
      nobody = await person({ name: 'Nia None' })
      engine = createJobReminders({ db: t.db, sms, email, logger: console as any, isFeatureEnabled: t.services.features.isFeatureEnabled })
    }, 120_000)

    beforeEach(async () => {
      texts.length = 0; mails.length = 0; reply = { status: 'sent' }
      await t.db.delete(t.schema.reminderLog)
      await t.db.delete(t.schema.job)
      await features(['contacts', 'jobs', 'job_reminders'])
      await t.db.update(t.schema.company).set({ settings: {} } as any).where(eq(t.schema.company.id, companyId))
    })

    describe('the settings door', () => {
      test('off by default; a manager reads but cannot change; field and viewer seats cannot change', async () => {
        expect(await json(await owner('/api/job-reminders/settings'))).toMatchObject({ enabled: false, hoursBefore: [24], sms: true, email: true })
        expect((await seat.manager('/api/job-reminders/settings')).status).toBe(200)
        for (const who of ['manager', 'field', 'viewer']) expect({ who, status: (await seat[who]('/api/job-reminders/settings', { method: 'PUT', json: RULES })).status }).toEqual({ who, status: 403 })
        expect((await setRules()).status).toBe(200)
        expect((await json(await owner('/api/job-reminders/settings'))).enabled).toBe(true)
      })
      test('bad values are refused by field, and nothing is saved', async () => {
        const bad = await setRules({ hoursBefore: [0, 500], sendFromHour: 30, message: '' })
        expect(bad.status).toBe(400)
        expect((await json(bad)).fields).toMatchObject({ 'hoursBefore.0': 'At least 1 hour before', 'hoursBefore.1': 'At most 168 hours (7 days) before', sendFromHour: 'An hour from 0 to 23', message: 'Write the text message' })
        const three = await setRules({ hoursBefore: [48, 24, 12] })
        expect(three.status).toBe(400); expect((await json(three)).fields).toEqual({ hoursBefore: 'At most 2 reminders' })
        // the rules that need two fields together
        const backwards = await setRules({ sendFromHour: 20, sendUntilHour: 8 })
        expect(backwards.status).toBe(400); expect(Object.keys((await json(backwards)).fields)).toEqual(['sendUntilHour'])
        const silent = await setRules({ sms: false, email: false })
        expect(silent.status).toBe(400); expect(Object.keys((await json(silent)).fields)).toEqual(['sms'])
        expect((await json(await owner('/api/job-reminders/settings'))).enabled).toBe(false)
      })
      test('the feature is not ready: a business without it cannot switch it on from Settings, and without it the door is shut', async () => {
        await features(['contacts', 'jobs'])
        const res = await owner('/api/company/features', { method: 'PUT', json: { features: ['contacts', 'jobs', 'job_reminders'] } })
        expect(res.status).toBe(400)
        const [co] = await t.db.select().from(t.schema.company).where(eq(t.schema.company.id, companyId))
        expect(co.enabledFeatures).not.toContain('job_reminders')
        expect((await owner('/api/job-reminders/settings')).status).toBe(403)
      })
    })

    describe('the pass', () => {
      test('off: nothing is sent, though a job is due', async () => {
        await job()
        await engine.runOnce(chicago('2026-10-30T10:00:00'))
        expect(texts).toHaveLength(0); expect(mails).toHaveLength(0)
      })

      test('on: one text and one email, in the business\'s words and on its clock — and only once', async () => {
        await setRules()
        const j = await job()
        const out = await engine.runOnce(chicago('2026-10-30T10:00:00'))
        expect(out).toMatchObject({ sent: 2, skipped: 0, failed: 0 })
        expect(texts).toHaveLength(1)
        expect(texts[0].msg).toMatchObject({ contactId: ann, toPhone: '6085550100' })
        expect(texts[0].msg.message).toContain('Saturday, October 31 at 9:00 AM')
        expect(texts[0].msg.message).toContain('Ann'); expect(texts[0].msg.message).toContain('Test Builders'); expect(texts[0].msg.message).toContain('Furnace tune-up')
        expect(mails).toHaveLength(1)
        expect(mails[0]).toMatchObject({ to: 'ann@example.com', template: 'jobReminder' })
        expect(mails[0].data).toMatchObject({ when: 'Saturday, October 31 at 9:00 AM', jobTitle: 'Furnace tune-up', address: '12 Oak St, Eau Claire' })
        expect((await logOf('job_reminder_sms'))[0]).toMatchObject({ subjectId: j.id, status: 'sent', sentTo: '6085550100' })
        await engine.runOnce(chicago('2026-10-30T10:10:00'))
        await engine.runOnce(chicago('2026-10-30T15:00:00'))
        expect(texts).toHaveLength(1); expect(mails).toHaveLength(1)
      })

      test('not before its moment: 25 hours out, nothing; and nothing once the visit has started', async () => {
        await setRules()
        await job()
        await engine.runOnce(chicago('2026-10-30T08:30:00'))
        expect(texts).toHaveLength(0)
        await engine.runOnce(chicago('2026-10-31T09:30:00'))
        expect(texts).toHaveLength(0)
      })

      test('a visit moved to another time is reminded again, for its new time', async () => {
        await setRules()
        const j = await job()
        await engine.runOnce(chicago('2026-10-30T10:00:00'))
        await t.db.update(t.schema.job).set({ scheduledTime: '11:00' } as any).where(eq(t.schema.job.id, j.id))
        await engine.runOnce(chicago('2026-10-30T10:20:00')) // the new reminder is not due until 11:00 Friday
        expect(texts).toHaveLength(1)
        await engine.runOnce(chicago('2026-10-30T11:20:00'))
        expect(texts).toHaveLength(2)
        expect(texts[1].msg.message).toContain('Saturday, October 31 at 11:00 AM')
        expect(mails).toHaveLength(2)
      })

      test('sending hours: a reminder due overnight goes when the hours open, never before', async () => {
        await setRules()
        await job({ scheduledTime: '07:00' }) // due from 7am Friday — before the 8am opening
        await engine.runOnce(chicago('2026-10-30T07:30:00'))
        await engine.runOnce(chicago('2026-10-30T03:00:00'))
        expect(texts).toHaveLength(0)
        await engine.runOnce(chicago('2026-10-30T08:30:00'))
        expect(texts).toHaveLength(1)
        // and the business's own hours: 10am–noon only
        texts.length = 0; await t.db.delete(t.schema.reminderLog)
        await setRules({ sendFromHour: 10, sendUntilHour: 12 })
        await engine.runOnce(chicago('2026-10-30T09:30:00'))
        await engine.runOnce(chicago('2026-10-30T12:30:00'))
        expect(texts).toHaveLength(0)
        await engine.runOnce(chicago('2026-10-30T10:30:00'))
        expect(texts).toHaveLength(1)
      })

      test('STOP: never texted, still emailed; unsubscribed: never emailed, still texted; no number, no address: skipped, and the log says why', async () => {
        await setRules()
        await job({ contactId: stopper }); await job({ contactId: unsub }); await job({ contactId: nobody })
        await engine.runOnce(chicago('2026-10-30T10:00:00'))
        expect(texts.map((x) => x.msg.contactId)).toEqual([unsub])
        expect(mails.map((x) => x.to)).toEqual(['stu@example.com'])
        const sms = await logOf('job_reminder_sms'); const mail = await logOf('job_reminder_email')
        expect(sms.filter((r: any) => r.status === 'skipped').map((r: any) => r.detail).sort()).toEqual(['The customer asked not to be texted (STOP).', 'The customer has no phone number.'])
        expect(mail.filter((r: any) => r.status === 'skipped').map((r: any) => r.detail).sort()).toEqual(['The customer has no email address.', 'The customer unsubscribed from emails.'])
      })

      test('texting refused (not set up, wallet empty): held and tried again; the email is not repeated', async () => {
        await setRules()
        await job()
        reply = { refused: true, errorMessage: 'Texting is not set up.' }
        await engine.runOnce(chicago('2026-10-30T10:00:00'))
        expect((await logOf('job_reminder_sms'))[0]).toMatchObject({ status: 'held', detail: 'Texting is not set up.' })
        reply = { status: 'sent' }
        await engine.runOnce(chicago('2026-10-30T10:10:00'))
        expect(texts).toHaveLength(2) // the refused attempt, then the one that went
        expect((await logOf('job_reminder_sms'))[0].status).toBe('sent')
        expect(mails).toHaveLength(1)
      })

      test('a job with no time is reminded the day before, by date alone', async () => {
        await setRules()
        await job({ scheduledTime: null })
        await engine.runOnce(chicago('2026-10-30T07:30:00')) // the day opens at 8
        expect(texts).toHaveLength(0)
        await engine.runOnce(chicago('2026-10-30T10:00:00'))
        expect(texts).toHaveLength(1)
        expect(texts[0].msg.message).toContain('Saturday, October 31'); expect(texts[0].msg.message).not.toContain(' at ')
      })

      test('only the jobs the office booked, scheduled or dispatched', async () => {
        await setRules()
        await job({ source: 'online_booking' }); await job({ status: 'cancelled' }); await job({ status: 'in_progress' }); await job({ status: 'completed' })
        await engine.runOnce(chicago('2026-10-30T10:00:00'))
        expect(texts).toHaveLength(0); expect(mails).toHaveLength(0)
        await job({ status: 'dispatched' })
        await engine.runOnce(chicago('2026-10-30T10:05:00'))
        expect(texts).toHaveLength(1)
      })

      test('two reminders: the first at its time, the second at its own; booked late, only the latest is sent', async () => {
        await setRules({ hoursBefore: [48, 24], email: false })
        await job({ scheduledDate: new Date('2026-11-01T00:00:00Z'), scheduledTime: '09:00' }) // Sunday 9:00 CST = 15:00Z; 48h before is Friday 9:00 CDT
        await engine.runOnce(chicago('2026-10-30T10:00:00'))
        expect(texts).toHaveLength(1)
        await engine.runOnce(chicago('2026-10-31T10:00:00'))
        expect(texts).toHaveLength(2)
        // a visit booked inside both: one text, the earlier step logged as superseded
        texts.length = 0; await t.db.delete(t.schema.reminderLog); await t.db.delete(t.schema.job)
        await job({ scheduledTime: '09:00' }) // Saturday 9:00 — at noon Friday both steps have come due
        await engine.runOnce(chicago('2026-10-30T12:00:00'))
        expect(texts).toHaveLength(1)
        const rows = await logOf('job_reminder_sms')
        expect(rows.map((r: any) => [r.step.split(':')[0], r.status]).sort()).toEqual([['24h', 'sent'], ['48h', 'skipped']])
      })

      test('without the feature, nothing is sent, however the settings stand', async () => {
        await setRules()
        await job()
        await features(['contacts', 'jobs'])
        await engine.runOnce(chicago('2026-10-30T10:00:00'))
        expect(texts).toHaveLength(0); expect(mails).toHaveLength(0)
      })

      test('another business\'s jobs are not touched by this one\'s settings', async () => {
        const [other] = await t.db.insert(t.schema.company).values({ name: 'Other Co', slug: 'other-co', timezone: 'America/Chicago', enabledFeatures: ['jobs'] } as any).returning()
        const [c2] = await t.db.insert(t.schema.contact).values({ companyId: other.id, name: 'Zed Other', mobile: '6085550199', type: 'client' } as any).returning()
        await t.db.insert(t.schema.job).values({ companyId: other.id, number: 'X-1', title: 'Theirs', contactId: c2.id, status: 'scheduled', scheduledDate: new Date('2026-10-31T00:00:00Z'), scheduledTime: '09:00' } as any)
        await setRules()
        await engine.runOnce(chicago('2026-10-30T10:00:00'))
        expect(texts.filter((x) => x.companyId === other.id)).toHaveLength(0)
      })
    })
  })
}
