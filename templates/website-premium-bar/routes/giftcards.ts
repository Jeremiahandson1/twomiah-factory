/**
 * routes/giftcards.ts — gift cards on the website.
 *
 *   POST /gift-cards/balance          the same lookup as a plain form (works with JS off)
 *   GET  /gift-cards                  check a balance; buy one (when GIFT_CARDS_ONLINE=on and Square is set up)
 *   POST /api/gift-cards/balance      { code } → balance (rate-limited: 10 lookups / 10 min per IP)
 *   POST /api/gift-cards/buy          { amountCents, purchaser…, recipient…, message, sourceId, idempotencyKey }
 *
 * The card form is Square's Web Payments SDK (same CSP as /order). The code
 * is shown on the confirmation and emailed to the recipient (and the buyer)
 * when email is set up. No expiration, no fees.
 */
import { Hono, type Context } from 'hono'
import { eq } from 'drizzle-orm'
import ejs from 'ejs'
import path from 'path'
import { db } from '../db'
import { giftCards, settings as settingsTbl } from '../db/schema'
import { renderBase, viewsDir } from '../lib/render'
import { formatCents, squareConfig } from '../lib/square/client'
import { charge, paymentErrorMessage } from '../lib/square/orders'
import { findCard, GiftCardError, issueCard, validAmount } from '../lib/giftcards/cards'
import { sendEmail } from '../lib/email'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export function giftCardsOnline(): boolean {
  const cfg = squareConfig()
  return !!cfg && !!cfg.applicationId && (process.env.GIFT_CARDS_ONLINE || '').toLowerCase() === 'on'
}

function csp(environment: 'sandbox' | 'production'): string {
  const web = environment === 'production' ? 'https://web.squarecdn.com' : 'https://sandbox.web.squarecdn.com'
  const pci = environment === 'production' ? 'https://pci-connect.squareup.com' : 'https://pci-connect.squareupsandbox.com'
  return ["default-src 'self'", "img-src 'self' data: https:", `font-src 'self' https://fonts.gstatic.com https://square-fonts-production-f.squarecdn.com https://d1g145x70srn7h.cloudfront.net data:`,
    `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com ${web}`, `script-src 'self' 'unsafe-inline' ${web}`, `connect-src 'self' ${pci} https://o160250.ingest.sentry.io`,
    `frame-src ${web}`, "frame-ancestors 'none'", "base-uri 'self'", "form-action 'self'"].join('; ')
}

const buckets = new Map<string, number[]>()
function limited(c: Context, max: number, windowMs = 10 * 60 * 1000): boolean {
  const ip = (c.req.header('X-Forwarded-For') || '').split(',')[0].trim() || c.req.header('CF-Connecting-IP') || 'unknown'
  const now = Date.now()
  const times = (buckets.get(ip) || []).filter(t => now - t < windowMs)
  if (times.length >= max) return true
  times.push(now); buckets.set(ip, times)
  return false
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch] || ch))

function cardEmail(o: { company: string; address: string; toName: string | null; fromName: string | null; code: string; cents: number; message: string | null; forBuyer: boolean }): string {
  return `<!doctype html><html><body style="margin:0;padding:24px 12px;background:#14110c;font-family:Georgia,'Times New Roman',serif;color:#efe6d2;">
  <table width="560" cellpadding="0" cellspacing="0" align="center" style="background:#1d1912;border:1px solid #6b5626;border-radius:8px;">
    <tr><td style="padding:28px 30px;">
      <div style="font-size:12px;letter-spacing:.2em;text-transform:uppercase;color:#c9a24e;">${esc(o.company)} · gift card</div>
      <h1 style="margin:10px 0 14px;font-size:26px;font-weight:normal;color:#e6c77a;">${o.forBuyer ? 'Your gift card is on its way.' : `${esc(o.fromName || 'Someone')} got you a gift card.`}</h1>
      <p style="margin:0 0 10px;font-size:18px;">${esc(formatCents(o.cents))} at the ${esc(o.company)}.</p>
      ${o.message && !o.forBuyer ? `<p style="margin:0 0 14px;font-style:italic;">"${esc(o.message)}"</p>` : ''}
      <p style="margin:18px 0 6px;font-size:13px;letter-spacing:.14em;text-transform:uppercase;color:#9c9181;">Card number</p>
      <p style="margin:0 0 18px;font-family:'Courier New',monospace;font-size:26px;color:#e6c77a;">${esc(o.code)}</p>
      <p style="margin:0;line-height:1.6;">Give the number at the bar. It never expires and there are no fees.${o.forBuyer && o.toName ? ` We sent it to ${esc(o.toName)} too.` : ''}</p>
    </td></tr>
    <tr><td style="padding:14px 30px 22px;border-top:1px solid #3a3020;font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:12px;color:#9c9181;">${esc(o.company)}${o.address ? ' · ' + esc(o.address) : ''}</td></tr>
  </table></body></html>`
}

type Lookup = { code: string; balanceCents?: number; error?: string } | null

/** Same answer for "no such card" and "voided", so the lookup can't be used to probe numbers. */
async function lookupBalance(raw: string): Promise<{ status: 200 | 404; body: { ok?: true; code: string; balanceCents?: number; error?: string } }> {
  const card = await findCard(db, raw)
  if (!card || card.status !== 'active') return { status: 404, body: { code: String(raw || '').trim().slice(0, 24), error: 'No active gift card with that number.' } }
  return { status: 200, body: { ok: true, code: card.code, balanceCents: card.balanceCents } }
}

async function page(c: Context, lookup: Lookup, status: 200 | 404 | 429 = 200) {
  const [s] = await db.select().from(settingsTbl).limit(1)
  const settings: any = s || { companyName: 'The bar', nav: [] }
  const online = giftCardsOnline()
  const cfg = squareConfig()
  const body = await ejs.renderFile(path.join(viewsDir, 'giftcards', 'page.ejs'), {
    settings, online, lookup, square: online && cfg ? { applicationId: cfg.applicationId, locationId: cfg.locationId, sdkUrl: cfg.sdkUrl } : null,
  }) as string
  const html = await renderBase({ body, currentPath: '/gift-cards', settings: { ...settings, seoTitle: 'Gift cards — ' + settings.companyName, seoDescription: `Gift cards for the ${settings.companyName}. Any amount, never expire, no fees. Check a balance.` } })
  if (online && cfg) c.header('Content-Security-Policy', csp(cfg.environment))
  c.header('Cache-Control', 'no-store')
  return c.html(html, status)
}

export const giftCardPages = new Hono()
giftCardPages.get('/', (c) => page(c, null))
// The no-JavaScript balance check: a plain form post, answered on the page.
giftCardPages.post('/balance', async (c) => {
  if (limited(c, 10)) return page(c, { code: '', error: 'Too many lookups. Ask at the bar.' }, 429)
  const form = await c.req.parseBody().catch(() => ({} as Record<string, unknown>))
  const r = await lookupBalance(String(form.code || ''))
  return page(c, r.body, r.status)
})

export const giftCardApi = new Hono()
giftCardApi.post('/balance', async (c) => {
  if (limited(c, 10)) return c.json({ error: 'Too many lookups. Ask at the bar.' }, 429)
  const b = await c.req.json().catch(() => ({})) as Record<string, unknown>
  const r = await lookupBalance(String(b.code || ''))
  return c.json(r.body, r.status)
})

giftCardApi.post('/buy', async (c) => {
  if (!giftCardsOnline()) return c.json({ error: 'Gift cards are sold at the bar for now.' }, 404)
  if (limited(c, 10)) return c.json({ error: 'Too many attempts. Ask at the bar.' }, 429)
  const b = await c.req.json().catch(() => ({})) as Record<string, any>
  const cents = Math.round(Number(b.amountCents))
  const purchaserName = String(b.purchaserName || '').trim().slice(0, 60)
  const purchaserEmail = String(b.purchaserEmail || '').trim().toLowerCase().slice(0, 120)
  const recipientName = String(b.recipientName || '').trim().slice(0, 60) || null
  const recipientEmail = String(b.recipientEmail || '').trim().toLowerCase().slice(0, 120) || null
  const message = String(b.message || '').trim().slice(0, 300) || null
  const key = String(b.idempotencyKey || ''), sourceId = String(b.sourceId || '')
  if (!validAmount(cents)) return c.json({ error: 'Pick an amount from $5 to $500.' }, 400)
  if (!purchaserName || !EMAIL.test(purchaserEmail)) return c.json({ error: 'Your name and email, so we can send you the card number.' }, 400)
  if (recipientEmail && !EMAIL.test(recipientEmail)) return c.json({ error: "That recipient's email doesn't look right." }, 400)
  if (!UUID.test(key) || !sourceId) return c.json({ error: 'The card form did not finish. Try again.' }, 400)
  // A retried request returns the card it already made, never a second charge.
  const [prior] = await db.select().from(giftCards).where(eq(giftCards.idempotencyKey, key)).limit(1)
  if (prior) return c.json({ ok: true, code: prior.code, balanceCents: prior.balanceCents })
  let paymentId: string
  try {
    paymentId = (await charge({ amountCents: cents, sourceId, idempotencyKey: key, referenceId: 'giftcard-' + key.slice(0, 8), note: `Gift card ${formatCents(cents)} for ${recipientName || purchaserName}`, phone: null })).squarePaymentId
  } catch (e) {
    return c.json({ error: paymentErrorMessage(e) }, 402)
  }
  let card
  try {
    card = await issueCard(db, { cents, soldVia: 'online', soldBy: 'Website', purchaserName, purchaserEmail, recipientName, recipientEmail, message, squarePaymentId: paymentId, idempotencyKey: key })
  } catch (e: any) {
    console.error('[giftcards] charged but not issued:', paymentId, e?.message || e)
    return c.json({ error: 'You were charged but the card did not save. Call the bar and give them this: ' + paymentId }, 500)
  }
  const [s] = await db.select().from(settingsTbl).limit(1)
  const company = s?.companyName || 'The bar'
  const address = [s?.streetAddress, s?.addressLocality, s?.addressRegion].filter(Boolean).join(', ')
  const mails: Promise<boolean>[] = []
  if (recipientEmail) mails.push(sendEmail({ to: recipientEmail, subject: `${purchaserName} got you a gift card at the ${company}`, html: cardEmail({ company, address, toName: recipientName, fromName: purchaserName, code: card.code, cents, message, forBuyer: false }) }).catch(() => false))
  mails.push(sendEmail({ to: purchaserEmail, subject: `Your ${company} gift card`, html: cardEmail({ company, address, toName: recipientName, fromName: purchaserName, code: card.code, cents, message, forBuyer: true }) }).catch(() => false))
  const sent = await Promise.all(mails)
  return c.json({ ok: true, code: card.code, balanceCents: card.balanceCents, emailed: sent.some(Boolean) })
})

export { GiftCardError }
