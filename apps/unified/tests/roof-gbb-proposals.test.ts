// A Good / Better / Best roofing proposal the homeowner chooses (docs/parity/roof-gbb-proposals.md; roofing depth, gap 3),
// through the real server as the roofing vertical:
//   · the office builds one quote with three options — each with its lines, a brand, a warranty and photos — beside the
//     lines every option shares; a seat without quotes:update cannot, and a business without the feature cannot;
//   · the homeowner opens the quote's own /d/<token> link (no sign-in), sees each option and what the whole job comes to
//     with it, picks one, and signs; signing without a pick is refused, here and when the office marks it approved;
//   · the pick becomes the accepted price: the quote's total, the roof job's value, the invoice and the progress billing —
//     and an option nobody chose is on none of them;
//   · a signed proposal is a record: no more picking, no more editing its options;
//   · an item's pricebook tiers become the options in one step; the shared lines can be edited without losing the options.
// Nothing here reaches Stripe, the mail provider or a real tenant.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'

type T = Awaited<ReturnType<typeof bootTenant>>
let t: T
let companyId = ''
const tokens: Record<string, string> = {}
const ids: Record<string, string> = {}
const PASS = 'Seat-pass-1'
const sent: Array<{ to: string; template: string; data: any }> = []
const SIGN = { signature: 'data:image/png;base64,iVBORw0KGgo=', signedBy: 'Lee Marsh', consent: true }
const FEATURES = ['jobs', 'contacts', 'quotes', 'invoices', 'pricebook', 'quote_proposals']

const login = async (email: string, password: string) =>
  (await (await t.call('/api/auth/login', { method: 'POST', json: { email, password } })).json()).accessToken as string
const as = (who: string) => (p: string, init: any = {}) => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${tokens[who]}` } })
const json = async (r: Response) => ({ status: r.status, body: await r.json() as any })
const ins = async (table: any, values: any) => ((await t.db.insert(table).values(values).returning()) as any[])[0]
const setFeatures = async (features: string[]) => {
  await t.db.update(t.schema.company).set({ enabledFeatures: features } as any).where(eq(t.schema.company.id, companyId))
  t.services.features.forgetFeatures()
}

const SHARED = [{ description: 'Tear-off, disposal and permit', quantity: 1, unitPrice: 2000 }]
const OPTIONS = [
  { name: 'Good', tier: 'good', brand: 'Owens Corning Supreme', warranty: '25-year limited shingle warranty', description: 'Three-tab shingles',
    photos: ['https://img.roofer.example/good.jpg'], lines: [{ description: 'Supreme 3-tab shingles, 30 squares', quantity: 1, unitPrice: 5000 }] },
  { name: 'Better', tier: 'better', brand: 'GAF Timberline HDZ', warranty: 'Lifetime shingle warranty, 10-year workmanship', description: 'Architectural shingles with ice and water at the eaves',
    photos: ['https://img.roofer.example/better.jpg', '/media/photos/better-2.jpg'], recommended: true,
    lines: [{ description: 'Timberline HDZ shingles, 30 squares', quantity: 1, unitPrice: 6500 }, { description: 'Ice and water shield, eaves and valleys', quantity: 1, unitPrice: 800 }] },
  { name: 'Best', tier: 'best', brand: 'GAF Designer Slate', warranty: 'Lifetime system warranty, 50-year workmanship', description: 'Designer shingles, full synthetic underlayment, ridge vent',
    photos: ['https://img.roofer.example/best.jpg'], lines: [{ description: 'Designer shingles, 30 squares', quantity: 1, unitPrice: 9500 }, { description: 'Synthetic underlayment and ridge vent', quantity: 1, unitPrice: 1500 }] },
]
// What the whole job comes to with each option (the shared $2,000 plus the option's own lines, no tax on this quote).
const PRICE = { good: 7000, better: 9300, best: 13000 }

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
  ;(t.services as any).crm.sms.sendSMS = async () => ({ success: true })
  const hash = await Bun.password.hash(PASS, 'bcrypt')
  await t.db.insert(t.schema.user).values({ email: 'book@test.example', passwordHash: hash, firstName: 'Bo', lastName: 'Keeper', role: 'viewer', companyId } as any)
  tokens.viewer = await login('book@test.example', PASS)
  ids.home = (await ins(t.schema.contact, { companyId, name: 'Lee Marsh', email: 'lee@home.example', mobile: '715-555-0101', type: 'client' })).id
}, 120_000)

/** A roofing job and a quote written for it, with the shared lines. */
async function jobAndQuote(extra: Record<string, unknown> = {}) {
  const job = await json(await as('owner')('/api/jobs', { method: 'POST', json: {
    contactId: ids.home, jobType: 'retail', propertyAddress: `${100 + Math.floor(Math.random() * 800)} Elm St`, city: 'Akron', state: 'OH', zip: '44301', estimatedRevenue: 12000, totalSquares: 30,
  } }))
  expect(job.status).toBe(201)
  const q = await json(await as('owner')('/api/quotes', { method: 'POST', json: { contactId: ids.home, jobId: job.body.id, name: 'Roof replacement', taxRate: 0, lineItems: SHARED, ...extra } }))
  expect(q.status).toBe(201)
  return { jobId: job.body.id as string, quoteId: q.body.id as string }
}
const putOptions = (quoteId: string, options: any[], who = 'owner') => as(who)(`/api/quotes/${quoteId}/proposal`, { method: 'PUT', json: { options } })
/** Send the quote and return the token of its own link, as the homeowner's email carries it. */
async function sendIt(quoteId: string) {
  const r = await as('owner')(`/api/quotes/${quoteId}/send`, { method: 'POST' })
  expect(r.status).toBe(200)
  return String(sent.filter((m) => m.template === 'quoteSent').at(-1)!.data.documentPath).replace('/d/', '')
}

let jobId = '', quoteId = '', link = ''
let chosenId = ''

describe('the office builds the proposal', () => {
  test('three options with lines, brand, warranty and photos sit beside the lines they share; nothing is chosen yet', async () => {
    ;({ jobId, quoteId } = await jobAndQuote())
    const saved = await json(await putOptions(quoteId, OPTIONS))
    expect(saved.status).toBe(200)
    // The shared lines stay the quote's lines; the options come apart, each priced as the whole job.
    expect(saved.body.lineItems.map((l: any) => l.description)).toEqual(['Tear-off, disposal and permit'])
    expect(saved.body.proposal.needsChoice).toBe(true)
    expect(saved.body.proposal.options.map((o: any) => [o.name, o.price])).toEqual([['Good', '7000.00'], ['Better', '9300.00'], ['Best', '13000.00']])
    const better = saved.body.proposal.options[1]
    expect(better).toMatchObject({ brand: 'GAF Timberline HDZ', warranty: 'Lifetime shingle warranty, 10-year workmanship', recommended: true, chosen: false })
    expect(better.photos).toEqual(['https://img.roofer.example/better.jpg', '/media/photos/better-2.jpg'])
    expect(better.lines.length).toBe(2)
    // Until someone chooses, the quote counts only what every option shares.
    expect(Number(saved.body.total)).toBe(2000)
    ids.better = better.id; ids.good = saved.body.proposal.options[0].id; ids.best = saved.body.proposal.options[2].id
    // Read back whole, and the office's edit form still sees only the shared lines.
    const read = await json(await as('owner')(`/api/quotes/${quoteId}`))
    expect(read.body.lineItems.length).toBe(1)
    expect(read.body.proposal.options.length).toBe(3)
  })

  test('editing the lines the options share keeps the options, and every option is priced on the new figure', async () => {
    const read = await json(await as('owner')(`/api/quotes/${quoteId}`))
    const edited = await json(await as('owner')(`/api/quotes/${quoteId}`, { method: 'PUT', json: { lineItems: [{ description: 'Tear-off, disposal and permit', quantity: 1, unitPrice: 2500 }] } }))
    expect(edited.status).toBe(200)
    expect(edited.body.proposal.options.map((o: any) => o.price)).toEqual(['7500.00', '9800.00', '13500.00'])
    expect(edited.body.lineItems.length).toBe(1)
    // …and back, for the figures the rest of the test reads.
    await as('owner')(`/api/quotes/${quoteId}`, { method: 'PUT', json: { lineItems: [{ description: read.body.lineItems[0].description, quantity: 1, unitPrice: 2000 }] } })
    const again = await json(await as('owner')(`/api/quotes/${quoteId}`))
    expect(again.body.proposal.options.map((o: any) => o.price)).toEqual(['7000.00', '9300.00', '13000.00'])
  })

  test('a seat without quotes:update is refused by the server; so is a business without the feature', async () => {
    const q = await jobAndQuote()
    const viewer = await putOptions(q.quoteId, OPTIONS, 'viewer')
    expect(viewer.status).toBe(403)
    expect((await as('viewer')(`/api/quotes/${quoteId}/proposal/choose`, { method: 'POST', json: { optionId: ids.good } })).status).toBe(403)
    // The refused attempt wrote nothing.
    expect((await json(await as('owner')(`/api/quotes/${q.quoteId}`))).body.proposal).toBeUndefined()
    await setFeatures(FEATURES.filter((f) => f !== 'quote_proposals'))
    expect((await putOptions(q.quoteId, OPTIONS)).status).toBe(403)
    await setFeatures(FEATURES)
  })

  test('the rules: at least two options, photos are web or /media addresses, a name and a line each, at most six', async () => {
    const q = await jobAndQuote()
    expect((await putOptions(q.quoteId, [OPTIONS[0]])).status).toBe(400)
    expect((await putOptions(q.quoteId, [{ ...OPTIONS[0], photos: ['javascript:alert(1)'] }, OPTIONS[1]])).status).toBe(400)
    expect((await putOptions(q.quoteId, [{ ...OPTIONS[0], lines: [] }, OPTIONS[1]])).status).toBe(400)
    expect((await putOptions(q.quoteId, [{ ...OPTIONS[0], name: ' ' }, OPTIONS[1]])).status).toBe(400)
    expect((await putOptions(q.quoteId, Array.from({ length: 7 }, (_, i) => ({ ...OPTIONS[0], name: `Option ${i}` })))).status).toBe(400)
    // Two is a choice; none clears the proposal.
    expect((await putOptions(q.quoteId, [OPTIONS[0], OPTIONS[2]])).status).toBe(200)
    const cleared = await json(await putOptions(q.quoteId, []))
    expect(cleared.status).toBe(200)
    expect(cleared.body.proposal).toBeUndefined()
    expect(Number(cleared.body.total)).toBe(2000)
  })

  test("an item's Good / Better / Best tiers in the pricebook become the options in one step", async () => {
    const item = await ins(t.schema.pricebookItem, { companyId, name: 'Architectural reroof, per job', price: 8000, cost: 5000, type: 'service', imageUrl: 'https://img.roofer.example/item.jpg' })
    await ins(t.schema.pricebookGoodBetterBest, { pricebookItemId: item.id, tier: 'good', name: 'Standard', price: 6000, features: ['3-tab shingles'] })
    await ins(t.schema.pricebookGoodBetterBest, { pricebookItemId: item.id, tier: 'better', name: 'Architectural', price: 8000, recommended: true, features: ['Architectural shingles', 'Ice and water at eaves'] })
    await ins(t.schema.pricebookGoodBetterBest, { pricebookItemId: item.id, tier: 'best', name: 'Premium', price: 11000, description: 'Full system' })
    const q = await jobAndQuote()
    const built = await json(await as('owner')(`/api/quotes/${q.quoteId}/proposal/from-pricebook`, { method: 'POST', json: { pricebookItemId: item.id } }))
    expect(built.status).toBe(200)
    expect(built.body.proposal.options.map((o: any) => [o.name, o.tier, o.price])).toEqual([['Standard', 'good', '8000.00'], ['Architectural', 'better', '10000.00'], ['Premium', 'best', '13000.00']])
    expect(built.body.proposal.options[1]).toMatchObject({ recommended: true, description: 'Architectural shingles · Ice and water at eaves' })
    expect(built.body.proposal.options[0].photos).toEqual(['https://img.roofer.example/item.jpg'])
    // An item with fewer than two tiers, and a seat that may not edit quotes, are refused.
    const plain = await ins(t.schema.pricebookItem, { companyId, name: 'Gutter guard', price: 900, cost: 400, type: 'service' })
    expect((await as('owner')(`/api/quotes/${q.quoteId}/proposal/from-pricebook`, { method: 'POST', json: { pricebookItemId: plain.id } })).status).toBe(400)
    expect((await as('viewer')(`/api/quotes/${q.quoteId}/proposal/from-pricebook`, { method: 'POST', json: { pricebookItemId: item.id } })).status).toBe(403)
  })
})

describe('the homeowner chooses and signs on the quote\'s own link', () => {
  test('the sent quote offers each option at its whole price — and shows no cost', async () => {
    link = await sendIt(quoteId)
    const mail = sent.filter((m) => m.template === 'quoteSent').at(-1)!.data
    // The email lists the options (each at its whole price), not the shared lines alone.
    expect(mail.lineItems.map((l: any) => [l.description.split(' — ')[0], l.unitPrice])).toEqual([['Good', '7000.00'], ['Better', '9300.00'], ['Best', '13000.00']])
    const seen = await json(await t.call(`/api/portal/d/${link}/quotes/${quoteId}`))
    expect(seen.status).toBe(200)
    expect(seen.body.proposal).toMatchObject({ needsChoice: true, chosenOptionId: null })
    expect(seen.body.proposal.options.map((o: any) => o.name)).toEqual(['Good', 'Better', 'Best'])
    const better = seen.body.proposal.options.find((o: any) => o.name === 'Better')
    expect(better).toMatchObject({ brand: 'GAF Timberline HDZ', warranty: 'Lifetime shingle warranty, 10-year workmanship', price: '9300.00' })
    expect(better.photos.length).toBe(2)
    expect(JSON.stringify(seen.body)).not.toContain('unitCost')
    expect(seen.body.lineItems.map((l: any) => l.description)).toEqual(['Tear-off, disposal and permit'])
  })

  test('signing before choosing is refused — by the homeowner and by the office', async () => {
    const homeowner = await json(await t.call(`/api/portal/d/${link}/quotes/${quoteId}/approve`, { method: 'POST', json: SIGN }))
    expect(homeowner.status).toBe(400)
    expect(homeowner.body.error).toContain('Choose one of the options')
    const office = await json(await as('owner')(`/api/quotes/${quoteId}/approve`, { method: 'POST' }))
    expect(office.status).toBe(400)
    // Still open: the homeowner has seen it (viewed) but nothing was signed.
    expect(['sent', 'viewed']).toContain((await json(await as('owner')(`/api/quotes/${quoteId}`))).body.status)
  })

  test("choosing an option makes the quote's total that option's; choosing another moves it; an option from another quote is refused", async () => {
    const best = await json(await t.call(`/api/portal/d/${link}/quotes/${quoteId}/choose-option`, { method: 'POST', json: { optionId: ids.best } }))
    expect(best.status).toBe(200)
    expect(Number(best.body.total)).toBe(PRICE.best)
    expect(best.body.proposal).toMatchObject({ needsChoice: false, chosenOptionId: ids.best })
    const better = await json(await t.call(`/api/portal/d/${link}/quotes/${quoteId}/choose-option`, { method: 'POST', json: { optionId: ids.better } }))
    expect(better.status).toBe(200)
    expect(Number(better.body.total)).toBe(PRICE.better)
    expect(better.body.proposal.options.filter((o: any) => o.chosen).map((o: any) => o.name)).toEqual(['Better'])
    chosenId = ids.better
    const other = await jobAndQuote()
    await putOptions(other.quoteId, OPTIONS)
    const foreign = (await json(await as('owner')(`/api/quotes/${other.quoteId}`))).body.proposal.options[0].id
    expect((await t.call(`/api/portal/d/${link}/quotes/${quoteId}/choose-option`, { method: 'POST', json: { optionId: foreign } })).status).toBe(404)
    expect((await t.call(`/api/portal/d/${link}/quotes/${quoteId}/choose-option`, { method: 'POST', json: {} })).status).toBe(400)
    // A line of an option is not ticked by itself: the option is the choice.
    const lineOfGood = (await t.db.select().from(t.schema.quoteLineItem).where(eq(t.schema.quoteLineItem.proposalOptionId, ids.good)))[0]
    expect((await t.call(`/api/portal/d/${link}/quotes/${quoteId}/options`, { method: 'POST', json: { lineItemId: lineOfGood.id, selected: true } })).status).toBe(400)
    expect(Number((await json(await as('owner')(`/api/quotes/${quoteId}`))).body.total)).toBe(PRICE.better)
  })

  test('the homeowner signs: the quote is approved for the Better option, and the signature names it', async () => {
    const signed = await json(await t.call(`/api/portal/d/${link}/quotes/${quoteId}/approve`, { method: 'POST', json: SIGN }))
    expect(signed.status).toBe(200)
    expect(signed.body.quote).toMatchObject({ status: 'approved', total: '9300.00' })
    const audit = await t.db.select().from(t.schema.auditLog).where(eq(t.schema.auditLog.entityId, quoteId))
    const signedRow = audit.find((a: any) => a.action === 'quote.signed')
    expect(signedRow).toBeTruthy()
    expect((signedRow as any).metadata.option).toBe('Better')
    const [row] = await t.db.select().from(t.schema.quote).where(eq(t.schema.quote.id, quoteId))
    expect(row.signedBy).toBe('Lee Marsh')
    expect(row.signatureHash).toBeTruthy()
  })

  test('a signed proposal is a record: no more picking, no more editing its options', async () => {
    expect((await t.call(`/api/portal/d/${link}/quotes/${quoteId}/choose-option`, { method: 'POST', json: { optionId: ids.best } })).status).toBe(400)
    expect((await as('owner')(`/api/quotes/${quoteId}/proposal/choose`, { method: 'POST', json: { optionId: ids.best } })).status).toBe(400)
    expect((await putOptions(quoteId, OPTIONS)).status).toBe(400)
    const after = await json(await as('owner')(`/api/quotes/${quoteId}`))
    expect(after.body.proposal.chosenOptionId).toBe(chosenId)
    expect(Number(after.body.total)).toBe(PRICE.better)
  })
})

describe('the choice is the accepted price', () => {
  test("the roof job is worth the chosen option, not the figure it was opened at", async () => {
    const [job] = await t.db.select().from(t.schema.job).where(eq(t.schema.job.id, jobId))
    expect(Number(job.estimatedValue)).toBe(PRICE.better)
    // The job list's "quoted" figure and the job's own quote both read the chosen option.
    const list = await json(await as('owner')('/api/jobs?limit=100'))
    expect(Number(list.body.data.find((j: any) => j.id === jobId).quotedValue)).toBe(PRICE.better)
    const read = await json(await as('owner')(`/api/jobs/${jobId}`))
    expect(read.body.quotes.map((x: any) => Number(x.total))).toEqual([PRICE.better])
  })

  test('the invoice made from the quote bills the chosen option and neither of the others', async () => {
    const inv = await json(await as('owner')(`/api/quotes/${quoteId}/convert-to-invoice`, { method: 'POST' }))
    expect(inv.status).toBe(201)
    expect(Number(inv.body.total)).toBe(PRICE.better)
    const lines = inv.body.lineItems.map((l: any) => l.description)
    expect(lines).toEqual(expect.arrayContaining(['Tear-off, disposal and permit', 'Timberline HDZ shingles, 30 squares', 'Ice and water shield, eaves and valleys']))
    expect(lines.length).toBe(3)
    expect(lines.join('|')).not.toContain('Supreme')
    expect(lines.join('|')).not.toContain('Designer')
  })

  test('billing in parts is against the chosen total: the unchosen options add nothing to bill', async () => {
    const q = await jobAndQuote({ depositType: 'percent', depositValue: 10 })
    await putOptions(q.quoteId, OPTIONS)
    const token = await sendIt(q.quoteId)
    expect((await t.call(`/api/portal/d/${token}/quotes/${q.quoteId}/choose-option`, { method: 'POST', json: { optionId: (await json(await as('owner')(`/api/quotes/${q.quoteId}`))).body.proposal.options[2].id } })).status).toBe(200)
    const approved = await json(await t.call(`/api/portal/d/${token}/quotes/${q.quoteId}/approve`, { method: 'POST', json: SIGN }))
    expect(approved.status).toBe(200)
    // The deposit is a tenth of the chosen $13,000.
    expect(approved.body.deposit).toMatchObject({ total: '1300.00', billKind: 'deposit' })
    const summary = await json(await as('owner')(`/api/quote-billing/quotes/${q.quoteId}`))
    expect(summary.body).toMatchObject({ total: '13000.00', billed: '1300.00', remaining: '11700.00' })
    expect(summary.body.lines.map((l: any) => l.description).join('|')).not.toContain('Supreme')
    expect(summary.body.lines.map((l: any) => l.description).join('|')).not.toContain('Timberline')
    // More than the chosen total cannot be billed, whatever the other options came to.
    const rest = await json(await as('owner')(`/api/quote-billing/quotes/${q.quoteId}/progress`, { method: 'POST', json: { percent: 90 } }))
    expect(rest.status).toBe(201)
    expect(rest.body.total).toBe('11700.00')
    expect((await as('owner')(`/api/quote-billing/quotes/${q.quoteId}/progress`, { method: 'POST', json: { percent: 1 } })).status).toBe(409)
    const [job] = await t.db.select().from(t.schema.job).where(eq(t.schema.job.id, q.jobId))
    expect(Number(job.estimatedValue)).toBe(PRICE.best)
  })

  test('the office can pick for a homeowner who said yes by phone, then approve', async () => {
    const q = await jobAndQuote()
    await putOptions(q.quoteId, OPTIONS)
    const opts = (await json(await as('owner')(`/api/quotes/${q.quoteId}`))).body.proposal.options
    const chose = await json(await as('owner')(`/api/quotes/${q.quoteId}/proposal/choose`, { method: 'POST', json: { optionId: opts[0].id } }))
    expect(chose.status).toBe(200)
    expect(Number(chose.body.total)).toBe(PRICE.good)
    const ok = await json(await as('owner')(`/api/quotes/${q.quoteId}/approve`, { method: 'POST' }))
    expect(ok.status).toBe(200)
    const [job] = await t.db.select().from(t.schema.job).where(eq(t.schema.job.id, q.jobId))
    expect(Number(job.estimatedValue)).toBe(PRICE.good)
  })

  test('a quote with no options is untouched: it signs as before and leaves its job alone', async () => {
    const q = await jobAndQuote()
    const token = await sendIt(q.quoteId)
    const seen = await json(await t.call(`/api/portal/d/${token}/quotes/${q.quoteId}`))
    expect(seen.body.proposal).toBeUndefined()
    expect((await json(await t.call(`/api/portal/d/${token}/quotes/${q.quoteId}/approve`, { method: 'POST', json: SIGN }))).status).toBe(200)
    const [job] = await t.db.select().from(t.schema.job).where(eq(t.schema.job.id, q.jobId))
    expect(Number(job.estimatedValue)).toBe(12000)
  })
})

// Owner follow-up 10/30 (PR #170): the switch is one rule on both sides. With `quote_proposals` off, the homeowner's page and
// link show no options and the pick is refused, and the quote is answered exactly as it was before options existed.
describe('with the proposal options switched off the quote behaves as if they did not exist', () => {
  const offFeatures = FEATURES.filter((f) => f !== 'quote_proposals')
  const optionIds = async (qid: string) => Object.fromEntries(((await json(await as('owner')(`/api/quotes/${qid}`))).body.proposal.options as any[]).map((o) => [o.name, o.id]))
  const seenBy = async (token: string, qid: string) => json(await t.call(`/api/portal/d/${token}/quotes/${qid}`))

  test('on: the homeowner is offered the options and can pick one; off: no options on the page, the link, the email or the pick', async () => {
    const q = await jobAndQuote()
    expect((await putOptions(q.quoteId, OPTIONS)).status).toBe(200)
    const token = await sendIt(q.quoteId)
    const names = await optionIds(q.quoteId)
    // ON
    const on = await seenBy(token, q.quoteId)
    expect(on.body.proposal.options.map((o: any) => o.name)).toEqual(['Good', 'Better', 'Best'])
    expect((await json(await t.call(`/api/portal/d/${token}/quotes/${q.quoteId}/choose-option`, { method: 'POST', json: { optionId: names.Good } }))).status).toBe(200)
    // Back to the undecided quote, then OFF.
    await as('owner')(`/api/quotes/${q.quoteId}/proposal`, { method: 'PUT', json: { options: OPTIONS } })
    const fresh = await optionIds(q.quoteId)
    await setFeatures(offFeatures)
    try {
      const off = await seenBy(token, q.quoteId)
      expect(off.status).toBe(200)
      expect(off.body.proposal).toBeUndefined()
      expect(JSON.stringify(off.body)).not.toMatch(/Good|Better|Best|Timberline|warranty/i)
      expect(off.body.lineItems.map((l: any) => l.description)).toEqual(['Tear-off, disposal and permit'])
      expect(Number(off.body.total)).toBe(2000)
      // The pick is refused as a path that is not there, whichever option it names — and nothing was chosen.
      for (const optionId of [fresh.Good, fresh.Best]) {
        expect((await t.call(`/api/portal/d/${token}/quotes/${q.quoteId}/choose-option`, { method: 'POST', json: { optionId } })).status).toBe(404)
      }
      expect((await t.db.select().from(t.schema.quoteProposalOption).where(eq(t.schema.quoteProposalOption.quoteId, q.quoteId))).some((o: any) => o.chosen)).toBe(false)
      // The office cannot pick for the customer either (the screen is not there, and the server says so).
      expect((await as('owner')(`/api/quotes/${q.quoteId}/proposal/choose`, { method: 'POST', json: { optionId: fresh.Good } })).status).toBe(403)
      // A re-sent quote's email lists the quote's own lines, not the options.
      await as('owner')(`/api/quotes/${q.quoteId}/send`, { method: 'POST' })
      const mail = sent.filter((m) => m.template === 'quoteSent').at(-1)!.data
      expect(mail.lineItems.map((l: any) => l.description)).toEqual(['Tear-off, disposal and permit'])
      // And it is signed as it stood before options existed: no pick is asked for, the signature names no option.
      const signed = await json(await t.call(`/api/portal/d/${token}/quotes/${q.quoteId}/approve`, { method: 'POST', json: SIGN }))
      expect([signed.status, signed.body.quote?.status, signed.body.quote?.total]).toEqual([200, 'approved', '2000.00'])
      const audit = (await t.db.select().from(t.schema.auditLog).where(eq(t.schema.auditLog.entityId, q.quoteId))).find((a: any) => a.action === 'quote.signed') as any
      expect(audit.metadata.option ?? null).toBeNull()
    } finally { await setFeatures(FEATURES) }
  })

  test('on again: a second quote is offered its options once more', async () => {
    const q = await jobAndQuote()
    await putOptions(q.quoteId, OPTIONS)
    const token = await sendIt(q.quoteId)
    expect((await seenBy(token, q.quoteId)).body.proposal.options.length).toBe(3)
    const unsigned = await json(await t.call(`/api/portal/d/${token}/quotes/${q.quoteId}/approve`, { method: 'POST', json: SIGN }))
    expect([unsigned.status, unsigned.body.error]).toEqual([400, expect.stringContaining('Choose one of the options')])
  })

  test('an option already chosen stays readable when the switch goes off: its lines are in the total, so they are on the page', async () => {
    const q = await jobAndQuote()
    await putOptions(q.quoteId, OPTIONS)
    const token = await sendIt(q.quoteId)
    const names = await optionIds(q.quoteId)
    expect((await json(await t.call(`/api/portal/d/${token}/quotes/${q.quoteId}/choose-option`, { method: 'POST', json: { optionId: names.Better } }))).status).toBe(200)
    await setFeatures(offFeatures)
    try {
      const off = await seenBy(token, q.quoteId)
      expect(off.body.proposal).toBeUndefined()
      expect(Number(off.body.total)).toBe(PRICE.better)
      const sum = off.body.lineItems.reduce((s: number, l: any) => s + Number(l.total), 0)
      expect(sum).toBe(PRICE.better)
      expect(JSON.stringify(off.body.lineItems)).not.toMatch(/Good|Best/)
    } finally { await setFeatures(FEATURES) }
  })
})
