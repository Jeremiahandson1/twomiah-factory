// Offers and more automatic messages (salon row 20; server/crm/salon/offers.ts, retention.ts, loyaltyAward.ts; hidden feature `retention_sends`).
//   · a birthday / win-back / milestone / anniversary / tier message can carry a single-use code: an amount or percent off, an expiry on the
//     salon's calendar, made in the pass that sends the message, redeemed once at the client's own sale, counted in the report;
//   · milestone (the Nth completed visit), client-anniversary and moved-up-a-tier messages, with the same consent, quiet hours, weekly cap and ledger;
//   · a message that did not go out has no live code.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { addDays, tzParts } from '@twomiah/tenant-backend'
import { bootTenant, seedOwner } from './harness.ts'
import { OFFER_KINDS, dayWords, discountCentsFor, makeCode, offerSentence, parseTerms, tierReached } from '../server/crm/salon/offers.ts'
import { ordinal } from '../server/crm/salon/retention.ts'

const TZ = 'America/Chicago'
const FEATURES = ['contacts', 'client_profiles', 'service_menu', 'salon_booking', 'rebooking_reminders', 'invoices', 'loyalty_rewards', 'retention_sends']
const DAY = 86400_000

describe('the rules', () => {
  test('a code: prefix by message, six characters with nothing that is misread', () => {
    for (const k of OFFER_KINDS) expect(makeCode(k)).toMatch(/^[A-Z]+-[A-HJKMNP-Z2-9]{6}$/)
    expect(makeCode('birthday')).toMatch(/^BDAY-/)
    expect(makeCode('tier_up', () => 0)).toBe('TIER-AAAAAA')
  })
  test('terms are checked in words', () => {
    expect(parseTerms(null)).toEqual({ terms: null })
    expect(parseTerms({ type: 'amount', value: 1000, validDays: 30 })).toEqual({ terms: { type: 'amount', value: 1000, validDays: 30 } })
    for (const bad of [{ type: 'free' }, { type: 'percent', value: 101, validDays: 5 }, { type: 'percent', value: 0, validDays: 5 }, { type: 'amount', value: 10.5, validDays: 5 }, { type: 'amount', value: 100001, validDays: 5 }, { type: 'amount', value: 500, validDays: 0 }, { type: 'amount', value: 500, validDays: 400 }, 'x', []]) {
      expect('problem' in parseTerms(bad)).toBe(true)
    }
  })
  test('what a code takes off: an amount is capped at what is left, a percent rounds down', () => {
    expect(discountCentsFor({ discountType: 'amount', value: 1000 }, 25000)).toBe(1000)
    expect(discountCentsFor({ discountType: 'amount', value: 1000 }, 800)).toBe(800)
    expect(discountCentsFor({ discountType: 'percent', value: 15 }, 9000)).toBe(1350)
    expect(discountCentsFor({ discountType: 'percent', value: 15 }, 999)).toBe(149)
    expect(discountCentsFor({ discountType: 'percent', value: 100 }, 0)).toBe(0)
  })
  test('the sentence in the message, and the date in words', () => {
    expect(offerSentence('BDAY-ABC234', { type: 'amount', value: 1000 }, '2026-11-30')).toBe('Use code BDAY-ABC234 for $10 off, good through Nov 30.')
    expect(offerSentence('YEAR-ABC234', { type: 'percent', value: 15 }, '2026-12-01')).toBe('Use code YEAR-ABC234 for 15% off, good through Dec 1.')
    expect(offerSentence('X', { type: 'amount', value: 1250 }, '2026-01-05')).toContain('$12.50 off')
    expect(dayWords('2026-02-09')).toBe('Feb 9')
  })
  test('a tier is reached only by moving UP into it', () => {
    const tiers = [{ minPoints: 100 }, { minPoints: 500 }]
    expect(tierReached(tiers, 0, 99)).toBeNull()
    expect(tierReached(tiers, 0, 100)).toEqual({ minPoints: 100 })
    expect(tierReached(tiers, 99, 650)).toEqual({ minPoints: 500 })
    expect(tierReached(tiers, 150, 400)).toBeNull()
    expect(tierReached(tiers, 600, 200)).toBeNull()
    expect(tierReached([], 0, 9999)).toBeNull()
  })
  test('ordinals', () => {
    expect([1, 2, 3, 4, 5, 10, 11, 12, 13, 21, 22, 25, 101, 111].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '5th', '10th', '11th', '12th', '13th', '21st', '22nd', '25th', '101st', '111th'])
  })
})

describe('salon: offers and more automatic messages', () => {
  let t: Awaited<ReturnType<typeof bootTenant>>
  let co = '', cut = '', owner = ''
  const texts: Array<{ to: string; message: string; contactId: string }> = []
  const emails: Array<{ to: string; subject: string; html: string }> = []
  let smsStatus = 'sent'
  let ip = 0, nameN = 0, inv = 0
  const ins = async (table: any, values: any) => ((await t.db.insert(table).values(values).returning()) as any[])[0]
  const as = async (path: string, method = 'GET', json?: unknown) => {
    const r = await t.call(path, { method, json, headers: { Authorization: `Bearer ${owner}`, 'x-forwarded-for': `10.8.0.${++ip}` } })
    const text = await r.text(); let body: any = text; try { body = JSON.parse(text) } catch { /* html */ }
    return { status: r.status, body }
  }
  const features = async (list: string[]) => { await t.db.update(t.schema.company).set({ enabledFeatures: list } as any).where(eq(t.schema.company.id, co)); t.services.features.forgetFeatures() }
  const today = () => tzParts(new Date(), TZ).date
  const noon = (d: string) => new Date(`${d}T18:00:00Z`)
  const settings = (patch: Record<string, unknown>) => as('/api/retention/settings', 'PUT', patch)
  const run = () => as('/api/retention/run', 'POST', {})
  const client = async (first: string) => {
    const c = await ins(t.schema.contact, { companyId: co, name: `${first} Test`, email: `${first.toLowerCase()}${++nameN}@example.com`, mobile: `608555${String(1000 + ++nameN).slice(-4)}`, type: 'client' })
    await ins(t.schema.smsConsent, { companyId: co, phone: '+1' + String(c.mobile).replace(/\D/g, ''), source: 'booking', givenAt: new Date() })
    return c
  }
  const sale = (contactId: string, subtotal = '100.00', status = 'sent') => ins(t.schema.invoice, { companyId: co, contactId, number: `OFR-${++inv}`, status, subtotal, total: subtotal, amountPaid: status === 'paid' ? subtotal : '0' })
  const offers = async () => (await as('/api/retention-offers')).body.data as any[]
  const code = (contactId: string, over: Record<string, unknown> = {}) => ins(t.schema.offerCode, { companyId: co, contactId, code: `TEST-${++nameN}XYZ`, source: 'tier_up', discountType: 'amount', value: 1000, expiresOn: addDays(today(), 20), ...over })
  const redeem = (c: string, invoiceId: string, preview = false) => as('/api/retention-offers/redeem', 'POST', { code: c, invoiceId, preview })
  const visitDone = (contactId: string, startMs: number, updatedMs: number) => ins(t.schema.appointment, { companyId: co, contactId, status: 'completed', startTime: new Date(startMs), endTime: new Date(startMs + 3600_000), updatedAt: new Date(updatedMs) })

  beforeAll(async () => {
    process.env.API_BASE_URL = 'https://api.salon.test'
    process.env.SITE_URL = 'https://salon.test'
    t = await bootTenant({ vertical: 'salon' })
    const s = await seedOwner(t)
    co = s.company.id
    await t.db.update(t.schema.company).set({ timezone: TZ, name: 'Test Salon' } as any).where(eq(t.schema.company.id, co))
    await features(FEATURES)
    owner = ((await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } })).json()) as any).accessToken
    cut = (await ins(t.schema.serviceMenu, { companyId: co, name: 'Colour', price: '80' })).id
    ;(t.services.crm.sms as any).sendSMS = async (_c: string, m: any) => { texts.push({ to: m.toPhone, message: m.message, contactId: m.contactId }); return smsStatus === 'sent' ? { status: 'sent' } : { status: 'failed', errorMessage: 'Carrier said no' } }
    ;(t.services.crm.emailService as any).sendRaw = async (m: any) => { emails.push(m) }
  }, 120_000)

  test('the settings door: offers, milestone visits and the new messages are checked in words, and saved', async () => {
    for (const bad of [{ offers: { birthday: { type: 'amount', value: 0, validDays: 30 } } }, { offers: { rebook: { type: 'amount', value: 500, validDays: 30 } } }, { offers: 'x' }, { milestoneVisits: [1] }, { milestoneVisits: ['five'] }, { milestoneVisits: new Array(13).fill(0).map((_, i) => i + 2) }, { milestone: 'yes' }, { templates: { milestone: 'Hi {nickname}' } }]) {
      const r = await settings(bad)
      expect([r.status, JSON.stringify(bad)]).toEqual([400, JSON.stringify(bad)])
    }
    const ok = await settings({
      birthday: true, winBack: true, winBackDays: 90, milestone: true, milestoneVisits: [10, 5, 5], anniversary: true, tierUp: true,
      offers: { birthday: { type: 'amount', value: 1000, validDays: 30 }, win_back: { type: 'percent', value: 15, validDays: 14 }, milestone: { type: 'percent', value: 10, validDays: 14 } },
      templates: { tier_up: 'Congrats {firstName}, welcome to {tier}! {offer}' },
    })
    expect(ok.status).toBe(200)
    expect(ok.body).toMatchObject({ milestone: true, anniversary: true, tierUp: true, milestoneVisits: [5, 10], offers: { birthday: { type: 'amount', value: 1000, validDays: 30 } } })
    // taking an offer off a kind
    expect((await settings({ offers: { milestone: null } })).body.offers.milestone).toBeUndefined()
    expect((await settings({ offers: { milestone: { type: 'percent', value: 10, validDays: 14 } } })).status).toBe(200)
    // The switch-on moment: two days ago, so a visit completed since counts
    const [row] = await t.db.select({ settings: t.schema.company.settings }).from(t.schema.company).where(eq(t.schema.company.id, co))
    const rs: any = row.settings; rs.retention.since = new Date(Date.now() - 2 * DAY).toISOString()
    await t.db.update(t.schema.company).set({ settings: rs } as any).where(eq(t.schema.company.id, co))
  })

  test('a birthday message carries the client’s own code: in the text, dated on the salon’s calendar, tied to the send, made once', async () => {
    texts.length = 0
    const p = today().split('-')
    const bea = await client('Bea'); await ins(t.schema.clientProfile, { contactId: bea.id, companyId: co, birthday: `1990-${p[1]}-${p[2]}` })
    expect((await run()).body.sent).toBe(1)
    const m = texts[0].message
    const found = m.match(/Use code (BDAY-[A-Z0-9]{6}) for \$10 off, good through ([A-Z][a-z]{2} \d+)\./)
    expect(found).not.toBeNull()
    expect(m).toContain('https://salon.test/book')
    expect(m.indexOf('Use code')).toBeLessThan(m.indexOf('https://salon.test/book'))      // ahead of the link when the owner did not place it
    const rows = await t.db.select().from(t.schema.offerCode).where(eq(t.schema.offerCode.contactId, bea.id))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ code: found![1], source: 'birthday', discountType: 'amount', value: 1000, status: 'active', expiresOn: addDays(today(), 30) })
    expect(found![2]).toBe(dayWords(addDays(today(), 30)))
    const [send] = await t.db.select().from(t.schema.retentionSend).where(eq(t.schema.retentionSend.contactId, bea.id))
    expect(rows[0].sendId).toBe(send.id)
    expect(send.message).toContain(found![1])
    // once: a second pass sends nothing and makes no second code
    expect((await run()).body.sent).toBe(0)
    expect(await t.db.select().from(t.schema.offerCode).where(eq(t.schema.offerCode.contactId, bea.id))).toHaveLength(1)
  })

  test('a kind with no offer sends no code, and its text is as it always was', async () => {
    texts.length = 0
    const dora = await client('Dora')
    await visitDone(dora.id, Date.now() - 2 * 3600_000, Date.now() - 40 * 60_000)
    await settings({ nextVisit: true })
    expect((await run()).body.sent).toBe(1)
    expect(texts[0].message).toContain('Thanks for coming in, Dora!')
    expect(texts[0].message).not.toContain('Use code')
    expect(await t.db.select().from(t.schema.offerCode).where(eq(t.schema.offerCode.contactId, dora.id))).toHaveLength(0)
    await settings({ nextVisit: false })
  })

  test('at the sale: the client’s own code takes its amount off, once; the figures on the bill move with it', async () => {
    const bea = (await t.db.select().from(t.schema.contact).where(eq(t.schema.contact.name, 'Bea Test')))[0]
    const o = (await offers()).find((x) => x.contactId === bea.id)!
    expect(o).toMatchObject({ source: 'birthday', sourceWords: 'Birthday', state: 'active', words: '$10 off' })
    const bill = await sale(bea.id, '100.00')
    const preview = await redeem(o.code.toLowerCase(), bill.id, true)           // typed in any case
    expect(preview.body).toMatchObject({ preview: true, discount: 10, words: '$10 off' })
    expect((await t.db.select().from(t.schema.invoice).where(eq(t.schema.invoice.id, bill.id)))[0].discount).toBe('0.00')   // a preview changes nothing
    const r = await redeem(o.code, bill.id)
    expect([r.status, r.body.discount]).toEqual([200, 10])
    const after = (await t.db.select().from(t.schema.invoice).where(eq(t.schema.invoice.id, bill.id)))[0]
    expect([after.discount, after.total]).toEqual(['10.00', '90.00'])
    const spent = (await t.db.select().from(t.schema.offerCode).where(eq(t.schema.offerCode.code, o.code)))[0]
    expect(spent).toMatchObject({ status: 'used', usedInvoiceId: bill.id, discountCents: 1000 })
    // single use
    const again = await redeem(o.code, (await sale(bea.id)).id)
    expect([again.status, again.body.code]).toEqual([409, 'CODE_USED'])
  })

  test('refused in words: a stranger’s sale, a second code on one sale, an old code, a paid sale, a cancelled code, no such code', async () => {
    const eve = await client('Eve'), fay = await client('Fay')
    const evesBill = await sale(eve.id)
    const faysCode = await code(fay.id)
    expect((await redeem(faysCode.code, evesBill.id)).body.code).toBe('WRONG_CLIENT')
    const none = await ins(t.schema.invoice, { companyId: co, number: `OFR-${++inv}`, status: 'sent', subtotal: '50.00', total: '50.00' })
    expect((await redeem(faysCode.code, none.id)).body.code).toBe('WRONG_CLIENT')
    const first = await code(eve.id), second = await code(eve.id)
    expect((await redeem(first.code, evesBill.id)).status).toBe(200)
    const two = await redeem(second.code, evesBill.id)
    expect([two.status, two.body.code]).toEqual([409, 'ONE_PER_SALE'])
    expect((await t.db.select().from(t.schema.offerCode).where(eq(t.schema.offerCode.id, second.id)))[0].status).toBe('active')   // not spent by the refusal
    const old = await code(eve.id, { expiresOn: addDays(today(), -1) })
    const o = await redeem(old.code, (await sale(eve.id)).id)
    expect([o.status, o.body.code]).toEqual([400, 'CODE_EXPIRED'])
    expect(o.body.error ?? o.body.message).toContain('ran out on')
    const paid = await sale(eve.id, '100.00', 'paid')
    expect((await redeem(second.code, paid.id)).body.code).toBe('SALE_PAID')
    const gone = await code(eve.id, { status: 'void' })
    expect((await redeem(gone.code, (await sale(eve.id)).id)).body.code).toBe('CODE_VOID')
    expect((await redeem('NOPE-123456', evesBill.id)).status).toBe(404)
    expect((await as('/api/retention-offers/redeem', 'POST', { invoiceId: evesBill.id })).status).toBe(400)
    // list states: the old one reads as expired without anything having run
    expect((await offers()).find((x) => x.id === old.id).state).toBe('expired')
  })

  test('two desks, one code: one gets it, the other is told; a percent code rounds down and an amount is capped at what is left', async () => {
    const gus = await client('Gus')
    const c = await code(gus.id)
    const [b1, b2] = [await sale(gus.id), await sale(gus.id)]
    const both = await Promise.all([redeem(c.code, b1.id), redeem(c.code, b2.id)])
    expect(both.map((r) => r.status).sort()).toEqual([200, 409])
    const used = (await t.db.select().from(t.schema.offerCode).where(eq(t.schema.offerCode.id, c.id)))[0]
    expect(used.status).toBe('used')
    const spentOn = [b1, b2].filter((b) => b.id === used.usedInvoiceId)
    expect(spentOn).toHaveLength(1)
    const other = [b1, b2].find((b) => b.id !== used.usedInvoiceId)!
    expect((await t.db.select().from(t.schema.invoice).where(eq(t.schema.invoice.id, other.id)))[0].discount).toBe('0.00')

    const pct = await code(gus.id, { discountType: 'percent', value: 15 })
    const small = await sale(gus.id, '8.00')
    const p = await redeem(pct.code, small.id, true)
    expect(p.body.discount).toBe(1.2)
    const big = await code(gus.id, { value: 5000 })
    const q = await redeem(big.code, small.id, true)
    expect(q.body).toMatchObject({ discount: 8, cappedAtSale: true })
    expect((await redeem(big.code, small.id)).body.discount).toBe(8)
    expect((await t.db.select().from(t.schema.invoice).where(eq(t.schema.invoice.id, small.id)))[0]).toMatchObject({ total: '0.00', status: 'paid' })   // taken to nothing is paid
  })

  test('a win-back message that could not be sent leaves no live code, and the report does not count it', async () => {
    texts.length = 0; smsStatus = 'failed'
    const lou = await client('Lou')
    await ins(t.schema.serviceRecord, { companyId: co, contactId: lou.id, serviceId: cut, performedAt: noon(addDays(today(), -90)), formula: [] })
    const r = (await run()).body
    smsStatus = 'sent'
    expect([r.sent, r.failed]).toEqual([0, 1])
    const rows = await t.db.select().from(t.schema.offerCode).where(eq(t.schema.offerCode.contactId, lou.id))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ source: 'win_back', discountType: 'percent', value: 15, status: 'void' })
    expect(texts[0].message).toContain(`Use code ${rows[0].code} for 15% off`)
    expect((await redeem(rows[0].code, (await sale(lou.id)).id)).body.code).toBe('CODE_VOID')
  })

  test('milestone: the visit that makes it the Nth gets the message, once; a client one short gets nothing', async () => {
    texts.length = 0
    const mia = await client('Mia'), ned = await client('Ned')
    for (const [c, n] of [[mia, 4], [ned, 3]] as const) for (let i = 1; i <= n; i++) await visitDone(c.id, Date.now() - (10 + i * 7) * DAY, Date.now() - 30 * DAY)
    await visitDone(mia.id, Date.now() - 2 * 3600_000, Date.now() - 40 * 60_000)        // her 5th
    await visitDone(ned.id, Date.now() - 2 * 3600_000, Date.now() - 40 * 60_000)        // his 4th
    expect((await run()).body.sent).toBe(1)
    expect(texts).toHaveLength(1)
    expect(texts[0].contactId).toBe(mia.id)
    expect(texts[0].message).toMatch(/Mia, that was your 5th visit/)
    expect(texts[0].message).toMatch(/Use code VISIT-[A-Z0-9]{6} for 10% off, good through /)
    const [sent] = await t.db.select().from(t.schema.retentionSend).where(eq(t.schema.retentionSend.contactId, mia.id))
    expect([sent.kind, sent.eventKey, sent.status]).toEqual(['milestone', '5', 'sent'])
    expect((await run()).body.sent).toBe(0)
  })

  test('anniversary: the day each year a client first came in, from the first year; not on the first day; own words and the years in them', async () => {
    texts.length = 0
    const [y, mm, dd] = today().split('-')
    const ana = await client('Ana'), ben = await client('Ben'), cy = await client('Cy')
    await visitDone(ana.id, +noon(`${Number(y) - 2}-${mm}-${dd}`), +noon(`${Number(y) - 2}-${mm}-${dd}`))
    await visitDone(ana.id, Date.now() - 20 * DAY, Date.now() - 20 * DAY)               // later visits do not move the anniversary
    await visitDone(ben.id, +noon(`${Number(y) - 1}-${mm}-${dd}`), +noon(`${Number(y) - 1}-${mm}-${dd}`))
    await visitDone(cy.id, Date.now() - 3 * 3600_000, Date.now() - 3 * 3600_000)        // first came today: no anniversary yet
    expect((await run()).body.sent).toBe(2)
    const byId = Object.fromEntries(texts.map((x) => [x.contactId, x.message]))
    expect(byId[ana.id]).toMatch(/Happy anniversary, Ana — 2 years with us!/)
    expect(byId[ben.id]).toMatch(/Happy anniversary, Ben — 1 year with us!/)
    expect(byId[cy.id]).toBeUndefined()
    expect((await run()).body.sent).toBe(0)
  })

  test('a client who just had a message waits the week for the next kind, but not on another kind’s account', async () => {
    texts.length = 0
    const zed = await client('Zed')
    const [y, mm, dd] = today().split('-')
    await ins(t.schema.clientProfile, { contactId: zed.id, companyId: co, birthday: `1990-${mm}-${dd}` })
    await visitDone(zed.id, +noon(`${Number(y) - 3}-${mm}-${dd}`), +noon(`${Number(y) - 3}-${mm}-${dd}`))     // a 3-year anniversary today as well
    expect((await run()).body.sent).toBe(1)                                             // the birthday first; the anniversary waits
    expect(texts).toHaveLength(1)
    expect(texts[0].message).toContain('Happy birthday')
    expect((await run()).body.sent).toBe(0)
  })

  test('a client who moves up a loyalty tier is told, once; one who does not is not', async () => {
    texts.length = 0
    expect((await as('/api/loyalty/config', 'PUT', { loyaltyEnabled: true, loyaltyPointsPerDollar: 1, loyaltyTiers: [{ name: 'Silver', minPoints: 100, multiplier: 1.5 }, { name: 'Gold', minPoints: 400, multiplier: 2 }] })).status).toBe(200)
    const complete = async (contactId: string, price: number) => {
      const a = await ins(t.schema.appointment, { companyId: co, contactId, serviceId: cut, startTime: new Date(Date.now() - 3600_000 * 5), endTime: new Date(Date.now() - 3600_000 * 4), status: 'in_chair', quotedPrice: String(price) })
      expect((await as(`/api/appointments/${a.id}`, 'PUT', { status: 'completed' })).status).toBe(200)
    }
    const tia = await client('Tia'), uma = await client('Uma')
    await complete(uma.id, 60)
    await complete(tia.id, 150)
    const member = async (id: string) => (await t.db.select().from(t.schema.loyaltyMember).where(eq(t.schema.loyaltyMember.contactId, id)))[0]
    expect([(await member(uma.id)).tierMin, (await member(uma.id)).tierAt]).toEqual([null, null])
    expect((await member(tia.id)).tierMin).toBe(100)
    // the pass wants the grace after a visit only for the next-visit prompt; the tier message is for the move itself
    expect((await run()).body.sent).toBe(1)
    expect(texts).toHaveLength(1)
    expect(texts[0].contactId).toBe(tia.id)
    expect(texts[0].message).toMatch(/^Congrats Tia, welcome to Silver! Reply STOP/)
    expect(texts[0].message).not.toContain('Use code')                                  // no offer on this kind
    expect((await run()).body.sent).toBe(0)
    // a second visit that stays in the same tier says nothing more; one that reaches Gold does
    await complete(tia.id, 100)
    expect((await member(tia.id)).tierMin).toBe(100)
    await complete(tia.id, 200)
    expect((await member(tia.id)).tierMin).toBe(400)
    await t.db.delete(t.schema.retentionSend).where(eq(t.schema.retentionSend.contactId, tia.id))        // (the week's cap is a different test)
    texts.length = 0
    expect((await run()).body.sent).toBe(1)
    expect(texts[0].message).toContain('welcome to Gold')
  })

  test('a correction by hand that lifts a client into a tier counts as moving up', async () => {
    const vic = await client('Vic')
    const m = await ins(t.schema.loyaltyMember, { companyId: co, contactId: vic.id })
    expect((await as(`/api/loyalty/members/${m.id}/adjust`, 'POST', { points: 120, reason: 'Goodwill' })).status).toBe(200)
    expect((await t.db.select().from(t.schema.loyaltyMember).where(eq(t.schema.loyaltyMember.id, m.id)))[0].tierMin).toBe(100)
  })

  test('the report counts what was sent, used, left open and ran out, and what the used ones took off; a cancelled code is not a send', async () => {
    const r = (await as('/api/retention-offers/report')).body
    const by = Object.fromEntries(r.kinds.map((k: any) => [k.kind, k]))
    expect(by.birthday).toMatchObject({ words: 'Birthday', sent: 2, used: 1, open: 1, expired: 0, discountCents: 1000, billedCents: 9000 })   // Bea's, used on a $100 sale taken to $90; Zed's still open
    expect(by.win_back).toMatchObject({ sent: 0 })                                       // the one that failed to send is void
    expect(by.milestone).toMatchObject({ sent: 1, used: 0, open: 1 })
    expect(r.total.sent).toBeGreaterThanOrEqual(2)
    expect((await as('/api/retention-offers/report?from=2026-10-31&to=2026-01-01')).status).toBe(400)
    expect((await as('/api/retention-offers/report?from=nope')).status).toBe(400)
  })

  test('closed with the feature off', async () => {
    await features(FEATURES.filter((f) => f !== 'retention_sends'))
    expect((await as('/api/retention-offers')).status).not.toBe(200)
    expect((await as('/api/retention-offers/redeem', 'POST', { code: 'X', invoiceId: 'y' })).status).not.toBe(200)
    await features(FEATURES)
  })
})
