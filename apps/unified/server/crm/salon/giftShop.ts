// The salon's public gift card pages (salon parity row 19): buy a card online, and check a card's balance.
//
//   /api/gift-shop     choose an amount (the salon's "buy $100, get $20 free" offers, or any amount), who it is for and the day to send it, then pay on
//                      STRIPE'S OWN page on the SALON'S account — never Twomiah's. The card waits, unspendable, until the payment is recorded; then it is
//                      issued, emailed (now, or on the day chosen), and the buyer gets a receipt. Recorded two ways — Stripe's finished-page event and the
//                      page the buyer returns to — and once (the card turns active once); nothing is believed on the page's word: the session is read back.
//   /api/gift-balance  a holder types the number and sees what they can spend, the free bonus and its last day. Nothing about who bought it.
// Both are off until the owner switches online sales on (Settings › Gift cards) and need the salon's own Stripe account. Both are rate limited per address.
import { Hono } from 'hono'
import { and, asc, eq } from 'drizzle-orm'
import type Stripe from 'stripe'
import { recordInvoicePayment, round2 } from '@twomiah/tenant-backend'
import { company, invoice, payment, salonGiftCard } from '../../db/schema/index.ts'
import { escHtml } from '../../core/email.ts'
import { siteOrigin } from '../../booking/happenings.ts'
import { fail, one } from '../../http/reply.ts'
import type { CrmDeps } from '../deps.ts'
import { platformStripe } from '../platformStripe.ts'
import { GIFT_MAX_CENTS, GIFT_MIN_CENTS, GiftCardError, type SalonGiftCards } from './giftCards.ts'

const dollars = (c: number) => '$' + (c % 100 ? (c / 100).toFixed(2) : String(c / 100))
const fmtDay = (day: string) => new Date(day + 'T12:00:00Z').toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })
export const SHOP_AMOUNTS = [2500, 5000, 7500, 10000, 15000]

const page = (title: string, salon: string, inner: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex, nofollow"><title>${escHtml(title)}</title>
<style>body{font:16px/1.5 system-ui,sans-serif;margin:0;background:#f8fafc;color:#0f172a}main{max-width:34rem;margin:6vh auto;padding:2rem;background:#fff;border:1px solid #e2e8f0;border-radius:12px}h1{font-size:1.4rem;margin:0 0 .5rem}.s{color:#475569}label{display:block;margin:.6rem 0 .2rem;font-weight:600}input[type=text],input[type=email],input[type=date],textarea{font:inherit;padding:.6rem;border:1px solid #cbd5e1;border-radius:8px;width:100%;box-sizing:border-box}.o{display:block;font-weight:400;padding:.5rem .6rem;border:1px solid #e2e8f0;border-radius:8px;margin:.3rem 0}button{font:inherit;padding:.7rem 1.2rem;border:0;border-radius:8px;background:#0f766e;color:#fff;cursor:pointer;margin-top:1rem}.hp{position:absolute;left:-9999px}</style></head>
<body><main><p class="s">${escHtml(salon)}</p>${inner}</main></body></html>`

/** At most `max` per address per `windowMs`: the public doors cannot be used to guess card numbers or flood the sale. */
function limiter(max: number, windowMs: number) {
  const hits = new Map<string, number[]>()
  return (key: string): boolean => {
    const now = Date.now()
    const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs)
    if (recent.length >= max) { hits.set(key, recent); return false }
    recent.push(now); hits.set(key, recent)
    if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < windowMs)) hits.delete(k)
    return true
  }
}
const addressOf = (c: any) => String(c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || 'unknown').split(',')[0].trim()

export function createGiftShop(d: CrmDeps, g: SalonGiftCards, deps: { stripe?: () => Stripe | null } = {}) {
  const { db, logger } = d
  const stripeOf = deps.stripe ?? (() => platformStripe(d.services.testStripeClient))
  const mayBuy = limiter(12, 3600_000)
  const mayCheck = limiter(10, 10 * 60_000)

  /** One company per tenant database: the oldest row is the business. */
  async function theCompany(): Promise<{ id: string; name: string } | null> {
    const [row] = await db.select({ id: company.id, name: company.name }).from(company).orderBy(asc(company.createdAt)).limit(1)
    return row ? { id: row.id, name: row.name || '' } : null
  }
  /** Whether this salon sells cards online right now, and from which Stripe account. */
  async function shopFor(): Promise<{ co: { id: string; name: string }; acct: string; settings: Awaited<ReturnType<SalonGiftCards['settings']>> } | { problem: string; salon: string }> {
    const co = await theCompany()
    if (!co) return { problem: 'Not found.', salon: '' }
    if (!(await d.features.isFeatureEnabled(co.id, 'salon_gift_cards'))) return { problem: 'Not found.', salon: co.name }
    const settings = await g.settings(co.id)
    const acct = await d.services.stripeService.connectedAccountFor(co.id)
    if (!settings.online || !acct || !stripeOf()) return { problem: 'Gift cards are not sold online right now. Please ask us at the salon.', salon: co.name }
    return { co, acct, settings }
  }

  /** Write a finished payment page's money down against the card's sale and make the card live — once. */
  async function settle(session: Stripe.Checkout.Session, stripeAccount: string): Promise<{ done: boolean; duplicate?: boolean; reason?: string }> {
    const cardId = session.metadata?.twomiah_gift_card, companyId = session.metadata?.twomiah_company
    if (!cardId || !companyId) return { done: false, reason: 'not a gift card page' }
    if ((await d.services.stripeService.connectedAccountFor(companyId)) !== stripeAccount) return { done: false, reason: 'not this business\'s Stripe account' }
    if (session.mode !== 'payment' || session.payment_status !== 'paid') return { done: false, reason: 'not paid' }
    const [card] = await db.select().from(salonGiftCard).where(and(eq(salonGiftCard.id, cardId), eq(salonGiftCard.companyId, companyId))).limit(1)
    if (!card) return { done: false, reason: 'unknown card' }
    if (card.status === 'active') return { done: true, duplicate: true }
    if (card.status !== 'pending' || !card.invoiceId) { logger.warn('[gift-shop] a paid gift card page found its card voided; the payment needs refunding by hand', { cardId }); return { done: false, reason: 'card no longer waiting' } }
    const pi = typeof session.payment_intent === 'string' ? session.payment_intent : (session.payment_intent as any)?.id
    if (!pi || Number(session.amount_total) !== card.initialCents) { logger.warn('[gift-shop] amount paid does not match the card', { cardId }); return { done: false, reason: 'amount does not match' } }
    const [have] = await db.select({ id: payment.id }).from(payment).where(and(eq(payment.invoiceId, card.invoiceId), eq(payment.reference, pi))).limit(1)
    if (!have) {
      const out = await recordInvoicePayment(db, { invoice, payment }, true, { invoiceId: card.invoiceId, companyId, amount: round2(card.initialCents / 100), method: 'card', reference: pi, notes: 'Gift card bought online', tipAmount: 0 })
      if (!out.ok) return { done: false, reason: out.error }
      try { await d.audit.log({ action: 'payment', entity: 'invoice', entityId: card.invoiceId, companyId, metadata: { giftCard: 'bought online', amount: card.initialCents / 100 } }) } catch { /* the money is recorded */ }
    }
    await g.activateRecorded(card.invoiceId)
    return { done: true }
  }

  async function claim(event: Stripe.Event, stripeAccount: string): Promise<Record<string, unknown> | null> {
    if (event.type !== 'checkout.session.completed') return null
    const session = event.data.object as Stripe.Checkout.Session
    if (!session.metadata?.twomiah_gift_card) return null
    const out = await settle(session, stripeAccount)
    return { handled: out.done, giftCard: true, ...out }
  }

  const todayInput = () => new Date().toISOString().slice(0, 10)
  function formHtml(shop: Exclude<Awaited<ReturnType<typeof shopFor>>, { problem: string }>, today: string, message = ''): string {
    const offers = shop.settings.offers
    const offerAmounts = new Set(offers.map((o) => o.buyCents))
    const opts = [
      ...offers.map((o) => `<label class="o"><input type="radio" name="choice" value="offer:${escHtml(o.id)}" required> Buy ${dollars(o.buyCents)}, get <strong>${dollars(o.bonusCents)} free</strong>${o.validDays ? ` <span class="s">(the free ${dollars(o.bonusCents)} is spendable for ${o.validDays} days; the ${dollars(o.buyCents)} you pay never expires)</span>` : ''}</label>`),
      ...SHOP_AMOUNTS.filter((a) => !offerAmounts.has(a)).map((a) => `<label class="o"><input type="radio" name="choice" value="amount:${a}" required> ${dollars(a)}</label>`),
    ].join('')
    return page('Buy a gift card', shop.co.name, `<h1>Buy a gift card</h1>${message ? `<p role="alert"><strong>${escHtml(message)}</strong></p>` : ''}<p class="s">The money you pay for a gift card never expires.</p>
<form method="post" action="">
<div role="group" aria-label="Amount">${opts}<label class="o"><input type="radio" name="choice" value="custom" required> Another amount ($${GIFT_MIN_CENTS / 100} to $${GIFT_MAX_CENTS / 100}) <input type="text" name="custom" inputmode="decimal" autocomplete="off" aria-label="Other amount in dollars" style="width:7rem"></label></div>
<label for="pn">Your name</label><input id="pn" type="text" name="purchaserName" maxlength="120" autocomplete="name">
<label for="pe">Your email (for your receipt)</label><input id="pe" type="email" name="purchaserEmail" maxlength="200" required autocomplete="email">
<label for="rn">Who is it for? (name)</label><input id="rn" type="text" name="recipientName" maxlength="120">
<label for="re">Their email (we send the gift card to them; leave empty to have it sent to you)</label><input id="re" type="email" name="recipientEmail" maxlength="200">
<label for="m">A message (optional)</label><textarea id="m" name="message" maxlength="400" rows="3"></textarea>
<label for="d">Send on (leave empty to send now)</label><input id="d" type="date" name="deliverOn" min="${escHtml(today)}">
<input class="hp" type="text" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
<button type="submit">Continue to payment</button></form><p class="s">You pay on our payment provider&rsquo;s secure page.</p>`)
  }

  const shopRoutes = () => {
    const app = new Hono()
    app.use('*', async (c, next) => { await next(); c.header('X-Robots-Tag', 'noindex, nofollow'); c.header('Cache-Control', 'no-store') })
    app.get('/', async (c) => {
      const shop = await shopFor()
      if ('problem' in shop) return c.html(page('Gift cards', shop.salon, `<h1>Gift cards</h1><p>${escHtml(shop.problem)}</p>`), shop.problem === 'Not found.' ? 404 : 409)
      const doneId = c.req.query('done')
      if (doneId) {
        let thanks = false
        try {
          const session = await stripeOf()!.checkout.sessions.retrieve(String(doneId), {}, { stripeAccount: shop.acct })
          if (session.metadata?.twomiah_gift_card) thanks = (await settle(session, shop.acct)).done
        } catch (e: any) { logger.warn('[gift-shop] page not read back', { error: e?.message }) }
        return c.html(page('Thank you', shop.co.name, thanks ? '<h1>Thank you!</h1><p>Your payment went through. The gift card is on its way by email.</p>' : '<h1>We could not confirm your payment yet</h1><p>If your card was charged, the gift card will be emailed shortly. Please contact the salon if it does not arrive.</p>'))
      }
      return c.html(formHtml(shop, todayInput()))
    })
    app.post('/', async (c) => {
      const shop = await shopFor()
      if ('problem' in shop) return c.html(page('Gift cards', shop.salon, `<h1>Gift cards</h1><p>${escHtml(shop.problem)}</p>`), shop.problem === 'Not found.' ? 404 : 409)
      const form = await c.req.parseBody().catch(() => ({} as Record<string, unknown>))
      if (String(form.website ?? '').trim()) return c.html(formHtml(shop, todayInput(), 'Please try again.'), 400)
      if (!mayBuy(addressOf(c))) return c.html(formHtml(shop, todayInput(), 'Too many tries. Please wait a while and try again.'), 429)
      const choice = String(form.choice ?? '')
      let input: Record<string, unknown> = {
        purchaserName: form.purchaserName, purchaserEmail: form.purchaserEmail, recipientName: form.recipientName, recipientEmail: form.recipientEmail, message: form.message, deliverOn: form.deliverOn,
      }
      if (choice.startsWith('offer:')) {
        const offer = shop.settings.offers.find((o) => o.id === choice.slice(6))
        input = { ...input, offerId: offer?.id, amountCents: offer?.buyCents }
      } else if (choice.startsWith('amount:')) input = { ...input, amountCents: Number(choice.slice(7)) }
      else {
        const raw = String(form.custom ?? '').replace(/[$,\s]/g, '')
        input = { ...input, amountCents: raw !== '' ? Math.round(Number(raw) * 100) : NaN }
      }
      try {
        const { card, invoiceId } = await g.startPending(shop.co.id, input as any, 'online', null)
        const back = `${siteOrigin()}/api/gift-shop`
        try {
          const session = await stripeOf()!.checkout.sessions.create({
            mode: 'payment', payment_method_types: ['card'], customer_email: String(input.purchaserEmail),
            line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: card.initialCents, product_data: { name: `Gift card for ${shop.co.name || 'the salon'}` } } }],
            metadata: { twomiah_gift_card: card.id, twomiah_company: shop.co.id, twomiah_invoice: invoiceId },
            payment_intent_data: { metadata: { twomiah_gift_card: card.id, twomiah_company: shop.co.id } },
            success_url: back + '?done={CHECKOUT_SESSION_ID}', cancel_url: back + '?cancelled=1',
          }, { stripeAccount: shop.acct })
          if (!session.url) throw new Error('no url')
          await g.attachSession(card.id, session.id)
          return c.redirect(session.url, 303)
        } catch (e: any) {
          logger.warn('[gift-shop] payment page not opened', { error: e?.message })
          await g.abandonPending(card.id)
          return c.html(formHtml(shop, todayInput(), 'The payment page could not be opened. Please try again.'), 502)
        }
      } catch (e: any) {
        if (e instanceof GiftCardError) return c.html(formHtml(shop, todayInput(), e.message), 400)
        logger.error('[gift-shop]', { error: e?.message || String(e) })
        return c.html(formHtml(shop, todayInput(), 'That did not go through. Please try again.'), 500)
      }
    })
    return app
  }

  const balanceRoutes = () => {
    const app = new Hono()
    app.use('*', async (c, next) => { await next(); c.header('X-Robots-Tag', 'noindex, nofollow'); c.header('Cache-Control', 'no-store') })
    const ask = async (c: any, code: string) => {
      const co = await theCompany()
      if (!co || !(await d.features.isFeatureEnabled(co.id, 'salon_gift_cards'))) return { status: 404 as const, co, out: null }
      if (!mayCheck(addressOf(c))) return { status: 429 as const, co, out: null }
      return { status: 200 as const, co, out: await g.balanceOf(co.id, code) }
    }
    const answer = (co: { name: string }, out: Awaited<ReturnType<SalonGiftCards['balanceOf']>>) => {
      if (!out.found) return '<h1>Gift card balance</h1><p>No gift card with that number. Check it and try again.</p>'
      if (out.status === 'void') return '<h1>Gift card balance</h1><p>This gift card is no longer valid.</p>'
      const bonus = out.bonusCents > 0 ? `<p>Includes a free <strong>${dollars(out.bonusCents)}</strong> bonus${out.bonusExpiresOn ? ` to spend by ${escHtml(fmtDay(out.bonusExpiresOn))}` : ''}. The ${dollars(out.paidCents)} that was paid for the card does not expire.</p>`
        : out.bonusExpired ? `<p>The free bonus on this card has ended. The ${dollars(out.paidCents)} that was paid for the card does not expire.</p>` : '<p>This card has no expiry date.</p>'
      return `<h1>Gift card balance</h1><p class="s">${escHtml(co.name)}</p><p style="font-size:1.6rem;margin:.2rem 0"><strong>${dollars(out.spendableCents)}</strong> to spend</p>${bonus}`
    }
    const form = (note = '') => `<h1>Check a gift card</h1>${note ? `<p role="alert">${escHtml(note)}</p>` : ''}<form method="post" action=""><label for="c">Gift card number</label><input id="c" type="text" name="code" maxlength="40" autocomplete="off" required><button type="submit">Check balance</button></form>`
    app.get('/', async (c) => {
      const co = await theCompany()
      if (!co || !(await d.features.isFeatureEnabled(co.id, 'salon_gift_cards'))) return c.html(page('Gift card balance', '', '<h1>Not found</h1>'), 404)
      return c.html(page('Gift card balance', co.name, form()))
    })
    app.post('/', async (c) => {
      const body = await c.req.parseBody().catch(() => ({} as Record<string, unknown>))
      const r = await ask(c, String(body.code ?? ''))
      if (r.status === 404) return c.html(page('Gift card balance', '', '<h1>Not found</h1>'), 404)
      if (r.status === 429) return c.html(page('Gift card balance', r.co?.name || '', form('Too many tries. Please wait a few minutes and try again.')), 429)
      return c.html(page('Gift card balance', r.co!.name, answer(r.co!, r.out!) + '<p><a href="">Check another card</a></p>'))
    })
    // The same answer as data, for an app or a page that wants to draw it itself.
    app.post('/check', async (c) => {
      const body = await c.req.json().catch(() => ({})) as { code?: unknown }
      const r = await ask(c, String(body.code ?? ''))
      if (r.status === 404) return fail(c, 404, 'Not found')
      if (r.status === 429) return fail(c, 429, 'Too many tries. Please wait a few minutes and try again.', 'RATE_LIMITED')
      return one(c, r.out!)
    })
    return app
  }

  return { claim, settle, shopRoutes, balanceRoutes, shopFor }
}
export type GiftShop = ReturnType<typeof createGiftShop>
