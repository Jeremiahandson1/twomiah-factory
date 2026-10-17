// crm-bar — gift cards, through the real routes on PGlite (services/barGiftCards.ts, routes/barGiftCards.ts and
// the register's sell / pay):
//   1. codes: this bar's prefix, no look-alike letters, never repeated, what people type is forgiven; the prefix
//      is kept when the bar is renamed; amounts $5 to $500
//   2. the gift_cards feature switches selling, spending and the cards page off together
//   3. selling: a gift-card line is not taxed, is not a card until the check is paid, comes off without a manager
//      before then; paid, the card exists with its opening ledger row; a pre-printed number, used once
//   4. spending: up to the balance, no tip, a card cannot pay for a card; a voided payment puts the money back
//   5. a manager corrects (never below zero, always a reason) or voids a card; a voided card cannot be spent
//   6. another company never finds this bar's card
//   7. the close-out keeps gift cards sold out of food & drink
import { Hono } from 'hono'
import { eq, and } from 'drizzle-orm'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 600)) }
}

const { setupSchema } = await import('./setup.ts')
await setupSchema()
const { db } = await import('./db/index.ts')
const S = await import('./db/schema.ts')
const { company, user, barMenuSection, barMenuItem, barGiftCard, barGiftCardLedger, barSettings } = S
const { requestScope } = await import('./src/services/audit.ts')
const G = await import('./src/services/barGiftCards.ts')

const ALL = ['contacts', 'bar_menu', 'bar_tonight', 'bar_register', 'gift_cards']
const [co] = await db.insert(company).values({ name: 'Amber Inn', slug: 'amber-gc', email: 'bar@test.local', state: 'WI', settings: { defaultTaxRate: 5.5 }, enabledFeatures: ALL } as any).returning()
const mk = async (cid: string, role: string, first: string, tag: string) => (await db.insert(user).values({ email: `${role}-${tag}@test.local`, passwordHash: 'x', firstName: first, lastName: 'T', role, companyId: cid, isActive: true } as any).returning())[0]
const manager = await mk(co.id, 'manager', 'Pat', 'gc'), bartender = await mk(co.id, 'field', 'Jess', 'gc')
const [sec] = await db.insert(barMenuSection).values({ slug: 'food', name: 'Food', kind: 'food', companyId: co.id } as any).returning()
const [burger] = await db.insert(barMenuItem).values({ sectionId: sec.id, slug: 'burger', name: 'Hamburger', priceCents: 1000, companyId: co.id } as any).returning()

const app = new Hono()
app.use('*', (c, next) => requestScope.run({ c }, next))
const R = await import('./src/routes/barRegister.ts')
app.route('/api/register', R.registerRoutes)
app.route('/api/gift-cards', (await import('./src/routes/barGiftCards.ts')).default)
app.onError((err: any, c: any) => c.json({ error: err?.message || 'Internal error' }, err?.status || 500))
const call = (who: any, cid = co.id) => async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, { method, headers: { 'content-type': 'application/json', 'x-test-user': who.id, 'x-test-company': cid, 'x-test-role': who.role }, body: body === undefined ? undefined : JSON.stringify(body) })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j }
}
const M = call(manager), B = call(bartender)
const newCheck = async (label: string) => (await B('POST', '/api/register/check', { kind: 'tab', label })).json.check.id as string
const pay = (id: string, b: any) => B('POST', `/api/register/check/${id}/pay`, b)

console.log('\n══════════ 1. codes ══════════')
{
  check('a prefix from the bar\'s name that reads back clearly', G.prefixFromName('Amber Inn') === 'AMBE' && G.prefixFromName('Lil Ollie') === 'EXXX' && G.prefixFromName('') === 'XXXX', [G.prefixFromName('Amber Inn'), G.prefixFromName('Lil Ollie')])
  let ok = true
  for (let i = 0; i < 300; i++) { const c = G.generateCode('AMBE'); if (!/^AMBE-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/.test(c) || /[ILOU]/.test(c.slice(5))) ok = false }
  check('PREFIX-XXXX-XXXX with no look-alike letters', ok)
  check('never repeated in a big batch', new Set(Array.from({ length: 5000 }, () => G.generateCode('AMBE'))).size === 5000)
  check('what people type is forgiven', G.normalizeCode('ambe 7k2q 9xmp', 'AMBE') === 'AMBE-7K2Q-9XMP' && G.normalizeCode('AMBE-7K2Q-9XMO', 'AMBE') === 'AMBE-7K2Q-9XM0' && G.normalizeCode('ambe-1lii-0000', 'AMBE') === 'AMBE-1111-0000' && G.normalizeCode('  00123456  ', 'AMBE') === '00123456')
  check('amounts $5 to $500, whole cents', G.validAmount(2500) && !G.validAmount(499) && !G.validAmount(50001) && !G.validAmount(25.5))
}

console.log('\n══════════ 2. the feature ══════════')
{
  const [other] = await db.insert(company).values({ name: 'No Cards', slug: 'nocards-gc', email: 'nc@test.local', settings: {}, enabledFeatures: ['contacts', 'bar_menu', 'bar_register'] } as any).returning()
  const om = await mk(other.id, 'manager', 'Otto', 'nocards')
  const O = call(om, other.id)
  const c = (await O('POST', '/api/register/check', { kind: 'tab', label: 'X' })).json.check.id
  const sell = await O('POST', `/api/register/check/${c}/giftcard`, { amountCents: 2500 })
  const spendIt = await O('POST', `/api/register/check/${c}/pay`, { tender: 'giftcard', giftCardCode: 'XXXX-0000-0000' })
  const page = await O('GET', '/api/gift-cards')
  const state = await O('GET', '/api/register/state')
  check(`switched off: no selling, no spending, no cards page (${sell.status}, ${spendIt.status}, ${page.status})`, sell.status === 403 && spendIt.status === 403 && page.status === 403, [sell.json, spendIt.json])
  check('…and the register is told so', state.json.giftCards === false)
}

console.log('\n══════════ 3. selling ══════════')
let code = ''
{
  const c = await newCheck('Gift buyer')
  await B('POST', `/api/register/check/${c}/items`, { menuItemId: burger.id })
  const bad = await B('POST', `/api/register/check/${c}/giftcard`, { amountCents: 300 })
  check('a $3 card is refused', bad.status === 400 && /\$5 to \$500/.test(bad.json.error), bad.json)
  const r = await B('POST', `/api/register/check/${c}/giftcard`, { amountCents: 5000 })
  const t = r.json.check.totals
  check(`the card is not taxed; the burger is (${t.subtotalCents} + ${t.taxCents})`, t.subtotalCents === 6000 && t.taxCents === 55 && t.totalCents === 6055, t)
  const cards0 = await db.select().from(barGiftCard).where(eq(barGiftCard.companyId, co.id))
  check('not a card until the check is paid', cards0.length === 0)
  const line = r.json.check.items.find((i: any) => i.kind === 'giftcard')
  const off = await B('POST', `/api/register/item/${line.id}/void`, {})
  check('before then it comes off without a manager or a reason', off.status === 200 && !off.json.check.items.some((i: any) => i.kind === 'giftcard'), off.json)
  await B('POST', `/api/register/check/${c}/giftcard`, { amountCents: 5000 })
  const paid = await pay(c, { tender: 'cash', amountCents: 6055 })
  check('paid', paid.status === 200 && paid.json.check.status === 'paid', paid.json)
  const [card] = await db.select().from(barGiftCard).where(eq(barGiftCard.companyId, co.id))
  check(`paid: the card exists, $50 on it, sold on the register by who (${card?.code})`, !!card && card.balanceCents === 5000 && card.initialCents === 5000 && card.soldVia === 'register' && card.soldByName === 'Jess T' && card.checkId === c, card)
  check("…with this bar's prefix", /^AMBE-[0-9A-Z]{4}-[0-9A-Z]{4}$/.test(card.code), card.code)
  const gl = paid.json.check.items.find((i: any) => i.kind === 'giftcard')
  check('the check line now carries the card and its number', gl.giftCardId === card.id && gl.note === card.code, gl)
  const led = await db.select().from(barGiftCardLedger).where(eq(barGiftCardLedger.cardId, card.id))
  check('its opening ledger row', led.length === 1 && led[0].kind === 'issue' && led[0].amountCents === 5000, led)
  code = card.code
  // a pre-printed card
  const c2 = await newCheck('Printed')
  const pp = await B('POST', `/api/register/check/${c2}/giftcard`, { amountCents: 2500, code: '0012 3456' })
  await pay(c2, { tender: 'card_external', amountCents: 2500 })
  const [printed] = await db.select().from(barGiftCard).where(and(eq(barGiftCard.companyId, co.id), eq(barGiftCard.code, '00123456')))
  check("a pre-printed card's own number is used", pp.status === 200 && !!printed && printed.balanceCents === 2500, printed)
  const c3 = await newCheck('Printed again')
  const dup = await B('POST', `/api/register/check/${c3}/giftcard`, { amountCents: 2500, code: '00123456' })
  check('…and only once', dup.status === 409 && /already in use/.test(dup.json.error), dup.json)
  // renaming the bar never changes the prefix
  await db.update(company).set({ name: 'The New Amber' } as any).where(eq(company.id, co.id))
  const [s] = await db.select().from(barSettings).where(eq(barSettings.companyId, co.id))
  check('the prefix is kept when the bar is renamed', s.giftCardPrefix === 'AMBE' && (await G.cardPrefix(co.id)) === 'AMBE', s.giftCardPrefix)
}

console.log('\n══════════ 4. spending ══════════')
{
  const look = await B('GET', `/api/gift-cards/lookup?code=${encodeURIComponent(code.toLowerCase().replace(/-/g, ' '))}`)
  check('a bartender looks up a balance as typed', look.status === 200 && look.json.balanceCents === 5000 && look.json.code === code, look.json)
  const nope = await B('GET', '/api/gift-cards/lookup?code=AMBE-ZZZZ-ZZZZ')
  check('a number that is not a card says so', nope.status === 404, nope.json)
  // a $60.55 check paid off a $50 card: $50 off the card, $10.55 still owed
  const c = await newCheck('Card spender')
  for (let i = 0; i < 6; i++) await B('POST', `/api/register/check/${c}/items`, { menuItemId: burger.id })
  const tip = await pay(c, { tender: 'giftcard', giftCardCode: code, tipCents: 200 })
  check('no tip off a gift card', tip.status === 400 && /tip/.test(tip.json.error), tip.json)
  const r = await pay(c, { tender: 'giftcard', giftCardCode: code })
  check(`up to the balance: $50 off the card, ${r.json.check?.totals?.balanceCents} still owed`, r.status === 200 && r.json.check.totals.paidCents === 5000 && r.json.check.totals.balanceCents === 1330 && r.json.giftCard?.balanceCents === 0, r.json)
  const empty = await pay(c, { tender: 'giftcard', giftCardCode: code })
  check('an empty card says so', empty.status === 409 && /nothing left/.test(empty.json.error), empty.json)
  // the payment voided (a manager's): the $50 goes back on the card
  const p = r.json.check.payments.find((x: any) => x.tender === 'giftcard')
  const v = await M('POST', `/api/register/payment/${p.id}/void`, { reason: 'Wrong card' })
  const [back] = await db.select().from(barGiftCard).where(and(eq(barGiftCard.companyId, co.id), eq(barGiftCard.code, code)))
  check('a voided gift-card payment puts the money back on the card', v.status === 200 && back.balanceCents === 5000, back.balanceCents)
  const led = await db.select().from(barGiftCardLedger).where(eq(barGiftCardLedger.cardId, back.id))
  check('…on the ledger: issue, redeem, refund', JSON.stringify(led.map((l) => l.kind).sort()) === JSON.stringify(['issue', 'redeem', 'refund']) && led.reduce((s, l) => s + l.amountCents, 0) === back.balanceCents, led.map((l) => [l.kind, l.amountCents]))
  const c2 = await newCheck('Card for a card')
  await B('POST', `/api/register/check/${c2}/giftcard`, { amountCents: 2500 })
  const cc = await pay(c2, { tender: 'giftcard', giftCardCode: code })
  check('a gift card cannot pay for a gift card', cc.status === 400 && /cannot pay for a gift card/.test(cc.json.error), cc.json)
}

console.log('\n══════════ 5. corrections and voids ══════════')
{
  const [card] = await db.select().from(barGiftCard).where(and(eq(barGiftCard.companyId, co.id), eq(barGiftCard.code, code)))
  const bart = await B('POST', `/api/gift-cards/${card.id}/adjust`, { deltaCents: 500, reason: 'comp' })
  check('a bartender may not correct a card', bart.status === 403, bart.json)
  const list = await B('GET', '/api/gift-cards')
  check('…nor see every card', list.status === 403)
  const why = await M('POST', `/api/gift-cards/${card.id}/adjust`, { deltaCents: 500 })
  check('a correction needs a reason', why.status === 400 && /Say why/.test(why.json.error), why.json)
  const below = await M('POST', `/api/gift-cards/${card.id}/adjust`, { deltaCents: -6000, reason: 'oops' })
  check('never below zero', below.status === 409 && /below zero/.test(below.json.error), below.json)
  const ok = await M('POST', `/api/gift-cards/${card.id}/adjust`, { deltaCents: 500, reason: 'Went through the wash' })
  check('a manager adds $5, with the reason on the ledger', ok.status === 200 && ok.json.card.balanceCents === 5500, ok.json)
  const one = await M('GET', `/api/gift-cards/${card.id}`)
  check('the card page shows its ledger', one.status === 200 && one.json.history.some((h: any) => h.kind === 'adjust' && h.note === 'Went through the wash' && h.byName === 'Pat T'), one.json.history)
  const all = await M('GET', '/api/gift-cards')
  check(`the cards list adds up what is owed on them (${all.json.outstandingCents})`, all.status === 200 && all.json.outstandingCents === 5500 + 2500 && all.json.prefix === 'AMBE', all.json.outstandingCents)
  const vd = await M('POST', `/api/gift-cards/${card.id}/void`, { reason: 'Reported stolen' })
  check('a manager voids a card', vd.status === 200)
  const c = await newCheck('Stolen card')
  await B('POST', `/api/register/check/${c}/items`, { menuItemId: burger.id })
  const sp = await pay(c, { tender: 'giftcard', giftCardCode: code })
  check('a voided card cannot be spent', sp.status === 409 && /voided/.test(sp.json.error), sp.json)
}

console.log('\n══════════ 6. another company ══════════')
{
  const [other] = await db.insert(company).values({ name: 'Other Bar', slug: 'other-gc', email: 'ob@test.local', settings: {}, enabledFeatures: ALL } as any).returning()
  const om = await mk(other.id, 'manager', 'Oz', 'othergc')
  const look = await call(om, other.id)('GET', '/api/gift-cards/lookup?code=00123456')
  check("another company never finds this bar's card", look.status === 404, look.json)
  const [printed] = await db.select().from(barGiftCard).where(and(eq(barGiftCard.companyId, co.id), eq(barGiftCard.code, '00123456')))
  const peek = await call(om, other.id)('GET', `/api/gift-cards/${printed.id}`)
  check('…nor reads it by id', peek.status === 404, peek.json)
}

console.log('\n══════════ 7. the close-out ══════════')
{
  const day = (await M('GET', '/api/register/day')).json.summary
  check(`gift cards sold are kept out of food & drink (${day.giftCardsSold.count} sold, ${day.giftCardsSold.cents})`, day.giftCardsSold.count === 2 && day.giftCardsSold.cents === 7500, day.giftCardsSold)
}

console.log(`\nbar-gift-cards: ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
