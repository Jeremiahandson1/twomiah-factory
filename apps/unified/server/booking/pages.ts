// The booking pages on the website: the services, the picker, the confirmation, and the customer's own page to
// reschedule or cancel. Server-rendered in the site's layout; the picker's times come from /api/book (modules/
// booking.ts) through /scripts/book-flow.js. Moved from the premium site's server-static.ts, with:
//   • the confirmation and the calendar file reached by the booking's private token, not its id (the site showed a
//     booking's email and address to anyone with its id in /book/thanks?id=…);
//   • the dates offered by the server, from the business's own window and with full days left out (the site drew
//     14 days from the visitor's own clock, full or not);
//   • a waitlist the customer can actually join when nothing fits (the site had the endpoint and no button);
//   • a cancel that works without JavaScript, and a reschedule page that loads (the site's script stopped on it).
import { Hono, type Context } from 'hono'
import fs from 'node:fs'
import path from 'node:path'
import { safeTz } from '@twomiah/tenant-backend'
import type { BookingEngine, BookingRow, ServiceRow, SettingsRow } from './engine.ts'
import { BookingError } from './engine.ts'
// The site's one rule for a tab's title, "Page — Business, City, ST" (site/menu.ts), as every other page of the site.
import { pageTitle } from '../site/menu.ts'
import { whenText } from './emails.ts'
import { icsOf } from './happenings.ts'
import { renderBody, escHtml } from '../site/render.ts'
import { EMBED_CSP } from '../http/guards.ts'
import type { SiteContext } from '../site/context.ts'
import { consentBoxHtml } from '../site/smsConsent.ts'

// The pages' script is TypeScript like everything else (RULEBOOK §1), turned into plain JavaScript once, at start.
const SCRIPT = new Bun.Transpiler({ loader: 'ts', target: 'browser' }).transformSync(fs.readFileSync(path.join(import.meta.dir, '..', '..', 'site', 'public', 'scripts', 'book-flow.ts'), 'utf8'))
// The embed (another website showing the booking pages in a frame), served from the site like the picker's script.
const EMBED_SCRIPT = new Bun.Transpiler({ loader: 'ts', target: 'browser' }).transformSync(fs.readFileSync(path.join(import.meta.dir, '..', '..', 'site', 'public', 'scripts', 'book-embed.ts'), 'utf8'))
const FEATURE = 'online_booking'
const length = (m: number) => (m % 60 === 0 ? `${m / 60} hr` : m > 60 ? `${Math.floor(m / 60)} hr ${m % 60} min` : `${m} min`)
const price = (p: string | null) => (p == null ? '' : '$' + (Number(p) % 1 ? Number(p).toFixed(2) : String(Number(p))))
/** A service's price as customers read it: "from $250" when it is a starting price (booking_service.price_is_from). */
const servicePrice = (svc: Pick<ServiceRow, 'price' | 'priceIsFrom'>) => (svc.price == null ? '' : (svc.priceIsFrom ? 'from ' : '') + price(svc.price))

export function createBookingPages(deps: { engine: BookingEngine; ctxOf: () => Promise<SiteContext | null>; isFeatureEnabled: (companyId: string, f: string) => Promise<boolean> }) {
  const { engine } = deps
  const app = new Hono()

  /** The site, when bookings are on; otherwise the site's 404. */
  async function site(c: Context) {
    const ctx = await deps.ctxOf()
    if (!ctx || !(await deps.isFeatureEnabled(ctx.companyId, FEATURE))) return null
    return { ctx, settings: await engine.settingsOf(ctx.companyId) }
  }
  /**
   * In the site's layout. A customer's own pages (`private`) are kept out of search engines. Framed on another website
   * (?embed=1, /scripts/book-embed.js): the page alone, and only these pages may be framed by other sites.
   */
  async function html(c: Context, ctx: SiteContext, body: string, title: string, currentPath: string, priv = false) {
    const embed = embedded(c)
    const h = await renderBody(ctx, body, { homeHref: '/', contactHref: '/contact', seoTitle: pageTitle(ctx.settings, { title }), seoDescription: '' }, currentPath, { embed })
    if (embed) c.header('Content-Security-Policy', EMBED_CSP)
    if (!priv) return c.html(h)
    c.header('X-Robots-Tag', 'noindex, nofollow')
    c.header('Cache-Control', 'private, no-store')
    return c.html(h.replace('<meta name="robots" content="index, follow">', '<meta name="robots" content="noindex, nofollow">'))
  }

  /** Framed on another website: the pages keep ?embed=1 among themselves; anything that leaves opens the whole window. */
  const embedded = (c: Context) => c.req.query('embed') === '1'
  const keep = (c: Context, sep: '?' | '&' = '?') => (embedded(c) ? sep + 'embed=1' : '')
  const top = (c: Context) => (embedded(c) ? ' target="_top"' : '')

  const closed = (c: Context, ctx: SiteContext) => html(c, ctx, `<section class="book-empty"><div class="container"><h1>Online booking is closed</h1><p>Please <a href="/contact">get in touch</a> to arrange a time.</p></div></section>`, 'Book online', '/book')

  // Cross-origin by design: it is loaded by the business's other website.
  app.get('/scripts/book-embed.js', (c) => c.body(EMBED_SCRIPT, 200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'public, max-age=300', 'Access-Control-Allow-Origin': '*' }))
  app.get('/scripts/book-flow.js', (c) => c.body(SCRIPT, 200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'public, max-age=300' }))

  app.get('/book', async (c) => {
    const s = await site(c); if (!s) return c.notFound()
    if (!s.settings.enabled) return closed(c, s.ctx)
    const services = await engine.listServices(s.ctx.companyId, { activeOnly: true })
    const body = !services.length
      ? '<section class="book-empty"><div class="container"><h1>Bookings opening soon</h1><p>Online booking is being set up. <a href="/contact">Get in touch</a> for now.</p></div></section>'
      : `<section class="book-services"><div class="container"><h1 class="book-services__title">${escHtml(s.settings.heroTitle || 'Book a service')}</h1>${s.settings.heroSubtitle ? `<p class="book-services__subtitle">${escHtml(s.settings.heroSubtitle)}</p>` : ''}<div class="book-services__grid">${services.map((x) => `
          <a class="service-card" href="/book/${escHtml(x.slug)}${keep(c)}"><div class="service-card__body"><h2 class="service-card__name">${escHtml(x.name)}</h2>${x.description ? `<p class="service-card__desc">${escHtml(x.description)}</p>` : ''}<div class="service-card__meta"><span>${length(x.durationMinutes)}</span>${x.price != null ? `<span class="service-card__price">${servicePrice(x)}</span>` : ''}</div><span class="service-card__cta">Book →</span></div></a>`).join('')}</div></div></section>`
    return html(c, s.ctx, body, 'Book online', '/book')
  })

  /** The picker, for a new booking or (with the booking) a new time for an existing one. */
  // askZip: only where somebody covers named ZIP codes (Settings › Service areas) — the ZIP picks who is offered. A salon
  // that has none asked every client for one (salon live test, 2026-10-25).
  function picker(svc: ServiceRow, settings: SettingsRow, requireAddress: boolean, moving?: BookingRow, embed = false, askZip = false) {
    const tips = Array.isArray(svc.tipPresets) && svc.price != null ? (svc.tipPresets as number[]) : []
    // The waitlist's dates are held to the booking window like a booking's (engine.customerRules).
    const win = engine.window(settings)
    const data = [
      `data-service="${escHtml(svc.slug)}"`,
      moving ? `data-token="${escHtml(moving.token)}"` : '',
      embed ? 'data-embed="1"' : '',
    ].filter(Boolean).join(' ')
    const details = moving ? `
        <form id="book-form" novalidate>
          <button type="submit" class="book-submit">Move my booking to this time</button>
          <div class="book-error" id="book-error" role="alert" hidden></div>
        </form>` : `
        <form id="book-form" autocomplete="on" novalidate>
          <label>Name<input type="text" name="name" required autocomplete="name"></label>
          <label>Email<input type="email" name="email" required autocomplete="email"></label>
          <label>Phone${settings.requirePhone ? '' : ' (optional)'}<input type="tel" name="phone" ${settings.requirePhone ? 'required' : ''} autocomplete="tel"></label>
          ${consentBoxHtml('booking')}
          <label>Address${requireAddress ? '' : ' (optional)'}<input type="text" name="address" ${requireAddress ? 'required' : ''} autocomplete="street-address"></label>
          ${engine.questions.map((q) => `<label>${escHtml(q.label)}<input type="text" name="${escHtml(q.name)}" maxlength="${q.maxLength}"${q.placeholder ? ` placeholder="${escHtml(q.placeholder)}"` : ''}${q.requiredMessage ? ' required' : ''}></label>`).join('\n          ')}
          <label>Anything we should know? (optional)<textarea name="notes" rows="3"></textarea></label>
          ${tips.length ? `<div class="book-tip"><span class="book-tip__label">Add a tip (optional)</span><div class="book-tip-row" role="group" aria-label="Tip">
            <button type="button" data-tip="" class="book-tip-btn is-active" aria-pressed="true">None</button>
            ${tips.map((p) => `<button type="button" data-tip="${p}" class="book-tip-btn" aria-pressed="false">${p}%</button>`).join('')}
          </div><input type="hidden" name="tipPercent" value=""></div>` : ''}
          <input type="text" name="website" tabindex="-1" autocomplete="off" class="book-hp" aria-hidden="true">
          <input type="hidden" name="t">
          <button type="submit" class="book-submit">${escHtml(settings.confirmCta || 'Confirm booking')}</button>
          <div class="book-error" id="book-error" role="alert" hidden></div>
        </form>`
    return `
    <div id="book-flow" ${data}>
      <ol class="book-progress" aria-label="Booking progress">
        <li class="book-progress__step is-active" data-step="date"><span class="book-progress__num">1</span><span class="book-progress__label">Date</span></li>
        <li class="book-progress__step" data-step="slot"><span class="book-progress__num">2</span><span class="book-progress__label">Time</span></li>
        <li class="book-progress__step" data-step="form"><span class="book-progress__num">3</span><span class="book-progress__label">${moving ? 'Confirm' : 'Details'}</span></li>
      </ol>
      <div class="book-step book-step--date">
        <h2>Pick a date</h2>
        ${moving || !askZip ? '' : `<div class="book-zip"><label>Your ZIP code (optional)<input type="text" inputmode="numeric" pattern="[0-9]{5}" maxlength="5" id="book-zip" name="zip" autocomplete="postal-code"></label></div>`}
        <div class="book-dates" id="book-dates"><p class="book-loading">Finding open days…</p></div>
      </div>
      <div class="book-step book-step--slot" hidden>
        <h2>Pick a time</h2>
        <div class="book-slots" id="book-slots"></div>
      </div>
      <div class="book-step book-step--form" hidden>
        <h2>${moving ? 'Confirm the new time' : 'Your details'}</h2>
        <p class="book-chosen" id="book-chosen"></p>
        ${details}
      </div>
      ${moving ? '' : `<div class="book-step book-step--waitlist" hidden>
        <h2>Nothing fits?</h2>
        <p>Leave your details and we'll email you when a time opens.</p>
        <form id="book-waitlist" novalidate>
          <label>Name<input type="text" name="name" required autocomplete="name"></label>
          <label>Email<input type="email" name="email" required autocomplete="email"></label>
          <label>Phone${settings.requirePhone ? '' : ' (optional)'}<input type="tel" name="phone" ${settings.requirePhone ? 'required' : ''} autocomplete="tel"></label>
          <label>From (optional)<input type="date" name="from" min="${win.first}" max="${win.last}"></label>
          <label>Until (optional)<input type="date" name="to" min="${win.first}" max="${win.last}"></label>
          <input type="text" name="website" tabindex="-1" autocomplete="off" class="book-hp" aria-hidden="true">
          <input type="hidden" name="t">
          <button type="submit" class="book-submit book-submit--secondary">Tell me when a time opens</button>
          <div class="book-error" role="alert" hidden></div>
          <p class="book-ok" role="status" hidden></p>
        </form>
      </div>
      <p class="book-waitlist-link"><button type="button" class="book-linkbtn" id="book-waitlist-open">None of these times work? Join the waitlist</button></p>`}
    </div>
    <script src="/scripts/book-flow.js" defer></script>`
  }

  app.get('/book/done', async (c) => {
    const s = await site(c); if (!s) return c.notFound()
    const b = await engine.byToken(s.ctx.companyId, c.req.query('token') || '')
    if (!b) return c.notFound()
    const svc = b.serviceId ? await engine.serviceById(s.ctx.companyId, b.serviceId) : null
    const tz = safeTz(s.settings.timezone)
    const body = `<section class="book-thanks"><div class="container container--narrow">
      <div class="book-thanks__check" aria-hidden="true">✓</div>
      <h1>${escHtml(s.settings.thanksMessage || "You're booked.")}</h1>
      <p class="book-thanks__lead">A confirmation is on its way to <strong>${escHtml(b.customerEmail)}</strong>.</p>
      <div class="book-thanks__summary">
        <div><span>Service</span><strong>${escHtml(svc?.name || 'Booking')}</strong></div>
        <div><span>When</span><strong>${escHtml(whenText(b.startAt, tz))}</strong></div>
        ${b.customerAddress ? `<div><span>Where</span><strong>${escHtml(b.customerAddress)}</strong></div>` : ''}
      </div>
      <p class="book-thanks__addcal"><a href="/booking/${escHtml(b.token)}/ics">Add to your calendar</a> · <a href="/booking/${escHtml(b.token)}"${top(c)}>Reschedule or cancel</a></p>
    </div></section>`
    return html(c, s.ctx, body, 'Booking confirmed', '/book/done', true)
  })

  app.get('/book/:slug', async (c) => {
    const s = await site(c); if (!s) return c.notFound()
    if (!s.settings.enabled) return closed(c, s.ctx)
    const svc = await engine.serviceBySlug(s.ctx.companyId, c.req.param('slug'))
    if (!engine.offered(svc)) return c.notFound()
    const body = `<section class="book-picker"><div class="container container--narrow">
      <a class="book-picker__back" href="/book${keep(c)}">← All services</a>
      <h1 class="book-picker__title">${escHtml(svc.name)}</h1>
      <p class="book-picker__desc">${svc.description ? escHtml(svc.description) + ' · ' : ''}${length(svc.durationMinutes)}${svc.price != null ? ' · ' + servicePrice(svc) : ''}</p>
      ${picker(svc, s.settings, engine.requireAddress(s.settings), undefined, embedded(c), (await engine.listZones(s.ctx.companyId)).some((z: any) => Array.isArray(z.zips) && z.zips.length > 0))}
    </div></section>`
    return html(c, s.ctx, body, `Book ${svc.name}`, '/book/' + svc.slug)
  })

  /** The customer's own page: what, when, and the way to move or cancel it while it's still allowed. */
  app.get('/booking/:token', async (c) => {
    const s = await site(c); if (!s) return c.notFound()
    const b = await engine.byToken(s.ctx.companyId, c.req.param('token'))
    if (!b) return c.notFound()
    const svc = b.serviceId ? await engine.serviceById(s.ctx.companyId, b.serviceId) : null
    const tz = safeTz(s.settings.timezone)
    const status = ({ pending: 'Waiting for the deposit', confirmed: 'Confirmed', cancelled: 'Cancelled', completed: 'Completed', no_show: 'Missed' } as Record<string, string>)[b.status] || b.status
    const open = engine.selfServiceOpen(b, s.settings)
    // A deposit still owed: its amount, and how long the time is held for it (the engine releases it after that).
    const owed = b.status === 'pending' && b.depositStatus === 'pending'
    const holdEnds = new Date(b.createdAt.getTime() + s.settings.depositHoldMinutes * 60_000)
    const held = owed && holdEnds.getTime() > Date.now()
    const amount = price(String(Number(b.depositAmount || 0) + Number(b.tipAmount || 0)))
    const note = c.req.query('moved') ? '<p class="book-ok" role="status">Your booking has its new time. A confirmation is on its way.</p>'
      : c.req.query('cancelled') ? '<p class="book-ok" role="status">Your booking is cancelled.</p>'
      : c.req.query('deposit') === 'paid' ? (b.depositStatus === 'paid'
        ? '<p class="book-ok" role="status">Thank you — your deposit is paid and your booking is confirmed. A confirmation is on its way.</p>'
        : '<p class="book-ok" role="status">Thank you — your payment is being confirmed. This usually takes a few seconds; refresh to see it.</p>')
      : c.req.query('deposit') === 'cancelled' && held ? `<p class="book-error" role="alert">The deposit wasn't paid. Your time is held until ${escHtml(whenText(holdEnds, tz))} — pay below to keep it.</p>`
      : c.req.query('error') ? `<p class="book-error" role="alert">${escHtml(c.req.query('error')!)}</p>` : ''
    const body = `<section class="book-thanks"><div class="container container--narrow">
      <h1>Your booking</h1>
      ${note}
      <div class="book-thanks__summary">
        <div><span>Service</span><strong>${escHtml(svc?.name || 'Booking')}</strong></div>
        <div><span>When</span><strong>${escHtml(whenText(b.startAt, tz))}</strong></div>
        <div><span>Status</span><strong>${escHtml(status)}</strong></div>
        ${b.customerAddress ? `<div><span>Where</span><strong>${escHtml(b.customerAddress)}</strong></div>` : ''}
        ${b.depositAmount ? `<div><span>Deposit</span><strong>${escHtml(amount)} · ${escHtml(({ pending: held ? 'not paid yet' : 'not paid — the hold ran out', paid: 'paid', refunded: 'refunded', expired: 'not paid — the hold ran out', none: 'not taken' } as Record<string, string>)[b.depositStatus] || b.depositStatus)}</strong></div>` : ''}
      </div>
      ${held ? `<div class="book-actions"><a class="book-submit" href="/booking/${escHtml(b.token)}/pay"${top(c)}>Pay the ${escHtml(amount)} deposit</a></div>
      <p class="book-thanks__lead">Your time is held until ${escHtml(whenText(holdEnds, tz))}. After that it is offered to others.</p>` : ''}
      ${open ? `<div class="book-actions">
        ${svc?.active ? `<a class="book-submit book-submit--secondary" href="/booking/${escHtml(b.token)}/reschedule"${top(c)}>Reschedule</a>` : ''}
        <form method="post" action="/booking/${escHtml(b.token)}/cancel" data-confirm="Cancel this booking?"${top(c)}><button type="submit" class="book-submit book-submit--danger">Cancel booking</button></form>
      </div>` : (b.status === 'confirmed' || b.status === 'pending') ? `<p class="book-thanks__lead">It's too close to the start to change this online. Please <a href="/contact">get in touch</a>.</p>` : ''}
      ${b.status !== 'cancelled' ? `<p class="book-thanks__addcal"><a href="/booking/${escHtml(b.token)}/ics">Add to your calendar</a></p>` : ''}
    </div></section>
    <script src="/scripts/book-flow.js" defer></script>`
    return html(c, s.ctx, body, 'Your booking', '/booking', true)
  })

  /** The deposit's payment page again (Stripe's; a new one each time — the last may have closed). */
  app.get('/booking/:token/pay', async (c) => {
    const s = await site(c); if (!s) return c.notFound()
    const b = await engine.byToken(s.ctx.companyId, c.req.param('token'))
    if (!b) return c.notFound()
    const url = await engine.depositPage(s.ctx.companyId, b)
    if (url) return c.redirect(url, 303)
    const now = await engine.byToken(s.ctx.companyId, b.token)
    const why = now?.depositStatus === 'paid' ? '' : now?.status === 'cancelled'
      ? 'The time was not held any longer — please book again.'
      : 'Card payment is not available right now — please get in touch.'
    return c.redirect(`/booking/${b.token}${why ? '?error=' + encodeURIComponent(why) : ''}`, 303)
  })

  app.get('/booking/:token/reschedule', async (c) => {
    const s = await site(c); if (!s) return c.notFound()
    const b = await engine.byToken(s.ctx.companyId, c.req.param('token'))
    if (!b) return c.notFound()
    const svc = b.serviceId ? await engine.serviceById(s.ctx.companyId, b.serviceId) : null
    if (!svc || !svc.active || !engine.selfServiceOpen(b, s.settings)) return c.redirect('/booking/' + b.token)
    const body = `<section class="book-picker"><div class="container container--narrow">
      <a class="book-picker__back" href="/booking/${escHtml(b.token)}">← Your booking</a>
      <h1 class="book-picker__title">Reschedule</h1>
      <p class="book-picker__desc">${escHtml(svc.name)} is booked for <strong>${escHtml(whenText(b.startAt, safeTz(s.settings.timezone)))}</strong>. Pick a new time.</p>
      ${picker(svc, s.settings, false, b)}
    </div></section>`
    return html(c, s.ctx, body, 'Reschedule', '/booking', true)
  })

  /** Cancel without JavaScript: the manage page's plain form. */
  app.post('/booking/:token/cancel', async (c) => {
    const s = await site(c); if (!s) return c.notFound()
    const b = await engine.byToken(s.ctx.companyId, c.req.param('token'))
    if (!b) return c.notFound()
    try {
      await engine.cancel(s.ctx.companyId, b, { by: 'customer' })
      return c.redirect(`/booking/${b.token}?cancelled=1`, 303)
    } catch (e) {
      if (e instanceof BookingError) return c.redirect(`/booking/${b.token}?error=${encodeURIComponent(e.message)}`, 303)
      throw e
    }
  })

  app.get('/booking/:token/ics', async (c) => {
    const s = await site(c); if (!s) return c.notFound()
    const b = await engine.byToken(s.ctx.companyId, c.req.param('token'))
    if (!b) return c.notFound()
    const svc = b.serviceId ? await engine.serviceById(s.ctx.companyId, b.serviceId) : null
    return c.body(icsOf(b, svc, s.ctx.settings.companyName, b.status === 'cancelled'), 200, { 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': 'attachment; filename="booking.ics"' })
  })

  return app
}
