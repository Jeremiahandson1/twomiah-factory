// Automatic invoice reminders and the late fee (server/crm/billing/invoiceReminders.ts). The emails were written and
// nothing sent them (matrix 10/23). Through the real server and its real database; the clock is pinned (each pass is
// handed its `now`), and no email leaves: the email service's send is replaced to record what it was handed.
//   · off by default; on, nothing before 8am on the company's clock;
//   · due soon once, overdue once per step (the latest step reached), never twice — a second pass sends nothing;
//   · the company's clock decides the day: due "today" in Chicago is not overdue at 9:30pm though UTC is a day on;
//   · an unsubscribed customer is never emailed; the log says why; a paid invoice is never chased;
//   · every reminder carries the invoice's own /d/<token> pay link;
//   · the late fee: off by default; once; a visible "Late fee" line; totals re-worked; an audit row with before/after;
//   · the settings door: validated, owner/admin only;
//   · home care's Billing invoices get the same reminders through their own email, and never a late fee.
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { and, eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { crmTemplates } from '../server/crm/messages.ts'
import { stepFor, reminderSettings, lateFeeOn } from '../server/crm/billing/invoiceReminders.ts'

const json = async (r: Response) => (await r.json()) as any
const marker = (d: string) => new Date(`${d}T00:00:00.000Z`)
/** A moment on the Chicago clock (CDT until 1 Nov 2026, CST after). */
const chicago = (local: string) => { const d = new Date(`${local}Z`); const off = d < new Date('2026-11-01T07:00:00Z') ? 5 : 6; return new Date(d.getTime() + off * 3600_000) }

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId = ''
let owner: (p: string, init?: any) => Promise<Response>
let manager: (p: string, init?: any) => Promise<Response>
const sent: Array<{ to: string; template: string; data: any }> = []
let ann = '', bob = ''

async function invoiceFor(contactId: string, number: string, due: string, total = 100, extra: Record<string, unknown> = {}) {
  const [inv] = await t.db.insert(t.schema.invoice).values({ companyId, contactId, number, status: 'sent', dueDate: marker(due), subtotal: String(total), total: String(total), ...extra } as any).returning()
  await t.db.insert(t.schema.invoiceLineItem).values({ invoiceId: inv.id, description: 'Work done', quantity: '1', unitPrice: String(total), total: String(total) } as any)
  return inv
}
const setRules = (rules: any) => owner('/api/invoice-reminders/settings', { method: 'PUT', json: rules })
const RULES = { enabled: true, dueSoonDays: 3, overdueDays: [1, 7, 14], lateFee: { enabled: false, type: 'percent', amount: 1.5, afterDays: 30 } }
const run = (now: Date) => t.services.crm.invoiceReminders.runOnce(now)
const logFor = (id: string) => t.db.select().from(t.schema.reminderLog).where(eq(t.schema.reminderLog.subjectId, id))

beforeAll(async () => {
  t = await bootTenant()
  const s = await seedOwner(t)
  companyId = s.company.id
  await t.db.update(t.schema.company).set({ timezone: 'America/Chicago', enabledFeatures: ['contacts', 'invoices'] } as any).where(eq(t.schema.company.id, companyId))
  const email: any = t.services.email
  email.send = async (to: string, template: string, data: any) => { sent.push({ to, template, data }); return { success: true, dev: true } }
  const tok = (await json(await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } }))).accessToken
  owner = (p, init = {}) => Promise.resolve(t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${tok}` } }))
  await t.db.insert(t.schema.user).values({ email: 'manager@test.example', passwordHash: await Bun.password.hash('Manager-pass-1', 'bcrypt'), firstName: 'Mae', lastName: 'Manager', role: 'manager', companyId } as any)
  const mtok = (await json(await t.call('/api/auth/login', { method: 'POST', json: { email: 'manager@test.example', password: 'Manager-pass-1' } }))).accessToken
  manager = (p, init = {}) => Promise.resolve(t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${mtok}` } }))
  ann = (await t.db.insert(t.schema.contact).values({ companyId, name: 'Ann Able', email: 'ann@example.com', type: 'client' } as any).returning())[0].id
  bob = (await t.db.insert(t.schema.contact).values({ companyId, name: 'Bob Gone', email: 'bob@example.com', type: 'client', emailOptOut: true } as any).returning())[0].id
}, 120_000)

describe('the rules, by themselves', () => {
  test('defaults: off, 3 days before, 1/7/14 late, no late fee', () => {
    expect(reminderSettings({})).toEqual({ enabled: false, dueSoonDays: 3, overdueDays: [1, 7, 14], lateFee: { enabled: false, type: 'percent', amount: 1.5, afterDays: 30 } })
  })
  test('the step: due soon inside the window, the latest overdue step reached, nothing between', () => {
    const cfg = reminderSettings({ invoiceReminders: RULES })
    expect(stepFor(5, cfg)).toBeNull()
    expect(stepFor(3, cfg)).toEqual({ name: 'due_soon', daysOverdue: 0 })
    expect(stepFor(0, cfg)).toEqual({ name: 'due_soon', daysOverdue: 0 })
    expect(stepFor(-1, cfg)).toEqual({ name: 'overdue_1', daysOverdue: 1 })
    expect(stepFor(-6, cfg)).toEqual({ name: 'overdue_1', daysOverdue: 6 })
    expect(stepFor(-30, cfg)).toEqual({ name: 'overdue_14', daysOverdue: 30 })
    expect(stepFor(2, { ...cfg, dueSoonDays: 0 })).toBeNull()
  })
  test('the fee: a percent of the balance to the cent, or the flat amount; none when off', () => {
    expect(lateFeeOn(200, { enabled: true, type: 'percent', amount: 1.5, afterDays: 30 })).toBe(3)
    expect(lateFeeOn(333.33, { enabled: true, type: 'percent', amount: 1.5, afterDays: 30 })).toBe(5)
    expect(lateFeeOn(200, { enabled: true, type: 'flat', amount: 25, afterDays: 30 })).toBe(25)
    expect(lateFeeOn(200, { enabled: false, type: 'flat', amount: 25, afterDays: 30 })).toBe(0)
  })
})

describe('the settings door', () => {
  test('starts off; a manager may read but not change it; bad numbers are refused field by field', async () => {
    const r = await json(await owner('/api/invoice-reminders/settings'))
    expect(r.enabled).toBe(false)
    expect((await manager('/api/invoice-reminders/settings')).status).toBe(200)
    expect((await manager('/api/invoice-reminders/settings', { method: 'PUT', json: RULES })).status).toBe(403)
    const bad = await setRules({ ...RULES, dueSoonDays: 40, lateFee: { enabled: true, type: 'percent', amount: 30, afterDays: 0 } })
    expect(bad.status).toBe(400)
    const b = await json(bad)
    expect(Object.keys(b.fields)).toEqual(expect.arrayContaining(['dueSoonDays', 'lateFee.amount', 'lateFee.afterDays']))
  })
  test('saved as the engine reads it, and the change is in the audit log', async () => {
    const r = await setRules({ ...RULES, overdueDays: [14, 1, 7, 7] })
    expect(r.status).toBe(200)
    expect((await json(r)).overdueDays).toEqual([1, 7, 14])
    const rows = await t.db.select().from(t.schema.auditLog).where(eq(t.schema.auditLog.entity, 'company'))
    expect(rows.some((a: any) => a.metadata?.invoiceReminders?.after?.enabled === true)).toBe(true)
  })
})

describe('reminders', () => {
  test('off: nothing goes, whatever is owed', async () => {
    await setRules({ ...RULES, enabled: false })
    const inv = await invoiceFor(ann, 'INV-OFF', '2026-10-01')
    expect((await run(chicago('2026-10-23T10:00:00'))).sent).toBe(0)
    expect(await logFor(inv.id)).toEqual([])
    await t.db.delete(t.schema.invoice).where(eq(t.schema.invoice.id, inv.id))
    await setRules(RULES)
  })

  test('due soon: not before 8am on the company clock; once, with the pay link; a second pass sends nothing', async () => {
    const inv = await invoiceFor(ann, 'INV-SOON', '2026-10-25')
    sent.length = 0
    await run(chicago('2026-10-23T07:30:00'))
    expect(sent).toEqual([])
    await run(chicago('2026-10-23T09:00:00'))
    expect(sent.length).toBe(1)
    expect(sent[0]).toMatchObject({ to: 'ann@example.com', template: 'invoiceReminder' })
    expect(sent[0].data).toMatchObject({ invoiceNumber: 'INV-SOON', balance: '100.00', dueDate: 'October 25, 2026', daysOverdue: 0 })
    expect(String(sent[0].data.documentPath)).toMatch(/^\/d\/[0-9a-f]{64}$/)
    const [row] = await t.db.select().from(t.schema.invoice).where(eq(t.schema.invoice.id, inv.id))
    expect(sent[0].data.documentPath).toBe(`/d/${row.publicToken}`)
    const rendered = crmTemplates.invoiceReminder(sent[0].data, { companyName: 'Test Builders', colourOnWhite: '#c2410c' } as any, 'https://app.test')
    expect(rendered.html).toContain(`href="https://app.test/d/${row.publicToken}"`)
    await run(chicago('2026-10-23T15:00:00'))
    await run(chicago('2026-10-24T09:00:00'))
    expect(sent.filter((m) => m.data.invoiceNumber === 'INV-SOON').length).toBe(1)
    const log = await logFor(inv.id)
    expect(log.map((l: any) => [l.kind, l.step, l.status])).toEqual([['invoice_reminder', 'due_soon:2026-10-25', 'sent']])
  })

  test('overdue: the latest step reached, once per step, through the overdue email', async () => {
    const inv = await invoiceFor(ann, 'INV-LATE', '2026-10-13')
    sent.length = 0
    const mine = () => sent.filter((m) => m.data.invoiceNumber === 'INV-LATE')
    await run(chicago('2026-10-23T09:00:00')) // 10 days late → the 7-day step
    expect(mine().map((m) => [m.template, m.data.daysOverdue])).toEqual([['invoiceOverdue', 10]])
    await run(chicago('2026-10-26T09:00:00')) // 13 days: still the 7-day step, already sent
    expect(mine().length).toBe(1)
    await run(chicago('2026-10-27T09:00:00')) // 14 days → the 14-day step
    expect(mine().map((m) => m.data.daysOverdue)).toEqual([10, 14])
    const log = await logFor(inv.id)
    expect(log.map((l: any) => l.step).sort()).toEqual(['overdue_14:2026-10-13', 'overdue_7:2026-10-13'])
    const audit = await t.db.select().from(t.schema.auditLog).where(and(eq(t.schema.auditLog.entity, 'invoice'), eq(t.schema.auditLog.entityId, inv.id)))
    expect(audit.filter((a: any) => a.action === 'send' && a.metadata?.automatic === 'reminder').length).toBe(2)
  })

  test("the company's clock decides the day: due today in Chicago at 9:30pm is not overdue, though UTC is tomorrow", async () => {
    const inv = await invoiceFor(ann, 'INV-TZ', '2026-11-05')
    sent.length = 0
    await run(new Date('2026-11-06T03:30:00Z')) // 9:30pm on 5 November in Chicago
    expect(sent.filter((m) => m.data.invoiceNumber === 'INV-TZ').map((m) => m.template)).toEqual(['invoiceReminder'])
    expect((await logFor(inv.id)).map((l: any) => l.step)).toEqual(['due_soon:2026-11-05'])
  })

  test('an unsubscribed customer is never emailed (the log says why); a paid invoice is never chased', async () => {
    const gone = await invoiceFor(bob, 'INV-OPTOUT', '2026-10-20')
    const paid = await invoiceFor(ann, 'INV-PAID', '2026-10-20', 100, { status: 'paid', amountPaid: '100' })
    sent.length = 0
    await run(chicago('2026-10-23T09:00:00'))
    expect(sent.find((m) => m.to === 'bob@example.com')).toBeUndefined()
    expect(sent.find((m) => m.data.invoiceNumber === 'INV-PAID')).toBeUndefined()
    const [log] = await logFor(gone.id)
    expect(log).toMatchObject({ status: 'skipped', detail: 'The customer unsubscribed from email.' })
    expect(await logFor(paid.id)).toEqual([])
  })

  test('the late fee: once, as a visible line; totals re-worked; the reminder asks for the new balance; audited', async () => {
    await setRules({ ...RULES, lateFee: { enabled: true, type: 'percent', amount: 1.5, afterDays: 30 } })
    const inv = await invoiceFor(ann, 'INV-FEE', '2026-09-20', 200)
    sent.length = 0
    await run(chicago('2026-10-23T09:00:00')) // 33 days late
    const lines = await t.db.select().from(t.schema.invoiceLineItem).where(eq(t.schema.invoiceLineItem.invoiceId, inv.id))
    const fee = lines.find((l: any) => l.type === 'late_fee')
    expect(fee).toMatchObject({ description: 'Late fee (1.5% of the $200.00 overdue balance)', unitPrice: '3.00', total: '3.00' })
    const [row] = await t.db.select().from(t.schema.invoice).where(eq(t.schema.invoice.id, inv.id))
    expect([row.subtotal, row.total, row.status]).toEqual(['203.00', '203.00', 'sent'])
    expect(sent.find((m) => m.data.invoiceNumber === 'INV-FEE')?.data.balance).toBe('203.00')
    await run(chicago('2026-10-24T09:00:00'))
    await run(chicago('2026-11-30T09:00:00'))
    const again = await t.db.select().from(t.schema.invoiceLineItem).where(eq(t.schema.invoiceLineItem.invoiceId, inv.id))
    expect(again.filter((l: any) => l.type === 'late_fee').length).toBe(1)
    const audit = await t.db.select().from(t.schema.auditLog).where(and(eq(t.schema.auditLog.entityId, inv.id), eq(t.schema.auditLog.action, 'update')))
    expect(audit.map((a: any) => a.metadata)).toEqual([expect.objectContaining({ automatic: 'late_fee', lateFee: '3.00', totalBefore: '200.00', totalAfter: '203.00' })])
    // The invoice page's panel reads the same history.
    const hist = await json(await owner(`/api/invoice-reminders/history/${inv.id}`))
    expect(hist.data.map((h: any) => h.kind)).toEqual(expect.arrayContaining(['invoice_late_fee', 'invoice_reminder']))
    await setRules(RULES)
  })

  test('no late fee before its day, or with the fee off', async () => {
    await setRules({ ...RULES, lateFee: { enabled: true, type: 'flat', amount: 25, afterDays: 30 } })
    const early = await invoiceFor(ann, 'INV-EARLY', '2026-10-01')
    await run(chicago('2026-10-23T09:00:00')) // 22 days
    expect((await t.db.select().from(t.schema.invoiceLineItem).where(eq(t.schema.invoiceLineItem.invoiceId, early.id))).some((l: any) => l.type === 'late_fee')).toBe(false)
    await setRules(RULES)
    await run(chicago('2026-11-23T09:00:00')) // 53 days, fee off
    expect((await t.db.select().from(t.schema.invoiceLineItem).where(eq(t.schema.invoiceLineItem.invoiceId, early.id))).some((l: any) => l.type === 'late_fee')).toBe(false)
  })
})

describe("home care's Billing invoices", () => {
  let h: Awaited<ReturnType<typeof bootTenant>>
  const hsent: Array<{ to: string; template: string; data: any }> = []
  let hco = ''
  beforeAll(async () => {
    h = await bootTenant({ vertical: 'homecare' })
    const s = await seedOwner(h)
    hco = s.company.id
    await h.db.update(h.schema.company).set({ timezone: 'America/Chicago', settings: { invoiceReminders: { ...RULES, lateFee: { enabled: true, type: 'flat', amount: 25, afterDays: 1 } } } } as any).where(eq(h.schema.company.id, hco))
    const email: any = h.services.email
    email.send = async (to: string, template: string, data: any) => { hsent.push({ to, template, data }); return { success: true } }
  }, 120_000)

  test('a sent, unpaid invoice past due gets its reminder with the pay link and a note; a draft does not; no late fee', async () => {
    const [cl] = await h.db.insert(h.schema.clients).values({ companyId: hco, firstName: 'Ada', lastName: 'Client', email: 'ada@family.example', isActive: true } as any).returning()
    const [inv] = await h.db.insert(h.schema.invoices).values({ companyId: hco, invoiceNumber: 'HC-9', clientId: cl.id, billingPeriodStart: '2026-09-01', billingPeriodEnd: '2026-09-14', subtotal: '120', total: '120', paymentStatus: 'pending', paymentDueDate: '2026-10-15', sentAt: new Date('2026-09-20T12:00:00Z') } as any).returning()
    const [draft] = await h.db.insert(h.schema.invoices).values({ companyId: hco, invoiceNumber: 'HC-10', clientId: cl.id, billingPeriodStart: '2026-09-15', billingPeriodEnd: '2026-09-28', subtotal: '80', total: '80', paymentStatus: 'pending', paymentDueDate: '2026-10-15' } as any).returning()
    await h.services.crm.invoiceReminders.runOnce(chicago('2026-10-23T09:00:00'))
    expect(hsent.map((m) => [m.to, m.template, m.data.daysOverdue, m.data.amountDue])).toEqual([['ada@family.example', 'homecareInvoiceReminder', 8, '120.00']])
    expect(String(hsent[0].data.documentPath)).toMatch(/^\/d\/[0-9a-f]{64}$/)
    const [row] = await h.db.select().from(h.schema.invoices).where(eq(h.schema.invoices.id, inv.id))
    expect(row.notes).toContain('Automatic reminder sent to ada@family.example on 2026-10-23 (8d overdue)')
    expect([row.total, row.subtotal]).toEqual(['120.00', '120.00'])
    expect(await h.db.select().from(h.schema.reminderLog).where(eq(h.schema.reminderLog.subjectId, draft.id))).toEqual([])
    await h.services.crm.invoiceReminders.runOnce(chicago('2026-10-24T09:00:00'))
    expect(hsent.length).toBe(1)
  })
})

afterAll(() => {})
