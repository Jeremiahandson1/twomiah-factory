// Good / Better / Best, finished (docs/parity/fieldservice-quote-options.md rows 5 and 6; quote-options-unify.md): a quote's
// options sit in up to THREE SETS (Jobber), and a set may be ADDITIVE (Housecall Pro "approve more than one option",
// ServiceTitan additive options). Through the real server and the real login, on field service and basic:
//   · three sets on one quote — two the customer picks one of, one they add any of — named, 2–6 options each; a fourth set,
//     a set of one, a set of seven and unnamed sets are refused;
//   · the customer's page lists the sets with their kind; each pick-one option at the whole job's price, each add-on at
//     what it adds; the total "from" the cheapest pick of every set;
//   · the customer cannot sign until EVERY pick-one set is picked (code option_required); add-ons never block signing;
//   · picking in one set leaves the other sets' picks alone; an add-on is added and removed on its own; a pick-one set's
//     pick cannot be taken back, only moved;
//   · the deposit, the signed fingerprint (which names every pick), the invoice and the job follow every pick together;
//   · a deposit bigger than the cheapest combination is refused, on the quote and on the options;
//   · the office picks and adds for a customer who says it by phone;
//   · the PDF prints each set under its name — choose one / add any — and the email lists each option under its set;
//   · the quote-options.test.ts single set still passes (run it too): one unnamed pick-one set is what it always was.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { inflateSync } from 'node:zlib'
import { bootTenant, seedOwner } from './harness.ts'

const SIGN = { signature: 'data:image/png;base64,iVBORw0KGgo=', signedBy: 'Pat Client', consent: true }
const FEATURES = ['contacts', 'quotes', 'invoices', 'jobs', 'quote_proposals']

const SHARED = [{ description: 'Service call', quantity: 1, unitPrice: 100 }]
const line = (description: string, unitPrice: number) => ({ description, quantity: 1, unitPrice })
const FURNACE = { name: 'Furnace', kind: 'one', options: [
  { name: 'Good', tier: 'good', lines: [line('Basic furnace', 3000)] },
  { name: 'Better', tier: 'better', recommended: true, lines: [line('Better furnace', 4500), line('Better warranty', 500)] },
  { name: 'Best', tier: 'best', lines: [line('Best furnace', 6000)] },
] }
const THERMOSTAT = { name: 'Thermostat', kind: 'one', options: [{ name: 'Basic', lines: [line('Basic thermostat', 200)] }, { name: 'Smart', lines: [line('Smart thermostat', 400)] }] }
const ADDONS = { name: 'Add-ons', kind: 'any', options: [{ name: 'Humidifier', lines: [line('Whole-home humidifier', 800)] }, { name: 'Air purifier', lines: [line('Air purifier', 1200)] }] }
const SETS = [FURNACE, THERMOSTAT, ADDONS]

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

    /** A quote with the shared line and the three sets; a deposit after them (checked against the cheapest combination). */
    async function make(extra: any = {}, sets: any[] = SETS) {
      const { depositType, depositValue, ...rest } = extra
      const q = await as('owner', '/api/quotes', { method: 'POST', json: { contactId: ids.contact, name: 'Furnace and extras', taxRate: 10, lineItems: SHARED, ...rest } }).then(json)
      expect(q.status).toBe(201)
      let body = q.body
      if (sets.length) {
        const put = await as('owner', `/api/quotes/${q.body.id}/proposal`, { method: 'PUT', json: { sets } }).then(json)
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
    async function sentQuote(extra: any = {}) {
      const quote = await make(extra)
      expect((await as('owner', `/api/quotes/${quote.id}/send`, { method: 'POST' })).status).toBe(200)
      const link = String(sent.filter((m) => m.template === 'quoteSent').at(-1)!.data.documentPath).replace('/d/', '')
      return { quote, link }
    }
    const page = (link: string, id: string) => call(`/api/portal/d/${link}/quotes/${id}`).then(json)
    const pick = (link: string, quote: any, name: string, chosen?: boolean) => call(`/api/portal/d/${link}/quotes/${quote.id}/choose-option`, { method: 'POST', json: { optionId: optionId(quote, name), ...(chosen === undefined ? {} : { chosen }) } }).then(json)
    const sign = (link: string, id: string) => call(`/api/portal/d/${link}/quotes/${id}/approve`, { method: 'POST', json: SIGN }).then(json)

    beforeAll(async () => {
      t = await bootTenant({ vertical })
      const s = await seedOwner(t)
      ids.company = s.company.id
      await t.db.update(t.schema.company).set({ enabledFeatures: FEATURES, email: 'office@test.example' } as any).where(eq(t.schema.company.id, s.company.id))
      t.services.features.forgetFeatures()
      tok.owner = await signIn(s.owner.email, s.password)
      const email: any = t.services.email
      const real = email.send.bind(email)
      email.send = async (to: string, template: string, data: any, options?: any) => { sent.push({ template, data }); return real(to, template, data, options) }
      const [pat] = await t.db.insert(t.schema.contact).values({ companyId: s.company.id, name: 'Pat Client', email: 'pat@example.com', type: 'client' } as any).returning()
      ids.contact = pat.id
    }, 120_000)

    test('three sets on one quote, each named and of a kind; the limits are refused in words', async () => {
      const q = await make()
      expect(q.proposal.sets.map((s: any) => [s.name, s.kind, s.options.length, s.needsChoice])).toEqual([['Furnace', 'one', 3, true], ['Thermostat', 'one', 2, true], ['Add-ons', 'any', 2, false]])
      expect(q.proposal.options.map((o: any) => o.setName)).toEqual(['Furnace', 'Furnace', 'Furnace', 'Thermostat', 'Thermostat', 'Add-ons', 'Add-ons'])
      expect(q.proposal.needsChoice).toBe(true)
      expect(q.proposal.lowest.total).toBe('3630.00') // service call + Good + Basic, tax in; no add-on
      expect(Number(q.total)).toBe(110) // until something is picked the quote counts only the shared line
      const put = (sets: any[]) => as('owner', `/api/quotes/${q.id}/proposal`, { method: 'PUT', json: { sets } }).then(json)
      expect((await put([FURNACE, THERMOSTAT, ADDONS, { ...ADDONS, name: 'More' }])).status).toBe(400)
      expect((await put([FURNACE, { ...THERMOSTAT, options: [THERMOSTAT.options[0]] }])).status).toBe(400)
      expect((await put([{ ...FURNACE, options: Array.from({ length: 7 }, (_, i) => ({ name: `Option ${i}`, lines: [line('x', 10)] })) }])).status).toBe(400)
      const unnamed = await put([{ ...FURNACE, name: null }, THERMOSTAT])
      expect([unnamed.status, unnamed.body.error]).toEqual([400, expect.stringContaining('Name each set')])
      // The only set may go unnamed: the customer sees "Options", as every quote written before sets.
      const one = await put([{ ...FURNACE, name: null }])
      expect([one.status, one.body.proposal.sets[0].name]).toEqual([200, 'Options'])
    })

    test("the customer's page shows each set: a pick-one option at the whole job's price, an add-on at what it adds", async () => {
      const { quote, link } = await sentQuote({ depositType: 'percent', depositValue: 25 })
      const p = await page(link, quote.id)
      expect(p.status).toBe(200)
      expect(p.body.proposal.sets.map((s: any) => [s.name, s.kind])).toEqual([['Furnace', 'one'], ['Thermostat', 'one'], ['Add-ons', 'any']])
      const furnace = p.body.proposal.sets[0].options.map((o: any) => [o.name, o.price, o.deposit])
      expect(furnace).toEqual([['Good', '3410.00', '852.50'], ['Better', '5610.00', '1402.50'], ['Best', '6710.00', '1677.50']])
      expect(p.body.proposal.sets[2].options.map((o: any) => [o.name, o.addPrice])).toEqual([['Humidifier', '880.00'], ['Air purifier', '1320.00']])
      expect(p.body.proposal.lowest.total).toBe('3630.00')
      expect(p.body.lineItems.map((l: any) => l.description)).toEqual(['Service call'])
      // The email that carried the link listed each option under its set, the total "from" the cheapest combination.
      const mail = sent.filter((m) => m.template === 'quoteSent').at(-1)!.data
      expect(mail.total).toBe('3630.00')
      expect(mail.lineItems.map((l: any) => l.description)).toEqual(expect.arrayContaining(['Furnace: Good', 'Thermostat: Smart', 'Add-ons: Humidifier (add-on)']))
      expect(mail.lineItems.find((l: any) => l.description === 'Add-ons: Humidifier (add-on)').total).toBe('880.00')
    })

    test('every pick-one set must be picked before signing; add-ons never block; picks in one set leave the others alone', async () => {
      const { quote, link } = await sentQuote()
      expect([(await sign(link, quote.id)).status, (await sign(link, quote.id)).body.code]).toEqual([400, 'option_required'])
      const better = await pick(link, quote, 'Better')
      expect([better.status, better.body.total, better.body.proposal.needsChoice]).toEqual([200, '5610.00', true])
      // Once the furnace is picked, each thermostat is priced with it.
      expect(better.body.proposal.sets[1].options.map((o: any) => [o.name, o.price])).toEqual([['Basic', '5830.00'], ['Smart', '6050.00']])
      const early = await sign(link, quote.id)
      expect([early.status, early.body.code]).toEqual([400, 'option_required'])
      const smart = await pick(link, quote, 'Smart')
      expect([smart.body.total, smart.body.proposal.needsChoice, smart.body.proposal.chosenOptionIds.length]).toEqual(['6050.00', false, 2])
      // Moving the furnace pick keeps the thermostat pick.
      const best = await pick(link, quote, 'Best')
      expect([best.body.total, best.body.proposal.sets[1].chosenOptionIds]).toEqual(['7150.00', [optionId(quote, 'Smart')]])
      // A pick-one pick cannot be taken back, only moved.
      expect((await pick(link, quote, 'Best', false)).status).toBe(400)
      const office = await as('owner', `/api/quotes/${quote.id}/approve`, { method: 'POST' }).then(json)
      expect(office.status).toBe(200)
    })

    test('add-ons are added and removed one by one; the deposit, the fingerprint, the invoice and the job follow every pick', async () => {
      const a = await sentQuote({ depositType: 'percent', depositValue: 25 })
      const b = await sentQuote({ depositType: 'percent', depositValue: 25 })
      for (const { quote, link } of [a, b]) { await pick(link, quote, 'Better'); await pick(link, quote, 'Smart') }
      expect((await pick(a.link, a.quote, 'Humidifier')).body.total).toBe('6930.00')
      expect((await pick(a.link, a.quote, 'Air purifier', true)).body.total).toBe('8250.00')
      const dropped = await pick(a.link, a.quote, 'Humidifier', false)
      expect([dropped.body.total, dropped.body.proposal.sets[2].chosenOptionIds]).toEqual(['7370.00', [optionId(a.quote, 'Air purifier')]])
      const signedA = await sign(a.link, a.quote.id)
      const signedB = await sign(b.link, b.quote.id)
      expect(signedA.status).toBe(200)
      expect(signedA.body.deposit).toMatchObject({ billKind: 'deposit', total: '1842.50' })
      expect(signedB.body.deposit).toMatchObject({ billKind: 'deposit', total: '1512.50' })
      const rowOf = async (id: string) => (await t.db.select().from(t.schema.quote).where(eq(t.schema.quote.id, id)))[0] as any
      const ra = await rowOf(a.quote.id), rb = await rowOf(b.quote.id)
      expect(ra.signatureHash).toMatch(/^[0-9a-f]{64}$/)
      expect(ra.signatureHash).not.toBe(rb.signatureHash)
      const audit = (await t.db.select().from(t.schema.auditLog).where(eq(t.schema.auditLog.entityId, a.quote.id))).find((x: any) => x.action === 'quote.signed') as any
      expect(audit.metadata.option).toBe('Better + Smart + Air purifier')
      const inv = await as('owner', `/api/quotes/${a.quote.id}/convert-to-invoice`, { method: 'POST' }).then(json)
      expect(inv.status).toBe(201)
      expect(inv.body.lineItems.map((l: any) => l.description)).toEqual(['Service call', 'Better furnace', 'Better warranty', 'Smart thermostat', 'Air purifier'])
      expect(Number(inv.body.subtotal) + Number(inv.body.taxAmount)).toBe(7370)
      expect(Number(inv.body.total)).toBe(7370 - 1842.5)
      const job = await as('owner', `/api/quotes/${b.quote.id}/convert-to-job`, { method: 'POST' }).then(json)
      if (job.status !== 404) {
        expect(job.status).toBe(201)
        for (const s of ['Better furnace', 'Smart thermostat']) expect(job.body.description).toContain(s)
        for (const s of ['Basic thermostat', 'Humidifier', 'Best furnace']) expect(job.body.description).not.toContain(s)
      }
    })

    test('a deposit bigger than the cheapest combination is refused, on the quote and on the options', async () => {
      const q = await make()
      expect((await as('owner', `/api/quotes/${q.id}`, { method: 'PUT', json: { depositType: 'fixed', depositValue: 3630 } })).status).toBe(200)
      const tooBig = await as('owner', `/api/quotes/${q.id}`, { method: 'PUT', json: { depositType: 'fixed', depositValue: 3700 } }).then(json)
      expect(tooBig.status).toBe(400)
      // A cheaper thermostat under the deposit the quote already asks: 3,520 with it, less than the 3,630 asked.
      const cheap = await as('owner', `/api/quotes/${q.id}/proposal`, { method: 'PUT', json: { sets: [FURNACE, { ...THERMOSTAT, options: [{ name: 'Dial', lines: [line('Dial thermostat', 100)] }, THERMOSTAT.options[1]] }, ADDONS] } }).then(json)
      expect([cheap.status, cheap.body.error]).toEqual([400, expect.stringContaining('cheapest option')])
    })

    test('the office picks and adds for a customer who says it by phone', async () => {
      const { quote } = await sentQuote({ depositType: 'percent', depositValue: 10 })
      const choose = (name: string, chosen?: boolean) => as('owner', `/api/quotes/${quote.id}/proposal/choose`, { method: 'POST', json: { optionId: optionId(quote, name), ...(chosen === undefined ? {} : { chosen }) } }).then(json)
      await choose('Good'); await choose('Basic')
      const added = await choose('Humidifier', true)
      expect([added.status, added.body.total]).toEqual([200, '4510.00'])
      expect((await choose('Humidifier', false)).body.total).toBe('3630.00')
      expect((await choose('Good', false)).status).toBe(400)
      const approved = await as('owner', `/api/quotes/${quote.id}/approve`, { method: 'POST' }).then(json)
      expect([approved.status, approved.body.deposit.total]).toEqual([200, '363.00'])
    })

    test('the PDF prints each set under its name — choose one, add any — and offers the add-ons until the quote is signed', async () => {
      const q = await make()
      const text = async () => pdfText(new Uint8Array(await (await as('owner', `/api/quotes/${q.id}/pdf`)).arrayBuffer()))
      let s = await text()
      for (const w of ['Service call', 'Furnace', 'choose one', 'Thermostat', 'Add-ons', 'add any', 'Humidifier', 'Total: from']) expect(s).toContain(w)
      const choose = (name: string) => as('owner', `/api/quotes/${q.id}/proposal/choose`, { method: 'POST', json: { optionId: optionId(q, name) } })
      await choose('Good'); await choose('Basic')
      s = await text()
      expect(s).toContain('add any')
      expect(s).toContain('Good')
      expect(s).not.toContain('Total: from')
      expect(s).toContain('Total:')
    })
  })
}
