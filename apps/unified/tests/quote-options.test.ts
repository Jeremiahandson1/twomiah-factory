// Good / Better / Best on every trade with quotes — the one implementation (docs/parity/quote-options-unify.md): proposal options
// (quote_proposal_option) behind the one feature `quote_proposals`. roof-gbb-proposals.test.ts covers roofing's job value, photos,
// the pricebook tiers and the switch; this file carries over what field service's first build promised, on field service, basic,
// contractor and landscaping, through the real server and the real login:
//   · the customer's page lists each option with its whole price (tax included) and its deposit;
//   · the customer cannot sign (and the office cannot mark it approved) until an option is chosen — refused with a code;
//   · what is signed is the chosen option: the signed fingerprint differs between options;
//   · the deposit invoice is the deposit of the chosen option's total — and the invoice and the job carry only its lines;
//   · a deposit bigger than the cheapest option is refused, on the quote and on the options;
//   · after signing the choice is fixed; the office can choose for a customer who says it by phone (quotes:update);
//   · the PDF before a choice prints the shared lines and every option; an optional line nobody ticked is not printed;
//   · a quote with no options behaves exactly as before.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { inflateSync } from 'node:zlib'
import { bootTenant, seedOwner } from './harness.ts'

const SIGN = { signature: 'data:image/png;base64,iVBORw0KGgo=', signedBy: 'Pat Client', consent: true }
const FEATURES = ['contacts', 'quotes', 'invoices', 'jobs', 'quote_proposals']

const SHARED = [{ description: 'Service call', quantity: 1, unitPrice: 100 }]
const OPTIONS = [
  { name: 'Good', tier: 'good', lines: [{ description: 'Basic furnace', quantity: 1, unitPrice: 3000 }] },
  { name: 'Better', tier: 'better', recommended: true, warranty: '10-year parts', lines: [{ description: 'Better furnace', quantity: 1, unitPrice: 4500 }, { description: 'Better warranty', quantity: 1, unitPrice: 500 }] },
  { name: 'Best', tier: 'best', lines: [{ description: 'Best furnace', quantity: 1, unitPrice: 6000 }] },
]

/** The text a PDF draws: pdfkit writes each page's content stream deflated, its strings as hex runs inside TJ arrays. */
function pdfText(buf: Uint8Array): string {
  const raw = Buffer.from(buf).toString('latin1')
  let out = ''
  for (const m of raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    let body: string
    try { body = inflateSync(Buffer.from(m[1], 'latin1')).toString('latin1') } catch { continue }
    for (const tj of body.matchAll(/\[(.*?)\]\s*TJ/g)) {
      for (const h of tj[1].matchAll(/<([0-9a-fA-F]+)>/g)) out += Buffer.from(h[1], 'hex').toString('latin1')
      out += '\n'
    }
  }
  return out
}

for (const vertical of ['fieldservice', 'basic', 'contractor', 'landscaping'] as const) {
  describe(`${vertical}`, () => {
    let t: Awaited<ReturnType<typeof bootTenant>>
    const tok: Record<string, string> = {}
    const ids: Record<string, string> = {}
    const sent: Array<{ template: string; data: any }> = []
    const as = async (who: string, path: string, init: any = {}) => await t.call(path, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${tok[who]}` } })
    const call = async (path: string, init: any = {}) => await t.call(path, init)
    const json = async (r: Response) => ({ status: r.status, body: await r.json() as any })
    const signIn = async (email: string, password: string) => (await (await t.call('/api/auth/login', { method: 'POST', json: { email, password } })).json() as any).accessToken

    /**
     * A quote with the shared line and, unless told otherwise, the three options; answered as the office reads it. As on the
     * screen, the options are added to the saved quote and a deposit after them: it is checked against the cheapest option.
     */
    async function make(extra: any = {}, options: any[] = OPTIONS) {
      const { depositType, depositValue, ...rest } = extra
      const q = await as('owner', '/api/quotes', { method: 'POST', json: { contactId: ids.contact, name: 'Furnace', taxRate: 10, lineItems: SHARED, ...rest } }).then(json)
      expect(q.status).toBe(201)
      let body = q.body
      if (options.length) {
        const put = await as('owner', `/api/quotes/${q.body.id}/proposal`, { method: 'PUT', json: { options } }).then(json)
        expect(put.status).toBe(200)
        body = put.body
      }
      if (depositType) {
        const dep = await as('owner', `/api/quotes/${q.body.id}`, { method: 'PUT', json: { depositType, depositValue } }).then(json)
        expect(dep.status).toBe(200)
        body = dep.body
      }
      return body
    }
    const optionId = (quote: any, name: string) => quote.proposal.options.find((o: any) => o.name === name).id as string
    /** A quote the office has sent, and the customer's own link to it. */
    async function sentQuote(extra: any = {}) {
      const quote = await make(extra)
      expect((await as('owner', `/api/quotes/${quote.id}/send`, { method: 'POST' })).status).toBe(200)
      const link = String(sent.filter((m) => m.template === 'quoteSent').at(-1)!.data.documentPath).replace('/d/', '')
      return { quote, link }
    }
    const page = (link: string, id: string) => call(`/api/portal/d/${link}/quotes/${id}`).then(json)
    const pick = (link: string, quote: any, name: string) => call(`/api/portal/d/${link}/quotes/${quote.id}/choose-option`, { method: 'POST', json: { optionId: optionId(quote, name) } }).then(json)
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

    test('the feature is offered to this trade, and the old option-name field is gone', async () => {
      const q = await make({}, [])
      const named = await as('owner', `/api/quotes/${q.id}`, { method: 'PUT', json: { lineItems: [{ ...SHARED[0], optionGroup: 'Good' }] } }).then(json)
      expect(named.status).toBe(200)
      expect(named.body.lineItems[0].optionGroup).toBeUndefined()
      expect(named.body.lineItems[0].optional).toBe(false)
      expect((await as('owner', `/api/quotes/${q.id}/choose-option`, { method: 'POST', json: { group: 'Good' } })).status).toBe(404)
    })

    test("the customer's page shows each option's whole price and deposit; nothing is chosen yet", async () => {
      const { quote, link } = await sentQuote({ depositType: 'percent', depositValue: 25 })
      const p = await page(link, quote.id)
      expect(p.status).toBe(200)
      expect(p.body.proposal.needsChoice).toBe(true)
      expect(p.body.proposal.options.map((o: any) => [o.name, o.price, o.deposit])).toEqual([['Good', '3410.00', '852.50'], ['Better', '5610.00', '1402.50'], ['Best', '6710.00', '1677.50']])
      expect(p.body.lineItems.map((l: any) => l.description)).toEqual(['Service call'])
      expect(p.body.options).toBeUndefined()
    })

    test('the customer cannot sign until an option is chosen; the office cannot mark it approved either', async () => {
      const { quote, link } = await sentQuote()
      const early = await sign(link, quote.id)
      expect([early.status, early.body.code]).toEqual([400, 'option_required'])
      const office = await as('owner', `/api/quotes/${quote.id}/approve`, { method: 'POST' }).then(json)
      expect([office.status, office.body.code]).toEqual([400, 'option_required'])
    })

    test('what is signed is the chosen option: the fingerprint differs, the deposit follows, the invoice and job carry only it', async () => {
      const a = await sentQuote({ depositType: 'percent', depositValue: 25 })
      const b = await sentQuote({ depositType: 'percent', depositValue: 25 })
      expect((await pick(a.link, a.quote, 'Good')).body.total).toBe('3410.00')
      expect((await pick(b.link, b.quote, 'Best')).body.total).toBe('6710.00')
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
      if (job.status !== 404) { // a trade whose quotes do not become jobs has no such route
        expect(job.status).toBe(201)
        expect(job.body.description).toContain('Basic furnace')
        expect(job.body.description).not.toContain('Best furnace')
      }
    })

    test('a fixed deposit is the same whichever option; one bigger than the cheapest option is refused', async () => {
      const { quote, link } = await sentQuote({ depositType: 'fixed', depositValue: 300 })
      await pick(link, quote, 'Good')
      expect((await sign(link, quote.id)).body.deposit).toMatchObject({ total: '300.00' })
      // On the quote: the Good option is 3,410 with tax, though the shared line alone is 110.
      const q = await make({ depositType: 'fixed', depositValue: 300 })
      expect((await as('owner', `/api/quotes/${q.id}`, { method: 'PUT', json: { depositType: 'fixed', depositValue: 3400 } })).status).toBe(200)
      const tooBig = await as('owner', `/api/quotes/${q.id}`, { method: 'PUT', json: { depositType: 'fixed', depositValue: 3500 } }).then(json)
      expect(tooBig.status).toBe(400)
      // On the options: a cheaper option under a deposit the quote already asks.
      const cheap = await as('owner', `/api/quotes/${q.id}/proposal`, { method: 'PUT', json: { options: [{ name: 'Patch', lines: [{ description: 'Patch', quantity: 1, unitPrice: 50 }] }, OPTIONS[2]] } }).then(json)
      expect(cheap.status).toBe(400)
      expect(cheap.body.error).toContain('cheapest option')
    })

    test('after signing the choice is fixed; the choice cannot be changed from the link', async () => {
      const { quote, link } = await sentQuote()
      await pick(link, quote, 'Good')
      expect((await sign(link, quote.id)).status).toBe(200)
      expect((await pick(link, quote, 'Best')).status).toBe(400)
    })

    test('the office chooses for a customer who says it by phone: quotes:update chooses, a field seat is refused, a signed quote is closed', async () => {
      const { quote } = await sentQuote({ depositType: 'percent', depositValue: 10 })
      const choose = (who: string, id: string) => as(who, `/api/quotes/${quote.id}/proposal/choose`, { method: 'POST', json: { optionId: id } })
      expect((await choose('field', optionId(quote, 'Good'))).status).toBe(403)
      expect((await choose('owner', 'nope')).status).toBe(404)
      const picked = await json(await choose('owner', optionId(quote, 'Better')))
      expect([picked.status, picked.body.total]).toEqual([200, '5610.00'])
      const approved = await as('owner', `/api/quotes/${quote.id}/approve`, { method: 'POST' }).then(json)
      expect(approved.status).toBe(200)
      expect(approved.body.deposit).toMatchObject({ total: '561.00' })
      expect((await choose('owner', optionId(quote, 'Best'))).status).toBe(400)
    })

    test('the PDF before a choice prints the shared lines and every option; an optional line nobody ticked is not printed', async () => {
      const q = await make()
      await as('owner', `/api/quotes/${q.id}`, { method: 'PUT', json: { lineItems: [...SHARED, { description: 'Duct cleaning add-on', quantity: 1, unitPrice: 200, optional: true }] } })
      const r = await as('owner', `/api/quotes/${q.id}/pdf`)
      expect(r.status).toBe(200)
      const text = pdfText(new Uint8Array(await r.arrayBuffer()))
      for (const s of ['Service call', 'Options', 'Good', 'Better', 'Best', 'Better warranty', 'Total: from']) expect(text).toContain(s)
      expect(text).not.toContain('Duct cleaning')
    })

    test('a quote with no options is exactly as before', async () => {
      const q = await make({}, [])
      expect(Number(q.total)).toBe(110)
      const got = await as('owner', `/api/quotes/${q.id}`).then(json)
      expect(got.body.proposal).toBeUndefined()
      expect((await as('owner', `/api/quotes/${q.id}/approve`, { method: 'POST' })).status).toBe(200)
    })
  })
}
