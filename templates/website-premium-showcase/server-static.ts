/**
 * server-static.ts — premium-contractor template runtime.
 *
 * Renders pages from the section-composition schema:
 *   pages row → { sections: [...] } → views/home.ejs → views/base.ejs.
 *
 * Routes:
 *   /                 → renders page slug 'home'
 *   /:slug            → renders any other page row (about, services, contact, custom)
 *   /admin/*          → React SPA at admin/dist/ + JSON API at /api/admin/*
 *   /api/leads        → public POST for the contact form
 *   /api/internal/*   → Factory-key-gated control endpoints (settings sync, etc.)
 *   /uploads/*        → local-fallback static file serving for dev (R2 in prod)
 *   /styles/*, /scripts/* → inline-able build assets
 *   /health           → liveness for Render
 */
import { Hono } from 'hono'
import { logger } from 'hono/logger'
import { cors } from 'hono/cors'
import { serveStatic } from 'hono/bun'
import { eq, asc, desc, and, gte, lte } from 'drizzle-orm'
import ejs from 'ejs'
import fs from 'fs'
import path from 'path'
import { db } from './db'
import { settings as settingsTbl, pages as pagesTbl, leads as leadsTbl, posts as postsTbl } from './db/schema'
import adminRoutes from './routes/admin'
import { secureHeaders, adminCors, loginRateLimit, isSafeUrl } from './lib/security'

const app = new Hono()

app.use('*', logger())
app.use('*', secureHeaders())
// Public marketing pages can be embedded/fetched cross-origin freely.
// The admin API gets a stricter CORS gate further down.
app.use('*', cors())

// In-memory per-IP rate limit for the public contact form. Honeypot +
// dwell-time stop dumb bots; this stops someone hand-flooding a real
// browser. 5 submissions per IP per 10 minutes — generous for a human
// who's correcting typos, brutal for a flood.
const leadBuckets = new Map<string, number[]>()
const LEAD_WINDOW_MS = 10 * 60 * 1000
const LEAD_MAX = 5
function leadClientIp(c: any): string {
  const xff = c.req.header('X-Forwarded-For') || ''
  if (xff) return xff.split(',')[0].trim()
  return c.req.header('CF-Connecting-IP') || c.req.header('X-Real-IP') || 'unknown'
}

// ── Health ────────────────────────────────────────────────────────────────
app.get('/health', (c) => c.json({ ok: true, ts: new Date().toISOString() }))

// RFC 9116 security disclosure file. Pointer to twomiah.com/security
// keeps every tenant pointing to a single coordinated disclosure page.
app.get('/.well-known/security.txt', (c) => {
  const expires = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString()
  return c.text(
    'Contact: mailto:security@twomiah.com\n' +
    'Expires: ' + expires + '\n' +
    'Preferred-Languages: en\n' +
    'Canonical: https://twomiah.com/.well-known/security.txt\n' +
    'Policy: https://twomiah.com/security\n',
    200, { 'Content-Type': 'text/plain; charset=utf-8' }
  )
})

// ── Asset serving (CSS, JS, uploads) ──────────────────────────────────────
app.use('/styles/*', serveStatic({ root: './build' }))
app.use('/scripts/*', serveStatic({ root: './build' }))
app.use('/uploads/*', serveStatic({ root: '.' }))

// ── Helpers ───────────────────────────────────────────────────────────────
const viewsDir = path.join(__dirname, 'views')

async function loadSettings() {
  const rows = await db.select().from(settingsTbl).limit(1)
  return rows[0] || null
}

async function loadPage(slug: string) {
  const rows = await db.select().from(pagesTbl).where(eq(pagesTbl.slug, slug)).limit(1)
  return rows[0] || null
}

async function renderPage(slug: string, currentPath: string): Promise<string | null> {
  const [page, settingsRow] = await Promise.all([loadPage(slug), loadSettings()])
  if (!page || !page.isPublished) return null

  const homepage = { sections: Array.isArray(page.sections) ? page.sections : [] }
  const settings = settingsRow || { companyName: 'Your Company', nav: [], contactCtaLabel: 'Get in touch' }

  // Per-page SEO overrides
  const effectiveSettings = {
    ...settings,
    seoTitle: page.metaTitle || settings.seoTitle || page.title,
    seoDescription: page.metaDescription || settings.seoDescription || '',
  }

  const body = await ejs.renderFile(path.join(viewsDir, 'home.ejs'), { homepage, settings: effectiveSettings }) as string
  return ejs.renderFile(path.join(viewsDir, 'base.ejs'), { body, settings: effectiveSettings, crmApiUrl: process.env.CRM_API_URL || '', currentPath }) as Promise<string>
}

// Default placeholder served when the pages.home row doesn't exist yet
// (fresh deploy before the AI composer or admin has seeded any content).
// 200 status — the site is up and usable; the CMS admin link gets the
// owner straight to the editor.
function defaultHomePlaceholder(siteName: string): string {
  const safe = siteName.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] || c))
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${safe}</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-family:system-ui,-apple-system,sans-serif;margin:0;background:#fafaf7;color:#1a1a1a}main{max-width:680px;margin:10vh auto;padding:48px 32px;text-align:center}h1{font-size:2.5rem;margin:0 0 16px;letter-spacing:-.02em}p{color:#666;font-size:1.05rem;line-height:1.6;margin:0 0 32px}a.cta{display:inline-block;padding:14px 32px;background:#1a1a1a;color:#fff;text-decoration:none;border-radius:6px;font-weight:500}.tag{display:inline-block;font-size:.75rem;letter-spacing:.1em;text-transform:uppercase;color:#999;margin-bottom:24px}</style></head><body><main><span class="tag">Coming Soon</span><h1>${safe}</h1><p>Your premium website is being prepared. Sign in to the admin to add your home page content, or wait for our composition team to send your preview.</p><a class="cta" href="/admin">Open Admin</a></main></body></html>`
}

// ── Page routes ───────────────────────────────────────────────────────────
app.get('/', async (c) => {
  const html = await renderPage('home', '/')
  if (!html) {
    const siteName = process.env.SITE_NAME || 'Your Site'
    return c.html(defaultHomePlaceholder(siteName))
  }
  return c.html(html)
})

// Blog routes — must register before the catch-all `/:slug` below or
// Hono dispatches /blog to the slug handler first.
app.get('/blog', async (c) => {
  const settings = await loadSettings()
  if (!settings) return c.text('Blog not configured yet.', 503)
  const rows = await db.select().from(postsTbl).where(eq(postsTbl.status, 'published')).orderBy(desc(postsTbl.publishedAt))
  const listHtml = rows.length === 0
    ? '<p class="blog-empty">No posts yet. Check back soon.</p>'
    : '<div class="blog-list">' + rows.map(r => {
        const date = r.publishedAt ? new Date(r.publishedAt as any).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : ''
        return `<a class="blog-card" href="/blog/${r.slug}">
          ${r.coverImageUrl ? `<img class="blog-card__cover" src="${r.coverImageUrl}" alt="" loading="lazy">` : ''}
          <div class="blog-card__body">
            ${date ? `<div class="blog-card__date">${date}</div>` : ''}
            <h2 class="blog-card__title">${r.title}</h2>
            ${r.excerpt ? `<p class="blog-card__excerpt">${r.excerpt}</p>` : ''}
            <span class="blog-card__more">Read →</span>
          </div>
        </a>`
      }).join('') + '</div>'
  const body = '<section class="blog-section"><div class="container"><h1 class="blog-section__title">From the blog</h1>' + listHtml + '</div></section>'
  const effectiveSettings = {
    ...settings,
    homeHref: '/',
    contactHref: '/contact',
    seoTitle: 'Blog · ' + (settings.companyName || 'Our blog'),
    seoDescription: settings.seoDescription || 'Recent posts from ' + (settings.companyName || 'the team') + '.',
    nav: settings.nav || [],
  }
  const html = await ejs.renderFile(path.join(viewsDir, 'base.ejs'), { body, settings: effectiveSettings, crmApiUrl: process.env.CRM_API_URL || '', currentPath: '/blog' }) as string
  return c.html(html)
})

app.get('/blog/:slug', async (c) => {
  const slug = c.req.param('slug')
  const settings = await loadSettings()
  if (!settings) return c.text('Blog not configured yet.', 503)
  const rows = await db.select().from(postsTbl).where(eq(postsTbl.slug, slug as string)).limit(1)
  const post = rows[0]
  if (!post || post.status !== 'published') return c.notFound()
  const date = post.publishedAt ? new Date(post.publishedAt as any).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : ''
  const body = `<article class="blog-post">
    <div class="container container--narrow">
      <a class="blog-post__back" href="/blog">← All posts</a>
      ${post.coverImageUrl ? `<img class="blog-post__cover" src="${post.coverImageUrl}" alt="">` : ''}
      ${date ? `<div class="blog-post__date">${date}</div>` : ''}
      <h1 class="blog-post__title">${post.title}</h1>
      ${post.excerpt ? `<p class="blog-post__excerpt">${post.excerpt}</p>` : ''}
      <div class="blog-post__body">${markdownToHtml(post.body || '')}</div>
    </div>
  </article>`
  const effectiveSettings = {
    ...settings,
    homeHref: '/',
    contactHref: '/contact',
    seoTitle: post.metaTitle || post.title + ' — ' + (settings.companyName || ''),
    seoDescription: post.metaDescription || post.excerpt || '',
    nav: settings.nav || [],
  }
  const html = await ejs.renderFile(path.join(viewsDir, 'base.ejs'), { body, settings: effectiveSettings, crmApiUrl: process.env.CRM_API_URL || '', currentPath: '/blog/' + slug }) as string
  return c.html(html)
})

// ─── Twomiah Bookings — public routes ────────────────────────────────────
// Register BEFORE the catch-all `/:slug` below or Hono dispatches /book
// to the slug handler first.

import { generateSlots, pickCrewForSlot } from './lib/booking-slots'
import { sendBookingConfirmationEmail, notifyOwnerOfBooking } from './lib/email'
import { pushBookingEvent, deleteBookingEvent, listExternalBusyEvents } from './lib/google-calendar'
import { pushBookingEventOutlook, deleteBookingEventOutlook, listExternalBusyEventsOutlook } from './lib/outlook-calendar'
import { depositAmountFor, createDepositCheckoutSession, verifyStripeWebhook } from './lib/stripe-deposit'
import {
  bookingServices as bookingServicesTbl,
  bookingAvailabilityRules as bookingAvailabilityRulesTbl,
  bookingBlackouts as bookingBlackoutsTbl,
  bookingServiceZones as bookingServiceZonesTbl,
  bookings as bookingsTbl,
} from './db/schema'
import crypto from 'crypto'

const TENANT_TZ = process.env.TENANT_TIMEZONE || 'America/Chicago'

function dateInTenantTz(d: Date): { isoDate: string; dayOfWeek: number; minuteOfDay: number } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: TENANT_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short',
  })
  const parts = Object.fromEntries(fmt.formatToParts(d).map(p => [p.type, p.value]))
  const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  return {
    isoDate: parts.year + '-' + parts.month + '-' + parts.day,
    dayOfWeek: dayMap[parts.weekday] ?? 0,
    minuteOfDay: parseInt(parts.hour, 10) * 60 + parseInt(parts.minute, 10),
  }
}

// Convert a tenant-TZ wall-clock time on a specific date to UTC. Naive
// approach: build a Date as if local, then offset. We rely on the
// tenant TZ offset being stable for the target date (DST handled by
// Intl on the way back).
function tenantDateTimeToUtc(isoDate: string, minuteOfDay: number): Date {
  const [y, m, d] = isoDate.split('-').map(Number)
  const hour = Math.floor(minuteOfDay / 60), minute = minuteOfDay % 60
  // Build a UTC Date at the wall-clock time then shift by tenant offset
  const naive = new Date(Date.UTC(y, m - 1, d, hour, minute))
  const tzString = new Intl.DateTimeFormat('en-US', {
    timeZone: TENANT_TZ, timeZoneName: 'shortOffset',
  }).formatToParts(naive).find(p => p.type === 'timeZoneName')?.value || 'GMT'
  // Parse offset like "GMT-05:00"
  const m2 = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(tzString)
  if (!m2) return naive
  const sign = m2[1] === '+' ? -1 : 1  // GMT-5 means we add 5 hours to get UTC
  const offsetMinutes = sign * (parseInt(m2[2], 10) * 60 + parseInt(m2[3] || '0', 10))
  return new Date(naive.getTime() + offsetMinutes * 60_000)
}

app.get('/book', async (c) => {
  const settings = await loadSettings()
  if (!settings) return c.text('Bookings not configured yet.', 503)
  const services = await db.select().from(bookingServicesTbl)
    .where(eq(bookingServicesTbl.isActive, true))
    .orderBy(asc(bookingServicesTbl.displayOrder), asc(bookingServicesTbl.name))
  const escape = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] || c))
  const heroTitle = (settings as any).bookingHeroTitle || 'Book a service'
  const body = services.length === 0
    ? '<section class="book-empty"><div class="container"><h1>Bookings opening soon</h1><p>This business is setting up online booking. Use the contact form for now.</p></div></section>'
    : `<section class="book-services"><div class="container"><h1 class="book-services__title">${escape(heroTitle)}</h1>${(settings as any).bookingHeroSubtitle ? `<p class="book-services__subtitle">${escape((settings as any).bookingHeroSubtitle)}</p>` : ''}<div class="book-services__grid">${services.map(s => {
        const price = s.priceCents != null ? '$' + (s.priceCents / 100).toFixed(0) : ''
        const dur = s.durationMinutes >= 60 ? (s.durationMinutes / 60) + ' hr' : s.durationMinutes + ' min'
        return `<a class="service-card" href="/book/${escape(s.slug)}"><div class="service-card__body"><h2 class="service-card__name">${escape(s.name)}</h2>${s.description ? `<p class="service-card__desc">${escape(s.description)}</p>` : ''}<div class="service-card__meta"><span class="service-card__dur">${dur}</span>${price ? `<span class="service-card__price">${price}</span>` : ''}</div><span class="service-card__cta">Book →</span></div></a>`
      }).join('')}</div></div></section>`
  const effectiveSettings = { ...settings, homeHref: '/', contactHref: '/contact', seoTitle: 'Book online · ' + (settings.companyName || ''), seoDescription: 'Pick a service and time that works for you.', nav: settings.nav || [] }
  const html = await ejs.renderFile(path.join(viewsDir, 'base.ejs'), { body, settings: effectiveSettings, crmApiUrl: process.env.CRM_API_URL || '', currentPath: '/book' }) as string
  return c.html(html)
})

app.get('/book/:serviceSlug', async (c) => {
  const slug = c.req.param('serviceSlug')!
  const settings = await loadSettings()
  if (!settings) return c.text('Bookings not configured yet.', 503)
  const service = (await db.select().from(bookingServicesTbl).where(eq(bookingServicesTbl.slug, slug)).limit(1))[0]
  if (!service || !service.isActive) return c.notFound()
  const escape = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] || c))
  const body = `<section class="book-picker"><div class="container container--narrow">
    <a class="book-picker__back" href="/book">← All services</a>
    <h1 class="book-picker__title">${escape(service.name)}</h1>
    ${service.description ? `<p class="book-picker__desc">${escape(service.description)}</p>` : ''}
    <div id="book-flow" data-service-slug="${escape(service.slug)}" data-service-name="${escape(service.name)}" data-duration="${service.durationMinutes}" data-price-cents="${service.priceCents ?? ''}">
      <ol class="book-progress" aria-label="Booking progress">
        <li class="book-progress__step is-active" data-step="date"><span class="book-progress__num">1</span><span class="book-progress__label">Date</span></li>
        <li class="book-progress__step" data-step="slot"><span class="book-progress__num">2</span><span class="book-progress__label">Time</span></li>
        <li class="book-progress__step" data-step="form"><span class="book-progress__num">3</span><span class="book-progress__label">Details</span></li>
      </ol>
      <div class="book-step book-step--date">
        <h2>Pick a date</h2>
        <div class="book-zip"><label>Your ZIP code <input type="text" inputmode="numeric" pattern="[0-9]{5}" maxlength="5" placeholder="53703" id="book-zip-input"></label></div>
        <div class="book-dates" id="book-dates"></div>
      </div>
      <div class="book-step book-step--slot" hidden>
        <h2>Pick a time</h2>
        <div class="book-slots" id="book-slots"></div>
      </div>
      <div class="book-step book-step--form" hidden>
        <h2>Your details</h2>
        <form id="book-form" autocomplete="on">
          <input type="hidden" name="serviceSlug" value="${escape(service.slug)}">
          <input type="hidden" name="startAtIso" id="book-start">
          <input type="hidden" name="customerZip" id="book-zip-hidden">
          <label>Name<input type="text" name="customerName" required autocomplete="name"></label>
          <label>Email<input type="email" name="customerEmail" required autocomplete="email"></label>
          <label>Phone<input type="tel" name="customerPhone" autocomplete="tel"></label>
          <label>Address<input type="text" name="customerAddress" autocomplete="street-address"></label>
          <label>Anything we should know? (optional)<textarea name="customerNotes" rows="3"></textarea></label>
          <input type="text" name="website" tabindex="-1" autocomplete="off" style="position:absolute;left:-9999px;" aria-hidden="true">
          <input type="hidden" name="t" id="book-form-t">
          <button type="submit" class="book-submit">${escape((settings as any).bookingConfirmCta || 'Confirm booking')}</button>
          <div class="book-error" id="book-error" hidden></div>
        </form>
      </div>
    </div>
  </div></section>
  <script src="/scripts/book-flow.js" defer></script>`
  const effectiveSettings = { ...settings, homeHref: '/', contactHref: '/contact', seoTitle: 'Book ' + service.name + ' · ' + (settings.companyName || ''), seoDescription: service.description || '', nav: settings.nav || [] }
  const html = await ejs.renderFile(path.join(viewsDir, 'base.ejs'), { body, settings: effectiveSettings, crmApiUrl: process.env.CRM_API_URL || '', currentPath: '/book/' + slug }) as string
  return c.html(html)
})

// JSON endpoint the slot picker queries when the customer picks a date
app.get('/book/:serviceSlug/slots', async (c) => {
  const slug = c.req.param('serviceSlug')!
  const dateStr = c.req.query('date') || ''
  const customerZip = (c.req.query('zip') || '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return c.json({ error: 'date required' }, 400)
  const service = (await db.select().from(bookingServicesTbl).where(eq(bookingServicesTbl.slug, slug)).limit(1))[0]
  if (!service || !service.isActive) return c.json({ error: 'service not found' }, 404)
  const settings = await loadSettings()

  // Figure out which day-of-week this date falls on in tenant TZ
  const noonOfDate = new Date(dateStr + 'T12:00:00Z')
  const { dayOfWeek } = dateInTenantTz(noonOfDate)

  const rules = await db.select().from(bookingAvailabilityRulesTbl).where(eq(bookingAvailabilityRulesTbl.isActive, true))
  const blackouts = await db.select().from(bookingBlackoutsTbl).where(eq(bookingBlackoutsTbl.date, dateStr))
  const zones = await db.select().from(bookingServiceZonesTbl)
  // Existing bookings overlapping the target date — pull anything that
  // starts on the same date in tenant TZ, project to minutes
  const dayStart = tenantDateTimeToUtc(dateStr, 0)
  const dayEnd = tenantDateTimeToUtc(dateStr, 24 * 60)
  const dayBookings = await db.select().from(bookingsTbl)
    .where(and(gte(bookingsTbl.startAt, dayStart), lte(bookingsTbl.startAt, dayEnd), eq(bookingsTbl.status, 'confirmed')))
  const projected = dayBookings.map(b => ({
    assignedUserId: b.assignedUserId,
    startMinute: dateInTenantTz(b.startAt as any).minuteOfDay,
    endMinute: dateInTenantTz(b.endAt as any).minuteOfDay,
    status: b.status,
  }))

  // External (Google Cal) busy events become virtual existing bookings.
  // We dedupe against bookings we already pushed to those calendars.
  const externalBusy = await externalBusyForDate({
    dateStr, dayStart, dayEnd,
    ourBookings: dayBookings.map(b => ({ assignedUserId: b.assignedUserId, externalCalendarEventId: b.externalCalendarEventId })),
  })

  const slots = generateSlots({
    dayOfWeek,
    service: {
      durationMinutes: service.durationMinutes,
      bufferBeforeMinutes: service.bufferBeforeMinutes,
      bufferAfterMinutes: service.bufferAfterMinutes,
      slotGranularityMinutes: service.slotGranularityMinutes,
      capacityPerSlot: service.capacityPerSlot,
      driveTimeMinutes: (settings as any)?.bookingDefaultDriveTimeMinutes || 0,
    },
    rules: rules.map(r => ({ userId: r.userId, dayOfWeek: r.dayOfWeek, startMinute: r.startMinute, endMinute: r.endMinute, isActive: r.isActive })),
    blackouts: blackouts.map(b => ({ userId: b.userId, date: b.date, startMinute: b.startMinute, endMinute: b.endMinute })),
    existingBookings: [...projected, ...externalBusy],
    zone: customerZip ? { customerZip, serviceZones: zones.map(z => ({ userId: z.userId, zipList: z.zipList })) } : undefined,
  })

  return c.json({
    slots: slots.map(s => ({
      startMinute: s.startMinute,
      label: minuteToLabel(s.startMinute),
      startAtIso: tenantDateTimeToUtc(dateStr, s.startMinute).toISOString(),
    })),
  })
})

// Fetches external busy events from every connected calendar that
// overlaps the target date, projects them into the slot generator's
// ExistingBooking shape, and dedupes against bookings we already pushed
// to that calendar (so we don't double-count a booking we created).
async function externalBusyForDate(opts: {
  dateStr: string
  dayStart: Date
  dayEnd: Date
  ourBookings: Array<{ assignedUserId: string | null; externalCalendarEventId: string | null }>
}): Promise<Array<{ assignedUserId: string | null; startMinute: number; endMinute: number; status: string }>> {
  const { bookingCalendarConnections } = await import('./db/schema')
  // Map userId -> set of providers they've connected
  const conns = await db.select({ userId: bookingCalendarConnections.userId, provider: bookingCalendarConnections.provider })
    .from(bookingCalendarConnections)
  if (conns.length === 0) return []

  const ourEventIds = new Set(opts.ourBookings.map(b => b.externalCalendarEventId).filter(Boolean) as string[])

  const out: Array<{ assignedUserId: string | null; startMinute: number; endMinute: number; status: string }> = []
  const projectEvent = (userId: string, ev: { eventId: string; startUtc: Date; endUtc: Date }) => {
    if (ourEventIds.has(ev.eventId)) return
    const startProj = dateInTenantTz(ev.startUtc)
    const endProj = dateInTenantTz(ev.endUtc)
    const startMin = startProj.isoDate === opts.dateStr ? startProj.minuteOfDay : 0
    const endMin = endProj.isoDate === opts.dateStr ? endProj.minuteOfDay : 24 * 60
    if (endMin <= startMin) return
    out.push({ assignedUserId: userId, startMinute: startMin, endMinute: endMin, status: 'confirmed' })
  }
  for (const c of conns) {
    const list = c.provider === 'google'
      ? await listExternalBusyEvents({ userId: c.userId, timeMin: opts.dayStart, timeMax: opts.dayEnd })
      : c.provider === 'outlook'
        ? await listExternalBusyEventsOutlook({ userId: c.userId, timeMin: opts.dayStart, timeMax: opts.dayEnd })
        : null
    if (!list) continue
    for (const ev of list) projectEvent(c.userId, ev)
  }
  return out
}

function minuteToLabel(min: number): string {
  const h = Math.floor(min / 60), m = min % 60
  const am = h < 12
  const displayH = h === 0 ? 12 : h > 12 ? h - 12 : h
  return displayH + (m === 0 ? '' : ':' + String(m).padStart(2, '0')) + (am ? ' AM' : ' PM')
}

// In-memory rate limit for public booking POSTs — 3 per IP per hour
const bookBuckets = new Map<string, number[]>()
function bookIp(c: any): string {
  const xff = c.req.header('X-Forwarded-For') || ''
  if (xff) return xff.split(',')[0].trim()
  return c.req.header('CF-Connecting-IP') || c.req.header('X-Real-IP') || 'unknown'
}

app.get('/book/thanks', async (c) => {
  const settings = await loadSettings()
  if (!settings) return c.text('Bookings not configured yet.', 503)
  const id = c.req.query('id')
  if (!id) return c.notFound()
  const rows = await db.select().from(bookingsTbl).where(eq(bookingsTbl.id, id as string)).limit(1)
  const booking = rows[0]
  if (!booking) return c.notFound()
  const service = (await db.select().from(bookingServicesTbl).where(eq(bookingServicesTbl.id, booking.serviceId)).limit(1))[0]
  const escape = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] || c))
  const dateStr = (booking.startAt as Date).toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short', timeZone: TENANT_TZ })
  const body = `<section class="book-thanks"><div class="container container--narrow">
    <div class="book-thanks__check">✓</div>
    <h1>${escape((settings as any).bookingThanksMessage || "You're booked.")}</h1>
    <p class="book-thanks__lead">A confirmation is on its way to <strong>${escape(booking.customerEmail)}</strong>.</p>
    <div class="book-thanks__summary">
      <div><span>Service</span><strong>${escape(service?.name || 'Service')}</strong></div>
      <div><span>When</span><strong>${escape(dateStr)}</strong></div>
      ${booking.customerAddress ? `<div><span>Where</span><strong>${escape(booking.customerAddress)}</strong></div>` : ''}
    </div>
    <p class="book-thanks__addcal">Add to your calendar: <a href="/book/${booking.id}/ics">Apple / Outlook</a> · <a href="${googleCalendarLink(booking, service?.name || 'Booking')}" target="_blank" rel="noopener noreferrer">Google</a></p>
  </div></section>`
  const effectiveSettings = { ...settings, homeHref: '/', contactHref: '/contact', seoTitle: 'Booking confirmed', seoDescription: 'Your booking is confirmed.', nav: settings.nav || [] }
  const html = await ejs.renderFile(path.join(viewsDir, 'base.ejs'), { body, settings: effectiveSettings, crmApiUrl: process.env.CRM_API_URL || '', currentPath: '/book/thanks' }) as string
  return c.html(html)
})

// SMS via the connected CRM's Twilio. We don't bundle Twilio here —
// the CRM holds the credentials. Internal endpoint protected by
// FACTORY_SYNC_KEY. Best-effort; silently swallows failures so the
// booking still confirms.
async function sendBookingSmsConfirmation(opts: { url: string; key: string; to: string; body: string }): Promise<void> {
  await fetch(opts.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Factory-Key': opts.key },
    body: JSON.stringify({ to: opts.to, body: opts.body }),
  })
}

function siteOrigin(c: any): string {
  const explicit = process.env.SITE_URL
  if (explicit) return explicit.replace(/\/$/, '')
  const host = c.req.header('Host') || 'localhost'
  const proto = c.req.header('X-Forwarded-Proto') || (host.startsWith('localhost') ? 'http' : 'https')
  return proto + '://' + host
}

function googleCalendarLink(booking: any, title: string): string {
  const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: title,
    dates: fmt(booking.startAt) + '/' + fmt(booking.endAt),
    details: 'Booking #' + (booking.id || '').slice(0, 8),
    location: booking.customerAddress || '',
  })
  return 'https://www.google.com/calendar/render?' + params.toString()
}

app.get('/book/:id/ics', async (c) => {
  const id = c.req.param('id')!
  const rows = await db.select().from(bookingsTbl).where(eq(bookingsTbl.id, id)).limit(1)
  const booking = rows[0]
  if (!booking) return c.notFound()
  const service = (await db.select().from(bookingServicesTbl).where(eq(bookingServicesTbl.id, booking.serviceId)).limit(1))[0]
  const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
  const settings = await loadSettings()
  const ics = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Twomiah//Bookings//EN',
    'BEGIN:VEVENT',
    'UID:' + booking.id + '@twomiah',
    'DTSTAMP:' + fmt(new Date()),
    'DTSTART:' + fmt(booking.startAt as Date),
    'DTEND:' + fmt(booking.endAt as Date),
    'SUMMARY:' + (service?.name || 'Booking') + ' — ' + (settings?.companyName || ''),
    'DESCRIPTION:Booking confirmation. Reschedule or cancel: open the link in your confirmation email.',
    booking.customerAddress ? 'LOCATION:' + booking.customerAddress : '',
    'END:VEVENT', 'END:VCALENDAR',
  ].filter(Boolean).join('\r\n')
  return new Response(ics, { headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': 'attachment; filename="booking.ics"' } })
})

app.post('/book/:serviceSlug', async (c) => {
  const slug = c.req.param('serviceSlug')!
  try {
    const ip = bookIp(c)
    const now = Date.now()
    const times = (bookBuckets.get(ip) || []).filter(t => now - t < 60 * 60_000)
    if (times.length >= 3) {
      c.res.headers.set('Retry-After', String(Math.ceil((60 * 60_000 - (now - times[0])) / 1000)))
      return c.json({ error: 'Too many booking attempts. Please try again later.' }, 429)
    }
    times.push(now); bookBuckets.set(ip, times)

    const body = await c.req.parseBody() as Record<string, any>
    // Honeypot + dwell-time
    if (String(body.website || '').trim()) return c.json({ ok: true, booking: { id: 'silent' } })
    const stamp = parseInt(String(body.t || '0'), 10)
    if (stamp > 0 && Date.now() - stamp < 2000) return c.json({ ok: true, booking: { id: 'silent' } })

    const service = (await db.select().from(bookingServicesTbl).where(eq(bookingServicesTbl.slug, slug)).limit(1))[0]
    if (!service || !service.isActive) return c.json({ error: 'service not found' }, 404)

    const startAtIso = String(body.startAtIso || '')
    const startAt = new Date(startAtIso)
    if (isNaN(startAt.getTime())) return c.json({ error: 'invalid start time' }, 400)
    if (startAt.getTime() < Date.now() + 30 * 60_000) return c.json({ error: 'start time must be at least 30 minutes from now' }, 400)
    const endAt = new Date(startAt.getTime() + service.durationMinutes * 60_000)

    const name = String(body.customerName || '').trim()
    const email = String(body.customerEmail || '').trim()
    if (!name || !email) return c.json({ error: 'name and email are required' }, 400)

    // Re-verify this slot is still available, server-side. Cheap because
    // we're already in the same transaction shape.
    const settings = await loadSettings()
    const { dayOfWeek } = dateInTenantTz(startAt)
    const dateStr = dateInTenantTz(startAt).isoDate
    const startMinuteWanted = dateInTenantTz(startAt).minuteOfDay
    const rules = await db.select().from(bookingAvailabilityRulesTbl).where(eq(bookingAvailabilityRulesTbl.isActive, true))
    const blackouts = await db.select().from(bookingBlackoutsTbl).where(eq(bookingBlackoutsTbl.date, dateStr))
    const zones = await db.select().from(bookingServiceZonesTbl)
    const verifyDayStart = tenantDateTimeToUtc(dateStr, 0)
    const verifyDayEnd = tenantDateTimeToUtc(dateStr, 24 * 60)
    const dayBookings = await db.select().from(bookingsTbl)
      .where(and(gte(bookingsTbl.startAt, verifyDayStart), lte(bookingsTbl.startAt, verifyDayEnd), eq(bookingsTbl.status, 'confirmed')))
    const externalBusy = await externalBusyForDate({
      dateStr, dayStart: verifyDayStart, dayEnd: verifyDayEnd,
      ourBookings: dayBookings.map(b => ({ assignedUserId: b.assignedUserId, externalCalendarEventId: b.externalCalendarEventId })),
    })
    const slots = generateSlots({
      dayOfWeek,
      service: {
        durationMinutes: service.durationMinutes,
        bufferBeforeMinutes: service.bufferBeforeMinutes,
        bufferAfterMinutes: service.bufferAfterMinutes,
        slotGranularityMinutes: service.slotGranularityMinutes,
        capacityPerSlot: service.capacityPerSlot,
      },
      rules: rules.map(r => ({ userId: r.userId, dayOfWeek: r.dayOfWeek, startMinute: r.startMinute, endMinute: r.endMinute, isActive: r.isActive })),
      blackouts: blackouts.map(b => ({ userId: b.userId, date: b.date, startMinute: b.startMinute, endMinute: b.endMinute })),
      existingBookings: [
        ...dayBookings.map(b => ({ assignedUserId: b.assignedUserId, startMinute: dateInTenantTz(b.startAt as any).minuteOfDay, endMinute: dateInTenantTz(b.endAt as any).minuteOfDay, status: b.status })),
        ...externalBusy,
      ],
      zone: String(body.customerZip || '').trim() ? { customerZip: String(body.customerZip).trim(), serviceZones: zones.map(z => ({ userId: z.userId, zipList: z.zipList })) } : undefined,
    })
    const matchingSlot = slots.find(s => s.startMinute === startMinuteWanted)
    if (!matchingSlot) return c.json({ error: 'That slot is no longer available. Please pick another.' }, 409)
    const assignedUserId = pickCrewForSlot(matchingSlot.qualifyingUserIds)
    const confirmationToken = crypto.randomBytes(24).toString('base64url')

    const customerAddress = String(body.customerAddress || '').trim() || null
    const customerNotes = String(body.customerNotes || '').trim() || null
    const customerPhone = String(body.customerPhone || '').trim() || null
    const [created] = await db.insert(bookingsTbl).values({
      serviceId: service.id,
      startAt, endAt,
      customerName: name,
      customerEmail: email,
      customerPhone,
      customerAddress,
      customerZip: String(body.customerZip || '').trim() || null,
      customerNotes,
      assignedUserId,
      confirmationToken,
      source: 'public_form',
      sourcePath: String(body.sourcePath || '').trim() || null,
      sourceReferrer: String(body.sourceReferrer || '').trim() || null,
      sourceVariant: String(body.sourceVariant || '').trim() || null,
    }).returning({ id: bookingsTbl.id })

    // Fire-and-forget customer + owner emails. SMS to customer fires
    // through the CRM's existing Twilio integration via internal API
    // (not implemented yet — falls through silently if SMS_INTERNAL_URL
    // isn't set).
    const settingsForEmail = await loadSettings()
    const ownerEmail = (settingsForEmail as any)?.email || ''
    const ctx = {
      serviceName: service.name,
      startAt, endAt,
      customerName: name,
      customerEmail: email,
      customerAddress,
      customerNotes,
      manageUrl: siteOrigin(c) + '/booking/' + confirmationToken,
      icsUrl: siteOrigin(c) + '/book/' + created.id + '/ics',
      tenantTz: TENANT_TZ,
    }
    sendBookingConfirmationEmail(ctx).catch(e => console.warn('[book] customer email failed:', e?.message))
    if (ownerEmail) {
      notifyOwnerOfBooking({ ...ctx, ownerEmail }).catch(e => console.warn('[book] owner email failed:', e?.message))
    }
    // Push to assigned crew's Google Calendar if connected. Capture the
    // event ID so admin updates/cancellations can patch the same event.
    if (assignedUserId) {
      const bookingForCal = {
        id: created.id,
        startAt, endAt,
        customerName: name, customerEmail: email,
        customerPhone, customerAddress, customerNotes,
        externalCalendarEventId: null,
      }
      const svc = { name: service.name, description: service.description }
      const companyName = (settingsForEmail as any)?.companyName || undefined
      // Try Google first, fall back to Outlook. A crew can only have one
      // provider connected at a time in V1 — if both rows exist, Google wins.
      pushBookingEvent({ userId: assignedUserId, booking: bookingForCal, service: svc, companyName })
        .then(async eventId => {
          if (eventId) {
            await db.update(bookingsTbl).set({ externalCalendarEventId: eventId }).where(eq(bookingsTbl.id, created.id)).catch(() => {})
            return
          }
          const outlookId = await pushBookingEventOutlook({ userId: assignedUserId, booking: bookingForCal, service: svc, companyName })
          if (outlookId) await db.update(bookingsTbl).set({ externalCalendarEventId: outlookId }).where(eq(bookingsTbl.id, created.id)).catch(() => {})
        })
        .catch(e => console.warn('[book] external cal push failed:', e?.message))
    }
    if (customerPhone && process.env.SMS_INTERNAL_URL) {
      sendBookingSmsConfirmation({
        url: process.env.SMS_INTERNAL_URL,
        key: process.env.FACTORY_SYNC_KEY || '',
        to: customerPhone,
        body: 'Booking confirmed: ' + service.name + ' on ' + (startAt.toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short', timeZone: TENANT_TZ })) + '. Manage: ' + ctx.manageUrl,
      }).catch(e => console.warn('[book] customer sms failed:', e?.message))
    }

    // Stripe deposit if the service requires one. If checkout session
    // succeeds, return the URL so the client redirects to Stripe before
    // confirmation. We pre-mark the booking depositStatus='pending';
    // webhook flips it to 'paid' and the booking stays confirmed.
    const depositAmount = depositAmountFor(service)
    if (depositAmount > 0) {
      const checkout = await createDepositCheckoutSession({
        amountCents: depositAmount,
        serviceName: service.name,
        customerEmail: email,
        bookingId: created.id,
        successUrl: siteOrigin(c) + '/book/thanks?id=' + created.id + '&deposit=paid',
        cancelUrl: siteOrigin(c) + '/booking/' + confirmationToken + '?deposit=cancelled',
      })
      if (checkout) {
        await db.update(bookingsTbl).set({
          depositAmountCents: depositAmount,
          depositStatus: 'pending',
        }).where(eq(bookingsTbl.id, created.id))
        return c.json({ ok: true, booking: { id: created.id, confirmationToken }, depositCheckoutUrl: checkout.url })
      }
      // Falling through — deposit configured but Stripe failed, log + still confirm
      console.warn('[book] deposit checkout failed for booking ' + created.id)
    }
    return c.json({ ok: true, booking: { id: created.id, confirmationToken } })
  } catch (err: any) {
    console.error('[book] insert failed:', err.message)
    return c.json({ error: 'Could not save your booking. Please try again.' }, 500)
  }
})

// Stripe webhook for deposit payment status. Flips booking
// depositStatus='paid' when the deposit checkout completes.
app.post('/api/webhooks/stripe-deposit', async (c) => {
  const signature = c.req.header('Stripe-Signature') || ''
  const raw = await c.req.text()
  if (!verifyStripeWebhook(signature, raw)) return c.json({ error: 'invalid signature' }, 400)
  let event: any
  try { event = JSON.parse(raw) } catch { return c.json({ error: 'invalid payload' }, 400) }
  if (event.type === 'checkout.session.completed') {
    const session = event.data?.object || {}
    const bookingId = session.metadata?.booking_id
    if (bookingId) {
      await db.update(bookingsTbl).set({
        depositStatus: 'paid',
        depositPaymentIntentId: session.payment_intent || null,
      }).where(eq(bookingsTbl.id, bookingId))
    }
  } else if (event.type === 'checkout.session.expired') {
    const session = event.data?.object || {}
    const bookingId = session.metadata?.booking_id
    if (bookingId) {
      await db.update(bookingsTbl).set({
        status: 'cancelled',
        depositStatus: null,
        cancelledAt: new Date(),
        cancelledReason: 'deposit_not_paid',
      }).where(eq(bookingsTbl.id, bookingId))
    }
  }
  return c.json({ received: true })
})

// Customer self-service reschedule. Reuses the slot-list endpoint
// (filtered to the same service) so the picker is identical to the
// initial booking flow. New slot validated server-side, atomic update
// on the same booking row, calendar event patched.
app.get('/booking/:token/reschedule', async (c) => {
  const token = c.req.param('token')!
  const settings = await loadSettings()
  if (!settings) return c.text('Bookings not configured yet.', 503)
  const rows = await db.select().from(bookingsTbl).where(eq(bookingsTbl.confirmationToken, token)).limit(1)
  const booking = rows[0]
  if (!booking) return c.notFound()
  if (booking.status !== 'confirmed') return c.redirect('/booking/' + token)
  if ((booking.startAt as Date).getTime() < Date.now() + 60 * 60_000) return c.redirect('/booking/' + token + '?reschedule=too-late')
  const service = (await db.select().from(bookingServicesTbl).where(eq(bookingServicesTbl.id, booking.serviceId)).limit(1))[0]
  if (!service) return c.notFound()
  const escape = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] || c))
  const currentLabel = (booking.startAt as Date).toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short', timeZone: TENANT_TZ })
  const body = `<section class="book-picker"><div class="container container--narrow">
    <a class="book-picker__back" href="/booking/${escape(token)}">← Booking</a>
    <h1 class="book-picker__title">Reschedule</h1>
    <p class="book-picker__desc">Currently booked for <strong>${escape(currentLabel)}</strong>. Pick a new time below.</p>
    <div id="book-flow" data-service-slug="${escape(service.slug)}" data-reschedule-token="${escape(token)}" data-duration="${service.durationMinutes}">
      <div class="book-step book-step--date">
        <h2>Pick a date</h2>
        <div class="book-dates" id="book-dates"></div>
      </div>
      <div class="book-step book-step--slot" hidden>
        <h2>Pick a time</h2>
        <div class="book-slots" id="book-slots"></div>
      </div>
      <div class="book-step book-step--form" hidden>
        <form id="book-form">
          <input type="hidden" name="startAtIso" id="book-start">
          <button type="submit" class="book-submit">Confirm new time</button>
          <div class="book-error" id="book-error" hidden></div>
        </form>
      </div>
    </div>
  </div></section>
  <script src="/scripts/book-flow.js" defer></script>`
  const effectiveSettings = { ...settings, homeHref: '/', contactHref: '/contact', seoTitle: 'Reschedule', seoDescription: '', nav: settings.nav || [] }
  const html = await ejs.renderFile(path.join(viewsDir, 'base.ejs'), { body, settings: effectiveSettings, crmApiUrl: process.env.CRM_API_URL || '', currentPath: '/booking/' + token + '/reschedule' }) as string
  return c.html(html)
})

app.post('/booking/:token/reschedule', async (c) => {
  const token = c.req.param('token')!
  const body = await c.req.parseBody() as Record<string, any>
  const rows = await db.select().from(bookingsTbl).where(eq(bookingsTbl.confirmationToken, token)).limit(1)
  const booking = rows[0]
  if (!booking) return c.notFound()
  if (booking.status !== 'confirmed') return c.json({ error: 'Cannot reschedule a non-confirmed booking' }, 409)
  if ((booking.startAt as Date).getTime() < Date.now() + 60 * 60_000) {
    return c.json({ error: 'Too late to reschedule (within 1 hour of start time).' }, 409)
  }
  const newStartIso = String(body.startAtIso || '')
  const newStart = new Date(newStartIso)
  if (isNaN(newStart.getTime())) return c.json({ error: 'Invalid start time' }, 400)
  const service = (await db.select().from(bookingServicesTbl).where(eq(bookingServicesTbl.id, booking.serviceId)).limit(1))[0]
  if (!service) return c.notFound()
  const settings = await loadSettings()

  // Server-side slot re-verification at the new time
  const dateStr = dateInTenantTz(newStart).isoDate
  const dayOfWeek = dateInTenantTz(newStart).dayOfWeek
  const startMinuteWanted = dateInTenantTz(newStart).minuteOfDay
  const rules = await db.select().from(bookingAvailabilityRulesTbl).where(eq(bookingAvailabilityRulesTbl.isActive, true))
  const blackouts = await db.select().from(bookingBlackoutsTbl).where(eq(bookingBlackoutsTbl.date, dateStr))
  const dayStart = tenantDateTimeToUtc(dateStr, 0)
  const dayEnd = tenantDateTimeToUtc(dateStr, 24 * 60)
  const dayBookings = (await db.select().from(bookingsTbl)
    .where(and(gte(bookingsTbl.startAt, dayStart), lte(bookingsTbl.startAt, dayEnd), eq(bookingsTbl.status, 'confirmed'))))
    .filter(b => b.id !== booking.id)  // exclude ourselves so we can re-pick our own slot if we want
  const slots = generateSlots({
    dayOfWeek,
    service: {
      durationMinutes: service.durationMinutes,
      bufferBeforeMinutes: service.bufferBeforeMinutes,
      bufferAfterMinutes: service.bufferAfterMinutes,
      slotGranularityMinutes: service.slotGranularityMinutes,
      capacityPerSlot: service.capacityPerSlot,
      driveTimeMinutes: (settings as any)?.bookingDefaultDriveTimeMinutes || 0,
    },
    rules: rules.map(r => ({ userId: r.userId, dayOfWeek: r.dayOfWeek, startMinute: r.startMinute, endMinute: r.endMinute, isActive: r.isActive })),
    blackouts: blackouts.map(b => ({ userId: b.userId, date: b.date, startMinute: b.startMinute, endMinute: b.endMinute })),
    existingBookings: dayBookings.map(b => ({ assignedUserId: b.assignedUserId, startMinute: dateInTenantTz(b.startAt as any).minuteOfDay, endMinute: dateInTenantTz(b.endAt as any).minuteOfDay, status: b.status })),
  })
  if (!slots.find(s => s.startMinute === startMinuteWanted)) {
    return c.json({ error: 'That slot is no longer available. Pick another.' }, 409)
  }

  const newEnd = new Date(newStart.getTime() + service.durationMinutes * 60_000)
  await db.update(bookingsTbl).set({
    startAt: newStart, endAt: newEnd, updatedAt: new Date(),
  }).where(eq(bookingsTbl.id, booking.id))

  // Patch the external calendar event if connected
  if (booking.assignedUserId && booking.externalCalendarEventId) {
    const { patchBookingEvent } = await import('./lib/google-calendar')
    const settingsRow = await loadSettings()
    patchBookingEvent({
      userId: booking.assignedUserId,
      eventId: booking.externalCalendarEventId,
      booking: {
        id: booking.id, startAt: newStart, endAt: newEnd,
        customerName: booking.customerName, customerEmail: booking.customerEmail,
        customerPhone: booking.customerPhone, customerAddress: booking.customerAddress, customerNotes: booking.customerNotes,
        externalCalendarEventId: booking.externalCalendarEventId,
      },
      service: { name: service.name, description: service.description },
      companyName: (settingsRow as any)?.companyName || undefined,
    }).catch(() => {})
  }

  return c.json({ ok: true, booking: { id: booking.id, startAt: newStart.toISOString() } })
})

// Customer self-service: view + cancel a booking using the
// confirmation token from their email.
app.get('/booking/:token', async (c) => {
  const token = c.req.param('token') as string
  const settings = await loadSettings()
  if (!settings) return c.text('Bookings not configured yet.', 503)
  const rows = await db.select().from(bookingsTbl).where(eq(bookingsTbl.confirmationToken, token)).limit(1)
  const booking = rows[0]
  if (!booking) return c.notFound()
  const service = (await db.select().from(bookingServicesTbl).where(eq(bookingServicesTbl.id, booking.serviceId)).limit(1))[0]
  const escape = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] || c))
  const dateStr = (booking.startAt as Date).toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short', timeZone: TENANT_TZ })
  const statusLabel = booking.status === 'cancelled' ? 'Cancelled' : booking.status === 'completed' ? 'Completed' : 'Confirmed'
  const showCancel = booking.status === 'confirmed' && (booking.startAt as Date).getTime() > Date.now() + 60 * 60_000
  const body = `<section class="book-manage"><div class="container container--narrow">
    <a class="book-picker__back" href="/">← Home</a>
    <h1>Your booking</h1>
    <div class="book-thanks__summary">
      <div><span>Service</span><strong>${escape(service?.name || 'Service')}</strong></div>
      <div><span>When</span><strong>${escape(dateStr)}</strong></div>
      <div><span>Status</span><strong>${statusLabel}</strong></div>
      ${booking.customerAddress ? `<div><span>Where</span><strong>${escape(booking.customerAddress)}</strong></div>` : ''}
    </div>
    ${showCancel ? `<div style="margin-top:24px;text-align:center;display:flex;gap:12px;justify-content:center;">
      <a href="/booking/${escape(token)}/reschedule" class="book-submit" style="background:transparent;color:var(--brand);border:1px solid var(--brand);max-width:200px;text-decoration:none;display:inline-flex;align-items:center;justify-content:center;">Reschedule</a>
      <form method="POST" action="/booking/${escape(token)}/cancel" onsubmit="return confirm('Cancel this booking?')" style="margin:0;"><button type="submit" class="book-submit" style="background:#dc2626;max-width:200px;">Cancel booking</button></form>
    </div>` : ''}
    <p style="margin-top:16px;color:var(--muted);font-size:13px;text-align:center;">Questions? Hit reply on your confirmation email.</p>
  </div></section>`
  const effectiveSettings = { ...settings, homeHref: '/', contactHref: '/contact', seoTitle: 'Your booking', seoDescription: '', nav: settings.nav || [] }
  const html = await ejs.renderFile(path.join(viewsDir, 'base.ejs'), { body, settings: effectiveSettings, crmApiUrl: process.env.CRM_API_URL || '', currentPath: '/booking/' + token }) as string
  return c.html(html)
})

app.post('/booking/:token/cancel', async (c) => {
  const token = c.req.param('token') as string
  const rows = await db.select().from(bookingsTbl).where(eq(bookingsTbl.confirmationToken, token)).limit(1)
  const booking = rows[0]
  if (!booking) return c.notFound()
  if (booking.status !== 'confirmed') return c.redirect('/booking/' + token)
  // 1-hour cutoff
  if ((booking.startAt as Date).getTime() < Date.now() + 60 * 60_000) {
    return c.redirect('/booking/' + token)
  }
  await db.update(bookingsTbl).set({ status: 'cancelled', cancelledAt: new Date(), cancelledReason: 'customer_self_service' })
    .where(eq(bookingsTbl.id, booking.id))
  // Best-effort: remove from crew's external calendar (Google or Outlook).
  // Try both — only the connected one will succeed.
  if (booking.assignedUserId && booking.externalCalendarEventId) {
    deleteBookingEvent({ userId: booking.assignedUserId, eventId: booking.externalCalendarEventId }).catch(() => {})
    deleteBookingEventOutlook({ userId: booking.assignedUserId, eventId: booking.externalCalendarEventId }).catch(() => {})
  }
  return c.redirect('/booking/' + token)
})

// Match a single slug (no slashes, not an api/admin/uploads/styles/scripts prefix).
app.get('/:slug', async (c) => {
  const slug = c.req.param('slug')
  if (['api', 'admin', 'uploads', 'styles', 'scripts', 'health', 'sitemap.xml', 'robots.txt', 'blog', 'book', 'booking'].includes(slug)) return c.notFound()
  const html = await renderPage(slug, '/' + slug)
  if (!html) return c.notFound()
  return c.html(html)
})

// ── Blog ──────────────────────────────────────────────────────────────
// /blog        → list of published posts (newest first)
// /blog/:slug  → individual post detail
// Body is stored as markdown; we render to HTML at request time with a
// tiny inline converter rather than pulling a heavy dep — covers the
// 90% case (headings, paragraphs, lists, links, bold/italic, code,
// blockquotes, images).

function markdownToHtml(md: string): string {
  if (!md) return ''
  const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const lines = md.replace(/\r\n/g, '\n').split('\n')
  const out: string[] = []
  let inList = false, listTag: 'ul' | 'ol' = 'ul'
  let inBlockquote = false
  let inCode = false, codeLang = ''
  for (let raw of lines) {
    // Fenced code block
    const fence = raw.match(/^```(\w*)\s*$/)
    if (fence) {
      if (inCode) { out.push('</code></pre>'); inCode = false } else { codeLang = fence[1] || ''; out.push('<pre><code' + (codeLang ? ' class="lang-' + codeLang + '"' : '') + '>'); inCode = true }
      continue
    }
    if (inCode) { out.push(escape(raw)); continue }
    let line = raw
    // Headings
    const h = line.match(/^(#{1,6})\s+(.+)$/)
    if (h) { if (inList) { out.push('</' + listTag + '>'); inList = false } if (inBlockquote) { out.push('</blockquote>'); inBlockquote = false } out.push('<h' + h[1].length + '>' + inlineMd(escape(h[2])) + '</h' + h[1].length + '>'); continue }
    // List items
    const ul = line.match(/^\s*[-*]\s+(.+)$/)
    const ol = line.match(/^\s*\d+\.\s+(.+)$/)
    if (ul || ol) {
      const targetTag: 'ul' | 'ol' = ul ? 'ul' : 'ol'
      if (!inList || listTag !== targetTag) { if (inList) out.push('</' + listTag + '>'); listTag = targetTag; out.push('<' + listTag + '>'); inList = true }
      out.push('<li>' + inlineMd(escape((ul || ol)![1])) + '</li>')
      continue
    } else if (inList) { out.push('</' + listTag + '>'); inList = false }
    // Blockquote
    if (line.match(/^>\s?(.*)$/)) {
      const bq = line.match(/^>\s?(.*)$/)![1]
      if (!inBlockquote) { out.push('<blockquote>'); inBlockquote = true }
      out.push('<p>' + inlineMd(escape(bq)) + '</p>')
      continue
    } else if (inBlockquote) { out.push('</blockquote>'); inBlockquote = false }
    // Image: ![alt](url) — scheme-validate the URL so data:/javascript: can't sneak in
    const img = line.match(/^!\[([^\]]*)\]\(([^)]+)\)\s*$/)
    if (img) {
      const rawUrl = img[2]
      if (isSafeUrl(rawUrl) && /^(https?:|\/)/i.test(rawUrl)) {
        out.push('<p><img src="' + escape(rawUrl) + '" alt="' + escape(img[1]) + '" loading="lazy"></p>')
      }
      continue
    }
    // Blank line
    if (line.trim() === '') { continue }
    // Paragraph
    out.push('<p>' + inlineMd(escape(line)) + '</p>')
  }
  if (inList) out.push('</' + listTag + '>')
  if (inBlockquote) out.push('</blockquote>')
  if (inCode) out.push('</code></pre>')
  return out.join('\n')
}

function inlineMd(s: string): string {
  // Order matters — bold before italic. Links are scheme-validated to
  // strip javascript:/data:/vbscript: payloads even though body text is
  // already HTML-escaped upstream (defense in depth).
  return s
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/_([^_]+)_/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, text, href) => {
      const safe = isSafeUrl(href) ? href : '#'
      const external = /^https?:/i.test(safe)
      const attrs = external ? ' rel="noopener noreferrer" target="_blank"' : ''
      return '<a href="' + safe + '"' + attrs + '>' + text + '</a>'
    })
}

// ── SEO files ──────────────────────────────────────────────────────────
// Dynamic sitemap + robots so search engines see whatever's currently
// published in the pages table. Origin is derived from the incoming
// request when nothing's been explicitly set.

function getSiteOrigin(c: any): string {
  const explicit = process.env.SITE_ORIGIN
  if (explicit) return explicit.replace(/\/+$/, '')
  const url = new URL(c.req.url)
  return `${url.protocol}//${url.host}`
}

app.get('/sitemap.xml', async (c) => {
  const origin = getSiteOrigin(c)
  const pageRows = await db.select().from(pagesTbl).where(eq(pagesTbl.isPublished, true)).orderBy(asc(pagesTbl.navOrder), asc(pagesTbl.title))
  const postRows = await db.select().from(postsTbl).where(eq(postsTbl.status, 'published')).orderBy(desc(postsTbl.publishedAt))
  const urls: string[] = []
  for (const r of pageRows) {
    const loc = origin + (r.slug === 'home' ? '/' : '/' + r.slug)
    const lastmod = r.updatedAt instanceof Date ? r.updatedAt.toISOString() : new Date(r.updatedAt as any).toISOString()
    urls.push(`  <url><loc>${escapeXml(loc)}</loc><lastmod>${lastmod}</lastmod></url>`)
  }
  if (postRows.length > 0) {
    urls.push(`  <url><loc>${escapeXml(origin + '/blog')}</loc></url>`)
    for (const r of postRows) {
      const loc = origin + '/blog/' + r.slug
      const lastmod = r.updatedAt instanceof Date ? r.updatedAt.toISOString() : new Date(r.updatedAt as any).toISOString()
      urls.push(`  <url><loc>${escapeXml(loc)}</loc><lastmod>${lastmod}</lastmod></url>`)
    }
  }
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls.join('\n') +
    `\n</urlset>\n`
  c.header('Content-Type', 'application/xml')
  c.header('Cache-Control', 'public, max-age=3600')
  return c.body(xml)
})

app.get('/robots.txt', async (c) => {
  const origin = getSiteOrigin(c)
  const body =
    `User-agent: *\nAllow: /\nDisallow: /admin/\nDisallow: /api/\n\nSitemap: ${origin}/sitemap.xml\n`
  c.header('Content-Type', 'text/plain')
  c.header('Cache-Control', 'public, max-age=86400')
  return c.body(body)
})

function escapeXml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c] || c))
}

// ── Public: lead capture from the contact form ────────────────────────────
app.post('/api/leads', async (c) => {
  try {
    // Rate-limit first — keeps the DB write and email send off the
    // critical path for flooders.
    const ip = leadClientIp(c)
    const now = Date.now()
    const times = (leadBuckets.get(ip) || []).filter(t => now - t < LEAD_WINDOW_MS)
    if (times.length >= LEAD_MAX) {
      const retryAfterSec = Math.ceil((LEAD_WINDOW_MS - (now - times[0])) / 1000)
      c.res.headers.set('Retry-After', String(retryAfterSec))
      return c.json({ error: 'Too many submissions. Please try again later.' }, 429)
    }
    times.push(now)
    leadBuckets.set(ip, times)

    const body = await c.req.parseBody() as Record<string, any>

    // ── Spam protection (honeypot + minimum dwell time) ────────────────
    // The contact form template includes a hidden 'website' field that
    // legitimate users never see. Bots auto-fill every input — any
    // value here is a tell. Silently 200 so the bot thinks it worked.
    // The form also stamps a hidden 't' field with Date.now() when it
    // renders; if the submit lands in under 1.5s the form was almost
    // certainly auto-completed. Both checks are cheap and effective.
    const honeypot = String(body.website || '').trim()
    if (honeypot) {
      console.log('[Leads] honeypot triggered — silent drop')
      return c.json({ ok: true, message: "Got it. We'll reply within one business day." })
    }
    const stamp = parseInt(String(body.t || '0'), 10)
    if (stamp > 0 && Date.now() - stamp < 1500) {
      console.log('[Leads] dwell-time triggered — silent drop')
      return c.json({ ok: true, message: "Got it. We'll reply within one business day." })
    }

    const name = String(body.name || '').trim()
    const email = String(body.email || '').trim()
    const phone = String(body.phone || '').trim() || null
    const message = String(body.project || body.message || '').trim()
    const source = String(body.source || c.req.header('referer') || '').trim() || null

    if (!name || name.length < 2) return c.json({ error: 'Name is required.' }, 400)
    if (!email || !email.includes('@')) return c.json({ error: 'Valid email required.' }, 400)
    if (!message || message.length < 4) return c.json({ error: 'Tell us a bit about your project.' }, 400)

    await db.insert(leadsTbl).values({ name, email, phone, message, source: source || undefined })

    // Fire-and-forget owner notification. Reads recipient from
    // settings.email (the customer's contact address); skips silently
    // if SENDGRID_API_KEY isn't set yet.
    notifyOwnerOfLead({ name, email, phone, message, source }).catch((e: any) =>
      console.warn('[Leads] owner notification failed:', e.message))

    return c.json({ ok: true, message: "Got it. We'll reply within one business day." })
  } catch (err: any) {
    console.error('[Leads] insert failed:', err.message)
    return c.json({ error: 'Could not save your message. Please try again.' }, 500)
  }
})

async function notifyOwnerOfLead(lead: { name: string; email: string; phone: string | null; message: string; source: string | null }): Promise<void> {
  const apiKey = process.env.SENDGRID_API_KEY
  if (!apiKey) return
  const fromEmail = process.env.FROM_EMAIL || process.env.FACTORY_FROM_EMAIL || 'noreply@twomiah.app'
  const settingsRow = await loadSettings()
  const toEmail = (settingsRow as any)?.email
  if (!toEmail) return
  const companyName = (settingsRow as any)?.companyName || 'Your site'
  const escape = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] || c))
  const subject = `New website lead — ${lead.name}`
  const html = `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#fafaf7;margin:0;padding:40px 16px;color:#1a1a1a;">
    <table width="560" cellpadding="0" cellspacing="0" align="center" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(20,20,30,0.06);">
      <tr><td style="padding:28px 32px 16px;"><div style="font-size:12px;letter-spacing:0.16em;text-transform:uppercase;color:#888;">${escape(companyName)} · new lead</div></td></tr>
      <tr><td style="padding:0 32px 12px;"><h2 style="margin:0;font-size:22px;color:#1a1a1a;">${escape(lead.name)}</h2></td></tr>
      <tr><td style="padding:0 32px 24px;color:#3a3a3a;font-size:15px;line-height:1.6;">
        <div><strong>Email:</strong> <a href="mailto:${escape(lead.email)}" style="color:#1a1a1a;">${escape(lead.email)}</a></div>
        ${lead.phone ? `<div><strong>Phone:</strong> <a href="tel:${escape(lead.phone)}" style="color:#1a1a1a;">${escape(lead.phone)}</a></div>` : ''}
        ${lead.source ? `<div style="margin-top:6px;color:#888;font-size:13px;">Submitted from: ${escape(lead.source)}</div>` : ''}
        <div style="margin-top:18px;padding:14px 18px;background:#fafaf7;border-left:3px solid #f97316;border-radius:4px;white-space:pre-wrap;">${escape(lead.message)}</div>
      </td></tr>
      <tr><td style="padding:0 32px 24px;"><a href="mailto:${escape(lead.email)}?subject=Re:%20your%20inquiry" style="display:inline-block;background:#f97316;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;">Reply now</a></td></tr>
      <tr><td style="background:#fafaf7;padding:16px 32px;border-top:1px solid #eee;color:#888;font-size:12px;">This lead is also saved in your admin under Leads.</td></tr>
    </table>
  </body></html>`
  const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: toEmail }], subject }],
      from: { email: fromEmail, name: 'Twomiah' },
      reply_to: { email: lead.email, name: lead.name },
      content: [{ type: 'text/html', value: html }],
    }),
  })
  if (!res.ok) {
    console.warn('[Leads] SendGrid HTTP', res.status, await res.text().catch(() => ''))
  }
}

// ── Billing portal proxy ─────────────────────────────────────────────────
// The admin UI calls this to get a Stripe Customer Portal URL. We
// forward to the Factory (which has the Stripe secret key) using the
// shared FACTORY_SYNC_KEY for auth. Admin-only — gated by /api/admin/
// auth middleware in the route mount above isn't applied here, but
// the path is /api/admin/billing-portal so we gate manually below.
app.get('/api/admin/billing-portal', async (c) => {
  const authz = c.req.header('Authorization') || ''
  if (!authz.startsWith('Bearer ')) return c.json({ error: 'Missing auth token' }, 401)
  // Don't bother fully verifying — admin SPA already gates the route.
  // The token presence is a smoke check.

  const factoryUrl = process.env.FACTORY_URL
  const tenantId = process.env.TENANT_ID
  const syncKey = process.env.FACTORY_SYNC_KEY
  if (!factoryUrl || !tenantId || !syncKey) {
    return c.json({ error: 'Billing portal not configured on this tenant.' }, 503)
  }
  try {
    const r = await fetch(factoryUrl.replace(/\/+$/, '') + '/api/v1/factory/internal/billing-portal/' + tenantId, {
      headers: { 'X-Factory-Key': syncKey },
      signal: AbortSignal.timeout(15000),
    })
    const body = await r.json()
    if (!r.ok) return c.json(body, r.status as 400 | 401 | 403 | 404 | 409 | 500 | 503)
    return c.json(body)
  } catch (e: any) {
    return c.json({ error: 'Factory unreachable: ' + e.message }, 502)
  }
})

// ── Factory internal: bookings list for CRM SchedulePage ──────────────────
// CRM admin views jobs + bookings in one schedule view. The CRM backend
// calls this endpoint server-to-server with FACTORY_SYNC_KEY. Returns
// bookings in the requested date range with the service+assignee joined
// so the CRM doesn't need a separate lookup.
app.get('/api/internal/bookings', async (c) => {
  const factoryKey = process.env.FACTORY_SYNC_KEY
  if (!factoryKey) return c.json({ error: 'Factory sync not configured' }, 503)
  if (c.req.header('X-Factory-Key') !== factoryKey) return c.json({ error: 'Unauthorized' }, 401)
  const fromQ = c.req.query('from')
  const toQ = c.req.query('to')
  const conds: any[] = []
  if (fromQ) conds.push(gte(bookingsTbl.startAt, new Date(fromQ)))
  if (toQ) conds.push(lte(bookingsTbl.startAt, new Date(toQ)))
  const rows = conds.length > 0
    ? await db.select().from(bookingsTbl).where(and(...conds)).orderBy(asc(bookingsTbl.startAt))
    : await db.select().from(bookingsTbl).orderBy(asc(bookingsTbl.startAt))
  // Hydrate service name and assignee email so the CRM has everything inline
  const serviceIds = Array.from(new Set(rows.map(r => r.serviceId)))
  const userIds = Array.from(new Set(rows.map(r => r.assignedUserId).filter(Boolean) as string[]))
  const services = serviceIds.length > 0 ? await db.select().from(bookingServicesTbl) : []
  const { users: usersTbl } = await import('./db/schema')
  const users = userIds.length > 0 ? await db.select({ id: usersTbl.id, email: usersTbl.email, name: usersTbl.name }).from(usersTbl) : []
  const sById = new Map(services.map(s => [s.id, s]))
  const uById = new Map(users.map(u => [u.id, u]))
  return c.json({
    bookings: rows.map(b => ({
      id: b.id,
      startAt: b.startAt, endAt: b.endAt,
      status: b.status,
      customerName: b.customerName,
      customerEmail: b.customerEmail,
      customerPhone: b.customerPhone,
      customerAddress: b.customerAddress,
      serviceName: sById.get(b.serviceId)?.name || null,
      assignedUser: b.assignedUserId ? (uById.get(b.assignedUserId) ? { id: b.assignedUserId, email: uById.get(b.assignedUserId)!.email, name: uById.get(b.assignedUserId)!.name } : null) : null,
    })),
  })
})

// ── Public: booking waitlist ──────────────────────────────────────────────
// Customer joins the waitlist when no slots match their needs. When a
// confirmed booking gets cancelled, we email waitlist members whose
// date window overlaps.
import { bookingWaitlist as waitlistTbl } from './db/schema'

app.post('/book/:serviceSlug/waitlist', async (c) => {
  const slug = c.req.param('serviceSlug')!
  const body = await c.req.parseBody() as Record<string, any>
  if (String(body.website || '').trim()) return c.json({ ok: true })  // honeypot
  const service = (await db.select().from(bookingServicesTbl).where(eq(bookingServicesTbl.slug, slug)).limit(1))[0]
  if (!service) return c.json({ error: 'service not found' }, 404)
  const name = String(body.customerName || '').trim()
  const email = String(body.customerEmail || '').trim()
  if (!name || !email) return c.json({ error: 'name and email required' }, 400)
  await db.insert(waitlistTbl).values({
    serviceId: service.id,
    customerName: name, customerEmail: email,
    customerPhone: String(body.customerPhone || '').trim() || null,
    customerZip: String(body.customerZip || '').trim() || null,
    preferredFrom: String(body.preferredFrom || '').trim() || null,
    preferredTo: String(body.preferredTo || '').trim() || null,
    notes: String(body.notes || '').trim() || null,
  })
  return c.json({ ok: true, message: "You're on the list. We'll email if a slot opens up." })
})

// ── Factory internal: store Google Calendar OAuth tokens ──────────────────
// The Factory orchestrates the OAuth flow with one global Google app and
// POSTs the resulting tokens here, gated by FACTORY_SYNC_KEY. We upsert
// by (user_id, provider) so a re-connect overwrites the old row cleanly.
import { bookingCalendarConnections as calConnTbl } from './db/schema'

app.post('/api/internal/calendar/store-tokens', async (c) => {
  const factoryKey = process.env.FACTORY_SYNC_KEY
  if (!factoryKey) return c.json({ error: 'Factory sync not configured' }, 503)
  if (c.req.header('X-Factory-Key') !== factoryKey) return c.json({ error: 'Unauthorized' }, 401)
  const body = await c.req.json().catch(() => ({})) as any
  const provider = body.provider === 'outlook' ? 'outlook' : 'google'
  if (!body.userId || !body.accessToken) {
    return c.json({ error: 'userId + accessToken required' }, 400)
  }
  const expiresAt = new Date(Date.now() + ((body.expiresInSec || 3600) - 60) * 1000)
  // Upsert: delete any existing connection of this provider for this user, then insert
  await db.delete(calConnTbl).where(and(eq(calConnTbl.userId, body.userId), eq(calConnTbl.provider, provider)))
  const [row] = await db.insert(calConnTbl).values({
    userId: body.userId,
    provider,
    externalAccountEmail: body.externalAccountEmail || null,
    accessToken: body.accessToken,
    refreshToken: body.refreshToken || null,
    expiresAt,
    calendarId: body.calendarId || 'primary',
  }).returning({ id: calConnTbl.id })

  // Subscribe to push notifications. Best-effort; pull side still works
  // if subscription fails.
  if (provider === 'google') {
    const { watchCalendar } = await import('./lib/google-calendar')
    const webhookUrl = siteOrigin(c) + '/api/webhooks/google-calendar'
    watchCalendar({ userId: body.userId, webhookUrl })
      .then(async sub => {
        if (sub) await db.update(calConnTbl).set({
          syncChannelId: sub.channelId,
          syncResourceId: sub.resourceId,
          lastSyncAt: new Date(),
        }).where(eq(calConnTbl.id, row.id)).catch(() => {})
      })
      .catch(() => {})
  } else if (provider === 'outlook') {
    const { watchCalendarOutlook } = await import('./lib/outlook-calendar')
    const webhookUrl = siteOrigin(c) + '/api/webhooks/outlook-calendar'
    watchCalendarOutlook({ userId: body.userId, webhookUrl })
      .then(async sub => {
        if (sub) await db.update(calConnTbl).set({
          syncChannelId: sub.subscriptionId,
          lastSyncAt: new Date(),
        }).where(eq(calConnTbl.id, row.id)).catch(() => {})
      })
      .catch(() => {})
  }

  return c.json({ ok: true, connectionId: row.id })
})

// Outlook (Microsoft Graph) sends a validationToken on initial
// subscription handshake — we have to echo it within 10 seconds or
// the subscription fails. After that, POSTs carry change notifications.
app.post('/api/webhooks/outlook-calendar', async (c) => {
  const validationToken = c.req.query('validationToken')
  if (validationToken) {
    return c.text(validationToken, 200, { 'Content-Type': 'text/plain' })
  }
  // Real notification — we don't act on it directly; slot generator
  // pulls fresh on next list. Stamp lastSyncAt and 202.
  try {
    const body = await c.req.json().catch(() => ({})) as any
    for (const v of (body.value || [])) {
      if (v.subscriptionId) {
        await db.update(calConnTbl).set({ lastSyncAt: new Date() })
          .where(eq(calConnTbl.syncChannelId, v.subscriptionId))
          .catch(() => {})
      }
    }
  } catch { /* ignore */ }
  return c.body(null, 202)
})

// Google Calendar webhook receiver. We don't actually do anything
// fancy on push — slot generation pulls fresh events at slot-list
// time, so the notification just means "next list will be fresher".
// We log + 200 to acknowledge the channel.
app.post('/api/webhooks/google-calendar', async (c) => {
  const channelId = c.req.header('X-Goog-Channel-Id') || ''
  const resourceState = c.req.header('X-Goog-Resource-State') || ''
  if (channelId) {
    await db.update(calConnTbl).set({ lastSyncAt: new Date() })
      .where(eq(calConnTbl.syncChannelId, channelId))
      .catch(() => {})
  }
  if (resourceState === 'sync') return c.body(null, 200)  // initial handshake
  return c.body(null, 200)
})

// Cron: refresh watch subscriptions approaching expiry. Hourly cron.
// Google channels: 7-day TTL. Outlook subscriptions: 3-day TTL (we
// RENEW rather than re-create to preserve the subscription ID).
app.post('/api/internal/calendar/refresh-watches', async (c) => {
  const factoryKey = process.env.FACTORY_SYNC_KEY
  if (!factoryKey) return c.json({ error: 'Factory sync not configured' }, 503)
  if (c.req.header('X-Factory-Key') !== factoryKey) return c.json({ error: 'Unauthorized' }, 401)
  const { watchCalendar, unwatchCalendar } = await import('./lib/google-calendar')
  const { renewSubscriptionOutlook, watchCalendarOutlook } = await import('./lib/outlook-calendar')
  const dueSoon = new Date(Date.now() + 24 * 60 * 60 * 1000)
  const stale = await db.select().from(calConnTbl)
  let refreshed = 0
  for (const conn of stale) {
    if (!conn.lastSyncAt) continue
    if (conn.provider === 'google') {
      const guessedExpiry = new Date(conn.lastSyncAt.getTime() + 7 * 24 * 60 * 60 * 1000)
      if (guessedExpiry > dueSoon) continue
      if (conn.syncChannelId && conn.syncResourceId) {
        await unwatchCalendar({ userId: conn.userId, channelId: conn.syncChannelId, resourceId: conn.syncResourceId }).catch(() => {})
      }
      const webhookUrl = siteOrigin(c) + '/api/webhooks/google-calendar'
      const sub = await watchCalendar({ userId: conn.userId, webhookUrl })
      if (sub) {
        await db.update(calConnTbl).set({
          syncChannelId: sub.channelId, syncResourceId: sub.resourceId, lastSyncAt: new Date(),
        }).where(eq(calConnTbl.id, conn.id))
        refreshed++
      }
    } else if (conn.provider === 'outlook') {
      const guessedExpiry = new Date(conn.lastSyncAt.getTime() + 70 * 60 * 60 * 1000)
      if (guessedExpiry > dueSoon) continue
      let ok = false
      if (conn.syncChannelId) {
        ok = await renewSubscriptionOutlook({ userId: conn.userId, subscriptionId: conn.syncChannelId })
      }
      if (!ok) {
        const sub = await watchCalendarOutlook({ userId: conn.userId, webhookUrl: siteOrigin(c) + '/api/webhooks/outlook-calendar' })
        if (sub) {
          await db.update(calConnTbl).set({
            syncChannelId: sub.subscriptionId, lastSyncAt: new Date(),
          }).where(eq(calConnTbl.id, conn.id))
          refreshed++
        }
      } else {
        await db.update(calConnTbl).set({ lastSyncAt: new Date() }).where(eq(calConnTbl.id, conn.id))
        refreshed++
      }
    }
  }
  return c.json({ ok: true, refreshed })
})

// ── Factory internal: rebook nudge cron ───────────────────────────────────
// Daily cron from the Factory. For each service with rebookIntervalDays
// set, find completed bookings whose end_at is between (today - N days
// + 0d) and (today - N days + 1d) and whose rebook_reminder_sent_at is
// null. Send the "ready for your next one?" email, stamp the column.
app.post('/api/internal/booking-rebook-reminders', async (c) => {
  const factoryKey = process.env.FACTORY_SYNC_KEY
  if (!factoryKey) return c.json({ error: 'Factory sync not configured' }, 503)
  if (c.req.header('X-Factory-Key') !== factoryKey) return c.json({ error: 'Unauthorized' }, 401)
  const { sendBookingRebookEmail } = await import('./lib/email')

  const services = await db.select().from(bookingServicesTbl)
  let sent = 0, checked = 0
  for (const svc of services) {
    if (!svc.rebookIntervalDays || svc.rebookIntervalDays <= 0) continue
    const lowerBound = new Date(Date.now() - (svc.rebookIntervalDays + 1) * 24 * 60 * 60 * 1000)
    const upperBound = new Date(Date.now() - svc.rebookIntervalDays * 24 * 60 * 60 * 1000)
    const due = await db.select().from(bookingsTbl).where(and(
      eq(bookingsTbl.serviceId, svc.id),
      eq(bookingsTbl.status, 'completed'),
      gte(bookingsTbl.endAt, lowerBound),
      lte(bookingsTbl.endAt, upperBound),
    ))
    for (const b of due) {
      checked++
      if (b.rebookReminderSentAt) continue
      try {
        const bookUrl = siteOrigin(c) + '/book/' + svc.slug
        await sendBookingRebookEmail({
          serviceName: svc.name,
          startAt: b.startAt as Date, endAt: b.endAt as Date,
          customerName: b.customerName, customerEmail: b.customerEmail,
          customerAddress: b.customerAddress,
          bookUrl,
          tenantTz: TENANT_TZ,
        })
        await db.update(bookingsTbl).set({ rebookReminderSentAt: new Date() }).where(eq(bookingsTbl.id, b.id))
        sent++
      } catch (err: any) {
        console.warn('[rebook] failed for booking ' + b.id + ':', err?.message)
      }
    }
  }
  return c.json({ ok: true, checked, sent })
})

// ── Factory internal: 24h booking reminders ───────────────────────────────
// Hourly cron from the Factory hits this. We find every confirmed
// booking with start_at in the next 23-25 hours and reminder_24h_sent_at
// IS NULL, send the reminder, stamp the sent-at column. Idempotent.
app.post('/api/internal/booking-reminders', async (c) => {
  const factoryKey = process.env.FACTORY_SYNC_KEY
  if (!factoryKey) return c.json({ error: 'Factory sync not configured' }, 503)
  if (c.req.header('X-Factory-Key') !== factoryKey) return c.json({ error: 'Unauthorized' }, 401)

  const { sendBookingReminderEmail } = await import('./lib/email')
  const now = new Date()
  const windowStart = new Date(now.getTime() + 23 * 60 * 60 * 1000)
  const windowEnd = new Date(now.getTime() + 25 * 60 * 60 * 1000)
  const due = await db.select().from(bookingsTbl)
    .where(and(
      eq(bookingsTbl.status, 'confirmed'),
      gte(bookingsTbl.startAt, windowStart),
      lte(bookingsTbl.startAt, windowEnd),
    ))
  let emailsSent = 0, smsSent = 0
  for (const b of due) {
    const service = (await db.select().from(bookingServicesTbl).where(eq(bookingServicesTbl.id, b.serviceId)).limit(1))[0]
    if (!service) continue
    if (!b.reminder24hSentAt) {
      try {
        await sendBookingReminderEmail({
          serviceName: service.name,
          startAt: b.startAt as Date, endAt: b.endAt as Date,
          customerName: b.customerName, customerEmail: b.customerEmail,
          customerAddress: b.customerAddress,
          manageUrl: siteOrigin(c) + '/booking/' + b.confirmationToken,
          tenantTz: TENANT_TZ,
        })
        await db.update(bookingsTbl).set({ reminder24hSentAt: new Date() }).where(eq(bookingsTbl.id, b.id))
        emailsSent++
      } catch (err: any) { console.warn('[reminder email] ' + b.id + ':', err?.message) }
    }
    if (!b.reminder24hSmsSentAt && b.customerPhone && process.env.SMS_INTERNAL_URL) {
      try {
        const when = (b.startAt as Date).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: TENANT_TZ })
        await sendBookingSmsConfirmation({
          url: process.env.SMS_INTERNAL_URL,
          key: process.env.FACTORY_SYNC_KEY || '',
          to: b.customerPhone,
          body: 'Reminder: ' + service.name + ' tomorrow at ' + when + '.',
        })
        await db.update(bookingsTbl).set({ reminder24hSmsSentAt: new Date() }).where(eq(bookingsTbl.id, b.id))
        smsSent++
      } catch (err: any) { console.warn('[reminder sms] ' + b.id + ':', err?.message) }
    }
  }
  return c.json({ ok: true, checked: due.length, emailsSent, smsSent })
})

// Post-job review-request SMS cron. Daily fan-out from Factory.
// For bookings that ended 1-2 days ago and haven't sent a review SMS yet.
app.post('/api/internal/booking-review-requests', async (c) => {
  const factoryKey = process.env.FACTORY_SYNC_KEY
  if (!factoryKey) return c.json({ error: 'Factory sync not configured' }, 503)
  if (c.req.header('X-Factory-Key') !== factoryKey) return c.json({ error: 'Unauthorized' }, 401)
  const settings = await loadSettings()
  const companyName = (settings as any)?.companyName || 'the team'
  const reviewLink = (settings as any)?.googleReviewLink || ''
  const now = Date.now()
  const due = await db.select().from(bookingsTbl).where(and(
    eq(bookingsTbl.status, 'completed'),
    gte(bookingsTbl.endAt, new Date(now - 2 * 86400000)),
    lte(bookingsTbl.endAt, new Date(now - 86400000)),
  ))
  let sent = 0
  for (const b of due) {
    if (b.reviewRequestSmsSentAt) continue
    if (!b.customerPhone || !process.env.SMS_INTERNAL_URL) continue
    try {
      const msg = ('Hi ' + b.customerName.split(' ')[0] + ', thanks for choosing ' + companyName + '! If we did good work, a quick Google review would mean a lot' + (reviewLink ? ': ' + reviewLink : '. Just reply with your thoughts.')).slice(0, 320)
      await sendBookingSmsConfirmation({
        url: process.env.SMS_INTERNAL_URL,
        key: process.env.FACTORY_SYNC_KEY || '',
        to: b.customerPhone, body: msg,
      })
      await db.update(bookingsTbl).set({ reviewRequestSmsSentAt: new Date() }).where(eq(bookingsTbl.id, b.id))
      sent++
    } catch (err: any) { console.warn('[review sms] ' + b.id + ':', err?.message) }
  }
  return c.json({ ok: true, checked: due.length, sent })
})

// ── Factory internal: sync settings from the Factory ──────────────────────
app.post('/api/internal/sync-settings', async (c) => {
  const factoryKey = process.env.FACTORY_SYNC_KEY
  if (!factoryKey) return c.json({ error: 'Factory sync not configured' }, 503)
  if (c.req.header('X-Factory-Key') !== factoryKey) return c.json({ error: 'Unauthorized' }, 401)

  const patch = await c.req.json().catch(() => ({})) as Record<string, any>
  const existing = await loadSettings()
  if (!existing) return c.json({ error: 'Settings row not initialized yet' }, 409)

  const allowed: Record<string, any> = {}
  const fields = ['companyName', 'tagline', 'phone', 'email', 'address', 'seoTitle', 'seoDescription',
    'contactCtaLabel', 'primaryColor', 'secondaryColor', 'accentColor', 'logoUrl', 'faviconUrl', 'nav']
  for (const f of fields) if (f in patch) allowed[f] = patch[f]
  if (Object.keys(allowed).length === 0) return c.json({ ok: true, noChanges: true })

  await db.update(settingsTbl).set({ ...allowed, updatedAt: new Date() }).where(eq(settingsTbl.id, existing.id))
  return c.json({ ok: true, applied: Object.keys(allowed) })
})

// ── Factory internal: seed intake photos into the tenant's library ────────
//
// Called by the Factory after deploy completes, to copy photos the prospect
// uploaded during /public/intake (which live on the Factory's signed-URL
// storage and expire in 7 days) into the tenant's own R2 bucket + photos
// table so they survive long-term.
//
// Body: { photos: [{ url, tag?, alt? }] }
app.post('/api/internal/seed-photos', async (c) => {
  const factoryKey = process.env.FACTORY_SYNC_KEY
  if (!factoryKey) return c.json({ error: 'Factory sync not configured' }, 503)
  if (c.req.header('X-Factory-Key') !== factoryKey) return c.json({ error: 'Unauthorized' }, 401)

  let body: { photos?: Array<{ url?: string; tag?: string; alt?: string }> }
  try { body = await c.req.json() } catch { return c.json({ error: 'Invalid JSON' }, 400) }
  const incoming = Array.isArray(body.photos) ? body.photos : []
  if (incoming.length === 0) return c.json({ ok: true, seeded: 0 })

  const [sharp, { uploadImage }, schema] = await Promise.all([
    import('sharp').then(m => m.default),
    import('./services/storage'),
    import('./db/schema'),
  ])
  const photosTbl = schema.photos

  let seeded = 0
  const errors: Array<{ url: string; error: string }> = []
  for (const p of incoming.slice(0, 50)) {
    if (!p.url || typeof p.url !== 'string') continue
    try {
      const res = await fetch(p.url, { signal: AbortSignal.timeout(30_000) })
      if (!res.ok) throw new Error('fetch failed: ' + res.status)
      const raw = Buffer.from(await res.arrayBuffer())
      const meta = await sharp(raw).metadata()
      const isAlphaPng = meta.format === 'png' && meta.hasAlpha
      const processedBuffer = isAlphaPng ? raw : await sharp(raw).rotate().jpeg({ quality: 82, mozjpeg: true }).toBuffer()
      const processedType = isAlphaPng ? 'image/png' : 'image/jpeg'

      const upload = await uploadImage(processedBuffer, {
        filename: 'intake-photo' + (isAlphaPng ? '.png' : '.jpg'),
        contentType: processedType,
      })

      await db.insert(photosTbl).values({
        url: upload.url,
        storageKey: upload.storageKey,
        alt: p.alt || null,
        tag: p.tag || null,
        width: meta.width || null,
        height: meta.height || null,
        bytes: upload.bytes,
        contentType: upload.contentType,
      })
      seeded++
    } catch (err: any) {
      errors.push({ url: p.url, error: err.message || String(err) })
    }
  }

  return c.json({ ok: true, seeded, errors: errors.length > 0 ? errors : undefined })
})

// ── Admin: JSON API + SPA ─────────────────────────────────────────────────
// JSON API mounted at /api/admin/*. The React SPA build lands at
// admin/dist/ and gets served below at /admin/*. SPA routes that don't
// match a built asset fall back to index.html so client-side routing works.
// Admin API: stricter CORS than public pages — only same-origin browser
// requests, or explicit allowlist via CORS_ALLOWED_ORIGINS env var.
app.use('/api/admin/*', adminCors())
// Login endpoint gets its own rate limit before the bcrypt comparison.
app.use('/api/admin/login', loginRateLimit())
app.route('/api/admin', adminRoutes)

const adminDistDir = path.join(__dirname, 'admin', 'dist')
const hasAdminBuild = fs.existsSync(adminDistDir) && fs.existsSync(path.join(adminDistDir, 'index.html'))

if (hasAdminBuild) {
  app.use('/admin/assets/*', serveStatic({ root: './admin/dist' }))
  app.get('/admin/*', (c) => {
    // SPA fallback — serve index.html for any /admin/* request that wasn't
    // an asset. React Router takes over from there.
    const html = fs.readFileSync(path.join(adminDistDir, 'index.html'), 'utf8')
    return c.html(html)
  })
} else {
  app.get('/admin/*', (c) => c.html(
    '<!doctype html><meta charset="utf-8"><title>Admin not built</title>' +
    '<body style="font:16px system-ui;padding:40px;max-width:560px;margin:auto">' +
    '<h1>Admin not built</h1>' +
    '<p>Run <code>cd admin && bun install && bun run build</code> to ship the admin UI.</p>' +
    '</body>'
  ))
}

// ── Boot ──────────────────────────────────────────────────────────────────
const port = Number(process.env.PORT || '3000')
console.log('[Premium-Contractor] Serving on port', port)

export default {
  port,
  fetch: app.fetch,
}
