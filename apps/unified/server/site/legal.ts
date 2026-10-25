// The business's own privacy policy and terms (/privacy, /terms), with the text-message terms the carriers check
// before they approve a business to text (A2P 10DLC: the Factory's campaign names these two pages). Every business
// had none (2026-10-21). Each statement is what this system does:
//   · forms and bookings send what the visitor typed (enquiryHandler.ts, booking engine);
//   · page visits are counted per page per day, with nothing about the visitor (data/pageViews.ts countView);
//   · analytics are only what the business switched on in its settings (base.ejs: Tag Manager, Google Analytics /
//     Ads, Meta Pixel, Microsoft Clarity) — listed here only when present;
//   · card payments happen on the payment company's own page (Stripe Checkout, Square / PayPal hosted pages);
//   · texts go only to someone who ticked "Text me" or texted the business first (siteConsent.ts, the booking texts).
import { escHtml } from './render.ts'

interface LegalSettings {
  companyName?: string; email?: string; phone?: string; address?: string
  googleTagManagerId?: string; googleAnalyticsId?: string; googleAdsId?: string; facebookPixelId?: string; microsoftClarityId?: string
}

const contactLines = (s: LegalSettings) => [
  s.address && escHtml(s.address),
  s.phone && `<a href="tel:${escHtml(String(s.phone).replace(/[^\d+]/g, ''))}">${escHtml(s.phone)}</a>`,
  s.email && `<a href="mailto:${escHtml(s.email)}">${escHtml(s.email)}</a>`,
].filter(Boolean).join('<br>')

/** The analytics this business actually loads (none unless it set them). */
function analytics(s: LegalSettings): string[] {
  const out: string[] = []
  if (s.googleTagManagerId || s.googleAnalyticsId) out.push('Google Analytics (Google Tag Manager)')
  if (s.googleAdsId) out.push('Google Ads conversion tracking')
  if (s.facebookPixelId) out.push('the Meta (Facebook) Pixel')
  if (s.microsoftClarityId) out.push('Microsoft Clarity')
  return out
}

const page = (title: string, updated: string, body: string) =>
  `<section class="legal-page"><div class="container legal-page__inner"><h1>${title}</h1><p class="legal-page__updated">Last updated ${updated}</p>${body}</div></section>`

/** The day these terms last changed — a fixed date, never "today" (a policy dated today every day says nothing). */
const UPDATED = 'October 21, 2026'

/** What a visitor is told about text messages, the same words on both pages and beside every "Text me" box. */
export const SMS_TERMS = {
  frequency: 'Message frequency varies.',
  rates: 'Message and data rates may apply.',
  stopHelp: 'Reply STOP to stop receiving texts, or HELP for help.',
}

export function privacyHtml(s: LegalSettings): string {
  const name = escHtml(s.companyName || 'We')
  const a = analytics(s)
  return page('Privacy Policy', UPDATED, `
<p>This policy explains what ${name} collects through this website, how it is used, and the choices you have.</p>
<h2>What we collect</h2>
<ul>
  <li><strong>What you send us.</strong> When you fill in a form on this site — a booking, a request or a message — we receive what you type in it — such as your name, email, phone number, address, and the details of your request.</li>
  <li><strong>Payments.</strong> Card payments are taken on the payment company's own secure page (such as Stripe, Square or PayPal). We never see or store your full card number.</li>
  <li><strong>Visits.</strong> We count how many times each page of this site is visited each day. That count holds nothing about who you are.</li>
  ${a.length ? `<li><strong>Analytics.</strong> This site uses ${a.join(', ')} to understand how visitors use it and how our advertising performs. These services may set cookies; their own privacy policies apply.</li>` : ''}
</ul>
<h2>How we use it</h2>
<p>To answer you, to provide what you asked for, to send your booking confirmations, reminders, invoices and receipts, and — afterwards — to ask how we did.</p>
<h2>Text messages</h2>
<p>If you tick “Text me” on one of our forms, or text us first, we may text you about your booking, enquiry or service. ${SMS_TERMS.frequency} ${SMS_TERMS.rates} ${SMS_TERMS.stopHelp} Agreeing to texts is never a condition of buying anything.</p>
<p><strong>No mobile information will be shared with third parties or affiliates for marketing or promotional purposes.</strong> Text-messaging originator opt-in data and consent are not shared with any third parties, except the service providers that deliver our texts.</p>
<h2>Who we share it with</h2>
<p>Only the service providers that run this website and our records for us (hosting, email and text-message delivery, payments) — each only for that purpose. We do not sell your information.</p>
<h2>Your choices</h2>
<p>You can ask us what we hold about you, ask us to correct or delete it, or stop texts at any time by replying STOP. Contact us below.</p>
<h2>Contact</h2>
<p>${name}${contactLines(s) ? '<br>' + contactLines(s) : ''}</p>`)
}

export function termsHtml(s: LegalSettings): string {
  const name = escHtml(s.companyName || 'We')
  return page('Terms', UPDATED, `
<h2>Text messages from ${name}</h2>
<p><strong>What you get.</strong> If you tick “Text me” on one of our forms, or text us first, ${name} may text you about your booking, order or request: confirmations, reminders, updates, answers to your questions, and — afterwards — a request for a review.</p>
<p><strong>How often.</strong> ${SMS_TERMS.frequency} <strong>Cost.</strong> ${SMS_TERMS.rates}</p>
<p><strong>Stopping.</strong> Reply <strong>STOP</strong> to any text to stop receiving them; we will confirm once and send nothing more. Reply <strong>HELP</strong> for help, or contact us below.</p>
<p>Agreeing to texts is never a condition of buying anything. Carriers are not liable for delayed or undelivered messages.</p>
<p>How we handle your information, including your phone number, is in our <a href="/privacy">Privacy Policy</a>.</p>
<h2>This website</h2>
<p>Prices, availability and descriptions on this site can change; the price you are quoted or invoiced is the one that applies. Please contact us with any questions about a booking or an order.</p>
<h2>Contact</h2>
<p>${name}${contactLines(s) ? '<br>' + contactLines(s) : ''}</p>`)
}
