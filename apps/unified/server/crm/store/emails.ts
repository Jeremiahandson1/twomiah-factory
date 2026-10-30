// The store's messages to a shopper and to the shop: the order confirmed, a new paid order, shipped, a refund, the
// abandoned-cart reminder and the review request. Moved from templates/crm-store/backend/src/services/email.ts, whose
// HTML they keep; they send through the app's one email service (core/email.ts) — its provider, its FROM_EMAIL and its
// log — where the template posted to Resend itself and wrote no record. The shop's name is the company row's, read when
// the message is built. The template's password-reset and team-invite messages are the engine's own (auth, team).
import type { Brand, TemplateResult } from '../../core/email.ts'
import { escHtml as esc } from '../../core/email.ts'
import type { StoreAddress as Address } from '../../db/schema/store.ts'
import { formatCents } from './lib/money.ts'

export type EmailOrder = {
  orderNumber: string | null
  customerEmail: string
  customerName: string | null
  subtotalCents: number
  shippingCents: number
  taxCents: number
  /** The whole amount taken off (a code and any loyalty reward together), and the loyalty share of it. */
  discountCents?: number
  loyaltyDiscountCents?: number
  discountCode?: string | null
  totalCents: number
  currency: string
  shippingAddress: Address | null
  trackingCarrier?: string | null
  trackingNumber?: string | null
  /** What a gift card paid of the total, and how the order reaches the shopper (ship | pickup | digital). */
  giftCardCents?: number
  fulfillment?: string
}
export type EmailItem = { productName: string; variantName: string; quantity: number; lineTotalCents: number }

/** The discount lines between the subtotal and shipping: the code's share and the loyalty reward's, each taken off. */
export function discountLines(o: { discountCents?: number; loyaltyDiscountCents?: number; discountCode?: string | null }): { label: string; cents: number }[] {
  const total = Math.max(0, o.discountCents || 0), loyalty = Math.min(total, Math.max(0, o.loyaltyDiscountCents || 0))
  const lines: { label: string; cents: number }[] = []
  if (total - loyalty > 0) lines.push({ label: o.discountCode ? `Discount (${o.discountCode})` : 'Discount', cents: total - loyalty })
  if (loyalty > 0) lines.push({ label: 'Loyalty reward', cents: loyalty })
  return lines
}

/**
 * The plain-text part, from the HTML: an HTML-only message is scored as a marketing blast (both E2E Run 2 team invites
 * landed in spam, 10/15). Links keep their address, so the text works alone.
 */
export function htmlToText(html: string): string {
  return html
    .replace(/<(style|script|head)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, rawHref, label) => {
      const href = rawHref.replace(/&amp;/g, '&').replace(/&quot;/g, '"')
      const t = label.replace(/<[^>]+>/g, '').trim()
      return t && t !== href ? `${t}: ${href}` : href
    })
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|h[1-6]|li|table)>/gi, '\n')
    .replace(/<\/t[dh]>/gi, '  ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&minus;/g, '−').replace(/&times;/g, '×').replace(/&rarr;/g, '→')
    .replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

function itemsTable(items: EmailItem[], currency: string): string {
  const rows = items.map((it) => `
    <tr>
      <td style="padding:10px 0;border-bottom:1px solid #eee;color:#111;">${esc(it.productName)}${it.variantName && it.variantName !== 'Default' ? ` <span style="color:#666;">— ${esc(it.variantName)}</span>` : ''} <span style="color:#666;">&times; ${it.quantity}</span></td>
      <td style="padding:10px 0;border-bottom:1px solid #eee;text-align:right;color:#111;white-space:nowrap;">${formatCents(it.lineTotalCents, currency)}</td>
    </tr>`).join('')
  return `<table width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;">${rows}</table>`
}

function totalsTable(o: EmailOrder): string {
  const row = (label: string, val: string, bold = false) =>
    `<tr><td style="padding:2px 0;color:${bold ? '#111' : '#555'};${bold ? 'font-weight:600;' : ''}">${label}</td><td style="padding:2px 0;text-align:right;color:${bold ? '#111' : '#555'};${bold ? 'font-weight:600;' : ''}">${val}</td></tr>`
  return `<table width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;margin-top:12px;">
    ${row('Subtotal', formatCents(o.subtotalCents, o.currency))}
    ${discountLines(o).map((l) => row(esc(l.label), '−' + formatCents(l.cents, o.currency))).join('')}
    ${o.fulfillment === 'pickup' ? row('Pickup', 'Free') : o.fulfillment === 'digital' ? '' : row('Shipping', o.shippingCents > 0 ? formatCents(o.shippingCents, o.currency) : 'Free')}
    ${o.taxCents > 0 ? row('Tax', formatCents(o.taxCents, o.currency)) : ''}
    ${row('Total', formatCents(o.totalCents, o.currency), true)}
    ${(o.giftCardCents || 0) > 0 ? row('Paid by gift card', '−' + formatCents(o.giftCardCents!, o.currency)) + row('Paid by card', formatCents(Math.max(0, o.totalCents - o.giftCardCents!), o.currency)) : ''}
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
        <tr><td style="padding:18px 28px;border-top:1px solid #f0f0f0;color:#666;font-size:12px;">${esc(storeName)}</td></tr>
      </table>
    </td></tr></table>
  </body></html>`
}

const button = (href: string, label: string) =>
  `<p style="margin:26px 0 0;"><a href="${esc(href)}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600;font-size:15px;">${esc(label)}</a></p>`
const firstName = (n: string | null | undefined) => (n ? ' ' + esc(String(n).trim().split(/\s+/)[0]) : '')
const num = (o: { orderNumber: string | null }) => (o.orderNumber ? ` <strong>${esc(o.orderNumber)}</strong>` : '')
const numPlain = (o: { orderNumber: string | null }) => (o.orderNumber ? ' ' + o.orderNumber : '')
const done = (subject: string, html: string): TemplateResult => ({ subject, html, text: htmlToText(html) })

type OrderMail = { order: EmailOrder; items: EmailItem[]; supportEmail?: string | null }

/** The store's messages, registered with the app's email service by name. `b.companyName` is the shop's name. */
export const storeTemplates: Record<string, (data: any, b: Brand) => TemplateResult> = {
  storeOrderConfirmation: ({ order, items, supportEmail }: OrderMail, b) => done(
    `Your ${b.companyName} order${numPlain(order)} is confirmed`,
    wrap(b.companyName, 'Order confirmed', `
      <p style="color:#444;font-size:15px;line-height:1.6;">Thanks${firstName(order.customerName)}! We've received your order${num(order)} and it's being processed.</p>
      ${itemsTable(items, order.currency)}
      ${totalsTable(order)}
      ${order.shippingAddress ? `<h3 style="font-size:14px;color:#111;margin:20px 0 0;">Shipping to</h3>${addressBlock(order.shippingAddress)}` : ''}
      <p style="color:#666;font-size:13px;margin-top:24px;">We'll email you again when it ships.${supportEmail ? ' Questions? Reply to this email.' : ''}</p>`),
  ),
  storeMerchantNewOrder: ({ order, items }: OrderMail, b) => done(
    `New order${numPlain(order)} — ${formatCents(order.totalCents, order.currency)}`,
    wrap(b.companyName, 'New order received', `
      <p style="color:#444;font-size:15px;line-height:1.6;">You have a new paid order${num(order)} for <strong>${formatCents(order.totalCents, order.currency)}</strong>.</p>
      ${itemsTable(items, order.currency)}
      ${totalsTable(order)}
      <h3 style="font-size:14px;color:#111;margin:20px 0 0;">Customer</h3>
      <p style="color:#444;font-size:14px;line-height:1.5;margin:6px 0 0;">${esc(order.customerName || '')}<br>${esc(order.customerEmail)}</p>
      ${order.shippingAddress ? `<h3 style="font-size:14px;color:#111;margin:16px 0 0;">Ship to</h3>${addressBlock(order.shippingAddress)}` : ''}
      <p style="color:#666;font-size:13px;margin-top:24px;">Fulfill it from your admin &rarr; Orders.</p>`),
  ),
  storeOrderShipped: ({ order, items, supportEmail }: OrderMail, b) => done(
    `Your ${b.companyName} order${numPlain(order)} has shipped`,
    wrap(b.companyName, 'Your order shipped', `
      <p style="color:#444;font-size:15px;line-height:1.6;">Good news${firstName(order.customerName)} — your order${num(order)} has shipped.</p>
      ${order.trackingNumber ? `<p style="color:#444;font-size:14px;margin:12px 0 0;">Carrier: <strong>${esc(order.trackingCarrier || 'Carrier')}</strong><br>Tracking #: <strong>${esc(order.trackingNumber)}</strong></p>` : ''}
      <h3 style="font-size:14px;color:#111;margin:20px 0 8px;">Items</h3>
      ${itemsTable(items, order.currency)}
      ${order.shippingAddress ? `<h3 style="font-size:14px;color:#111;margin:20px 0 0;">Shipping to</h3>${addressBlock(order.shippingAddress)}` : ''}
      <p style="color:#666;font-size:13px;margin-top:24px;">${supportEmail ? 'Questions? Reply to this email.' : 'Thanks for shopping with us.'}</p>`),
  ),
  /** Money sent back — part of an order, the rest of it, or a cancelled order's payment. Sent only when the provider returned it. */
  storeRefundIssued: (p: { order: Pick<EmailOrder, 'orderNumber' | 'customerName' | 'currency'>; lines: { productName: string; variantName: string; quantity: number }[]; shippingCents: number; amountCents: number; cancelled?: boolean; supportEmail?: string | null }, b) => {
    const money = formatCents(p.amountCents, p.order.currency)
    const what = [
      ...p.lines.map((l) => `<li>${esc(l.productName)}${l.variantName && l.variantName !== 'Default' ? ` — ${esc(l.variantName)}` : ''} &times; ${l.quantity}</li>`),
      ...(p.shippingCents > 0 ? [`<li>Shipping (${formatCents(p.shippingCents, p.order.currency)})</li>`] : []),
    ]
    const lead = p.cancelled
      ? `your order${num(p.order)} was cancelled, and <strong>${money}</strong> has been refunded to the card you paid with.`
      : `we have refunded <strong>${money}</strong> on your order${num(p.order)} to the card you paid with.`
    return done(
      p.cancelled ? `Your ${b.companyName} order${numPlain(p.order)} was cancelled and refunded` : `${money} refunded on your ${b.companyName} order${numPlain(p.order)}`,
      wrap(b.companyName, p.cancelled ? 'Order cancelled' : 'Refund issued', `
        <p style="color:#444;font-size:15px;line-height:1.6;">Hi${firstName(p.order.customerName)} — ${lead}</p>
        ${what.length ? `<h3 style="font-size:14px;color:#111;margin:20px 0 8px;">Refunded</h3><ul style="color:#444;font-size:14px;line-height:1.6;margin:0;padding-left:18px;">${what.join('')}</ul>` : ''}
        <p style="color:#444;font-size:14px;line-height:1.6;margin-top:18px;">It can take 5–10 business days to appear on your statement, depending on your bank.</p>
        <p style="color:#666;font-size:13px;margin-top:24px;">${p.supportEmail ? 'Questions? Reply to this email.' : 'Thanks for shopping with us.'}</p>`),
    )
  },
  /** A shopper's sign-in: the link (which asks them to press Sign in) and the code to type instead. */
  storeSignIn: (p: { name?: string | null; code: string; link: string; minutes: number; supportEmail?: string | null }, b) => done(
    `Sign in to ${b.companyName}`,
    wrap(b.companyName, 'Sign in', `
      <p style="color:#444;font-size:15px;line-height:1.6;">Hi${firstName(p.name)} — press the button to sign in to your ${esc(b.companyName)} account.</p>
      ${button(p.link, 'Sign in')}
      <p style="color:#444;font-size:14px;line-height:1.6;margin-top:22px;">Or type this code on the sign-in page:</p>
      <p style="margin:6px 0 0;font-size:26px;letter-spacing:6px;font-family:Consolas,Menlo,monospace;color:#111;"><strong>${esc(p.code)}</strong></p>
      <p style="color:#666;font-size:13px;margin-top:24px;">The link and the code work for ${p.minutes} minutes, once. If you did not ask to sign in, you can ignore this email — nobody can sign in without it.</p>`),
  ),
  /** The codes a paid order bought, one per card. */
  storeGiftCard: (p: { orderNumber: string | null; currency: string; cards: { code: string; cents: number }[]; supportEmail?: string | null }, b) => done(
    p.cards.length === 1 ? `Your ${b.companyName} gift card` : `Your ${p.cards.length} ${b.companyName} gift cards`,
    wrap(b.companyName, p.cards.length === 1 ? 'Your gift card' : 'Your gift cards', `
      <p style="color:#444;font-size:15px;line-height:1.6;">Thanks for your order${num(p)}. ${p.cards.length === 1 ? 'Here is your gift card' : 'Here are your gift cards'} — enter the number at checkout to spend it. It never expires.</p>
      ${p.cards.map((c) => `<p style="margin:16px 0 0;padding:14px 16px;border:1px solid #e5e7eb;border-radius:10px;font-size:15px;color:#111;"><strong style="font-family:Consolas,Menlo,monospace;letter-spacing:1px;">${esc(c.code)}</strong><span style="float:right;">${formatCents(c.cents, p.currency)}</span></p>`).join('')}
      <p style="color:#666;font-size:13px;margin-top:24px;">Keep this email: the number is the card.${p.supportEmail ? ' Questions? Reply to this email.' : ''}</p>`),
  ),
  /** A pickup order is ready: where and when. */
  storeReadyForPickup: ({ order, items, supportEmail, pickupAddress, pickupHours }: OrderMail & { pickupAddress?: string | null; pickupHours?: string | null }, b) => done(
    `Your ${b.companyName} order${numPlain(order)} is ready for pickup`,
    wrap(b.companyName, 'Ready for pickup', `
      <p style="color:#444;font-size:15px;line-height:1.6;">Good news${firstName(order.customerName)} — your order${num(order)} is ready to collect.</p>
      ${pickupAddress ? `<h3 style="font-size:14px;color:#111;margin:20px 0 0;">Where</h3><p style="color:#444;font-size:14px;line-height:1.5;margin:6px 0 0;white-space:pre-line;">${esc(pickupAddress)}</p>` : ''}
      ${pickupHours ? `<h3 style="font-size:14px;color:#111;margin:16px 0 0;">When</h3><p style="color:#444;font-size:14px;line-height:1.5;margin:6px 0 0;white-space:pre-line;">${esc(pickupHours)}</p>` : ''}
      <h3 style="font-size:14px;color:#111;margin:20px 0 8px;">Items</h3>
      ${itemsTable(items, order.currency)}
      <p style="color:#666;font-size:13px;margin-top:24px;">Bring this email or your order number.${supportEmail ? ' Questions? Reply to this email.' : ''}</p>`),
  ),
  /** To the shop, once a day while anything is at or under its level: everything that is running low. */
  storeLowStockDigest: (p: { items: { productName: string; variantName: string; sku: string; quantity: number; lowStockAt: number }[]; productsUrl: string }, b) => done(
    p.items.length === 1 ? `Running low: ${p.items[0].productName}${p.items[0].variantName && p.items[0].variantName !== 'Default' ? ' — ' + p.items[0].variantName : ''}` : `${p.items.length} products are running low`,
    wrap(b.companyName, 'Running low', `
      <p style="color:#444;font-size:15px;line-height:1.6;">${p.items.length === 1 ? 'This is at or under the level you set' : 'These are at or under the levels you set'}. You get this email once a day while anything is low, and not on a day when nothing is.</p>
      <ul style="color:#444;font-size:14px;line-height:1.7;margin:12px 0 0;padding-left:18px;">${p.items.map((i) => `<li><strong>${esc(i.productName)}</strong>${i.variantName && i.variantName !== 'Default' ? ` — ${esc(i.variantName)}` : ''} (${esc(i.sku)}): <strong>${i.quantity} left</strong>, level ${i.lowStockAt}</li>`).join('')}</ul>
      ${button(p.productsUrl, 'See what is low')}`),
  ),
  /** To the shop: a chargeback was opened, with the deadline to answer it. */
  storeDisputeOpened: (p: { orderNumber: string | null; amount: string; reason: string; dueBy: string | null; respondUrl: string; disputesUrl: string }, b) => done(
    `Chargeback opened${p.orderNumber ? ' on ' + p.orderNumber : ''} — ${p.amount}`,
    wrap(b.companyName, 'A customer disputed a payment', `
      <p style="color:#444;font-size:15px;line-height:1.6;">A chargeback for <strong>${esc(p.amount)}</strong>${p.orderNumber ? ` on order <strong>${esc(p.orderNumber)}</strong>` : ''} was opened with the card's bank. Reason given: <strong>${esc(p.reason)}</strong>.</p>
      ${p.dueBy ? `<p style="color:#444;font-size:15px;line-height:1.6;">Send your evidence by <strong>${esc(p.dueBy)}</strong>, or the bank decides without it.</p>` : ''}
      ${button(p.respondUrl, 'Respond in Stripe')}
      <p style="color:#666;font-size:13px;margin-top:22px;">Every dispute is on the Disputes screen: ${esc(p.disputesUrl)}</p>`),
  ),
  /** An order the shop made for a customer (a wholesale order), with the link to pay it. */
  storeInvoice: ({ order, items, supportEmail, payUrl }: OrderMail & { payUrl: string }, b) => done(
    `Your ${b.companyName} order${numPlain(order)} — ${formatCents(order.totalCents, order.currency)}`,
    wrap(b.companyName, 'Your order is ready to pay', `
      <p style="color:#444;font-size:15px;line-height:1.6;">Hi${firstName(order.customerName)} — here is the order${num(order)} we put together for you.</p>
      ${itemsTable(items, order.currency)}
      ${totalsTable(order)}
      ${button(payUrl, 'Pay now')}
      <p style="color:#666;font-size:13px;margin-top:22px;">The link stays good until the order is paid or cancelled.${supportEmail ? ' Questions? Reply to this email.' : ''}</p>`),
  ),
  storeAbandonedCart: ({ order, items, supportEmail, recoverUrl }: OrderMail & { recoverUrl: string }, b) => done(
    `You left ${items.length === 1 ? 'an item' : 'items'} in your ${b.companyName} cart`,
    wrap(b.companyName, 'Still interested?', `
      <p style="color:#444;font-size:15px;line-height:1.6;">You left something behind${firstName(order.customerName)}. Your items are still here — finish whenever you are ready.</p>
      ${itemsTable(items, order.currency)}
      ${totalsTable(order)}
      ${button(recoverUrl, 'Complete your order')}
      <p style="color:#666;font-size:13px;margin-top:22px;">If you have changed your mind, you can ignore this — nothing has been charged.${supportEmail ? ' Questions? Just reply to this email.' : ''}</p>`),
  ),
  storeReviewRequest: ({ order, items, supportEmail, reviewUrl }: OrderMail & { reviewUrl: string }, b) => done(
    `How was your ${b.companyName} order?`,
    wrap(b.companyName, 'How did we do?', `
      <p style="color:#444;font-size:15px;line-height:1.6;">Hope you are enjoying your order${firstName(order.customerName)}. If you have a minute, a short review helps other shoppers a lot.</p>
      ${itemsTable(items, order.currency)}
      ${button(reviewUrl, 'Leave a review')}
      <p style="color:#666;font-size:13px;margin-top:22px;">Only if you want to — no follow-ups after this one.${supportEmail ? ' Something wrong? Reply to this email and we will fix it.' : ''}</p>`),
  ),
}

/** An order row (with its lines) as the messages read it. */
export function emailOrder(o: any): EmailOrder {
  return {
    orderNumber: o.orderNumber ?? null, customerEmail: o.customerEmail, customerName: o.customerName ?? null,
    subtotalCents: o.subtotalCents, shippingCents: o.shippingCents, taxCents: o.taxCents,
    discountCents: o.discountCents, loyaltyDiscountCents: o.loyaltyDiscountCents, discountCode: o.discountCode,
    totalCents: o.totalCents, currency: o.currency, shippingAddress: o.shippingAddress ?? null,
    trackingCarrier: o.trackingCarrier ?? null, trackingNumber: o.trackingNumber ?? null,
    giftCardCents: o.giftCardCents ?? 0, fulfillment: o.fulfillment ?? 'ship',
  }
}
export const emailItems = (rows: any[]): EmailItem[] =>
  rows.map((it) => ({ productName: it.productName, variantName: it.variantName, quantity: it.quantity, lineTotalCents: it.lineTotalCents }))
