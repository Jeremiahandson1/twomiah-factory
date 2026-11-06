// Gift card depth (salon parity row 19; server crm/salon/giftCards.ts, giftBonus.ts, giftShop.ts): a free promotional bonus ("buy $100, get $20") that
// may carry a last day while the PAID money never expires (owner decision 2026-10-31), a bonus's last day extended with a logged reason, a card
// reloaded as a paid sale, a card emailed now or on a chosen day, the salon's public page that sells a card on Stripe's own page on the salon's
// own account, the balance page, and a card sold on the card reader.
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { and, eq } from 'drizzle-orm'
import { addDays, tzParts } from '@twomiah/tenant-backend'
import { bootFood } from './foodKit.ts'
import { bonusExpired, parseOffers, readOffers, spendableCents, splitSpend } from '../server/crm/salon/giftBonus.ts'
import { notGiftCardSale } from '../server/data/salon.ts'

describe('gift card bonus arithmetic', () => {
  const card = { balanceCents: 12000, bonusCents: 2000, bonusExpiresOn: '2026-11-30' }
  test('the bonus is spent first while it lives; after its last day it cannot be spent and the paid part still can', () => {
    expect(bonusExpired(card, '2026-11-30')).toBe(false)
    expect(bonusExpired(card, '2026-12-01')).toBe(true)
    expect(bonusExpired({ ...card, bonusExpiresOn: null }, '2030-01-01')).toBe(false)
    expect(spendableCents(card, '2026-11-01')).toBe(12000)
    expect(spendableCents(card, '2026-12-01')).toBe(10000)
    expect(splitSpend(card, 5000, '2026-11-01')).toEqual({ fromBonus: 2000, fromPaid: 3000 })
    expect(splitSpend(card, 1500, '2026-11-01')).toEqual({ fromBonus: 1500, fromPaid: 0 })
    expect(splitSpend(card, 5000, '2026-12-01')).toEqual({ fromBonus: 0, fromPaid: 5000 })
    expect(splitSpend(card, 10001, '2026-12-01')).toBeNull()
    expect(splitSpend(card, 0, '2026-11-01')).toBeNull()
  })
  test('offers: the bonus is something and no more than the purchase; one offer per amount; the paid money has no expiry setting at all', () => {
    expect(parseOffers([{ buyCents: 10000, bonusCents: 2000, validDays: 30 }, { buyCents: 5000, bonusCents: 500 }])).toEqual({ offers: [
      { id: 'b5000', buyCents: 5000, bonusCents: 500, validDays: null }, { id: 'b10000', buyCents: 10000, bonusCents: 2000, validDays: 30 }] })
    for (const bad of [[{ buyCents: 100, bonusCents: 50 }], [{ buyCents: 5000, bonusCents: 0 }], [{ buyCents: 5000, bonusCents: 6000 }], [{ buyCents: 100000, bonusCents: 100 }],
      [{ buyCents: 5000, bonusCents: 500 }, { buyCents: 5000, bonusCents: 600 }], [{ buyCents: 5000, bonusCents: 500, validDays: 0 }], 'x']) expect(parseOffers(bad)).toHaveProperty('problem')
    expect(readOffers({ salonGiftOffers: 'junk' })).toEqual([])
    expect(Object.keys((parseOffers([{ buyCents: 5000, bonusCents: 500, paidExpiresDays: 30, expiresOn: '2027-01-01' }]) as any).offers[0])).toEqual(['id', 'buyCents', 'bonusCents', 'validDays'])
  })
})

const TZ = 'America/Chicago'
const today = () => tzParts(new Date(), TZ).date
const FEATURES = ['contacts', 'client_profiles', 'service_menu', 'salon_booking', 'invoices', 'chair_checkout', 'online_payments', 'salon_gift_cards']

describe('salon: gift cards — bonus, reload, send on, online sale, balance page, reader sale', () => {
  let k: Awaited<ReturnType<typeof bootFood>>
  let t: any, S: any, co = ''
  let ip = 0
  const mails: Array<{ to: string; subject: string; html: string }> = []
  const as = async (who: 'owner' | 'manager' | 'bartender', path: string, method = 'GET', json?: unknown) => {
    const r = await t.call(path, { method, json, headers: { Authorization: `Bearer ${k.tokens[who]}`, 'x-forwarded-for': `10.5.0.${++ip}`, host: 'bar.test' } })
    const text = await r.text(); let body: any = text; try { body = JSON.parse(text) } catch { /* html */ }
    return { status: r.status, body }
  }
  const pub = async (path: string, method = 'GET', form?: Record<string, string>, from = `10.4.0.${++ip}`) => {
    const r = await t.call(path, { method, headers: { 'x-forwarded-for': from, host: 'bar.test', ...(form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) }, ...(form ? { body: new URLSearchParams(form).toString() } : {}), redirect: 'manual' })
    return { status: r.status, text: await r.text(), location: r.headers.get('location') }
  }
  const jobs = () => (t.services.crm as any).giftCardJobs as { deliverDue(): Promise<number>; expireDue(): Promise<number>; expirePending(): Promise<number> }
  const cardRow = async (id: string) => (await t.db.select().from(S.salonGiftCard).where(eq(S.salonGiftCard.id, id)))[0]
  const ledgerOf = async (id: string) => (await t.db.select().from(S.salonGiftCardLedger).where(eq(S.salonGiftCardLedger.cardId, id))) as any[]
  const waitMail = async (n: number) => { for (let i = 0; i < 100 && mails.length < n; i++) await Bun.sleep(20) }
  const event = (account: string, sid: string) => t.call('/api/stripe/factory-event', {
    method: 'POST', headers: { 'X-Factory-Key': process.env.FACTORY_SYNC_KEY || 'factory-key' },
    json: { event: { type: 'checkout.session.completed', account, data: { object: k.stripe.sessions.get(sid) } } },
  })
  const sell = (body: Record<string, unknown>) => as('owner', '/api/salon-gift-cards/sell', 'POST', { method: 'cash', ...body })
  const sale = async (cents: number) => {
    const inv = (await t.db.insert(S.invoice).values({ companyId: co, number: `T-${++ip}`, status: 'open', subtotal: String(cents / 100), total: String(cents / 100), amountPaid: '0' }).returning())[0]
    return inv.id as string
  }

  beforeAll(async () => {
    process.env.FACTORY_SYNC_KEY = process.env.FACTORY_SYNC_KEY || 'factory-key'
    k = await bootFood({ vertical: 'salon', features: FEATURES, sharedStripe: true })
    t = k.t; S = k.S; co = k.companyId
    await t.db.update(S.company).set({ timezone: TZ }).where(eq(S.company.id, co))
    const real = t.services.crm.emailService.sendRaw.bind(t.services.crm.emailService)
    ;(t.services.crm.emailService as any).sendRaw = async (m: any) => { mails.push({ to: m.to, subject: m.subject, html: m.html }); return real(m) }
  }, 120_000)
  afterAll(() => k.restore())

  test('offers and online sales are the owner\'s to set — checked on the server; a bad offer is refused with the reason', async () => {
    expect((await as('manager', '/api/salon-gift-cards/settings', 'PUT', { offers: [] })).status).toBe(403)
    expect((await as('bartender', '/api/salon-gift-cards/settings')).status).toBe(403)
    const bad = await as('owner', '/api/salon-gift-cards/settings', 'PUT', { offers: [{ buyCents: 10000, bonusCents: 20000 }] })
    expect([bad.status, bad.body.code, typeof bad.body.fields?.offers]).toEqual([400, 'BAD_OFFERS', 'string'])
    const ok = await as('owner', '/api/salon-gift-cards/settings', 'PUT', { offers: [{ buyCents: 10000, bonusCents: 2000, validDays: 30 }, { buyCents: 5000, bonusCents: 500, validDays: null }] })
    expect([ok.status, ok.body.online, ok.body.offers.map((o: any) => o.id)]).toEqual([200, false, ['b5000', 'b10000']])
    expect((await as('manager', '/api/salon-gift-cards/settings')).body.offers).toHaveLength(2)
  })

  test('desk sale with an offer: pay $100, get $20 free with a last day; the sale is $100 only; the email prints the last day and says the paid money stays', async () => {
    mails.length = 0
    const r = await sell({ amountCents: 10000, offerId: 'b10000', recipientName: 'Rae', recipientEmail: 'rae@example.com', purchaserName: 'Pat' })
    expect(r.status).toBe(201)
    const c = r.body.card
    expect([c.initialCents, c.balanceCents, c.bonusCents, c.paidCents, c.spendableCents, c.bonusExpiresOn]).toEqual([10000, 12000, 2000, 10000, 12000, addDays(today(), 30)])
    const inv = (await t.db.select().from(S.invoice).where(eq(S.invoice.id, r.body.invoiceId)))[0]
    expect([Number(inv.total), Number(inv.amountPaid), inv.status]).toEqual([100, 100, 'paid'])
    expect((await ledgerOf(c.id)).map((l) => [l.kind, l.amountCents]).sort()).toEqual([['bonus', 2000], ['issue', 10000]])
    await waitMail(1)
    expect(mails[0].to).toBe('rae@example.com')
    expect(mails[0].html).toContain('$120')
    expect(mails[0].html).toContain('free $20 bonus')
    expect(mails[0].html).toContain('does not expire')
    expect(mails[0].html).toContain(new Date(addDays(today(), 30) + 'T12:00:00Z').toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }))
    expect(mails[0].html).toContain('/api/gift-balance')
    // a made-up offer, or an offer for another amount, is refused and nothing is sold
    const before = (await t.db.select().from(S.salonGiftCard)).length
    expect((await sell({ amountCents: 10000, offerId: 'nope' })).body.code).toBe('BAD_OFFER')
    expect((await sell({ amountCents: 7500, offerId: 'b10000' })).body.code).toBe('BAD_OFFER')
    expect((await t.db.select().from(S.salonGiftCard)).length).toBe(before)
    // there is no way to give a card an expiry on the money that was paid
    const plain = await sell({ amountCents: 5000, bonusExpiresOn: '2020-01-01', expiresOn: '2020-01-01' })
    expect([plain.status, plain.body.card.bonusCents, plain.body.card.bonusExpiresOn]).toEqual([201, 0, null])
  })

  test('spending takes the live bonus first; the sale it pays shows the split; a refund by card goes back as paid value', async () => {
    const r = await sell({ amountCents: 10000, offerId: 'b10000' })
    const id = r.body.card.id, code = r.body.card.code
    const due = await sale(5000)
    const red = await as('owner', '/api/salon-gift-cards/redeem', 'POST', { code, invoiceId: due })
    expect([red.status, red.body.balanceCents, red.body.appliedCents]).toEqual([200, 7000, 5000])
    const after = await cardRow(id)
    expect([after.balanceCents, after.bonusCents]).toEqual([7000, 0])                          // the $20 bonus went first
    expect((await ledgerOf(id)).find((l) => l.kind === 'redeem')?.note).toContain('$20 of it from the free bonus')
  })

  test('after its last day the bonus cannot be spent and is taken off by a ledger line; the paid part is still spendable', async () => {
    const r = await sell({ amountCents: 5000, offerId: 'b5000' })
    const id = r.body.card.id, code = r.body.card.code
    // the bonus here has no last day; give a second card one that has passed
    const r2 = await sell({ amountCents: 10000, offerId: 'b10000' })
    const id2 = r2.body.card.id, code2 = r2.body.card.code
    await t.db.update(S.salonGiftCard).set({ bonusExpiresOn: addDays(today(), -1) }).where(eq(S.salonGiftCard.id, id2))
    const look = await as('owner', `/api/salon-gift-cards/lookup?code=${code2}`)
    expect([look.body.balanceCents, look.body.spendableCents]).toEqual([12000, 10000])
    const big = await sale(12000)
    const over = await as('owner', '/api/salon-gift-cards/redeem', 'POST', { code: code2, invoiceId: big, amountCents: 11000 })
    expect([over.status, over.body.code]).toEqual([409, 'OVER_BALANCE'])
    const ok = await as('owner', '/api/salon-gift-cards/redeem', 'POST', { code: code2, invoiceId: big, amountCents: 10000 })
    expect([ok.status, ok.body.balanceCents]).toEqual([200, 0])
    const kinds = (await ledgerOf(id2)).map((l) => [l.kind, l.amountCents])
    expect(kinds).toContainEqual(['bonus_expired', -2000])
    expect(kinds).toContainEqual(['redeem', -10000])
    // the no-expiry card is untouched by any date
    const other = await cardRow(id)
    expect([other.bonusExpiresOn, other.status]).toEqual([null, 'active'])
    expect((await as('owner', `/api/salon-gift-cards/lookup?code=${code}`)).body.spendableCents).toBe(5500)
  })

  test('the timed pass takes expired bonuses off cards nobody has touched, once', async () => {
    const r = await sell({ amountCents: 5000, offerId: 'b5000' })
    await t.db.update(S.salonGiftCard).set({ bonusExpiresOn: addDays(today(), -2) }).where(eq(S.salonGiftCard.id, r.body.card.id))
    const swept = await jobs().expireDue()
    expect(swept).toBeGreaterThanOrEqual(1)
    const row = await cardRow(r.body.card.id)
    expect([row.balanceCents, row.bonusCents]).toEqual([5000, 0])
    expect(await jobs().expireDue()).toBe(0)
  })

  test('extending a live bonus\'s last day needs a reason and a later day, is logged, and is refused once the bonus has ended', async () => {
    const r = await sell({ amountCents: 10000, offerId: 'b10000' })
    const id = r.body.card.id
    const ext = (body: unknown, who: 'owner' | 'bartender' = 'owner') => as(who, `/api/salon-gift-cards/${id}/extend-bonus`, 'POST', body)
    expect((await ext({ bonusExpiresOn: addDays(today(), 60), reason: 'x' }, 'bartender')).status).toBe(403)
    expect((await ext({ bonusExpiresOn: addDays(today(), 60) })).body.code).toBe('REASON_REQUIRED')
    expect((await ext({ bonusExpiresOn: 'soon', reason: 'Illness' })).body.code).toBe('BAD_DATE')
    expect((await ext({ bonusExpiresOn: addDays(today(), 10), reason: 'Illness' })).body.code).toBe('BAD_DATE')       // not later than the current last day
    const ok = await ext({ bonusExpiresOn: addDays(today(), 60), reason: 'Client was ill' })
    expect([ok.status, ok.body.card.bonusExpiresOn]).toEqual([200, addDays(today(), 60)])
    const line = (await ledgerOf(id)).find((l) => l.kind === 'extend')
    expect(line.note).toContain(`${addDays(today(), 30)} → ${addDays(today(), 60)}`)
    expect(line.note).toContain('Client was ill')
    // a card with no bonus has nothing to extend; an ended bonus is not brought back this way
    const plain = await sell({ amountCents: 5000 })
    expect((await as('owner', `/api/salon-gift-cards/${plain.body.card.id}/extend-bonus`, 'POST', { bonusExpiresOn: addDays(today(), 5), reason: 'x' })).body.code).toBe('NO_BONUS')
    await t.db.update(S.salonGiftCard).set({ bonusExpiresOn: addDays(today(), -1) }).where(eq(S.salonGiftCard.id, id))
    expect((await ext({ bonusExpiresOn: addDays(today(), 90), reason: 'Please' })).body.code).toBe('BONUS_EXPIRED')
  })

  test('reload: more money on a card as a paid sale of its own — not revenue, limited, and the right is checked', async () => {
    const r = await sell({ amountCents: 5000 })
    const id = r.body.card.id
    expect((await as('bartender', `/api/salon-gift-cards/${id}/reload`, 'POST', { amountCents: 3000, method: 'cash' })).status).toBe(403)
    expect((await as('owner', `/api/salon-gift-cards/${id}/reload`, 'POST', { amountCents: 100, method: 'cash' })).body.code).toBe('BAD_AMOUNT')
    expect((await as('owner', `/api/salon-gift-cards/${id}/reload`, 'POST', { amountCents: 3000, method: 'barter' })).body.code).toBe('BAD_METHOD')
    expect((await as('owner', `/api/salon-gift-cards/${id}/reload`, 'POST', { amountCents: 99000, method: 'cash' })).body.code).toBe('OVER_MAX')
    const ok = await as('owner', `/api/salon-gift-cards/${id}/reload`, 'POST', { amountCents: 3000, method: 'card' })
    expect([ok.status, ok.body.card.balanceCents, ok.body.card.paidCents]).toEqual([200, 8000, 8000])
    const inv = (await t.db.select().from(S.invoice).where(eq(S.invoice.id, ok.body.invoiceId)))[0]
    expect([Number(inv.total), inv.status]).toEqual([30, 'paid'])
    expect((await t.db.select().from(S.payment).where(eq(S.payment.invoiceId, ok.body.invoiceId))).map((p: any) => [Number(p.amount), p.method])).toEqual([[30, 'card']])
    const line = (await ledgerOf(id)).find((l) => l.kind === 'reload')
    expect([line.amountCents, line.invoiceId]).toEqual([3000, ok.body.invoiceId])
    // a reload is a liability like the first sale, not revenue
    const revenue = await t.db.select({ id: S.invoice.id }).from(S.invoice).where(and(eq(S.invoice.id, ok.body.invoiceId), notGiftCardSale))
    expect(revenue).toHaveLength(0)
    // a voided or unpaid card cannot be reloaded
    await as('owner', `/api/salon-gift-cards/${id}/void`, 'POST', { reason: 'Lost' })
    expect((await as('owner', `/api/salon-gift-cards/${id}/reload`, 'POST', { amountCents: 3000, method: 'cash' })).status).toBe(409)
  })

  test('send on a chosen day: not emailed at the sale, emailed once when the day comes; a past or made-up day is refused', async () => {
    mails.length = 0
    const later = addDays(today(), 3)
    const r = await sell({ amountCents: 5000, recipientEmail: 'later@example.com', deliverOn: later })
    expect([r.status, r.body.emailed, r.body.scheduled, r.body.card.deliverOn]).toEqual([201, false, later, later])
    expect((await sell({ amountCents: 5000, recipientEmail: 'x@example.com', deliverOn: addDays(today(), -1) })).body.code).toBe('BAD_DATE')
    expect((await sell({ amountCents: 5000, recipientEmail: 'x@example.com', deliverOn: '2026-02-30' })).body.code).toBe('BAD_DATE')
    expect((await sell({ amountCents: 5000, deliverOn: later })).body.code).toBe('BAD_EMAIL')            // nobody to send it to
    await Bun.sleep(100)
    expect(mails.filter((m) => m.to === 'later@example.com')).toHaveLength(0)
    expect(await jobs().deliverDue()).toBe(0)
    await t.db.update(S.salonGiftCard).set({ deliverOn: today() }).where(eq(S.salonGiftCard.id, r.body.card.id))
    expect(await jobs().deliverDue()).toBe(1)
    expect(await jobs().deliverDue()).toBe(0)
    expect(mails.filter((m) => m.to === 'later@example.com')).toHaveLength(1)
    expect((await cardRow(r.body.card.id)).deliveredAt).not.toBeNull()
  })

  test('the online page: off until the owner switches it on; then a card is bought on Stripe\'s page on the salon\'s account and is live only when paid', async () => {
    const off = await pub('/api/gift-shop')
    expect([off.status, off.text.includes('not sold online')]).toEqual([409, true])
    expect((await as('manager', '/api/salon-gift-cards/settings', 'PUT', { online: true })).status).toBe(403)
    expect((await as('owner', '/api/salon-gift-cards/settings', 'PUT', { online: 'yes' })).status).toBe(400)
    expect((await as('owner', '/api/salon-gift-cards/settings', 'PUT', { online: true })).body.online).toBe(true)
    const form = await pub('/api/gift-shop')
    expect(form.status).toBe(200)
    expect(form.text).toContain('get <strong>$20 free</strong>')
    expect(form.text).toContain('never expires')
    const base = { choice: 'offer:b10000', purchaserName: 'Pat', purchaserEmail: 'pat@example.com', recipientName: 'Rae', recipientEmail: 'rae2@example.com', message: 'Enjoy' }
    // refused before Stripe is asked: a robot, no email, a bad amount, a past day
    const calls = k.stripe.posts('/v1/checkout/sessions').length
    expect((await pub('/api/gift-shop', 'POST', { ...base, website: 'spam.example' })).status).toBe(400)
    expect((await pub('/api/gift-shop', 'POST', { ...base, purchaserEmail: '' })).status).toBe(400)
    expect((await pub('/api/gift-shop', 'POST', { ...base, choice: 'custom', custom: '2' })).status).toBe(400)
    expect((await pub('/api/gift-shop', 'POST', { ...base, deliverOn: addDays(today(), -1) })).status).toBe(400)
    expect(k.stripe.posts('/v1/checkout/sessions').length).toBe(calls)
    const cardsBefore = (await t.db.select().from(S.salonGiftCard)).length
    expect(cardsBefore).toBeGreaterThan(0)
    expect((await t.db.select().from(S.salonGiftCard).where(eq(S.salonGiftCard.status, 'pending')))).toHaveLength(0)       // refused ones left nothing behind
    mails.length = 0
    const go = await pub('/api/gift-shop', 'POST', base)
    expect(go.status).toBe(303)
    expect(go.location).toContain('checkout.stripe.com')
    const made = k.stripe.calls.filter((c) => c.method === 'POST' && c.path === '/v1/checkout/sessions').pop()!
    expect(made.account).toBe('acct_biz')
    expect(made.params.get('line_items[0][price_data][unit_amount]')).toBe('10000')              // what is paid; the bonus is free
    const pending = (await t.db.select().from(S.salonGiftCard).where(eq(S.salonGiftCard.status, 'pending')))[0]
    expect(made.params.get('metadata[twomiah_gift_card]')).toBe(pending.id)
    expect([pending.balanceCents, pending.bonusCents, pending.bonusGrantedCents, pending.source]).toEqual([0, 0, 2000, 'online'])
    // a card that has not been paid for cannot be spent or found, and nothing is sent
    const due = await sale(1000)
    expect((await as('owner', '/api/salon-gift-cards/redeem', 'POST', { code: pending.code, invoiceId: due })).status).toBe(409)
    expect((await pub('/api/gift-balance', 'POST', { code: pending.code })).text).toContain('No gift card with that number')
    const sid = [...k.stripe.sessions.keys()].pop()!
    expect((await pub(`/api/gift-shop?done=${sid}`)).text).toContain('could not confirm')
    expect((await cardRow(pending.id)).status).toBe('pending')
    // paid on Stripe's page; the buyer returns
    k.stripe.paySession(sid)
    expect((await event('acct_other', sid)).status).toBeLessThan(500)
    expect((await cardRow(pending.id)).status).toBe('pending')                                   // an event from another account does nothing
    const back = await pub(`/api/gift-shop?done=${sid}`)
    expect(back.text).toContain('Thank you')
    const live = await cardRow(pending.id)
    expect([live.status, live.balanceCents, live.bonusCents]).toEqual(['active', 12000, 2000])
    const inv = (await t.db.select().from(S.invoice).where(eq(S.invoice.id, live.invoiceId)))[0]
    expect([inv.status, Number(inv.amountPaid)]).toEqual(['paid', 100])
    const pays = await t.db.select().from(S.payment).where(eq(S.payment.invoiceId, live.invoiceId))
    expect(pays.map((p: any) => [Number(p.amount), p.method, p.reference])).toEqual([[100, 'card', `pi_for_${sid}`]])
    await waitMail(2)
    expect(mails.find((m) => m.to === 'rae2@example.com')?.html).toContain(live.code)
    expect(mails.find((m) => m.to === 'pat@example.com')?.html).toContain('has been emailed to rae2@example.com')
    // Stripe's own event, and the page again: still one payment, one card, one email each
    expect((await event('acct_biz', sid)).status).toBe(200)
    await pub(`/api/gift-shop?done=${sid}`)
    await Bun.sleep(150)
    expect(await t.db.select().from(S.payment).where(eq(S.payment.invoiceId, live.invoiceId))).toHaveLength(1)
    expect(mails.filter((m) => m.to === 'rae2@example.com')).toHaveLength(1)
    expect((await ledgerOf(live.id)).filter((l) => l.kind === 'issue')).toHaveLength(1)
    // it can now be spent
    expect((await as('owner', '/api/salon-gift-cards/redeem', 'POST', { code: live.code, invoiceId: due })).status).toBe(200)
  })

  test('the online page can send on a chosen day: paid now, emailed on the day; with no recipient the buyer gets it', async () => {
    mails.length = 0
    const later = addDays(today(), 5)
    const go = await pub('/api/gift-shop', 'POST', { choice: 'amount:2500', purchaserEmail: 'buyer@example.com', recipientEmail: 'gift@example.com', deliverOn: later })
    expect(go.status).toBe(303)
    const sid = [...k.stripe.sessions.keys()].pop()!
    k.stripe.paySession(sid)
    expect((await event('acct_biz', sid)).status).toBe(200)
    const row = (await t.db.select().from(S.salonGiftCard).where(eq(S.salonGiftCard.sessionId, sid)))[0]
    expect([row.status, row.deliverOn, row.balanceCents]).toEqual(['active', later, 2500])
    await waitMail(1)
    expect(mails.map((m) => m.to)).toEqual(['buyer@example.com'])                                 // the buyer's receipt says when; the card itself waits
    expect(mails[0].html).toContain('will be emailed to gift@example.com')
    // for themselves: sent to the buyer at once
    mails.length = 0
    await pub('/api/gift-shop', 'POST', { choice: 'amount:5000', purchaserEmail: 'me@example.com' })
    const sid2 = [...k.stripe.sessions.keys()].pop()!
    k.stripe.paySession(sid2)
    await event('acct_biz', sid2)
    await waitMail(1)
    expect(mails[0].to).toBe('me@example.com')
    expect(mails[0].html).toContain((await t.db.select().from(S.salonGiftCard).where(eq(S.salonGiftCard.sessionId, sid2)))[0].code)
  })

  test('the balance page: what can be spent, the free bonus and its last day, nothing about the buyer; unknown numbers say so; it is rate limited', async () => {
    const r = await sell({ amountCents: 10000, offerId: 'b10000', purchaserName: 'Secret Buyer', purchaserEmail: 'secret@example.com' })
    const page = await pub('/api/gift-balance', 'POST', { code: r.body.card.code }, '10.3.0.1')
    expect(page.status).toBe(200)
    expect(page.text).toContain('$120')
    expect(page.text).toContain('free <strong>$20</strong> bonus')
    expect(page.text).toContain('The $100 that was paid for the card does not expire')
    expect(page.text).not.toContain('Secret Buyer')
    expect(page.text).not.toContain('secret@example.com')
    expect((await pub('/api/gift-balance', 'POST', { code: 'NOPE-0000-0000' }, '10.3.0.2')).text).toContain('No gift card with that number')
    // after the bonus ends: only the paid part, and it says so
    await t.db.update(S.salonGiftCard).set({ bonusExpiresOn: addDays(today(), -1) }).where(eq(S.salonGiftCard.id, r.body.card.id))
    const after = await pub('/api/gift-balance', 'POST', { code: r.body.card.code }, '10.3.0.3')
    expect(after.text).toContain('$100')
    expect(after.text).toContain('free bonus on this card has ended')
    const json = await t.call('/api/gift-balance/check', { method: 'POST', headers: { 'x-forwarded-for': '10.3.0.4', host: 'bar.test', 'content-type': 'application/json' }, body: JSON.stringify({ code: r.body.card.code }) })
    expect(await json.json()).toMatchObject({ found: true, spendableCents: 10000, bonusExpired: true })
    // ten tries from one address, then it stops
    for (let i = 0; i < 10; i++) await pub('/api/gift-balance', 'POST', { code: 'NOPE-0000-0000' }, '10.3.0.99')
    expect((await pub('/api/gift-balance', 'POST', { code: r.body.card.code }, '10.3.0.99')).status).toBe(429)
    // a voided card is no longer valid
    await as('owner', `/api/salon-gift-cards/${r.body.card.id}/void`, 'POST', { reason: 'Lost' })
    expect((await pub('/api/gift-balance', 'POST', { code: r.body.card.code }, '10.3.0.5')).text).toContain('no longer valid')
  })

  test('sold on the card reader: the card waits on an open sale, is live only when the reader takes the payment, and is not tippable revenue', async () => {
    const paired = await as('owner', '/api/chair-checkout/readers', 'POST', { code: 'simulated-wpe', label: 'Front desk' })
    expect(paired.status).toBe(201)
    const readerId = paired.body.reader.id
    expect((await as('bartender', '/api/salon-gift-cards/reader-sale', 'POST', { amountCents: 5000 })).status).toBe(403)
    const made = await as('owner', '/api/salon-gift-cards/reader-sale', 'POST', { amountCents: 10000, offerId: 'b10000', recipientEmail: 'reader@example.com' })
    expect([made.status, made.body.card.status, made.body.card.source, made.body.card.balanceCents]).toEqual([201, 'pending', 'reader', 0])
    const due = await sale(1000)
    expect((await as('owner', '/api/salon-gift-cards/redeem', 'POST', { code: made.body.card.code, invoiceId: due })).status).toBe(409)
    mails.length = 0
    const started = await as('owner', '/api/chair-checkout/charges', 'POST', { invoiceId: made.body.invoiceId, readerId, tipOnReader: false })
    expect(started.status).toBe(201)
    expect((await cardRow(made.body.card.id)).status).toBe('pending')                           // charge started, not paid
    const tapped = await as('owner', `/api/chair-checkout/charges/${started.body.charge.id}/simulate`, 'POST', { outcome: 'approve', tipCents: 0 })
    expect(tapped.status).toBeLessThan(300)
    const live = await cardRow(made.body.card.id)
    expect([live.status, live.balanceCents, live.bonusCents]).toEqual(['active', 12000, 2000])
    await waitMail(1)
    expect(mails.find((m) => m.to === 'reader@example.com')?.html).toContain(live.code)
    expect((await ledgerOf(live.id)).filter((l) => l.kind === 'issue')).toHaveLength(1)
    // a reader sale nobody pays is cleaned up by the timed pass
    const stale = await as('owner', '/api/salon-gift-cards/reader-sale', 'POST', { amountCents: 5000 })
    await t.db.update(S.salonGiftCard).set({ createdAt: new Date(Date.now() - 4 * 86400_000) }).where(eq(S.salonGiftCard.id, stale.body.card.id))
    expect(await jobs().expirePending()).toBeGreaterThanOrEqual(1)
    expect([(await cardRow(stale.body.card.id)).status, (await t.db.select().from(S.invoice).where(eq(S.invoice.id, stale.body.invoiceId)))[0].status]).toEqual(['void', 'void'])
  })
})
