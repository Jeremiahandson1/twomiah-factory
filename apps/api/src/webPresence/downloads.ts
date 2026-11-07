// "Sell a download" for the $19 Web presence plan: the Factory's side. A Web presence site has no server of ours behind it, so the
// Factory does the three things that need Twomiah's own keys, and nothing else:
//   - Stripe: linking the owner's own Stripe account (the existing Connect OAuth, services/stripeConnectOAuth.ts), opening a checkout
//     ON that account for the one product the site sells, asking Stripe whether a checkout was paid, and hearing Stripe's events for
//     the account (billing.ts /stripe/connect-webhook → handleConnectEvent). The platform key never leaves the Factory.
//   - Download links: minted with the site's own secret (only the Factory can compute it), so a link is worthless at another site.
//   - Email: the buyer's link and the owner's "you made a sale".
// What the Factory keeps: NOTHING about a buyer. The sale (who, where it is licensed for, the license number) is written to the
// site's own store (handler.mjs /api/sale), and Stripe holds the payment. Everything outside is injected, so tests make no live call.
//
// Behind its own switch, WEB_PRESENCE_DOWNLOADS_ON (default off — the owner's rule: untested features stay off on every path).
import { createHmac } from 'node:crypto'
import { WebPresenceOffError, requireWebPresence, downloadsOn } from './switch.ts'
import { siteRowFor, type SiteRow } from './service.ts'
import { siteSecret, signRequest, mintDownload } from './site/session.mjs'
import { LIMITS } from './site/shapes.mjs'
import { cleanLocation } from './site/clean.mjs'
import { signState, authorizeUrl, type StripeOAuthConfig } from '../services/stripeConnectOAuth.ts'

export { downloadsOn }
/** Every path starts here: the plan's own switch AND this one. Off answers as if it did not exist (the routes' 404). */
export function requireDownloads(env: Record<string, string | undefined> = process.env): void {
  requireWebPresence(env)
  if (!downloadsOn(env)) throw new WebPresenceOffError()
}

export interface StripeCalls {
  /** A Checkout Session on the connected account (Stripe-Account header). */
  createCheckout: (account: string, params: Record<string, any>, idempotencyKey: string) => Promise<{ id: string; url: string | null }>
  retrieveSession: (account: string, id: string) => Promise<any>
  retrievePaymentIntent: (account: string, id: string) => Promise<any>
}
export interface DownloadDeps {
  db: any
  env: Record<string, string | undefined>
  now: () => number
  fetch: (url: string, init: any) => Promise<Response>
  stripe: StripeCalls
  /** The Factory's mail. Resolves false when it could not send. */
  sendMail: (to: string, subject: string, html: string) => Promise<boolean>
  alert: (key: string, what: string, detail: string, tenantId?: string) => Promise<void>
  /** Stripe Connect OAuth: the config (null = linking not offered) and withdrawing access. */
  oauthConfig: () => StripeOAuthConfig | null
  deauthorize: (accountId: string, cfg: StripeOAuthConfig) => Promise<{ ok: boolean; detail?: string }>
}

export class DownloadError extends Error {
  constructor(readonly status: number, message: string) { super(message); this.name = 'DownloadError' }
}

const SALE_RE = /^[A-Za-z0-9_-]{8,40}$/
const SESSION_RE = /^cs_(test|live)_[A-Za-z0-9]{10,200}$/
const masterKey = (env: DownloadDeps['env']) => String(env.WEB_PRESENCE_SECRET_KEY || '')
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string)

/** The site's public address: its own domain once its certificate is in place, otherwise its Netlify address. */
export function publicOrigin(row: SiteRow): string {
  return String(row.custom_domain && row.ssl_ok ? 'https://' + row.custom_domain : row.origin || '').replace(/\/+$/, '')
}
/** Addresses a buyer may be sent back to: this site's, and nothing else (a checkout never returns to a stranger's page). */
function originAllowed(row: SiteRow, origin: string): boolean {
  const own = [row.origin, row.custom_domain ? 'https://' + row.custom_domain : null, row.custom_domain ? 'https://www.' + row.custom_domain : null]
  return own.filter(Boolean).map((o) => String(o).replace(/\/+$/, '')).includes(String(origin || '').replace(/\/+$/, ''))
}

async function tenantOf(d: DownloadDeps, row: SiteRow): Promise<any> {
  const { data, error } = await d.db.from('tenants').select('id, name, email, admin_email, phone, plan, stripe_connect_account_id').eq('id', row.tenant_id).single()
  if (error || !data) throw new DownloadError(404, 'Customer not found')
  return data
}

/**
 * The license number: the same for a sale every time (a webhook delivered twice, the thank-you page and the webhook racing), and
 * not guessable from another one. The business's initials, the year, then 8 characters from an HMAC of the sale under the site's secret.
 */
export async function licenseFor(d: DownloadDeps, row: SiteRow, businessName: string, saleId: string, paidAt: Date): Promise<string> {
  const initials = String(businessName || '').split(/\s+/).map((w) => w.replace(/[^A-Za-z]/g, '')[0] || '').join('').toUpperCase().slice(0, 3) || 'LIC'
  const secret = await siteSecret(masterKey(d.env), row.id)
  const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'                       // no 0/O, 1/I: read aloud over the phone
  const bytes = createHmac('sha256', secret).update('license:' + saleId).digest()
  let code = ''
  for (let i = 0; i < 8; i++) code += ALPHA[bytes[i] % ALPHA.length]
  return `${initials}-${paidAt.getUTCFullYear()}-${code.slice(0, 4)}-${code.slice(4)}`
}

/** POST to the site's own function, signed with the site's secret (the site checks it: handler.mjs fromFactory). */
async function toSite(d: DownloadDeps, row: SiteRow, path: string, obj: unknown): Promise<{ ok: boolean; status: number; d: any }> {
  const body = JSON.stringify(obj)
  const ts = String(Math.floor(d.now() / 1000))
  const secret = await siteSecret(masterKey(d.env), row.id)
  try {
    const r = await d.fetch(String(row.origin).replace(/\/+$/, '') + path, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-wp-ts': ts, 'x-wp-sig': await signRequest(secret, ts, body) }, body,
    })
    let out: any = null
    try { out = await r.json() } catch { /* below */ }
    return { ok: r.ok, status: r.status, d: out || {} }
  } catch { return { ok: false, status: 0, d: {} } }
}

// ─── the checkout ─────────────────────────────────────────────────────────────

export interface Offer { name: string; priceCents: number; license?: string }

/** The buy button: a Stripe checkout on the OWNER's account for the one product the site sells. Returns Stripe's page. */
export async function startCheckout(d: DownloadDeps, row: SiteRow, b: { saleId?: unknown; origin?: unknown; offer?: any }): Promise<{ url: string }> {
  requireDownloads(d.env)
  if (row.status !== 'live' && row.status !== 'canceling') throw new DownloadError(409, 'This site is not taking orders.')
  const saleId = String(b.saleId || '')
  const origin = String(b.origin || '')
  if (!SALE_RE.test(saleId)) throw new DownloadError(400, 'That did not look right.')
  if (!originAllowed(row, origin)) throw new DownloadError(400, 'That did not look right.')
  const name = String(b.offer?.name || '').trim().slice(0, 100)
  const cents = Number(b.offer?.priceCents)
  if (!name || !Number.isInteger(cents) || cents < LIMITS.priceMinCents || cents > LIMITS.priceMaxCents) throw new DownloadError(400, 'This product has no price set.')
  const tenant = await tenantOf(d, row)
  const account = String(tenant.stripe_connect_account_id || '')
  if (!/^acct_[A-Za-z0-9]+$/.test(account)) throw new DownloadError(409, 'Payments are not set up for this site yet.')
  const license = String(b.offer?.license || '').trim().slice(0, 300)
  // The product's name rides in the metadata: Stripe's webhook carries a session without its line items.
  const metadata = { wp_site: row.id, wp_sale: saleId, wp_product: name }
  const s = await d.stripe.createCheckout(account, {
    mode: 'payment',
    line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: cents, product_data: { name, ...(license ? { description: license } : {}) } } }],
    // The license is for one place: the buyer says which, and it is printed on the license.
    // The owner's own discount codes (made in their Stripe dashboard as promotion codes) can be typed on Stripe's page.
    allow_promotion_codes: true,
    custom_fields: [{ key: 'location', type: 'text', optional: false, label: { type: 'custom', custom: 'Where will this be used? (school or group, and city)' }, text: { maximum_length: 120 } }],
    metadata,
    payment_intent_data: { metadata, description: name },
    success_url: origin + '/thanks?s={CHECKOUT_SESSION_ID}',
    cancel_url: origin + '/#download',
  }, 'wp-checkout:' + row.id + ':' + saleId)
  if (!s.url || !/^https:\/\/checkout\.stripe\.com\//.test(s.url)) throw new DownloadError(502, 'Stripe did not open a checkout.')
  return { url: s.url }
}

// ─── a sale ───────────────────────────────────────────────────────────────────

export interface SaleOutcome { status: 'paid' | 'pending' | 'not_ours'; license?: string; link?: string; product?: string; location?: string }

/**
 * Stripe says this checkout happened: when it is paid, the sale is written to the site (once — a second delivery changes nothing)
 * and, the first time only, the buyer gets their link and the owner gets a note. Returns the license and a fresh link either way.
 */
export async function recordSale(d: DownloadDeps, row: SiteRow, session: any): Promise<SaleOutcome> {
  const md = session?.metadata || {}
  if (md.wp_site !== row.id || !SALE_RE.test(String(md.wp_sale || ''))) return { status: 'not_ours' }
  // 'no_payment_required': a code took the price to $0 — the buyer is owed the download as surely as a paying one.
  if (session.payment_status !== 'paid' && session.payment_status !== 'no_payment_required') return { status: 'pending' }
  const saleId = String(md.wp_sale)
  const tenant = await tenantOf(d, row)
  const paidAt = new Date(Number(session.created) > 0 ? Number(session.created) * 1000 : d.now())
  const license = await licenseFor(d, row, tenant.name, saleId, paidAt)
  const field = (Array.isArray(session.custom_fields) ? session.custom_fields : []).find((f: any) => f && f.key === 'location')
  const location = cleanLocation(field?.text?.value)
  const buyer = session.customer_details || {}
  const product = String(md.wp_product || '').slice(0, 100) || productName(session)
  const sale = {
    saleId, license, sessionId: String(session.id || ''), product,
    name: String(buyer.name || ''), email: String(buyer.email || session.customer_email || ''), location,
    amountCents: Number(session.amount_total) || 0, currency: String(session.currency || 'usd'), at: paidAt.toISOString(),
  }
  const put = await toSite(d, row, '/api/sale', sale)
  if (!put.ok) throw new DownloadError(502, 'The site did not take the sale (' + put.status + ')')
  const link = await downloadLink(d, row, saleId)
  if (put.d.created) {
    if (sale.email) {
      const m = buyerEmail({ business: tenant.name, businessEmail: tenant.admin_email || tenant.email, product, license, location, link })
      const sent = await d.sendMail(sale.email, m.subject, m.html).catch(() => false)
      if (!sent) await d.alert('wp-download-mail:' + row.id + ':' + saleId, 'A buyer\'s download link did not send', `Sale ${license} on ${tenant.name}: the owner can re-send it from their editor (Sales).`, row.tenant_id)
    }
    const owner = tenant.admin_email || tenant.email
    if (owner) {
      const m = ownerEmail({ business: tenant.name, product, license, location, buyer: sale.name, amountCents: sale.amountCents, currency: sale.currency, editor: publicOrigin(row) + '/edit/' })
      await d.sendMail(owner, m.subject, m.html).catch(() => false)
    }
  }
  return { status: 'paid', license, link, product, location }
}

/** The product's name from the line items when Stripe sent them (a retrieved session may carry them), else a plain word. */
function productName(session: any): string {
  const fromLines = session?.line_items?.data?.[0]?.description
  return fromLines ? String(fromLines).slice(0, 100) : 'your download'
}

export async function downloadLink(d: DownloadDeps, row: SiteRow, saleId: string): Promise<string> {
  const token = await mintDownload(await siteSecret(masterKey(d.env), row.id), row.id, saleId, d.now())
  return publicOrigin(row) + '/download?k=' + encodeURIComponent(token)
}

/** The thank-you page asking: was this checkout paid? (It records the sale too, when it beat the webhook.) */
export async function saleStatus(d: DownloadDeps, row: SiteRow, b: { sessionId?: unknown }): Promise<SaleOutcome> {
  requireDownloads(d.env)
  const id = String(b.sessionId || '')
  if (!SESSION_RE.test(id)) throw new DownloadError(400, 'That did not look right.')
  const tenant = await tenantOf(d, row)
  const account = String(tenant.stripe_connect_account_id || '')
  if (!account) return { status: 'not_ours' }
  let session: any
  try { session = await d.stripe.retrieveSession(account, id) } catch { return { status: 'not_ours' } }
  return recordSale(d, row, session)
}

/** The owner re-sends a buyer's link (a fresh 7 days). Only to the email on the sale, which the site sends from its own record. */
export async function resendLink(d: DownloadDeps, row: SiteRow, b: { saleId?: unknown; email?: unknown; license?: unknown; product?: unknown }): Promise<{ ok: true }> {
  requireDownloads(d.env)
  const saleId = String(b.saleId || '')
  const email = String(b.email || '').trim()
  if (!SALE_RE.test(saleId) || !/^[^@\s<>"]+@[^@\s<>"]+\.[^@\s<>"]{2,}$/.test(email)) throw new DownloadError(400, 'That sale has no email address to send to.')
  const tenant = await tenantOf(d, row)
  const link = await downloadLink(d, row, saleId)
  const m = buyerEmail({ business: tenant.name, businessEmail: tenant.admin_email || tenant.email, product: String(b.product || 'your download').slice(0, 100), license: String(b.license || '').slice(0, 40), location: '', link, again: true })
  if (!(await d.sendMail(email, m.subject, m.html).catch(() => false))) throw new DownloadError(502, 'The email could not be sent just now. Please try again in a minute.')
  return { ok: true }
}

// ─── Stripe's events for the owner's account ──────────────────────────────────

/**
 * One event from the owner's linked account (billing.ts routes it here for a Web presence business). Returns the status to answer
 * Stripe with: 2xx = done; 5xx = Stripe tries again (the site was unreachable), which is what a lost sale needs.
 */
export async function handleConnectEvent(d: DownloadDeps, tenant: { id: string; stripe_connect_account_id?: string | null }, event: any): Promise<{ status: number; result: string }> {
  const row = await siteRowFor({ db: d.db } as any, { tenantId: tenant.id })
  if (!row) return { status: 200, result: 'no site' }
  const obj = event?.data?.object || {}
  try {
    if (event.type === 'account.application.deauthorized') {
      await d.db.from('tenants').update({ stripe_connect_account_id: null }).eq('id', tenant.id)
      const r = await toSite(d, row, '/api/stripe-link', { outcome: 'deauthorized' })
      return { status: 200, result: r.ok ? 'unlinked' : 'unlinked (site not told: ' + r.status + ')' }
    }
    if (!downloadsOn(d.env)) return { status: 200, result: 'downloads off' }
    if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
      const out = await recordSale(d, row, obj)
      return { status: 200, result: out.status }
    }
    if (event.type === 'charge.refunded') {
      // Only a full refund ends the sale's links; a partial refund is the owner's goodwill, not a return.
      if (!obj.refunded || !obj.payment_intent || !tenant.stripe_connect_account_id) return { status: 200, result: 'partial or unknown' }
      const pi = await d.stripe.retrievePaymentIntent(tenant.stripe_connect_account_id, String(obj.payment_intent))
      if (pi?.metadata?.wp_site !== row.id || !SALE_RE.test(String(pi?.metadata?.wp_sale || ''))) return { status: 200, result: 'not ours' }
      const r = await toSite(d, row, '/api/refund', { saleId: String(pi.metadata.wp_sale) })
      if (!r.ok) return { status: 502, result: 'site unreachable' }
      return { status: 200, result: 'refunded' }
    }
    return { status: 200, result: 'ignored' }
  } catch (e: any) {
    if (e instanceof WebPresenceOffError) return { status: 200, result: 'off' }
    return { status: 502, result: String(e?.message || e).slice(0, 200) }
  }
}

// ─── linking the owner's Stripe account ───────────────────────────────────────

/** The editor's "Link your Stripe account": Stripe's sign-in, coming back to this site's editor. The nonce is the site's. */
export async function stripeStart(d: DownloadDeps, row: SiteRow, b: { nonce?: unknown }): Promise<{ url: string }> {
  requireDownloads(d.env)
  const cfg = d.oauthConfig()
  if (!cfg) throw new DownloadError(503, 'Linking a Stripe account is not available yet.')
  const nonce = String(b.nonce || '')
  if (!/^[A-Za-z0-9_-]{24,128}$/.test(nonce)) throw new DownloadError(400, 'That did not look right.')
  if (row.status !== 'live' && row.status !== 'canceling') throw new DownloadError(409, 'This site is not live.')
  // One link at a time, decided by the Factory's record (always current) — not the site's store, which can answer an old copy for
  // about a minute after the link and show the button again (11/07: a second tap undid a good link). Disconnect first to change it.
  const tenant = await tenantOf(d, row)
  if (/^acct_/.test(String(tenant.stripe_connect_account_id || ''))) throw new DownloadError(409, 'Your Stripe account is already linked. Reload this page to see it.')
  const state = signState({ t: row.tenant_id, u: 'site:' + row.id, n: nonce, r: publicOrigin(row) + '/edit/' }, cfg.stateSecret)
  return { url: authorizeUrl(cfg, state) }
}

/** The OAuth callback's hand-over for a Web presence business (stripeOAuth.ts deliver): to the site, which checks its nonce. */
export async function deliverStripeLink(d: DownloadDeps, tenantId: string, body: { nonce: string; userId: string; accountId?: string; outcome?: string }): Promise<{ ok: boolean; status: number }> {
  const row = await siteRowFor({ db: d.db } as any, { tenantId })
  if (!row || body.userId !== 'site:' + row.id) return { ok: false, status: 403 }
  const r = await toSite(d, row, '/api/stripe-link', { nonce: body.nonce, ...(body.accountId ? { accountId: body.accountId } : {}), ...(body.outcome ? { outcome: body.outcome } : {}) })
  return { ok: r.ok, status: r.status }
}

/** The editor's "Disconnect": Stripe access withdrawn and the Factory's record cleared. */
export async function stripeDisconnect(d: DownloadDeps, row: SiteRow): Promise<{ ok: true }> {
  requireDownloads(d.env)
  const tenant = await tenantOf(d, row)
  const account = String(tenant.stripe_connect_account_id || '')
  if (account) {
    const cfg = d.oauthConfig()
    if (cfg) {
      const r = await d.deauthorize(account, cfg)
      if (!r.ok) throw new DownloadError(502, 'Stripe did not confirm the disconnect. Please try again.')
    }
    await d.db.from('tenants').update({ stripe_connect_account_id: null }).eq('id', tenant.id)
  }
  return { ok: true }
}

// ─── the emails ───────────────────────────────────────────────────────────────

const wrap = (inner: string) => `<div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;max-width:560px;margin:0 auto;color:#14181f;font-size:16px;line-height:1.5">${inner}</div>`
const button = (href: string, text: string) => `<p><a href="${esc(href)}" style="display:inline-block;padding:12px 20px;background:#1f4e79;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600">${esc(text)}</a></p>`

export function buyerEmail(o: { business: string; businessEmail?: string | null; product: string; license: string; location: string; link: string; again?: boolean }): { subject: string; html: string } {
  return {
    subject: (o.again ? 'Your download link: ' : 'Your download: ') + o.product,
    html: wrap(
      `<p>${o.again ? `Here is a new download link for ${esc(o.product)} from ${esc(o.business)}.` : `Thank you for buying ${esc(o.product)} from ${esc(o.business)}.`}</p>` +
      button(o.link, 'Download ' + o.product) +
      (o.license ? `<p>Your license number: <strong>${esc(o.license)}</strong>${o.location ? `<br>Licensed for: ${esc(o.location)}` : ''}</p>` : '') +
      `<p style="color:#4a5565;font-size:14px">The link works for 7 days and up to 5 downloads. Keep your license number for your records.${o.businessEmail ? ` Questions? Write to ${esc(o.businessEmail)}.` : ''}</p>`),
  }
}

export function ownerEmail(o: { business: string; product: string; license: string; location: string; buyer: string; amountCents: number; currency: string; editor: string }): { subject: string; html: string } {
  const amount = (o.amountCents / 100).toFixed(2) + (o.currency && o.currency.toLowerCase() !== 'usd' ? ' ' + o.currency.toUpperCase() : '')
  return {
    subject: 'New sale: ' + o.product,
    html: wrap(
      `<p>You made a sale on your website.</p>` +
      `<p><strong>${esc(o.product)}</strong> — $${esc(amount)}<br>License: ${esc(o.license)}${o.location ? `<br>Licensed for: ${esc(o.location)}` : ''}${o.buyer ? `<br>Buyer: ${esc(o.buyer)}` : ''}</p>` +
      `<p>The buyer has been emailed their download link. Every sale is listed under Sales in your editor, and the payment is in your Stripe account.</p>` +
      button(o.editor, 'Open your editor')),
  }
}
