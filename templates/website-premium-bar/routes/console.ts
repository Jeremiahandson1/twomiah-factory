/**
 * routes/console.ts — THE CONSOLE. A PIN-gated PWA a bartender runs from a
 * phone with wet hands: kitchen open/closed, closing early, tonight's
 * special, 86 an item, tap/blow a keg, room status, post an event, party
 * inbox, tonight's game. One input, many outputs — every write here changes
 * the Tonight Board, /api/live, the schema, and the voice agent at once.
 *
 * Mounted as:  app.route('/console', consolePages)   app.route('/api/console', consoleApi)
 * Auth: staff_pins (bcrypt) → staff_sessions (sha256 token in an httpOnly cookie, 30 days).
 * Separate from the email/2FA admin login on purpose — this is the bar's shared phone.
 */
import { Hono, type Context } from 'hono'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import { and, asc, desc, eq, gte, isNull, sql } from 'drizzle-orm'
import bcrypt from 'bcryptjs'
import crypto from 'crypto'
import ejs from 'ejs'
import path from 'path'
import { db } from '../db'
import { events, games, menuItems, menuSections, partyInquiries, serviceStatus, settings as settingsTbl, specials, staffPins, staffSessions, taps } from '../db/schema'
import { bustSiteData, loadSiteData } from '../lib/site-data'
import { buildLiveState } from '../lib/live'
import { addDays, localDateString, localToUtc } from '../lib/hours'
import { loginRateLimit } from '../lib/security'

const COOKIE = 'bar_console'
const SESSION_DAYS = 30
const viewsDir = path.join(import.meta.dir, '..', 'views', 'console')
const isProd = process.env.NODE_ENV === 'production'

type Vars = { staff: { id: string; label: string; sessionId: string } }

function hashToken(t: string): string { return crypto.createHash('sha256').update(t).digest('hex') }

async function sessionFromCookie(c: Context<{ Variables: Vars }>) {
  const raw = getCookie(c, COOKIE)
  if (!raw) return null
  const [row] = await db.select({ id: staffSessions.id, pinId: staffSessions.pinId, expiresAt: staffSessions.expiresAt, revokedAt: staffSessions.revokedAt, label: staffPins.label, active: staffPins.isActive })
    .from(staffSessions).innerJoin(staffPins, eq(staffPins.id, staffSessions.pinId))
    .where(eq(staffSessions.tokenHash, hashToken(raw))).limit(1)
  if (!row || row.revokedAt || !row.active || row.expiresAt.getTime() < Date.now()) return null
  db.update(staffSessions).set({ lastUsedAt: new Date() }).where(eq(staffSessions.id, row.id)).catch(() => {})
  return { id: row.pinId, label: row.label, sessionId: row.id }
}

async function requireStaff(c: Context<{ Variables: Vars }>, next: () => Promise<void>) {
  const staff = await sessionFromCookie(c)
  if (!staff) {
    if (c.req.path.startsWith('/api/')) return c.json({ error: 'Sign in with your PIN.' }, 401)
    return c.redirect('/console/login?next=' + encodeURIComponent(c.req.path))
  }
  c.set('staff', staff)
  await next()
}

async function tz(): Promise<string> {
  const [s] = await db.select({ timezone: settingsTbl.timezone, hours: settingsTbl.hours }).from(settingsTbl).limit(1)
  return ((s?.hours as any)?.timezone as string) || s?.timezone || 'America/Chicago'
}

/** "End of business day": 6 AM local tomorrow — overrides lapse there so the board can't stay wrong. */
async function endOfBusinessDay(now = new Date()): Promise<Date> {
  const z = await tz()
  const today = localDateString(now, z)
  const sixToday = localToUtc(today, '06:00', z)
  return now.getTime() < sixToday.getTime() ? sixToday : localToUtc(addDays(today, 1), '06:00', z)
}

async function statusRow() {
  const [row] = await db.select().from(serviceStatus).limit(1)
  if (row) return row
  const [created] = await db.insert(serviceStatus).values({ roomStatus: 'quiet' }).returning()
  return created
}

async function bodyOf(c: Context): Promise<Record<string, any>> {
  const ct = c.req.header('content-type') || ''
  if (ct.includes('application/json')) return c.req.json().catch(() => ({}))
  return Object.fromEntries((await c.req.formData()).entries())
}

function str(v: unknown, max = 200): string | null { const s = String(v ?? '').trim(); return s ? s.slice(0, max) : null }

// ═══════════════════════════════════════════════════════════════════════════
// Pages
// ═══════════════════════════════════════════════════════════════════════════
export const consolePages = new Hono<{ Variables: Vars }>()

consolePages.get('/manifest.webmanifest', async (c) => {
  const [s] = await db.select({ name: settingsTbl.companyName }).from(settingsTbl).limit(1)
  c.header('Content-Type', 'application/manifest+json')
  return c.body(JSON.stringify({
    name: (s?.name || 'Bar') + ' Console', short_name: 'Console', start_url: '/console/', scope: '/console/',
    display: 'standalone', background_color: '#121010', theme_color: '#121010', orientation: 'portrait',
    icons: [{ src: '/console/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
  }))
})
consolePages.get('/icon.svg', (c) => {
  c.header('Content-Type', 'image/svg+xml'); c.header('Cache-Control', 'public, max-age=86400')
  return c.body(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><rect width="128" height="128" rx="24" fill="#121010"/><rect x="18" y="18" width="92" height="92" rx="8" fill="none" stroke="#C9A24E" stroke-width="3"/><text x="64" y="80" text-anchor="middle" font-family="Georgia,serif" font-size="48" fill="#C9A24E">C</text></svg>`)
})
consolePages.get('/sw.js', (c) => {
  c.header('Content-Type', 'application/javascript'); c.header('Cache-Control', 'no-cache')
  // Shell-only cache. HTML is always network-first so the board is never stale.
  return c.body(`const SHELL='bar-console-v1';const ASSETS=['/styles/console.css','/scripts/console.js','/console/icon.svg'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(SHELL).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==SHELL).map(x=>caches.delete(x)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{const u=new URL(e.request.url);if(e.request.method!=='GET')return;
if(ASSETS.includes(u.pathname)){e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request)));return;}
if(u.pathname.startsWith('/console')){e.respondWith(fetch(e.request).catch(()=>caches.match('/console/offline')||new Response('<h1>Offline</h1><p>The console needs a connection.</p>',{headers:{'Content-Type':'text/html'}})));}});`)
})

consolePages.get('/login', async (c) => {
  const [s] = await db.select({ name: settingsTbl.companyName }).from(settingsTbl).limit(1)
  const pins = await db.select({ id: staffPins.id }).from(staffPins).where(eq(staffPins.isActive, true)).limit(1)
  const html = await ejs.renderFile(path.join(viewsDir, 'login.ejs'), { companyName: s?.name || 'Bar', error: c.req.query('error') || '', next: c.req.query('next') || '/console/', noPins: pins.length === 0 })
  c.header('Cache-Control', 'no-store'); c.header('X-Robots-Tag', 'noindex')
  return c.html(html)
})

consolePages.use('/login', loginRateLimit())
consolePages.post('/login', async (c) => {
  const body = await bodyOf(c)
  const pin = String(body.pin || '').replace(/\D/g, '')
  const next = String(body.next || '/console/').startsWith('/console') ? String(body.next) : '/console/'
  if (pin.length < 4) return c.redirect('/console/login?error=' + encodeURIComponent('Enter your PIN.'))
  const rows = await db.select().from(staffPins).where(eq(staffPins.isActive, true))
  let match: typeof rows[number] | null = null
  for (const r of rows) if (await bcrypt.compare(pin, r.pinHash)) { match = r; break }
  if (!match) return c.redirect('/console/login?error=' + encodeURIComponent('That PIN is not right.'))
  const token = crypto.randomBytes(32).toString('base64url')
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400000)
  await db.insert(staffSessions).values({ pinId: match.id, tokenHash: hashToken(token), userAgent: (c.req.header('user-agent') || '').slice(0, 300), expiresAt })
  await db.update(staffPins).set({ lastUsedAt: new Date() }).where(eq(staffPins.id, match.id))
  setCookie(c, COOKIE, token, { httpOnly: true, sameSite: 'Lax', secure: isProd, path: '/', maxAge: SESSION_DAYS * 86400 })
  return c.redirect(next)
})

consolePages.post('/logout', requireStaff, async (c) => {
  const staff = c.get('staff')
  await db.update(staffSessions).set({ revokedAt: new Date() }).where(eq(staffSessions.id, staff.sessionId))
  deleteCookie(c, COOKIE, { path: '/' })
  return c.redirect('/console/login')
})

consolePages.get('/', requireStaff, async (c) => {
  const staff = c.get('staff')
  const now = new Date()
  const [[s], site, status, items, sections, tapRows, inquiries, upcomingGames, upcomingEvents] = await Promise.all([
    db.select().from(settingsTbl).limit(1),
    loadSiteData(now),
    statusRow(),
    db.select().from(menuItems).where(eq(menuItems.isActive, true)).orderBy(asc(menuItems.sortOrder), asc(menuItems.name)),
    db.select().from(menuSections).orderBy(asc(menuSections.sortOrder)),
    db.select().from(taps).orderBy(asc(taps.lineNumber)),
    db.select().from(partyInquiries).where(sql`${partyInquiries.status} in ('new', 'called')`).orderBy(desc(partyInquiries.createdAt)).limit(30),
    db.select().from(games).where(gte(games.startsAt, new Date(now.getTime() - 4 * 3600000))).orderBy(asc(games.startsAt)).limit(5),
    db.select().from(events).where(gte(events.startsAt, new Date(now.getTime() - 4 * 3600000))).orderBy(asc(events.startsAt)).limit(10),
  ])
  const live = await buildLiveState(db, now)
  const html = await ejs.renderFile(path.join(viewsDir, 'home.ejs'), {
    staff, settings: s, live, status, sections, items, taps: tapRows, inquiries, games: upcomingGames, events: upcomingEvents,
    timezone: live.timezone, hoursToday: { bar: site.live.bar, kitchen: site.live.kitchen },
  })
  c.header('Cache-Control', 'no-store'); c.header('X-Robots-Tag', 'noindex')
  return c.html(html)
})

consolePages.get('/offline', (c) => c.html('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Offline</title><body style="background:#121010;color:#EFE6D2;font:18px Georgia,serif;padding:40px"><h1 style="color:#C9A24E">No connection</h1><p>The console needs the internet to change the board. Try again in a moment.</p></body>'))

// ═══════════════════════════════════════════════════════════════════════════
// API — every route requires a staff session; every write busts the cache and
// returns the fresh live state so the phone can repaint immediately.
// ═══════════════════════════════════════════════════════════════════════════
export const consoleApi = new Hono<{ Variables: Vars }>()
consoleApi.use('*', requireStaff)

async function done(c: Context<{ Variables: Vars }>, extra: Record<string, unknown> = {}) {
  bustSiteData()
  const live = await buildLiveState(db)
  return c.json({ ok: true, live, ...extra })
}

consoleApi.get('/state', async (c) => c.json({ ok: true, live: await buildLiveState(db), staff: c.get('staff') }))

// Kitchen / bar: open (follow schedule), closed (until end of business day), closing-early at HH:MM
consoleApi.post('/department', async (c) => {
  const b = await bodyOf(c)
  const dept = b.department === 'bar' ? 'bar' : 'kitchen'
  const action = String(b.action || '')
  const until = await endOfBusinessDay()
  const patch: Partial<typeof serviceStatus.$inferInsert> = { updatedAt: new Date(), updatedBy: c.get('staff').label, overrideUntil: until }
  if (action === 'closed') { if (dept === 'kitchen') { patch.kitchenOpen = false; patch.kitchenClosesAt = null } else { patch.barOpen = false; patch.barClosesAt = null } }
  else if (action === 'open') { if (dept === 'kitchen') { patch.kitchenOpen = null; patch.kitchenClosesAt = null } else { patch.barOpen = null; patch.barClosesAt = null } }
  else if (action === 'closing-early') {
    const time = String(b.time || '')
    if (!/^\d{1,2}:\d{2}$/.test(time)) return c.json({ error: 'Pick a time.' }, 400)
    const z = await tz(); const now = new Date(); const today = localDateString(now, z)
    let at = localToUtc(today, time, z)
    if (at.getTime() < now.getTime()) at = localToUtc(addDays(today, 1), time, z)   // "1:00" typed at 11 PM means tomorrow 1 AM
    if (dept === 'kitchen') { patch.kitchenOpen = null; patch.kitchenClosesAt = at } else { patch.barOpen = null; patch.barClosesAt = at }
    if (at.getTime() > until.getTime()) patch.overrideUntil = new Date(at.getTime() + 3600000)
  } else return c.json({ error: 'Unknown action' }, 400)
  const row = await statusRow()
  await db.update(serviceStatus).set(patch).where(eq(serviceStatus.id, row.id))
  return done(c)
})

consoleApi.post('/room', async (c) => {
  const b = await bodyOf(c)
  const room = ['quiet', 'filling', 'packed'].includes(String(b.room)) ? String(b.room) : 'quiet'
  const row = await statusRow()
  await db.update(serviceStatus).set({ roomStatus: room, updatedAt: new Date(), updatedBy: c.get('staff').label }).where(eq(serviceStatus.id, row.id))
  return done(c)
})

consoleApi.post('/note', async (c) => {
  const b = await bodyOf(c)
  const row = await statusRow()
  const note = str(b.note, 140)
  await db.update(serviceStatus).set({ note, overrideUntil: note ? await endOfBusinessDay() : row.overrideUntil, updatedAt: new Date(), updatedBy: c.get('staff').label }).where(eq(serviceStatus.id, row.id))
  return done(c)
})

// Tonight's special: one active row until end of business day. Empty title clears it.
consoleApi.post('/special', async (c) => {
  const b = await bodyOf(c)
  const now = new Date()
  const title = str(b.title, 120)
  // End any special still running tonight.
  await db.update(specials).set({ endsAt: now }).where(and(eq(specials.isRecurring, false), isNull(specials.endsAt)))
  await db.update(specials).set({ endsAt: now }).where(and(eq(specials.isRecurring, false), gte(specials.endsAt, now)))
  if (title) {
    const cents = b.price !== undefined && String(b.price).trim() !== '' ? Math.round(Number(String(b.price).replace(/[^\d.]/g, '')) * 100) : null
    await db.insert(specials).values({ title, description: str(b.description, 240), priceCents: Number.isFinite(cents as number) ? cents : null, startsAt: now, endsAt: await endOfBusinessDay(now), createdBy: c.get('staff').label })
  }
  return done(c)
})

// 86 / un-86 an item
consoleApi.post('/86', async (c) => {
  const b = await bodyOf(c)
  const id = str(b.id, 80); const on = String(b.on) === 'true' || b.on === true || b.on === '1'
  if (!id) return c.json({ error: 'Which item?' }, 400)
  await db.update(menuItems).set({ is86ed: on, updatedAt: new Date() }).where(eq(menuItems.id, id))
  return done(c)
})

// Taps: tap a keg on a line (creates/replaces), blow it, mark last keg / just tapped
consoleApi.post('/tap', async (c) => {
  const b = await bodyOf(c)
  const action = String(b.action || '')
  const line = Number.parseInt(String(b.line || ''), 10)
  if (!Number.isFinite(line) || line < 1 || line > 99) return c.json({ error: 'Which line?' }, 400)
  const [existing] = await db.select().from(taps).where(eq(taps.lineNumber, line)).orderBy(desc(taps.updatedAt)).limit(1)
  const now = new Date()
  if (action === 'tap') {
    const beerName = str(b.beerName, 120)
    if (!beerName) return c.json({ error: 'What is on the line?' }, 400)
    const abv = str(b.abv, 6)
    const cents = b.price !== undefined && String(b.price).trim() !== '' ? Math.round(Number(String(b.price).replace(/[^\d.]/g, '')) * 100) : null
    const values = { lineNumber: line, beerName, brewery: str(b.brewery, 120), style: str(b.style, 80), abv: abv && !isNaN(Number(abv)) ? Number(abv).toFixed(1) : null, originCountry: str(b.origin, 60), priceCents: Number.isFinite(cents as number) ? cents : null, badge: str(b.badge, 60), status: 'just_tapped', isActive: true, tappedAt: now, blownAt: null, kegLevelPct: null, updatedAt: now, sortOrder: existing?.sortOrder ?? line }
    if (existing) await db.update(taps).set(values).where(eq(taps.id, existing.id))
    else await db.insert(taps).values(values)
  } else if (action === 'blow') {
    if (!existing) return c.json({ error: 'Nothing on that line.' }, 404)
    await db.update(taps).set({ status: 'blown', isActive: false, blownAt: now, updatedAt: now }).where(eq(taps.id, existing.id))
  } else if (action === 'last_keg' || action === 'pouring' || action === 'just_tapped') {
    if (!existing) return c.json({ error: 'Nothing on that line.' }, 404)
    await db.update(taps).set({ status: action, updatedAt: now }).where(eq(taps.id, existing.id))
  } else return c.json({ error: 'Unknown action' }, 400)
  const tapRows = await db.select().from(taps).orderBy(asc(taps.lineNumber))
  return done(c, { taps: tapRows })
})

// Post an event (writes to /events; syndication drafts come in Phase 4)
consoleApi.post('/event', async (c) => {
  const b = await bodyOf(c)
  const title = str(b.title, 140)
  const date = String(b.date || ''); const time = String(b.time || '19:00')
  if (!title || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{1,2}:\d{2}$/.test(time)) return c.json({ error: 'Title, date and time are required.' }, 400)
  const z = await tz()
  const startsAt = localToUtc(date, time, z)
  const base = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'event'
  const slug = base + '-' + date
  await db.insert(events).values({ slug, title, description: str(b.description, 1000), startsAt, isPublished: true })
    .onConflictDoUpdate({ target: events.slug, set: { title, description: str(b.description, 1000), startsAt, updatedAt: new Date() } })
  return done(c)
})

// Tonight's game (manual override; TheSportsDB feed arrives in Phase 4)
consoleApi.post('/game', async (c) => {
  const b = await bodyOf(c)
  if (String(b.action) === 'clear') {
    await db.update(games).set({ isFeatured: false }).where(eq(games.isFeatured, true))
    return done(c)
  }
  const home = str(b.home, 60), away = str(b.away, 60)
  const date = String(b.date || ''); const time = String(b.time || '')
  if (!home || !away || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{1,2}:\d{2}$/.test(time)) return c.json({ error: 'Teams, date and time are required.' }, 400)
  const z = await tz()
  await db.update(games).set({ isFeatured: false }).where(eq(games.isFeatured, true))
  await db.insert(games).values({ league: str(b.league, 20) || 'NFL', home, away, startsAt: localToUtc(date, time, z), isFeatured: true, note: str(b.note, 80), source: 'manual' })
  return done(c)
})

// Party inbox
consoleApi.post('/inquiry', async (c) => {
  const b = await bodyOf(c)
  const id = str(b.id, 80); const status = String(b.status || '')
  if (!id || !['new', 'called', 'booked', 'closed', 'spam'].includes(status)) return c.json({ error: 'Bad request' }, 400)
  await db.update(partyInquiries).set({ status }).where(eq(partyInquiries.id, id))
  const rows = await db.select().from(partyInquiries).where(sql`${partyInquiries.status} in ('new', 'called')`).orderBy(desc(partyInquiries.createdAt)).limit(30)
  return c.json({ ok: true, inquiries: rows })
})
