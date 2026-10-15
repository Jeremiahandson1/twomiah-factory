// Transactional store emails via Resend (raw fetch — no dependency). Sends the
// buyer an order confirmation + a shipped notice, and the merchant a new-order
// alert. Gracefully no-ops when RESEND_API_KEY isn't set, so a store without
// email configured still checks out fine.
import logger from './logger.ts'
import { formatCents } from '../lib/money.ts'
import type { Address } from '../../db/schema.ts'

const RESEND_API = 'https://api.resend.com/emails'

export type EmailOrder = {
  orderNumber: string | null
  customerEmail: string
  customerName: string | null
  subtotalCents: number
  shippingCents: number
  taxCents: number
  // The whole amount taken off (a code and any loyalty reward together) and the loyalty share of it — the receipt
  // listed subtotal, shipping and tax and a total that did not add up without these. (E2E Run 2, 10/15)
  discountCents?: number
  loyaltyDiscountCents?: number
  discountCode?: string | null
  totalCents: number
  currency: string
  shippingAddress: Address | null
  trackingCarrier?: string | null
  trackingNumber?: string | null
}

export type EmailItem = {
  productName: string
  variantName: string
  quantity: number
  lineTotalCents: number
}

/** The discount lines between the subtotal and shipping: the code's share and the loyalty reward's, each shown as taken off. */
export function discountLines(o: { discountCents?: number; loyaltyDiscountCents?: number; discountCode?: string | null }): { label: string; cents: number }[] {
  const total = Math.max(0, o.discountCents || 0), loyalty = Math.min(total, Math.max(0, o.loyaltyDiscountCents || 0))
  const lines: { label: string; cents: number }[] = []
  if (total - loyalty > 0) lines.push({ label: o.discountCode ? `Discount (${o.discountCode})` : 'Discount', cents: total - loyalty })
  if (loyalty > 0) lines.push({ label: 'Loyalty reward', cents: loyalty })
  return lines
}
function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function fromFor(storeName: string): string {
  const addr = process.env.STORE_FROM_EMAIL || process.env.FACTORY_FROM_EMAIL || 'orders@resend.dev'
  const name = storeName.replace(/[<>"\r\n]/g, '').trim() || 'Store'
  return `${name} <${addr}>`
}

/**
 * The plain-text part of an email, from its HTML. Every store email went out HTML-only, which spam filters score as a
 * marketing blast — both E2E Run 2 team invites landed in spam (10/15). Links keep their address, so the text works alone.
 */
export function htmlToText(html: string): string {
  return html
    .replace(/<(style|script|head)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, rawHref, label) => {
      // The href was HTML-escaped (esc): "&amp;invite=1" must read "&invite=1", or the copied link breaks.
      const href = rawHref.replace(/&amp;/g, '&').replace(/&quot;/g, '"')
      const t = label.replace(/<[^>]+>/g, '').trim()
      return t && t !== href ? `${t}: ${href}` : href
    })
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|h[1-6]|li|table)>/gi, '\n')
    .replace(/<\/t[dh]>/gi, '  ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&minus;/g, '−')
    .replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

async function send(opts: { from: string; to: string; subject: string; html: string; replyTo?: string }): Promise<boolean> {
  const key = process.env.RESEND_API_KEY
  if (!key || !opts.to) return false
  try {
    const res = await fetch(RESEND_API, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: opts.from, to: opts.to, subject: opts.subject, html: opts.html, text: htmlToText(opts.html),
        ...(opts.replyTo ? { reply_to: opts.replyTo } : {}),
      }),
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) { logger.warn('email send failed', { status: res.status }); return false }
    return true
  } catch (e: any) { logger.warn('email send error', { error: e?.message }); return false }
}

function itemsTable(items: EmailItem[], currency: string): string {
  const rows = items.map((it) => `
    <tr>
      <td style="padding:10px 0;border-bottom:1px solid #eee;color:#111;">${esc(it.productName)}${it.variantName && it.variantName !== 'Default' ? ` <span style="color:#888;">— ${esc(it.variantName)}</span>` : ''} <span style="color:#888;">&times; ${it.quantity}</span></td>
      <td style="padding:10px 0;border-bottom:1px solid #eee;text-align:right;color:#111;white-space:nowrap;">${formatCents(it.lineTotalCents, currency)}</td>
    </tr>`).join('')
  return `<table width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;">${rows}</table>`
}

function totalsTable(o: EmailOrder): string {
  const row = (label: string, val: string, bold = false) =>
    `<tr><td style="padding:2px 0;color:${bold ? '#111' : '#666'};${bold ? 'font-weight:600;' : ''}">${label}</td><td style="padding:2px 0;text-align:right;color:${bold ? '#111' : '#666'};${bold ? 'font-weight:600;' : ''}">${val}</td></tr>`
  return `<table width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;margin-top:12px;">
    ${row('Subtotal', formatCents(o.subtotalCents, o.currency))}
    ${discountLines(o).map((l) => row(l.label, '−' + formatCents(l.cents, o.currency))).join('')}
    ${row('Shipping', o.shippingCents > 0 ? formatCents(o.shippingCents, o.currency) : 'Free')}
    ${o.taxCents > 0 ? row('Tax', formatCents(o.taxCents, o.currency)) : ''}
    ${row('Total', formatCents(o.totalCents, o.currency), true)}
  </table>`
}

function addressBlock(a: Address | null): string {
  if (!a) return ''
  return `<p style="color:#444;font-size:14px;line-height:1.5;margin:6px 0 0;">${esc(a.line1)}${a.line2 ? '<br>' + esc(a.line2) : ''}<br>${esc(a.city)}, ${esc(a.state)} ${esc(a.postalCode)}<br>${esc(a.country)}</p>`
}

function wrap(storeName: string, heading: string, inner: string): string {
  return `<!doctype html><html><body style="margin:0;background:#f6f7f9;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f6f7f9;padding:24px 0;"><tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #eee;">
        <tr><td style="padding:22px 28px;border-bottom:1px solid #f0f0f0;font-weight:700;font-size:18px;color:#111;">${esc(storeName)}</td></tr>
        <tr><td style="padding:28px;"><h1 style="margin:0 0 12px;font-size:20px;color:#111;">${esc(heading)}</h1>${inner}</td></tr>
        <tr><td style="padding:18px 28px;border-top:1px solid #f0f0f0;color:#999;font-size:12px;">${esc(storeName)}</td></tr>
      </table>
    </td></tr></table>
  </body></html>`
}

const firstName = (n: string | null | undefined) => (n ? ' ' + esc(String(n).split(' ')[0]) : '')

export async function sendOrderConfirmation(p: { order: EmailOrder; items: EmailItem[]; storeName: string; supportEmail?: string | null }): Promise<void> {
  const { order, items, storeName } = p
  const inner = `
    <p style="color:#444;font-size:15px;line-height:1.6;">Thanks${firstName(order.customerName)}! We've received your order${order.orderNumber ? ` <strong>${esc(order.orderNumber)}</strong>` : ''} and it's being processed.</p>
    ${itemsTable(items, order.currency)}
    ${totalsTable(order)}
    ${order.shippingAddress ? `<h3 style="font-size:14px;color:#111;margin:20px 0 0;">Shipping to</h3>${addressBlock(order.shippingAddress)}` : ''}
    <p style="color:#888;font-size:13px;margin-top:24px;">We'll email you again when it ships.${p.supportEmail ? ` Questions? Reply to this email.` : ''}</p>`
  await send({ from: fromFor(storeName), to: order.customerEmail, replyTo: p.supportEmail || undefined,
    subject: `Your ${storeName} order${order.orderNumber ? ' ' + order.orderNumber : ''} is confirmed`,
    html: wrap(storeName, 'Order confirmed', inner) })
}

export async function sendMerchantNewOrder(p: { order: EmailOrder; items: EmailItem[]; storeName: string; toEmail: string }): Promise<void> {
  const { order, items, storeName } = p
  const inner = `
    <p style="color:#444;font-size:15px;line-height:1.6;">You have a new paid order${order.orderNumber ? ` <strong>${esc(order.orderNumber)}</strong>` : ''} for <strong>${formatCents(order.totalCents, order.currency)}</strong>.</p>
    ${itemsTable(items, order.currency)}
    ${totalsTable(order)}
    <h3 style="font-size:14px;color:#111;margin:20px 0 0;">Customer</h3>
    <p style="color:#444;font-size:14px;line-height:1.5;margin:6px 0 0;">${esc(order.customerName || '')}<br>${esc(order.customerEmail)}</p>
    ${order.shippingAddress ? `<h3 style="font-size:14px;color:#111;margin:16px 0 0;">Ship to</h3>${addressBlock(order.shippingAddress)}` : ''}
    <p style="color:#888;font-size:13px;margin-top:24px;">Fulfill it from your store admin &rarr; Orders.</p>`
  await send({ from: fromFor(storeName), to: p.toEmail, replyTo: order.customerEmail,
    subject: `New order${order.orderNumber ? ' ' + order.orderNumber : ''} — ${formatCents(order.totalCents, order.currency)}`,
    html: wrap(storeName, 'New order received', inner) })
}

export async function sendOrderShipped(p: { order: EmailOrder; items: EmailItem[]; storeName: string; supportEmail?: string | null }): Promise<void> {
  const { order, items, storeName } = p
  const track = order.trackingNumber
    ? `<p style="color:#444;font-size:14px;margin:12px 0 0;">Carrier: <strong>${esc(order.trackingCarrier || 'Carrier')}</strong><br>Tracking #: <strong>${esc(order.trackingNumber)}</strong></p>` : ''
  const inner = `
    <p style="color:#444;font-size:15px;line-height:1.6;">Good news${firstName(order.customerName)} — your order${order.orderNumber ? ` <strong>${esc(order.orderNumber)}</strong>` : ''} has shipped.</p>
    ${track}
    <h3 style="font-size:14px;color:#111;margin:20px 0 8px;">Items</h3>
    ${itemsTable(items, order.currency)}
    ${order.shippingAddress ? `<h3 style="font-size:14px;color:#111;margin:20px 0 0;">Shipping to</h3>${addressBlock(order.shippingAddress)}` : ''}
    <p style="color:#888;font-size:13px;margin-top:24px;">${p.supportEmail ? 'Questions? Reply to this email.' : 'Thanks for shopping with us.'}</p>`
  await send({ from: fromFor(storeName), to: order.customerEmail, replyTo: p.supportEmail || undefined,
    subject: `Your ${storeName} order${order.orderNumber ? ' ' + order.orderNumber : ''} has shipped`,
    html: wrap(storeName, 'Your order shipped', inner) })
}

/**
 * Money sent back to the shopper — part of an order, the rest of it, or a cancelled order's payment. Shopify tells the
 * shopper; the store did not (E2E Run 2). Sent only when the provider actually returned the money from here.
 */
export async function sendRefundIssued(p: {
  order: Pick<EmailOrder, 'orderNumber' | 'customerEmail' | 'customerName' | 'currency'>
  lines: { productName: string; variantName: string; quantity: number }[]
  shippingCents: number
  amountCents: number
  cancelled?: boolean
  storeName: string
  supportEmail?: string | null
}): Promise<void> {
  const { order, storeName } = p
  const money = formatCents(p.amountCents, order.currency)
  const what = [
    ...p.lines.map((l) => `<li>${esc(l.productName)}${l.variantName && l.variantName !== 'Default' ? ` — ${esc(l.variantName)}` : ''} &times; ${l.quantity}</li>`),
    ...(p.shippingCents > 0 ? [`<li>Shipping (${formatCents(p.shippingCents, order.currency)})</li>`] : []),
  ]
  const num = order.orderNumber ? ` <strong>${esc(order.orderNumber)}</strong>` : ''
  const lead = p.cancelled
    ? `your order${num} was cancelled, and <strong>${money}</strong> has been refunded to the card you paid with.`
    : `we have refunded <strong>${money}</strong> on your order${num} to the card you paid with.`
  const inner = `
    <p style="color:#444;font-size:15px;line-height:1.6;">Hi${firstName(order.customerName)} — ${lead}</p>
    ${what.length ? `<h3 style="font-size:14px;color:#111;margin:20px 0 8px;">Refunded</h3><ul style="color:#444;font-size:14px;line-height:1.6;margin:0;padding-left:18px;">${what.join('')}</ul>` : ''}
    <p style="color:#444;font-size:14px;line-height:1.6;margin-top:18px;">It can take 5–10 business days to appear on your statement, depending on your bank.</p>
    <p style="color:#888;font-size:13px;margin-top:24px;">${p.supportEmail ? 'Questions? Reply to this email.' : 'Thanks for shopping with us.'}</p>`
  await send({ from: fromFor(storeName), to: order.customerEmail, replyTo: p.supportEmail || undefined,
    subject: p.cancelled
      ? `Your ${storeName} order${order.orderNumber ? ' ' + order.orderNumber : ''} was cancelled and refunded`
      : `${money} refunded on your ${storeName} order${order.orderNumber ? ' ' + order.orderNumber : ''}`,
    html: wrap(storeName, p.cancelled ? 'Order cancelled' : 'Refund issued', inner) })
}

export async function sendAbandonedCart(p: {
  order: EmailOrder
  items: EmailItem[]
  storeName: string
  recoverUrl: string
  supportEmail?: string | null
}): Promise<void> {
  const { order, items, storeName, recoverUrl } = p
  const inner = `
    <p style="color:#444;font-size:15px;line-height:1.6;">You left something behind${firstName(order.customerName)}. Your items are still here — finish whenever you are ready.</p>
    ${itemsTable(items, order.currency)}
    ${totalsTable(order)}
    <p style="margin:26px 0 0;"><a href="${esc(recoverUrl)}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600;font-size:15px;">Complete your order</a></p>
    <p style="color:#888;font-size:13px;margin-top:22px;">If you have changed your mind, you can ignore this — nothing has been charged.${p.supportEmail ? ' Questions? Just reply to this email.' : ''}</p>`
  await send({
    from: fromFor(storeName),
    to: order.customerEmail,
    replyTo: p.supportEmail || undefined,
    subject: `You left ${items.length === 1 ? 'an item' : 'items'} in your ${storeName} cart`,
    html: wrap(storeName, 'Still interested?', inner),
  })
}

export async function sendReviewRequest(p: {
  order: EmailOrder
  items: EmailItem[]
  storeName: string
  reviewUrl: string
  supportEmail?: string | null
}): Promise<void> {
  const { order, items, storeName, reviewUrl } = p
  const inner = `
    <p style="color:#444;font-size:15px;line-height:1.6;">Hope you are enjoying your order${firstName(order.customerName)}. If you have a minute, a short review helps other shoppers a lot.</p>
    ${itemsTable(items, order.currency)}
    <p style="margin:26px 0 0;"><a href="${esc(reviewUrl)}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600;font-size:15px;">Leave a review</a></p>
    <p style="color:#888;font-size:13px;margin-top:22px;">Only if you want to — no follow-ups after this one.${p.supportEmail ? ' Something wrong? Reply to this email and we will fix it.' : ''}</p>`
  await send({
    from: fromFor(storeName),
    to: order.customerEmail,
    replyTo: p.supportEmail || undefined,
    subject: `How was your ${storeName} order?`,
    html: wrap(storeName, 'How did we do?', inner),
  })
}

export async function sendPasswordReset(p: { toEmail: string; storeName: string; resetUrl: string }): Promise<void> {
  const inner = `
    <p style="color:#444;font-size:15px;line-height:1.6;">We received a request to reset the password for your ${esc(p.storeName)} admin account.</p>
    <p style="margin:20px 0;"><a href="${esc(p.resetUrl)}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-size:14px;font-weight:600;">Set a new password</a></p>
    <p style="color:#888;font-size:13px;">This link expires in 1 hour and can be used once. If you didn't request this, you can safely ignore this email — your password is unchanged.</p>`
  await send({ from: fromFor(p.storeName), to: p.toEmail,
    subject: `Reset your ${p.storeName} admin password`,
    html: wrap(p.storeName, 'Reset your password', inner) })
}

/**
 * A team invite: the person chooses their own password from the link (7 days). As Shopify does it — the owner never
 * knows a teammate's password. Same wording as the CRMs' teamInvite. Returns whether the mail went out. (10/14)
 */
export async function sendTeamInvite(p: { toEmail: string; storeName: string; name?: string | null; inviterName: string; role: string; inviteUrl: string }): Promise<boolean> {
  const inner = `
    <p style="color:#444;font-size:15px;line-height:1.6;">Hi ${esc(p.name || 'there')},</p>
    <p style="color:#444;font-size:15px;line-height:1.6;"><strong>${esc(p.inviterName)}</strong> has invited you to help run <strong>${esc(p.storeName)}</strong>. Choose your password to sign in.</p>
    <p style="color:#444;font-size:15px;line-height:1.6;">Your role: <strong>${esc(p.role === 'manager' ? 'Manager' : 'Staff')}</strong></p>
    <p style="margin:20px 0;"><a href="${esc(p.inviteUrl)}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-size:14px;font-weight:600;">Accept invitation</a></p>
    <p style="color:#888;font-size:13px;">This invitation expires in 7 days.</p>`
  return send({ from: fromFor(p.storeName), to: p.toEmail,
    subject: `You're invited to join ${p.storeName}`,
    html: wrap(p.storeName, "You're invited", inner) })
}

// Exported for the inbound-message reply route (sends AS alias@storedomain).
export { send }
