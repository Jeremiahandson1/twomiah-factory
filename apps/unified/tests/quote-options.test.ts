// Item 5 of the field-service depth brief: good / better / best on a quote the office has SENT. The customer picks one option on
// the quote's own link and signs for it; the deposit follows the option they picked. Through the real server and the real login,
// on BOTH field service and basic.
//   · lines that share an option name are one option; a choice needs two to five; only one can be picked;
//   · the customer's page lists each option with its full price (tax included) and its deposit;
//   · the customer cannot sign (and the office cannot mark it approved) until an option is picked;
//   · picking turns that option's lines on and the others off, and the quote's total follows;
//   · what is signed is the picked option: the signed fingerprint differs between options;
//   · the deposit invoice is the deposit of the picked option's total (percent) — and the invoice and the job carry only its lines;
//   · after signing the pick is fixed; the office can pick for a customer who says it by phone (quotes:update);
//   · a quote with no option names behaves exactly as before.
import { describe, test, expect, beforeAll } from 'bun:test'
import { and, eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'

const SIGN = { signature: 'data:image/png;base64,iVBORw0KGgo=', signedBy: 'Pat Client', consent: true }
const FEATURES = ['contacts', 'quotes', 'invoices', 'jobs', 'quote_options']

for (const vertical of ['fieldservice', 'basic'] as const) {
  describe(`${vertical}`, () => {
    let t: Awaited<ReturnType<typeof bootTenant>>
    const tok: Record<string, string> = {}
    const ids: Record<string, string> = {}
    const sent: Array<{ template: string; data: any }> = []
    const as = async (who: string, path: string, init: any = {}) => await t.call(path, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${tok[who]}` } })
    const call = async (path: string, init: any = {}) => await t.call(path, init)
    const json = async (r: Response) => ({ status: r.status, body: await r.json() as any })
    const signIn = async (email: string, password: string) => (await (await t.call('/api/auth/login', { method: 'POST', json: { email, password } })).json() as any).accessToken

    const LINES = [
      { description: 'Service call', quantity: 1, unitPrice: 100 },
      { description: 'Basic furnace', quantity: 1, unitPrice: 3000, optionGroup: 'Good' },
      { description: 'Better furnace', quantity: 1, unitPrice: 4500, optionGroup: 'Better' },
      { description: 'Better warranty', quantity: 1, unitPrice: 500, optionGroup: 'Better' },
      { description: 'Best furnace', quantity: 1, unitPrice: 6000, optionGroup: 'Best' },
    ]
    const make = (extra: any = {}, lineItems: any[] = LINES) => as('owner', '/api/quotes', { method: 'POST', json: { contactId: ids.contact, name: 'Furnace', taxRate: 10, lineItems, ...extra } }).then(json)
    /** A quote the office has sent, and the customer's own link to it. */
    async function sentQuote(extra: any = {}, lineItems: any[] = LINES) {
      const q = await make(extra, lineItems)
      expect(q.status).toBe(201)
      expect((await as('owner', `/api/quotes/${q.body.id}/send`, { method: 'POST' })).status).toBe(200)
      const link = String(sent.filter((m) => m.template === 'quoteSent').at(-1)!.data.documentPath).replace('/d/', '')
      return { quote: q.body, link }
    }
    const page = (link: string, id: string) => call(`/api/portal/d/${link}/quotes/${id}`).then(json)
    const pick = (link: string, id: string, group: string) => call(`/api/portal/d/${link}/quotes/${id}/choose-option`, { method: 'POST', json: { group } }).then(json)
    const sign = (link: string, id: string) => call(`/api/portal/d/${link}/quotes/${id}/approve`, { method: 'POST', json: SIGN }).then(json)

    beforeAll(async () => {
      t = await bootTenant({ vertical })
      const s = await seedOwner(t)
      ids.company = s.company.id
      await t.db.update(t.schema.company).set({ enabledFeatures: FEATURES, email: 'office@test.example' } as any).where(eq(t.schema.company.id, s.company.id))
      t.services.features.forgetFeatures()
      tok.owner = await signIn(s.owner.email, s.password)
      await t.db.insert(t.schema.user).values({ email: 'field@test.example', passwordHash: await Bun.password.hash('Seat-pass-1', 'bcrypt'), firstName: 'Fay', lastName: 'Field', role: 'field', companyId: s.company.id })
      tok.field = await signIn('field@test.example', 'Seat-pass-1')
      const email: any = t.services.email
      const real = email.send.bind(email)
      email.send = async (to: string, template: string, data: any, options?: any) => { sent.push({ template, data }); return real(to, template, data, options) }
      const [pat] = await t.db.insert(t.schema.contact).values({ companyId: s.company.id, name: 'Pat Client', email: 'pat@example.com', type: 'client' } as any).returning()
      ids.contact = pat.id
    }, 120_000)

    describe('it is off until the business has Quote Options', () => {
      test('option names are refused, and so is the office pick, with the feature off', async () => {
        const turn = async (on: boolean) => { await t.db.update(t.schema.company).set({ enabledFeatures: on ? FEATURES : FEATURES.filter((f) => f !== 'quote_options') } as any).where(eq(t.schema.company.id, ids.company)); t.services.features.forgetFeatures() }
        const { quote } = await sentQuote()
        await turn(false)
        const off = await make()
        expect(off.status).toBe(400)
        expect(off.body.error).toContain('not switched on')
        expect((await as('owner', `/api/quotes/${quote.id}/choose-option`, { method: 'POST', json: { group: 'Good' } })).status).toBe(403)
        await turn(true)
        expect((await make()).status).toBe(201)
      })
    })

    describe('the office writes the options', () => {
      test('lines sharing a name are one option; the quote opens with none picked and the shared lines only', async () => {
        const q = await make()
        expect(q.status).toBe(201)
        expect(Number(q.body.subtotal)).toBe(100)
        expect(q.body.lineItems.filter((l: any) => l.optionGroup).every((l: any) => l.optional && !l.selected)).toBe(true)
        const got = await as('owner', `/api/quotes/${q.body.id}`).then(json)
        expect(got.body.options.names).toEqual(['Good', 'Better', 'Best'])
        expect(got.body.options.picked).toBeNull()
        expect(got.body.options.totals.map((x: any) => [x.name, x.total])).toEqual([['Good', 3410], ['Better', 5610], ['Best', 6710]])
      })

      test('refused in words: one option alone, two picked at once, more than five, a name too long', async () => {
        const alone = await make({}, [{ description: 'Call', quantity: 1, unitPrice: 100 }, { description: 'Only', quantity: 1, unitPrice: 5, optionGroup: 'Good' }])
        expect(alone.status).toBe(400)
        expect(alone.body.error).toContain('at least two options')
        const two = await make({}, LINES.map((l) => (l.optionGroup === 'Good' || l.optionGroup === 'Best' ? { ...l, selected: true } : l)))
        expect(two.status).toBe(400)
        expect(two.body.error).toContain('Only one option')
        const six = await make({}, ['A', 'B', 'C', 'D', 'E', 'F'].map((g) => ({ description: g, quantity: 1, unitPrice: 1, optionGroup: g })))
        expect(six.status).toBe(400)
        expect(six.body.error).toContain('At most five')
        expect((await make({}, LINES.map((l, i) => (i === 1 ? { ...l, optionGroup: 'x'.repeat(41) } : l)))).status).toBe(400)
      })

      test('two options are an offer by themselves — no shared line is needed', async () => {
        const q = await make({}, [{ description: 'Good unit', quantity: 1, unitPrice: 10, optionGroup: 'Good' }, { description: 'Best unit', quantity: 1, unitPrice: 20, optionGroup: 'Best' }])
        expect(q.status).toBe(201)
      })

      test('a quote with no option names is exactly as before', async () => {
        const q = await make({}, [{ description: 'Tune-up', quantity: 1, unitPrice: 200 }])
        expect(q.status).toBe(201)
        expect(Number(q.body.total)).toBe(220)
        const got = await as('owner', `/api/quotes/${q.body.id}`).then(json)
        expect(got.body.options).toBeUndefined()
        expect((await as('owner', `/api/quotes/${q.body.id}/approve`, { method: 'POST' })).status).toBe(200)
      })
    })

    describe('the customer chooses on the sent quote', () => {
      test("the page shows each option's full price and deposit; nothing is picked yet", async () => {
        const { quote, link } = await sentQuote({ depositType: 'percent', depositValue: 25 })
        const p = await page(link, quote.id)
        expect(p.status).toBe(200)
        expect(p.body.options.names).toEqual(['Good', 'Better', 'Best'])
        expect(p.body.options.picked).toBeNull()
        expect(p.body.options.totals.map((x: any) => [x.name, x.total, x.deposit])).toEqual([['Good', '3410.00', '852.50'], ['Better', '5610.00', '1402.50'], ['Best', '6710.00', '1677.50']])
        expect(p.body.lineItems.find((l: any) => l.description === 'Better warranty').optionGroup).toBe('Better')
      })

      test('the customer cannot sign until an option is picked; the office cannot mark it approved either', async () => {
        const { quote, link } = await sentQuote()
        const early = await sign(link, quote.id)
        expect(early.status).toBe(400)
        expect(early.body.code).toBe('option_required')
        expect(early.body.error).toContain('Good, Better, Best')
        const office = await as('owner', `/api/quotes/${quote.id}/approve`, { method: 'POST' }).then(json)
        expect(office.status).toBe(400)
        expect(office.body.code).toBe('option_required')
      })

      test('picking turns that option on and the others off, and the total follows', async () => {
        const { quote, link } = await sentQuote()
        expect((await pick(link, quote.id, 'Nonsense')).status).toBe(404)
        const better = await pick(link, quote.id, 'Better')
        expect(better.status).toBe(200)
        expect(better.body.options.picked).toBe('Better')
        expect(better.body.total).toBe('5610.00')
        const on = better.body.lineItems.filter((l: any) => l.optionGroup && l.selected).map((l: any) => l.description)
        expect(on.sort()).toEqual(['Better furnace', 'Better warranty'])
        const best = await pick(link, quote.id, 'Best')
        expect(best.body.total).toBe('6710.00')
        expect(best.body.lineItems.filter((l: any) => l.optionGroup && l.selected).map((l: any) => l.description)).toEqual(['Best furnace'])
      })

      test('what is signed is the picked option: the fingerprint differs, the deposit follows, the invoice and job carry only it', async () => {
        const a = await sentQuote({ depositType: 'percent', depositValue: 25 })
        const b = await sentQuote({ depositType: 'percent', depositValue: 25 })
        await pick(a.link, a.quote.id, 'Good'); await pick(b.link, b.quote.id, 'Best')
        const signedA = await sign(a.link, a.quote.id)
        const signedB = await sign(b.link, b.quote.id)
        expect(signedA.status).toBe(200)
        expect(signedA.body.deposit).toMatchObject({ billKind: 'deposit', total: '852.50' })
        expect(signedB.body.deposit).toMatchObject({ billKind: 'deposit', total: '1677.50' })
        const rowOf = async (id: string) => (await t.db.select().from(t.schema.quote).where(eq(t.schema.quote.id, id)))[0] as any
        const ra = await rowOf(a.quote.id), rb = await rowOf(b.quote.id)
        expect(ra.signatureHash).toMatch(/^[0-9a-f]{64}$/)
        expect(ra.signatureHash).not.toBe(rb.signatureHash)
        expect(Number(ra.total)).toBe(3410)
        const inv = await as('owner', `/api/quotes/${b.quote.id}/convert-to-invoice`, { method: 'POST' }).then(json)
        expect(inv.status).toBe(201)
        expect(inv.body.lineItems.map((l: any) => l.description)).toEqual(['Service call', 'Best furnace'])
        expect(Number(inv.body.subtotal) + Number(inv.body.taxAmount)).toBe(6710) // the whole option…
        expect(Number(inv.body.total)).toBe(6710 - 1677.5) // …less the 25% deposit already billed
        const job = await as('owner', `/api/quotes/${a.quote.id}/convert-to-job`, { method: 'POST' }).then(json)
        expect(job.status).toBe(201)
        expect(job.body.description).toContain('Basic furnace')
        expect(job.body.description).not.toContain('Best furnace')
      })

      test('a fixed deposit is the same amount whichever option; one bigger than the cheapest option is refused', async () => {
        const { quote, link } = await sentQuote({ depositType: 'fixed', depositValue: 300 })
        await pick(link, quote.id, 'Good')
        expect((await sign(link, quote.id)).body.deposit).toMatchObject({ total: '300.00' })
        const tooBig = await make({ depositType: 'fixed', depositValue: 3500 })
        expect(tooBig.status).toBe(400) // the Good option is 3,410 with tax
      })

      test('after signing the pick is fixed; the choice cannot be changed from the link', async () => {
        const { quote, link } = await sentQuote()
        await pick(link, quote.id, 'Good')
        expect((await sign(link, quote.id)).status).toBe(200)
        expect((await pick(link, quote.id, 'Best')).status).toBe(400)
      })
    })

    describe('the office picks for a customer who says it by phone', () => {
      test('quotes:update picks; a field seat is refused; a signed quote is closed', async () => {
        const { quote } = await sentQuote({ depositType: 'percent', depositValue: 10 })
        expect((await as('field', `/api/quotes/${quote.id}/choose-option`, { method: 'POST', json: { group: 'Good' } })).status).toBe(403)
        expect((await as('owner', `/api/quotes/${quote.id}/choose-option`, { method: 'POST', json: { group: 'Nope' } })).status).toBe(404)
        const picked = await as('owner', `/api/quotes/${quote.id}/choose-option`, { method: 'POST', json: { group: 'Better' } }).then(json)
        expect(picked.status).toBe(200)
        expect(picked.body.total).toBe('5610.00')
        const approved = await as('owner', `/api/quotes/${quote.id}/approve`, { method: 'POST' }).then(json)
        expect(approved.status).toBe(200)
        expect(approved.body.deposit).toMatchObject({ total: '561.00' })
        expect((await as('owner', `/api/quotes/${quote.id}/choose-option`, { method: 'POST', json: { group: 'Best' } })).status).toBe(400)
      })
    })
  })
}
