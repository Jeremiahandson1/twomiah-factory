// Quote templates, "create similar" and automatic quote follow-up (contractor parity item 2), through the real server and its
// real database. The clock is pinned (each pass is handed its `now`) and no email leaves: the email service's send is replaced
// to record what it was handed. The screens are quote-templates-ui.test.ts (a DOM installed as globals stops the in-memory
// database booting, so the two live in separate files).
//   · both features are registered not ready, general contractor only; off, their doors are shut (the registry's feature gate answers 403);
//   · a template is read from the saved quote (not from the browser), leaves out the customer/dates/options, and a seat
//     without margin:read is not sent what the lines cost; a seat that cannot create quotes cannot save one;
//   · follow-up: off by default; 8am on the company's clock; once per step (the latest reached); never to a quote that was
//     answered, expired, or never sent; never to a customer who unsubscribed; a quote sent again starts over.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import type { PgTable } from 'drizzle-orm/pg-core'
import { FEATURE_REGISTRY } from '@twomiah/tenant-backend'
import { bootTenant, seedOwner } from './harness.ts'
import { crmTemplates } from '../server/crm/messages.ts'
import { followUpSettings, stepFor } from '../server/crm/billing/quoteFollowUp.ts'
import { templateFor } from '../server/crm/billing/quoteTemplates.ts'

const json = async (r: Response) => (await r.json()) as any
/** A moment on the Chicago clock (CST from 1 Nov 2026). */
const chicago = (local: string) => new Date(new Date(`${local}Z`).getTime() + 6 * 3600_000)
const FEATURES = ['contacts', 'quotes', 'projects', 'quote_templates', 'quote_followup']

describe('the features', () => {
  test.each(['quote_templates', 'quote_followup'])('%s is registered, not ready, and offered to the general contractor only', (id) => {
    const f = (FEATURE_REGISTRY as any[]).find((x) => x.id === id)
    expect(f).toBeTruthy()
    expect(f.hidden).toBe(true)
    expect(f.templates).toEqual(['crm'])
  })
})

describe('the rules, by themselves', () => {
  test('follow-up defaults: off, 3 and 7 days; settings are cleaned the way the engine reads them', () => {
    expect(followUpSettings({})).toEqual({ enabled: false, afterDays: [3, 7] })
    expect(followUpSettings({ quoteFollowUp: { enabled: true, afterDays: [9, 3, 3, 0, 200, 'x', 5, 30] } })).toEqual({ enabled: true, afterDays: [3, 5, 9] })
  })
  test('the step is the latest one reached, and nothing before the first', () => {
    const cfg = followUpSettings({ quoteFollowUp: { enabled: true, afterDays: [3, 7] } })
    expect(stepFor(2, cfg)).toBeNull()
    expect(stepFor(3, cfg)).toEqual({ name: 'after_3', days: 3 })
    expect(stepFor(6, cfg)).toEqual({ name: 'after_3', days: 6 })
    expect(stepFor(40, cfg)).toEqual({ name: 'after_7', days: 40 })
  })
  test('a template shows what the lines cost only to a seat allowed to see it', () => {
    const body: any = { name: 'x', notes: '', terms: '', customerMessage: '', taxRate: 0, depositType: null, depositValue: 0, lineItems: [{ description: 'a', quantity: 1, unitPrice: 10, unitCost: 6, markupPct: 25, section: 'S' }] }
    expect(templateFor(body, true).lineItems[0]).toMatchObject({ unitCost: 6, markupPct: 25 })
    const stripped: any = templateFor(body, false).lineItems[0]
    expect(stripped.unitCost).toBeUndefined(); expect(stripped.markupPct).toBeUndefined(); expect(stripped).toMatchObject({ unitPrice: 10, section: 'S' })
  })
  test('the follow-up email carries the quote link, the total and the date it holds until, and escapes the business name', () => {
    const m: any = crmTemplates.quoteFollowUp({ quoteNumber: 'Q-00007', quoteName: 'Deck', companyName: 'Hall & <b>Sons</b>', contactName: 'Ann', total: '1234.5', expiryDate: 'November 30, 2026', documentPath: '/d/tok123', companyPhone: '555-0100' }, {} as any, 'https://crm.example.com')
    expect(m.subject).toBe('Following up on quote Q-00007 from Hall & <b>Sons</b>')
    expect(m.html).toContain('https://crm.example.com/d/tok123')
    expect(m.html).toContain('$1,234.50'); expect(m.html).toContain('November 30, 2026'); expect(m.html).toContain('555-0100')
    expect(m.html).not.toContain('<b>Sons</b>')
    expect(m.text).toContain('https://crm.example.com/d/tok123')
  })
})

describe('through the server', () => {
  let t: Awaited<ReturnType<typeof bootTenant>>
  let companyId = ''
  let owner: (p: string, i?: any) => Promise<Response>
  let viewer: (p: string, i?: any) => Promise<Response>
  let field: (p: string, i?: any) => Promise<Response>
  let manager: (p: string, i?: any) => Promise<Response>
  let ann = '', bob = '', nomail = ''
  const sent: Array<{ to: string; template: string; data: any }> = []
  // The one place a row is written straight to the database: typed by the table it goes into.
  const ins = async <T extends PgTable>(table: T, values: T['$inferInsert']) => ((await t.db.insert(table).values(values as any).returning()) as any[])[0]
  const run = (now: Date) => t.services.crm.quoteFollowUp.runOnce(now)
  const rulesOn = (afterDays = [3, 7]) => owner('/api/quote-followup/settings', { method: 'PUT', json: { enabled: true, afterDays } })
  const emailsFor = (number: string) => sent.filter((s) => s.data.quoteNumber === number)
  let n = 0
  const makeQuote = (over: Record<string, unknown> = {}) => ins(t.schema.quote, { companyId, number: `Q-${String(++n).padStart(5, '0')}`, name: 'Deck', status: 'sent', contactId: ann, total: '500', subtotal: '500', sentAt: chicago('2026-11-06T10:00:00'), ...over } as any)

  beforeAll(async () => {
    t = await bootTenant({ vertical: 'contractor' })
    const s = await seedOwner(t)
    companyId = s.company.id
    await t.db.update(t.schema.company).set({ timezone: 'America/Chicago', enabledFeatures: FEATURES } as any).where(eq(t.schema.company.id, companyId))
    const email: any = t.services.email
    email.send = async (to: string, template: string, data: any) => { sent.push({ to, template, data }); return { success: true, dev: true } }
    const login = async (e: string, p: string) => (await json(await t.call('/api/auth/login', { method: 'POST', json: { email: e, password: p } }))).accessToken
    const as = (tok: string) => (p: string, i: any = {}) => Promise.resolve(t.call(p, { ...i, headers: { ...(i.headers || {}), Authorization: `Bearer ${tok}` } }))
    owner = as(await login('owner@test.example', s.password))
    for (const role of ['viewer', 'field', 'manager']) await ins(t.schema.user, { companyId, email: `${role}@test.example`, firstName: role, lastName: 'Seat', role, passwordHash: await Bun.password.hash('Correct-horse-1', 'bcrypt') } as any)
    viewer = as(await login('viewer@test.example', 'Correct-horse-1'))
    field = as(await login('field@test.example', 'Correct-horse-1'))
    manager = as(await login('manager@test.example', 'Correct-horse-1'))
    ann = (await ins(t.schema.contact, { companyId, type: 'client', name: 'Ann Able', email: 'ann@example.com' } as any)).id
    bob = (await ins(t.schema.contact, { companyId, type: 'client', name: 'Bob Gone', email: 'bob@example.com', emailOptOut: true } as any)).id
    nomail = (await ins(t.schema.contact, { companyId, type: 'client', name: 'Cy Nomail' } as any)).id
  }, 120_000)

  // ------------------------------------------------------------------ templates
  describe('templates', () => {
    let quoteId = ''
    test('saving reads the saved quote: lines with section, cost code and markup; never the customer, dates or option lines', async () => {
      const made = await owner('/api/quotes', { method: 'POST', json: {
        name: 'Deck rebuild', contactId: ann, notes: 'Internal note', terms: 'Net 15', taxRate: 5,
        lineItems: [
          { description: 'Demo old deck', quantity: 1, unitPrice: 0, unitCost: 800, markupPct: 25, section: 'Demolition', costCode: '02-Demo', type: 'labor' },
          { description: 'Composite boards', quantity: 10, unitPrice: 60, unitCost: 45, section: 'Decking', costCode: '06-Deck', type: 'material' },
        ],
      } })
      expect(made.status).toBe(201)
      quoteId = (await json(made)).id
      // a line that belongs to a Good/Better/Best option of that quote is not part of a template
      const opt = await ins(t.schema.quoteProposalOption, { quoteId, name: 'Premium' } as any)
      await ins(t.schema.quoteLineItem, { quoteId, description: 'Hardwood upgrade', quantity: '1', unitPrice: '900', total: '900', optional: true, selected: false, proposalOptionId: opt.id } as any)
      const saved = await owner('/api/quote-templates', { method: 'POST', json: { quoteId, name: 'Deck rebuild' } })
      expect(saved.status).toBe(201)
      expect((await json(saved)).lineCount).toBe(2)
      const list = (await json(await owner('/api/quote-templates'))).data
      expect(list.map((r: any) => [r.name, r.lineCount, r.total])).toEqual([['Deck rebuild', 2, 1600]])
      const one = await json(await owner(`/api/quote-templates/${list[0].id}`))
      expect(one.body.lineItems.map((l: any) => [l.description, l.section, l.costCode, l.markupPct, l.unitCost])).toEqual([['Demo old deck', 'Demolition', '02-Demo', 25, 800], ['Composite boards', 'Decking', '06-Deck', undefined, 45]])
      expect(one.body).toMatchObject({ name: 'Deck rebuild', notes: 'Internal note', terms: 'Net 15', taxRate: 5 })
      expect(JSON.stringify(one.body)).not.toContain('Hardwood')
      expect(one.body.contactId).toBeUndefined(); expect(one.body.expiryDate).toBeUndefined(); expect(one.body.number).toBeUndefined()
    }, 120_000)

    test('a template is not a quote: the quote list is unchanged', async () => {
      const quotes = (await json(await owner('/api/quotes'))).data
      expect(quotes.length).toBe(1)
    })

    test('a name already in use (any case) is refused in words; a rename to a free name works', async () => {
      const again = await owner('/api/quote-templates', { method: 'POST', json: { quoteId, name: 'DECK REBUILD' } })
      expect(again.status).toBe(409)
      expect((await json(again)).error).toContain('already have a template with that name')
      const other = await json(await owner('/api/quote-templates', { method: 'POST', json: { quoteId, name: 'Deck, second' } }))
      expect((await owner(`/api/quote-templates/${other.id}`, { method: 'PUT', json: { name: 'Deck rebuild' } })).status).toBe(409)
      expect((await owner(`/api/quote-templates/${other.id}`, { method: 'PUT', json: { name: 'Deck with rail' } })).status).toBe(200)
      expect((await owner('/api/quote-templates', { method: 'POST', json: { quoteId, name: '   ' } })).status).toBe(400)
    })

    test('a seat that can read quotes sees the template without what the lines cost; one that cannot read quotes is refused', async () => {
      const list = (await json(await viewer('/api/quote-templates'))).data
      const body = (await json(await viewer(`/api/quote-templates/${list[0].id}`))).body
      expect(body.lineItems.length).toBe(2)
      for (const l of body.lineItems) { expect(l.unitCost).toBeUndefined(); expect(l.markupPct).toBeUndefined(); expect(l.unitPrice).toBeGreaterThanOrEqual(0) }
      expect((await field('/api/quote-templates')).status).toBe(403)
    })

    test('a seat without quotes:create cannot save one, without quotes:update cannot rename, without quotes:delete cannot delete', async () => {
      const list = (await json(await owner('/api/quote-templates'))).data
      expect((await viewer('/api/quote-templates', { method: 'POST', json: { quoteId, name: 'Sneaky' } })).status).toBe(403)
      expect((await viewer(`/api/quote-templates/${list[0].id}`, { method: 'PUT', json: { name: 'Sneaky' } })).status).toBe(403)
      expect((await viewer(`/api/quote-templates/${list[0].id}`, { method: 'DELETE' })).status).toBe(403)
    })

    test('a quote with no lines, or another company\'s quote, cannot be saved', async () => {
      const empty = await makeQuote({ status: 'draft' })
      expect((await owner('/api/quote-templates', { method: 'POST', json: { quoteId: empty.id, name: 'Empty' } })).status).toBe(400)
      expect((await owner('/api/quote-templates', { method: 'POST', json: { quoteId: 'nope', name: 'Ghost' } })).status).toBe(404)
    })

    test('deleting removes it; the quote it came from stays', async () => {
      const list = (await json(await owner('/api/quote-templates'))).data
      for (const r of list) expect((await owner(`/api/quote-templates/${r.id}`, { method: 'DELETE' })).status).toBe(200)
      expect((await json(await owner('/api/quote-templates'))).data).toEqual([])
      expect((await owner(`/api/quotes/${quoteId}`)).status).toBe(200)
    })

    test('with the feature off, the door is not there', async () => {
      await t.db.update(t.schema.company).set({ enabledFeatures: FEATURES.filter((f) => f !== 'quote_templates') } as any).where(eq(t.schema.company.id, companyId))
      await new Promise((r) => setTimeout(r, 16_000)) // the feature gate caches 15 s per company
      expect((await owner('/api/quote-templates')).status).toBe(403)
      await t.db.update(t.schema.company).set({ enabledFeatures: FEATURES } as any).where(eq(t.schema.company.id, companyId))
    }, 60_000)
  })

  // ------------------------------------------------------------------ follow-up
  describe('follow-up', () => {
    test('off by default: nothing is sent', async () => {
      const q = await makeQuote()
      expect((await run(chicago('2026-11-10T10:00:00'))).sent).toBe(0)
      expect(emailsFor(q.number)).toEqual([])
      expect(await t.db.select().from(t.schema.reminderLog).where(eq(t.schema.reminderLog.subjectId, q.id))).toEqual([])
    })

    test('the settings door: owner and admin change it, anyone who reads quotes sees it, bad numbers are refused in words', async () => {
      expect((await json(await owner('/api/quote-followup/settings'))).enabled).toBe(false)
      expect((await viewer('/api/quote-followup/settings')).status).toBe(200)
      expect((await field('/api/quote-followup/settings')).status).toBe(403)
      expect((await viewer('/api/quote-followup/settings', { method: 'PUT', json: { enabled: true, afterDays: [3] } })).status).toBe(403)
      expect((await manager('/api/quote-followup/settings', { method: 'PUT', json: { enabled: true, afterDays: [3] } })).status).toBe(403)
      for (const bad of [[0], [91], [1, 2, 3, 4], [1.5]]) expect((await owner('/api/quote-followup/settings', { method: 'PUT', json: { enabled: true, afterDays: bad } })).status).toBe(400)
      const ok = await rulesOn([7, 3])
      expect(ok.status).toBe(200)
      expect(await json(ok)).toMatchObject({ enabled: true, afterDays: [3, 7], sendFromHour: 8 })
    })

    test('nothing before 8am on the company\'s clock, even with the switch on', async () => {
      const q = await makeQuote()
      expect((await run(chicago('2026-11-10T07:30:00'))).sent).toBe(0)
      expect(emailsFor(q.number)).toEqual([])
    })

    test('a quote sent 4 days ago gets the 3-day follow-up, once, with its own link; a second pass sends nothing; day 8 gets the 7-day one', async () => {
      const q = await makeQuote({ sentAt: chicago('2026-11-06T10:00:00') })
      await run(chicago('2026-11-10T10:00:00'))
      const first = emailsFor(q.number)
      expect(first.length).toBe(1)
      expect(first[0]).toMatchObject({ to: 'ann@example.com', template: 'quoteFollowUp' })
      expect(first[0].data.documentPath).toMatch(/^\/d\//)
      await run(chicago('2026-11-10T12:00:00'))
      expect(emailsFor(q.number).length).toBe(1)
      await run(chicago('2026-11-14T10:00:00'))
      expect(emailsFor(q.number).length).toBe(2)
      await run(chicago('2026-11-20T10:00:00'))
      expect(emailsFor(q.number).length).toBe(2)
      const log = await json(await owner(`/api/quote-followup/history/${q.id}`))
      expect(log.data.map((e: any) => [e.step.split(':')[0], e.status, e.sentTo])).toEqual([['after_3', 'sent', 'ann@example.com'], ['after_7', 'sent', 'ann@example.com']])
    })

    test('a quote found 10 days after sending gets one email, the latest step — not two', async () => {
      const q = await makeQuote({ sentAt: chicago('2026-11-01T10:00:00') })
      await run(chicago('2026-11-11T10:00:00'))
      expect(emailsFor(q.number).length).toBe(1)
    })

    test('the company\'s clock decides the day: sent at 11:30pm Chicago on the 6th is 3 days old at 8:30am on the 9th', async () => {
      const q = await makeQuote({ sentAt: chicago('2026-11-06T23:30:00') })
      await run(chicago('2026-11-09T07:59:00'))
      expect(emailsFor(q.number).length).toBe(0)
      await run(chicago('2026-11-09T08:30:00'))
      expect(emailsFor(q.number).length).toBe(1)
    })

    test('a quote the customer answered, a draft, an expired quote and a quote past its valid-until day are left alone', async () => {
      const skipped = [
        await makeQuote({ status: 'approved', approvedAt: chicago('2026-11-08T10:00:00') }),
        await makeQuote({ status: 'declined' }),
        await makeQuote({ status: 'rejected' }),
        await makeQuote({ status: 'expired' }),
        await makeQuote({ status: 'draft', sentAt: null }),
        await makeQuote({ status: 'viewed', expiryDate: new Date('2026-11-08T00:00:00Z') }),
      ]
      await run(chicago('2026-11-12T10:00:00'))
      for (const q of skipped) expect(emailsFor(q.number)).toEqual([])
      const open = await makeQuote({ status: 'viewed', expiryDate: new Date('2026-11-30T00:00:00Z') })
      await run(chicago('2026-11-12T10:30:00'))
      expect(emailsFor(open.number).length).toBe(1)
    })

    test('a customer who unsubscribed, or has no email, is never emailed; the log says why', async () => {
      const gone = await makeQuote({ contactId: bob }), blank = await makeQuote({ contactId: nomail }), orphan = await makeQuote({ contactId: null })
      await run(chicago('2026-11-12T11:00:00'))
      for (const q of [gone, blank, orphan]) expect(emailsFor(q.number)).toEqual([])
      const why = async (id: string) => (await t.db.select().from(t.schema.reminderLog).where(eq(t.schema.reminderLog.subjectId, id)))[0]
      expect(await why(gone.id)).toMatchObject({ status: 'skipped', detail: 'The customer unsubscribed from email.' })
      expect(await why(blank.id)).toMatchObject({ status: 'skipped', detail: 'The customer has no email address.' })
      expect(await why(orphan.id)).toMatchObject({ status: 'skipped', detail: 'The quote has no customer.' })
    })

    test('a quote sent again starts over: a new send day earns its own steps', async () => {
      const q = await makeQuote({ sentAt: chicago('2026-11-01T10:00:00') })
      await run(chicago('2026-11-05T10:00:00'))
      expect(emailsFor(q.number).length).toBe(1)
      await t.db.update(t.schema.quote).set({ sentAt: chicago('2026-11-16T10:00:00') } as any).where(eq(t.schema.quote.id, q.id))
      await run(chicago('2026-11-20T10:00:00'))
      expect(emailsFor(q.number).length).toBe(2)
    })

    test('a failed send is logged as failed and is not tried again every hour', async () => {
      const q = await makeQuote({ sentAt: chicago('2026-11-17T10:00:00') })
      const email: any = t.services.email
      const real = email.send
      email.send = async () => { throw new Error('mailbox full') }
      const out = await run(chicago('2026-11-21T10:00:00'))
      email.send = real
      expect(out.failed).toBeGreaterThanOrEqual(1)
      await run(chicago('2026-11-21T11:00:00'))
      expect(emailsFor(q.number)).toEqual([])
      expect((await t.db.select().from(t.schema.reminderLog).where(eq(t.schema.reminderLog.subjectId, q.id)))[0]).toMatchObject({ status: 'failed', detail: 'mailbox full' })
    })

    test('with the feature off for the business, nothing is sent and its door is not there', async () => {
      const q = await makeQuote({ sentAt: chicago('2026-11-17T10:00:00'), contactId: ann })
      await t.db.update(t.schema.company).set({ enabledFeatures: FEATURES.filter((f) => f !== 'quote_followup') } as any).where(eq(t.schema.company.id, companyId))
      await new Promise((r) => setTimeout(r, 16_000)) // the feature gate caches 15 s per company
      await run(chicago('2026-11-25T10:00:00'))
      expect(emailsFor(q.number)).toEqual([])
      expect((await owner('/api/quote-followup/settings')).status).toBe(403)
    }, 60_000)
  })
})
