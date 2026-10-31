// A tip added after the visit, from the link in the receipt (salon parity row 11; Fresha: tips "later online"). The client opens a private page,
// picks one of the salon's tip percentages (worked on the services of the sale) or types an amount, and pays on STRIPE'S OWN page on the SALON'S
// account — never Twomiah's. The money is recorded as a tip-only payment on the sale, so it reaches the stylists through the sale's tip shares
// (./tipShares.ts) and shows on Tips by stylist like any tip.
//
// The link is the sale's id and an HMAC of it (the key is JWT_SECRET's own for tip links, as the bar's receipts do): unguessable, nothing to
// store. Recording is done two ways — Stripe's event for the finished page, and the page the client returns to — and is once per payment (the
// PaymentIntent is the reference). Nothing is recorded on the client's word: the session is read back from Stripe.
import crypto from 'node:crypto'
import { Hono } from 'hono'
import { and, eq } from 'drizzle-orm'
import type Stripe from 'stripe'
import { company, invoice, payment } from '../../db/schema/index.ts'
import { escHtml } from '../../core/email.ts'
import { siteOrigin } from '../../booking/happenings.ts'
import { tipsNetCents } from '../../data/salon.ts'
import type { CrmDeps } from '../deps.ts'
import { platformStripe } from '../platformStripe.ts'
import { createTipPresets } from './tipPresets.ts'
import type { TipSettings } from './tipSettings.ts'
import { createTipShares } from './tipShares.ts'

const key = () => crypto.createHmac('sha256', process.env.JWT_SECRET || '').update('salon-late-tip-link').digest()
const sign = (invoiceId: string) => crypto.createHmac('sha256', key()).update('tip|' + invoiceId).digest('base64url').slice(0, 24)
export const lateTipToken = (invoiceId: string) => `${invoiceId}.${sign(invoiceId)}`
export function invoiceIdFromTipToken(token: string): string | null {
  const m = /^([A-Za-z0-9]{10,40})\.([A-Za-z0-9_-]{24})$/.exec(String(token || ''))
  if (!m) return null
  const a = Buffer.from(sign(m[1])), b = Buffer.from(m[2])
  return a.length === b.length && crypto.timingSafeEqual(a, b) ? m[1] : null
}
export const lateTipPath = (invoiceId: string) => `/api/late-tip/${lateTipToken(invoiceId)}`

export const LATE_TIP_MIN_CENTS = 100
export const LATE_TIP_MAX_CENTS = 100_000
const money = (c: number) => '$' + (c % 100 ? (c / 100).toFixed(2) : String(c / 100))

const page = (title: string, salon: string, inner: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex, nofollow"><title>${escHtml(title)}</title>
<style>body{font:16px/1.5 system-ui,sans-serif;margin:0;background:#f8fafc;color:#0f172a}main{max-width:30rem;margin:8vh auto;padding:2rem;background:#fff;border:1px solid #e2e8f0;border-radius:12px}h1{font-size:1.4rem;margin:0 0 .5rem}.s{color:#475569}button{font:inherit;padding:.7rem 1.2rem;border:0;border-radius:8px;background:#0f766e;color:#fff;cursor:pointer;margin:.25rem .25rem .25rem 0}button.alt{background:#fff;color:#0f766e;border:1px solid #0f766e}input[type=text]{font:inherit;padding:.6rem;border:1px solid #cbd5e1;border-radius:8px;width:8rem}</style></head>
<body><main><p class="s">${escHtml(salon)}</p>${inner}</main></body></html>`

type Refused = { problem: string; status: 404 | 409; salon?: string }
type Open = { inv: any; salon: string; acct: string; settings: TipSettings }

export function createLateTips(d: CrmDeps, deps: { stripe?: () => Stripe | null } = {}) {
  const { db, logger } = d
  const stripeOf = deps.stripe ?? (() => platformStripe(d.services.testStripeClient))
  const presets = createTipPresets(d, stripeOf)
  const shares = createTipShares(db)

  /** The sale a link is for, when it can take a late tip: paid, the salon on, a Stripe account of its own. Otherwise the reason, in words. */
  async function open(token: string): Promise<Refused | Open> {
    const invoiceId = invoiceIdFromTipToken(token)
    if (!invoiceId) return { problem: 'This link is not valid.', status: 404 }
    const [inv] = await db.select().from(invoice).where(eq(invoice.id, invoiceId)).limit(1)
    if (!inv) return { problem: 'This link is not valid.', status: 404 }
    const [co] = await db.select({ name: company.name }).from(company).where(eq(company.id, inv.companyId)).limit(1)
    const salon = co?.name || ''
    const settings = await presets.settings(inv.companyId)
    const acct = await d.services.stripeService.connectedAccountFor(inv.companyId)
    const on = await d.features.isFeatureEnabled(inv.companyId, 'chair_checkout')
    if (!on || !settings.lateTipLink || !acct || !stripeOf()) return { problem: 'Tips cannot be added to this sale online.', status: 409, salon }
    if (inv.status !== 'paid') return { problem: inv.status === 'void' || inv.status === 'refunded' ? 'This sale was cancelled or refunded, so it cannot take a tip.' : 'This sale is not paid yet.', status: 409, salon }
    return { inv, salon, acct, settings }
  }

  async function view(token: string) {
    const o = await open(token)
    if ('problem' in o) return o
    const eligible = await presets.eligibleFor(o.inv.companyId, o.inv.id, null)
    const split = await shares.view(o.inv.companyId, o.inv.id)
    return {
      ...o, tipSoFar: await tipsNetCents(db, o.inv.id),
      suggestions: (await presets.info(o.inv.companyId, o.inv.id, null))?.suggestions ?? [],
      eligibleCents: eligible?.eligibleCents ?? 0, people: (split?.people ?? []).map((p) => p.name),
    }
  }

  /** Stripe's own page for the tip, on the salon's account. */
  async function startCheckout(token: string, tipCents: number): Promise<{ url: string } | { problem: string; status: 400 | 404 | 409 | 502 }> {
    const o = await open(token)
    if ('problem' in o) return { problem: o.problem, status: o.status }
    if (!Number.isInteger(tipCents) || tipCents < LATE_TIP_MIN_CENTS || tipCents > LATE_TIP_MAX_CENTS) return { problem: `A tip is from ${money(LATE_TIP_MIN_CENTS)} to ${money(LATE_TIP_MAX_CENTS)}.`, status: 400 }
    const stripe = stripeOf()!
    const back = `${siteOrigin()}${lateTipPath(o.inv.id)}`
    try {
      const session = await stripe.checkout.sessions.create({
        mode: 'payment', payment_method_types: ['card'],
        line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: tipCents, product_data: { name: `Tip for the team at ${o.salon || 'the salon'}` } } }],
        metadata: { twomiah_late_tip: o.inv.id, twomiah_company: o.inv.companyId, tip_cents: String(tipCents) },
        payment_intent_data: { metadata: { twomiah_late_tip: o.inv.id, twomiah_company: o.inv.companyId } },
        success_url: back + '?done={CHECKOUT_SESSION_ID}', cancel_url: back + '?cancelled=1',
      }, { stripeAccount: o.acct })
      return session.url ? { url: session.url } : { problem: 'The payment page could not be opened. Please try again.', status: 502 }
    } catch (e: any) {
      logger.warn('[late-tip] payment page not opened', { error: e?.message })
      return { problem: 'The payment page could not be opened. Please try again.', status: 502 }
    }
  }

  /**
   * Write a finished tip page's money down, once. `stripeAccount` is the account the event or the page came from: it must be the salon's own.
   * Returns what happened, for the event's answer.
   */
  async function record(session: Stripe.Checkout.Session, stripeAccount: string): Promise<{ recorded: boolean; duplicate?: boolean; reason?: string; invoiceId?: string }> {
    const invoiceId = session.metadata?.twomiah_late_tip, companyId = session.metadata?.twomiah_company
    if (!invoiceId || !companyId) return { recorded: false, reason: 'not a tip page' }
    if ((await d.services.stripeService.connectedAccountFor(companyId)) !== stripeAccount) return { recorded: false, reason: 'not this business\'s Stripe account' }
    if (session.mode !== 'payment' || session.payment_status !== 'paid') return { recorded: false, reason: 'not paid' }
    const pi = typeof session.payment_intent === 'string' ? session.payment_intent : (session.payment_intent as any)?.id
    const cents = Number(session.amount_total || 0)
    if (!pi || !(cents > 0)) return { recorded: false, reason: 'no payment' }
    let duplicate = false
    let wrote = false
    await db.transaction(async (tx: any) => {
      const [inv] = await tx.select({ id: invoice.id }).from(invoice).where(and(eq(invoice.id, invoiceId), eq(invoice.companyId, companyId))).limit(1).for('update')
      if (!inv) return
      const [have] = await tx.select({ id: payment.id }).from(payment).where(and(eq(payment.invoiceId, invoiceId), eq(payment.reference, pi))).limit(1)
      if (have) { duplicate = true; return }
      await tx.insert(payment).values({ invoiceId, amount: '0', method: 'card', reference: pi, notes: 'Tip added after the visit', tipAmount: (cents / 100).toFixed(2) })
      wrote = true
    })
    if (!wrote) return duplicate ? { recorded: false, duplicate: true, invoiceId } : { recorded: false, reason: 'unknown sale' }
    try { await d.audit.log({ action: 'payment', entity: 'invoice', entityId: invoiceId, companyId, metadata: { tip: cents / 100, method: 'card (late tip link)' } }) } catch { /* the money is recorded */ }
    d.realtime.emitToCompany(companyId, d.realtime.EVENTS.REFRESH, { entity: 'invoice' })
    return { recorded: true, invoiceId }
  }

  /** A connected-account event claimed when it is a finished tip page (payments/stripe.ts claimConnectedEvent). Not ours → null. */
  async function claim(event: Stripe.Event, stripeAccount: string): Promise<Record<string, unknown> | null> {
    if (event.type !== 'checkout.session.completed') return null
    const session = event.data.object as Stripe.Checkout.Session
    if (!session.metadata?.twomiah_late_tip) return null
    const out = await record(session, stripeAccount)
    return { handled: out.recorded || !!out.duplicate, lateTip: true, ...out }
  }

  const routes = () => {
    const app = new Hono()
    app.use('*', async (c, next) => { await next(); c.header('X-Robots-Tag', 'noindex, nofollow'); c.header('Cache-Control', 'no-store') })
    app.get('/:token', async (c) => {
      const token = c.req.param('token')
      const doneId = c.req.query('done')
      const o = await open(token)
      if ('problem' in o) return c.html(page('Add a tip', o.salon || '', `<h1>Tips</h1><p>${escHtml(o.problem)}</p>`), o.status)
      // Back from Stripe's page: read the session from Stripe (never the client's word) and write the money down, once.
      if (doneId) {
        let thanks = false
        try {
          const session = await stripeOf()!.checkout.sessions.retrieve(String(doneId), {}, { stripeAccount: o.acct })
          if (session.metadata?.twomiah_late_tip === o.inv.id) {
            const out = await record(session, o.acct)
            thanks = out.recorded || !!out.duplicate
          }
        } catch (e: any) { logger.warn('[late-tip] page not read back', { error: e?.message }) }
        return c.html(page('Thank you', o.salon, thanks ? '<h1>Thank you!</h1><p>Your tip is on its way to the team.</p>' : '<h1>We could not confirm your tip yet</h1><p>If your card was charged, it will appear on the sale shortly. Please contact the salon if it does not.</p>'))
      }
      const v = await view(token)
      if ('problem' in v) return c.html(page('Add a tip', o.salon, `<h1>Tips</h1><p>${escHtml(v.problem)}</p>`), v.status)
      const chips = v.suggestions.map((s: { percent: number; cents: number }) => `<button type="submit" name="tipCents" value="${s.cents}">${s.percent}% · ${money(s.cents)}</button>`).join('')
      const who = v.people.length ? `<p class="s">Your tip is shared between ${escHtml(v.people.join(' and '))}.</p>` : ''
      const so = v.tipSoFar > 0 ? `<p class="s">You tipped ${money(v.tipSoFar)} on this visit.</p>` : ''
      return c.html(page('Add a tip', o.salon, `<h1>Add a tip</h1><p>Thank you for visiting. Tips go to the team who looked after you.</p>${so}${who}
<form method="post" action="">${chips}<p><label>Or another amount ($) <input type="text" name="custom" inputmode="decimal" autocomplete="off" aria-label="Tip amount in dollars"></label> <button type="submit" class="alt">Tip this amount</button></p></form>
<p class="s">You pay on our payment provider&rsquo;s secure page.</p>`))
    })
    app.post('/:token', async (c) => {
      const token = c.req.param('token')
      const form = await c.req.parseBody().catch(() => ({} as Record<string, unknown>))
      const customRaw = String(form.custom ?? '').replace(/[$,\s]/g, '')
      const cents = customRaw !== '' ? Math.round(Number(customRaw) * 100) : Number(form.tipCents)
      const out = await startCheckout(token, cents)
      if ('url' in out) return c.redirect(out.url, 303)
      const o = await open(token)
      return c.html(page('Add a tip', 'salon' in o ? o.salon || '' : '', `<h1>Tips</h1><p>${escHtml(out.problem)}</p><p><a href="">Go back</a></p>`), out.status)
    })
    return app
  }

  return { open, view, startCheckout, record, claim, routes }
}
export type LateTips = ReturnType<typeof createLateTips>
