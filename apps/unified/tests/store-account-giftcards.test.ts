// Parity row 5 against Shopify (2026-10-31): the gift cards a shopper bought or was given, with balance and code, on their account
// page beside store credit.
//   · a card whose purchaser OR recipient email is the shopper's (any capitals, any spaces) is theirs, and only theirs;
//   · bought and given are told apart; a card they bought and were also sent shows once, as bought;
//   · a spent card is shown as used up (so it is not thought lost); a voided card and store credit from a return are not here;
//   · the page itself draws them (the served script says so) — a signed-out visitor is refused, as before.
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootStore } from './storeKit.ts'

let k: Awaited<ReturnType<typeof bootStore>>
const A = '/api/public/account'
const db = () => k.t.db as any
const ON = ['dashboard', 'orders', 'products', 'contacts', 'store_accounts']
const cookieOf = (res: { headers: Headers }) => (res.headers.get('set-cookie') || '').split(';')[0]
let ann: any, bob: any

async function signIn(email: string, who: any) {
  await db().delete(k.S.shopperLogin).where(eq(k.S.shopperLogin.contactId, who.id))
  const before = k.mails.filter((m) => m.to.toLowerCase() === email.toLowerCase() && m.template === 'storeSignIn').length
  await k.pub('POST', `${A}/sign-in`, { email })
  await k.settle()
  const mail = k.mails.filter((m) => m.to.toLowerCase() === email.toLowerCase() && m.template === 'storeSignIn')[before]
  const res = await k.pub('POST', `${A}/verify`, { email, code: mail.data.code })
  expect(res.status).toBe(200)
  return cookieOf(res)
}
let n = 0
const card = (v: Record<string, unknown>) => db().insert(k.S.barGiftCard).values({ companyId: k.companyId, code: `GC-${++n}`, initialCents: 5000, balanceCents: 5000, status: 'active', soldVia: 'online', ...v })

beforeAll(async () => {
  k = await bootStore()
  await db().insert(k.S.storeSettings).values({ companyId: k.companyId, currency: 'usd', flatShippingCents: 0, taxRateBps: 0 })
  ;[ann] = await db().insert(k.S.contact).values({ companyId: k.companyId, name: 'Ann Able', email: 'Ann@Example.com', type: 'customer' }).returning()
  ;[bob] = await db().insert(k.S.contact).values({ companyId: k.companyId, name: 'Bob Baker', email: 'bob@example.com', type: 'customer' }).returning()
  await card({ code: 'ANN-BOUGHT', initialCents: 5000, balanceCents: 3200, purchaserEmail: 'ann@example.com', createdAt: new Date('2026-10-01T12:00:00Z') })
  await card({ code: 'ANN-GIVEN', initialCents: 2500, balanceCents: 2500, purchaserEmail: 'bob@example.com', recipientEmail: ' ANN@example.com ', createdAt: new Date('2026-10-02T12:00:00Z') })
  await card({ code: 'ANN-SPENT', initialCents: 1000, balanceCents: 0, purchaserEmail: 'ann@example.com', createdAt: new Date('2026-09-01T12:00:00Z') })
  await card({ code: 'ANN-VOID', purchaserEmail: 'ann@example.com', status: 'void' })
  await card({ code: 'ANN-CREDIT', purchaserEmail: 'ann@example.com', soldVia: 'store_credit' })
  await card({ code: 'BOB-OWN', initialCents: 1500, balanceCents: 1500, purchaserEmail: 'bob@example.com' })
  await card({ code: 'BOTH', initialCents: 2000, balanceCents: 2000, purchaserEmail: 'ann@example.com', recipientEmail: 'ann@example.com' })
  await db().update(k.S.company).set({ enabledFeatures: ON }).where(eq(k.S.company.id, k.companyId))
  k.t.services.features.forgetFeatures()
}, 120_000)
afterAll(() => k.restore())

describe('gift cards on the account page', () => {
  test('a shopper sees the cards they bought and were given — balance and code — and nobody else\'s', async () => {
    const cookie = await signIn('ann@example.com', ann)
    const me = await k.pub('GET', `${A}/me`, undefined, { cookie })
    expect(me.status).toBe(200)
    const cards = me.json.giftCards as Array<{ code: string; balanceCents: number; initialCents: number; relation: string }>
    expect(cards.map((c) => c.code)).toEqual(['BOTH', 'ANN-GIVEN', 'ANN-BOUGHT', 'ANN-SPENT']) // newest first
    const by = Object.fromEntries(cards.map((c) => [c.code, c]))
    expect(by['ANN-BOUGHT']).toMatchObject({ balanceCents: 3200, initialCents: 5000, relation: 'bought' })
    expect(by['ANN-GIVEN']).toMatchObject({ balanceCents: 2500, relation: 'given' })
    expect(by['BOTH'].relation).toBe('bought') // bought it and sent to herself: once, as bought
    expect(by['ANN-SPENT']).toMatchObject({ balanceCents: 0, relation: 'bought' })
    for (const hidden of ['ANN-VOID', 'ANN-CREDIT', 'BOB-OWN']) expect(by[hidden]).toBeUndefined()
  })

  test('another shopper sees their own, which includes the card they bought for Ann', async () => {
    const cookie = await signIn('bob@example.com', bob)
    const me = await k.pub('GET', `${A}/me`, undefined, { cookie })
    expect((me.json.giftCards as any[]).map((c) => [c.code, c.relation]).sort()).toEqual([['ANN-GIVEN', 'bought'], ['BOB-OWN', 'bought']])
  })

  test('signed out: refused; the page\'s script draws the cards', async () => {
    expect((await k.pub('GET', `${A}/me`)).status).toBe(401)
    const script = await k.pub('GET', '/scripts/account.js')
    expect(script.status).toBe(200)
    expect(script.text).toContain('Gift card given to you')
    expect(script.text).toContain('used up')
  })
})
