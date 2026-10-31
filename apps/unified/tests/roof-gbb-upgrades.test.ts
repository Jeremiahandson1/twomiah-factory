// Row 6 of the roofing parity brief (docs/parity/roof-gbb-proposals.md #13, #14), through the real server as the roofing vertical:
//   · an option carries UPGRADES (add-ons that belong to it alone): the customer chooses the option FIRST, then ticks its upgrades;
//     choosing the option does not tick them, choosing another option clears them, an upgrade of an option not chosen is refused;
//   · an option carries ONE DISCOUNT (a fixed amount in cents, or a percent of its price before upgrades), taken off while that option
//     is chosen — kept apart from the discount the office typed on the quote, and together they are the quote's discount, so the
//     invoice, the page and the signature agree with the total;
//   · the rules: a discount bigger than the option, a percent over 100, an upgrade ticked before a choice or after signing.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { inflateSync } from 'node:zlib'
import { bootTenant, seedOwner } from './harness.ts'

/** The text a PDF draws: pdfkit writes each page's content stream deflated, its strings as hex runs inside TJ arrays. */
function pdfText(buf: Uint8Array): string {
  const raw = Buffer.from(buf).toString('latin1')
  let out = ''
  for (const m of raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    let body: string
    try { body = inflateSync(Buffer.from(m[1], 'latin1')).toString('latin1') } catch { continue }
    for (const tj of body.matchAll(/\[(.*?)\]\s*TJ/g)) { for (const h of tj[1].matchAll(/<([0-9a-fA-F]+)>/g)) out += Buffer.from(h[1], 'hex').toString('latin1'); out += '\n' }
  }
  return out
}

type T = Awaited<ReturnType<typeof bootTenant>>
let t: T
let companyId = ''
const tokens: Record<string, string> = {}
const sent: Array<{ to: string; template: string; data: any }> = []
const SIGN = { signature: 'data:image/png;base64,iVBORw0KGgo=', signedBy: 'Lee Marsh', consent: true }
const FEATURES = ['jobs', 'contacts', 'quotes', 'invoices', 'quote_proposals']
let homeId = ''

const login = async (email: string, password: string) => (await (await t.call('/api/auth/login', { method: 'POST', json: { email, password } })).json()).accessToken as string
const as = (who: string) => (p: string, init: any = {}) => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${tokens[who]}` } })
const json = async (r: Response) => ({ status: r.status, body: await r.json() as any })
const setFeatures = async (features: string[]) => {
  await t.db.update(t.schema.company).set({ enabledFeatures: features } as any).where(eq(t.schema.company.id, companyId))
  t.services.features.forgetFeatures()
}
const SHARED = [{ description: 'Tear-off, disposal and permit', quantity: 1, unitPrice: 2000 }]
const OPTIONS = (extra: Record<string, any> = {}) => [
  { name: 'Good', tier: 'good', lines: [{ description: 'Supreme 3-tab shingles', quantity: 1, unitPrice: 5000 }], upgrades: [{ description: 'Ridge vent', quantity: 1, unitPrice: 400 }] },
  { name: 'Better', tier: 'better', lines: [{ description: 'Timberline HDZ shingles', quantity: 1, unitPrice: 6500 }, { description: 'Ice and water shield', quantity: 1, unitPrice: 800 }],
    upgrades: [{ description: 'Copper valleys', quantity: 1, unitPrice: 1200 }, { description: 'Skylight flashing kit', quantity: 2, unitPrice: 150 }], discount: { type: 'amount', cents: 50000 }, ...extra },
  { name: 'Best', tier: 'best', lines: [{ description: 'Designer shingles', quantity: 1, unitPrice: 9500 }, { description: 'Underlayment and ridge vent', quantity: 1, unitPrice: 1500 }],
    upgrades: [{ description: 'Gutter guards', quantity: 1, unitPrice: 900 }], discount: { type: 'percent', percent: 10 } },
]
async function quoteWith(options: any[], extra: Record<string, unknown> = {}) {
  const q = await json(await as('owner')('/api/quotes', { method: 'POST', json: { contactId: homeId, name: 'Roof replacement', taxRate: 0, lineItems: SHARED, ...extra } }))
  expect(q.status).toBe(201)
  const saved = await json(await as('owner')(`/api/quotes/${q.body.id}/proposal`, { method: 'PUT', json: { options } }))
  expect(saved.status).toBe(200)
  const r = await as('owner')(`/api/quotes/${q.body.id}/send`, { method: 'POST' })
  expect(r.status).toBe(200)
  const link = String(sent.filter((m) => m.template === 'quoteSent').at(-1)!.data.documentPath).replace('/d/', '')
  const opt = (name: string) => saved.body.proposal.options.find((o: any) => o.name === name)
  return { id: q.body.id as string, link, saved, opt }
}
const portal = (link: string, id: string, path: string, init: any = {}) => t.call(`/api/portal/d/${link}/quotes/${id}${path}`, init)
const pick = async (link: string, id: string, optionId: string) => json(await portal(link, id, '/choose-option', { method: 'POST', json: { optionId } }))
const tick = async (link: string, id: string, lineItemId: string, selected: boolean) => json(await portal(link, id, '/choose-upgrade', { method: 'POST', json: { lineItemId, selected } }))

beforeAll(async () => {
  process.env.FRONTEND_URL ||= 'https://app.roofer.example'
  t = await bootTenant({ vertical: 'roofing' })
  const seeded = await seedOwner(t)
  companyId = seeded.company.id
  tokens.owner = await login('owner@test.example', seeded.password)
  await t.db.update(t.schema.company).set({ email: 'office@roofer.example' } as any).where(eq(t.schema.company.id, companyId))
  await setFeatures(FEATURES)
  const email: any = t.services.email
  const realSend = email.send.bind(email)
  email.send = async (to: string, template: string, data: any, options?: any) => { sent.push({ to, template, data }); return realSend(to, template, data, options) }
  const hash = await Bun.password.hash('Seat-pass-1', 'bcrypt')
  await t.db.insert(t.schema.user).values({ email: 'book@test.example', passwordHash: hash, firstName: 'Bo', lastName: 'Keeper', role: 'viewer', companyId } as any)
  tokens.viewer = await login('book@test.example', 'Seat-pass-1')
  homeId = (((await t.db.insert(t.schema.contact).values({ companyId, name: 'Lee Marsh', email: 'lee@home.example', mobile: '715-555-0101', type: 'client' } as any).returning()) as any[])[0]).id
}, 120_000)

describe('upgrades belong to one option; the customer chooses the option first', () => {
  test('the office saves upgrades and a discount per option; they are priced apart from the option', async () => {
    const q = await quoteWith(OPTIONS())
    const better = q.opt('Better')
    // The price of an option is the shared lines + its own, less ITS discount; its upgrades are not in it until ticked.
    expect(q.saved.body.proposal.options.map((o: any) => [o.name, o.price, o.discount])).toEqual([['Good', '7000.00', '0.00'], ['Better', '8800.00', '500.00'], ['Best', '11700.00', '1300.00']])
    expect(better.lines.map((l: any) => l.description)).toEqual(['Timberline HDZ shingles', 'Ice and water shield'])
    expect(better.upgrades.map((l: any) => l.description)).toEqual(['Copper valleys', 'Skylight flashing kit'])
    expect(better).toMatchObject({ discountCents: 50000, discountPercent: 0 })
    expect(q.opt('Best')).toMatchObject({ discountCents: 0, discountPercent: 10 })
    expect(Number(q.saved.body.total)).toBe(2000)
    // Read back whole by the office.
    const read = await json(await as('owner')(`/api/quotes/${q.id}`))
    expect(read.body.proposal.options[1].upgrades.length).toBe(2)
  })

  test('the customer sees upgrades under their option; none can be ticked before an option is chosen', async () => {
    const q = await quoteWith(OPTIONS())
    const seen = await json(await portal(q.link, q.id, ''))
    const better = seen.body.proposal.options.find((o: any) => o.name === 'Better')
    expect(better.upgrades.map((u: any) => u.description)).toEqual(['Copper valleys', 'Skylight flashing kit'])
    expect(better.discount).toBe('500.00')
    expect(JSON.stringify(seen.body)).not.toContain('unitCost')
    const early = await tick(q.link, q.id, better.upgrades[0].id, true)
    expect(early.status).toBe(400)
    expect(early.body.error).toContain('Choose an option first')
    // Nothing was ticked.
    expect(Number((await json(await portal(q.link, q.id, ''))).body.total)).toBe(2000)
  })

  test('choosing the option does not tick its upgrades; ticking them moves the total; the discount holds', async () => {
    const q = await quoteWith(OPTIONS())
    const picked = await pick(q.link, q.id, q.opt('Better').id)
    expect(picked.status).toBe(200)
    expect(Number(picked.body.total)).toBe(8800)
    const better = picked.body.proposal.options.find((o: any) => o.chosen)
    expect(better.upgrades.every((u: any) => u.selected === false)).toBe(true)
    const [copper, skylight] = better.upgrades
    const one = await tick(q.link, q.id, copper.id, true)
    expect(one.status).toBe(200)
    expect(Number(one.body.total)).toBe(10000)
    const two = await tick(q.link, q.id, skylight.id, true)
    expect(Number(two.body.total)).toBe(10300)
    expect(Number(two.body.discount)).toBe(500)
    // The chosen option's own price now counts the ticked upgrades, and equals the quote's total.
    expect(two.body.proposal.options.find((o: any) => o.chosen).price).toBe('10300.00')
    const off = await tick(q.link, q.id, copper.id, false)
    expect(Number(off.body.total)).toBe(9100)
  })

  test('choosing another option clears the upgrades of the first; an upgrade of an option not chosen is refused', async () => {
    const q = await quoteWith(OPTIONS())
    const better = q.opt('Better'), best = q.opt('Best'), good = q.opt('Good')
    await pick(q.link, q.id, better.id)
    expect((await tick(q.link, q.id, better.upgrades[0].id, true)).status).toBe(200)
    const other = await tick(q.link, q.id, best.upgrades[0].id, true)
    expect(other.status).toBe(400)
    expect(other.body.error).toContain('did not choose')
    const moved = await pick(q.link, q.id, good.id)
    expect(Number(moved.body.total)).toBe(7000)
    // Back to Better: its upgrade is unticked again, as the option was chosen afresh.
    const back = await pick(q.link, q.id, better.id)
    expect(Number(back.body.total)).toBe(8800)
    // A line that is not an upgrade is not ticked here.
    const read = await json(await as('owner')(`/api/quotes/${q.id}`))
    expect((await tick(q.link, q.id, read.body.lineItems[0].id, true)).status).toBe(404)
  })
})

describe('one discount per option', () => {
  test('a percent discount is a percent of the option before its upgrades; the quote total, tax and the office discount follow', async () => {
    const q = await quoteWith(OPTIONS(), { taxRate: 10, discount: 100 })
    // Best: 2000 + 11000 = 13000; its 10% = 1300; the office's $100 on top; tax 10% on what is left.
    const best = q.opt('Best')
    const expectBest = (13000 - 1300 - 100) * 1.1
    expect(Number(best.price)).toBeCloseTo(expectBest, 2)
    const picked = await pick(q.link, q.id, best.id)
    expect(Number(picked.body.total)).toBeCloseTo(expectBest, 2)
    expect(Number(picked.body.discount)).toBe(1400)
    // A ticked upgrade is full price: the percent is not taken off it (but tax is).
    const withUp = await tick(q.link, q.id, best.upgrades[0].id, true)
    expect(Number(withUp.body.total)).toBeCloseTo((13000 + 900 - 1400) * 1.1, 2)
    // The office reads the discount IT typed, and the option's own beside it.
    const office = await json(await as('owner')(`/api/quotes/${q.id}`))
    expect(Number(office.body.discount)).toBe(100)
    expect(Number(office.body.optionDiscount)).toBe(1300)
    expect(Number(office.body.discountTotal)).toBe(1400)
  })

  test("editing the lines every option shares re-works a chosen option's percent discount, and keeps the office's own", async () => {
    const q = await quoteWith(OPTIONS(), { discount: 100 })
    await pick(q.link, q.id, q.opt('Best').id)
    const edited = await json(await as('owner')(`/api/quotes/${q.id}`, { method: 'PUT', json: { lineItems: [{ description: 'Tear-off, disposal and permit', quantity: 1, unitPrice: 3000 }] } }))
    expect(edited.status).toBe(200)
    // 3000 + 11000 = 14000; 10% = 1400; the office's 100 stays.
    expect(Number(edited.body.optionDiscount)).toBe(1400)
    expect(Number(edited.body.discount)).toBe(100)
    expect(Number(edited.body.total)).toBe(14000 - 1400 - 100)
    // The office changes ITS discount only.
    const again = await json(await as('owner')(`/api/quotes/${q.id}`, { method: 'PUT', json: { discount: 250 } }))
    expect(Number(again.body.total)).toBe(14000 - 1400 - 250)
    expect(Number(again.body.optionDiscount)).toBe(1400)
  })

  test('signed for the option and the upgrades ticked: the invoice bills exactly those, with the discount, and the signature names them', async () => {
    const q = await quoteWith(OPTIONS(), { taxRate: 10 })
    const better = q.opt('Better')
    await pick(q.link, q.id, better.id)
    await tick(q.link, q.id, better.upgrades[1].id, true)
    const signed = await json(await portal(q.link, q.id, '/approve', { method: 'POST', json: SIGN }))
    expect(signed.status).toBe(200)
    // (2000 + 7300 + 300 - 500) * 1.1
    const total = (2000 + 7300 + 300 - 500) * 1.1
    const inv = await json(await as('owner')(`/api/quotes/${q.id}/convert-to-invoice`, { method: 'POST' }))
    expect(inv.status).toBe(201)
    expect(inv.body.lineItems.map((l: any) => l.description).sort()).toEqual(['Ice and water shield', 'Skylight flashing kit', 'Tear-off, disposal and permit', 'Timberline HDZ shingles'])
    expect(Number(inv.body.discount)).toBe(500)
    expect(Number(inv.body.total)).toBeCloseTo(total, 2)
    expect(Number(inv.body.subtotal) - Number(inv.body.discount) + Number(inv.body.taxAmount)).toBeCloseTo(Number(inv.body.total), 2)
    // Once signed, the upgrades are the record: no more ticking, from the customer or the office.
    expect((await tick(q.link, q.id, better.upgrades[0].id, true)).status).toBe(400)
    expect((await as('owner')(`/api/quotes/${q.id}/proposal/upgrade`, { method: 'POST', json: { lineItemId: better.upgrades[0].id, selected: true } })).status).toBe(400)
  })

  test('the rules: a discount over the option price, a percent over 100, a discount of nothing', async () => {
    const q = await json(await as('owner')('/api/quotes', { method: 'POST', json: { contactId: homeId, name: 'Rules', taxRate: 0, lineItems: SHARED } }))
    const put = (options: any[], who = 'owner') => as(who)(`/api/quotes/${q.body.id}/proposal`, { method: 'PUT', json: { options } })
    const [good, better] = OPTIONS()
    expect((await put([{ ...good, discount: { type: 'amount', cents: 800000 } }, better])).status).toBe(400)
    expect((await put([{ ...good, discount: { type: 'percent', percent: 101 } }, better])).status).toBe(400)
    expect((await put([{ ...good, discount: { type: 'amount', cents: 0 } }, better])).status).toBe(400)
    expect((await put([{ ...good, upgrades: Array.from({ length: 13 }, (_, i) => ({ description: `Up ${i}`, quantity: 1, unitPrice: 1 })) }, better])).status).toBe(400)
    expect((await put([good, better], 'viewer')).status).toBe(403)
    // A discount equal to the whole option is allowed (a free option is a decision, not an error).
    expect((await put([{ ...good, discount: { type: 'amount', cents: 700000 } }, better])).status).toBe(200)
  })

  test('the office can tick an upgrade for a customer on the phone; not before an option is chosen; not without the feature', async () => {
    const q = await quoteWith(OPTIONS())
    const better = q.opt('Better')
    const up = (lineItemId: string, selected = true) => as('owner')(`/api/quotes/${q.id}/proposal/upgrade`, { method: 'POST', json: { lineItemId, selected } })
    expect((await up(better.upgrades[0].id)).status).toBe(400)
    await as('owner')(`/api/quotes/${q.id}/proposal/choose`, { method: 'POST', json: { optionId: better.id } })
    const ok = await json(await up(better.upgrades[0].id))
    expect(ok.status).toBe(200)
    expect(Number(ok.body.total)).toBe(10000)
    await setFeatures(FEATURES.filter((f) => f !== 'quote_proposals'))
    expect((await up(better.upgrades[0].id, false)).status).toBe(403)
    expect((await tick(q.link, q.id, better.upgrades[0].id, false)).status).toBe(404)
    await setFeatures(FEATURES)
  })

  test('a quote without options is unchanged: its optional lines and its discount work as before', async () => {
    const q = await json(await as('owner')('/api/quotes', { method: 'POST', json: { contactId: homeId, name: 'Plain', taxRate: 0, discount: 50, lineItems: [{ description: 'Repair', quantity: 1, unitPrice: 1000 }, { description: 'Gutter clean', quantity: 1, unitPrice: 200, optional: true }] } }))
    expect(Number(q.body.total)).toBe(950)
    expect(q.body.proposal).toBeUndefined()
    expect(Number(q.body.discount)).toBe(50)
    const line = q.body.lineItems.find((l: any) => l.optional)
    const ticked = await json(await as('owner')(`/api/quotes/${q.body.id}/options`, { method: 'POST', json: { lineItemId: line.id, selected: true } }))
    expect(Number(ticked.body.total)).toBe(1150)
    expect(Number(ticked.body.discount)).toBe(50)
  })
})

describe('the quote PDF', () => {
  test('before a choice it prints each option with its discount and its upgrades; after, the lines bought and the discount taken', async () => {
    const q = await quoteWith(OPTIONS())
    const before = pdfText(new Uint8Array(await (await as('owner')(`/api/quotes/${q.id}/pdf`)).arrayBuffer()))
    expect(before).toContain('Discount on this option: -$500.00')
    expect(before).toContain('Optional upgrades, offered once this option is chosen:')
    expect(before).toContain('+ Copper valleys: $1,200.00')
    const better = q.opt('Better')
    await pick(q.link, q.id, better.id)
    await tick(q.link, q.id, better.upgrades[0].id, true)
    const after = pdfText(new Uint8Array(await (await portal(q.link, q.id, '/pdf')).arrayBuffer()))
    expect(after).toContain('Copper valleys')
    expect(after).not.toContain('Skylight flashing kit')
    expect(after).toContain('Discount: -$500.00')
    expect(after).toContain('$10,000.00')
  })
})
