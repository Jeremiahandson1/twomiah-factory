/**
 * routes/admin-bar.ts — the owner's view from a laptop: sales by night and
 * the Regulars list. Mounted under /api/admin by routes/admin.ts, behind the
 * same login (admin role for anything that changes money or people).
 *
 *   GET   /sales?day=YYYY-MM-DD      one night's report + closes + a 14-night trend
 *   GET   /guests?q=&sort=           the list (recent | visits | spend | points)
 *   GET   /guests/emails.csv         consented, subscribed emails only
 *   GET   /guests/:id                profile + recent checks + points history
 *   PATCH /guests/:id                edit name, phone, email, birthday, note
 *   POST  /guests/:id/points         { points, reason } adjust (logged)
 *   GET   /loyalty                   the Regulars terms
 *   PUT   /loyalty                   { enabled, pointsPerDollar, rewardPoints, rewardCents }
 */
import { Hono } from 'hono'
import { and, asc, desc, eq, gte, ilike, isNull, lt, or, sql } from 'drizzle-orm'
import { db } from '../db'
import { checkItems, checks, guests, loyaltyLedger, settings as settingsTbl, subscribers } from '../db/schema'
import { addDays } from '../lib/hours'
import { barTimezone, businessDayOf, dayWindow, loadDay } from '../lib/register/reports'
import { closeoutsFor } from '../lib/register/closeout'
import { GuestError, guestProfile, saveGuest } from '../lib/crm/guests'
import { loyaltyConfig } from '../lib/crm/loyalty'
import { birthdayConfig, birthdayEmailHtml, sendBirthdays, unsubscribeUrl } from '../lib/crm/birthday'
import { sendEmail } from '../lib/email'
import { bustSiteData } from '../lib/site-data'
import { toE164 } from '../lib/sms/twilio'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DAY = /^\d{4}-\d{2}-\d{2}$/

/** Build the routes with the admin app's own auth middlewares (so there's one login). */
export function barAdminRoutes(auth: any, requireAdmin: any, audit: (c: any, e: { action: string; target?: string; meta?: any }) => Promise<void>) {
  const app = new Hono<any>()

  // ── Sales ────────────────────────────────────────────────────────────────
  app.get('/sales', auth, requireAdmin, async (c) => {
    const tz = await barTimezone(db)
    const q = c.req.query('day') || ''
    const today = businessDayOf(new Date(), tz)
    const day = DAY.test(q) ? q : today
    const [{ summary, open }, closes] = await Promise.all([loadDay(db, day), closeoutsFor(db, day)])
    // 14 nights ending at this one: total, checks, tips — one grouped query.
    const first = addDays(day, -13)
    const from = dayWindow(first, tz).from, to = dayWindow(day, tz).to
    const rows = await db.select({ closedAt: checks.closedAt, total: checks.totalCents, tip: checks.tipCents }).from(checks)
      .where(and(eq(checks.status, 'paid'), gte(checks.closedAt, from), lt(checks.closedAt, to)))
    const trend = Array.from({ length: 14 }, (_, i) => ({ day: addDays(first, i), totalCents: 0, checks: 0, tipsCents: 0 }))
    for (const r of rows) {
      const d = businessDayOf(r.closedAt as Date, tz)
      const t = trend.find(x => x.day === d)
      if (t) { t.totalCents += r.total || 0; t.checks++; t.tipsCents += r.tip || 0 }
    }
    c.header('Cache-Control', 'no-store')
    return c.json({ day, today, summary, open, closes, trend })
  })

  // ── Guests ───────────────────────────────────────────────────────────────
  app.get('/guests', auth, async (c) => {
    const q = (c.req.query('q') || '').trim().slice(0, 60)
    const sort = c.req.query('sort') || 'recent'
    const order = sort === 'visits' ? [desc(guests.visitCount), asc(guests.name)]
      : sort === 'spend' ? [desc(guests.lifetimeCents), asc(guests.name)]
      : sort === 'points' ? [desc(guests.pointsBalance), asc(guests.name)]
      : [sql`${guests.lastVisitAt} desc nulls last`, desc(guests.createdAt)]
    const digits = q.replace(/\D/g, '')
    const where = !q ? undefined
      : digits.length >= 3 && digits.length === q.replace(/[\s()+.-]/g, '').length
        ? sql`regexp_replace(coalesce(${guests.phone}, ''), '\\D', '', 'g') like ${'%' + digits + '%'}`
        : or(ilike(guests.name, `%${q}%`), ilike(guests.email, `%${q}%`))
    const rows = await db.select().from(guests).where(where).orderBy(...order).limit(300)
    const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(guests)
    const [{ emailable }] = await db.select({ emailable: sql<number>`count(*)::int` }).from(subscribers).where(isNull(subscribers.unsubscribedAt))
    c.header('Cache-Control', 'no-store')
    return c.json({
      total, emailable,
      guests: rows.map(g => ({ id: g.id, name: g.name, phone: g.phone, email: g.email, visitCount: g.visitCount, lifetimeCents: g.lifetimeCents, pointsBalance: g.pointsBalance, lastVisitAt: g.lastVisitAt, createdAt: g.createdAt, source: g.source, birthday: g.birthdayMonth && g.birthdayDay ? `${g.birthdayMonth}/${g.birthdayDay}` : null })),
    })
  })

  // Only people who ticked the box and haven't unsubscribed. The consent columns go with it.
  app.get('/guests/emails.csv', auth, requireAdmin, async (c) => {
    const rows = await db.select().from(subscribers).where(isNull(subscribers.unsubscribedAt)).orderBy(asc(subscribers.email))
    const cell = (v: unknown) => { const s = v == null ? '' : v instanceof Date ? v.toISOString() : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s }
    const csv = ['email,name,birthday,consent_at,consent_source,consent_ip'].concat(rows.map(r => [r.email, r.name, r.birthdayMonth && r.birthdayDay ? `${r.birthdayMonth}/${r.birthdayDay}` : '', r.consentAt, r.consentSource, r.consentIp].map(cell).join(','))).join('\n') + '\n'
    await audit(c, { action: 'guests.export_emails', meta: { count: rows.length } })
    c.header('Content-Type', 'text/csv; charset=utf-8')
    c.header('Content-Disposition', 'attachment; filename="regulars-emails.csv"')
    return c.body(csv)
  })

  app.get('/guests/:id', auth, async (c) => {
    const id = c.req.param('id')
    if (!UUID.test(id)) return c.json({ error: 'Which guest?' }, 400)
    try {
      const profile = await guestProfile(db, id, await barTimezone(db))
      const recent = await db.select({ id: checks.id, number: checks.number, label: checks.label, kind: checks.kind, totalCents: checks.totalCents, closedAt: checks.closedAt }).from(checks)
        .where(and(eq(checks.guestId, id), eq(checks.status, 'paid'))).orderBy(desc(checks.closedAt)).limit(20)
      const items = recent.length ? await db.select({ checkId: checkItems.checkId, name: checkItems.name, size: checkItems.size, qty: checkItems.qty, kind: checkItems.kind, state: checkItems.state })
        .from(checkItems).where(sql`${checkItems.checkId} in (${sql.join(recent.map(r => sql`${r.id}`), sql`, `)})`) : []
      const ledger = await db.select().from(loyaltyLedger).where(eq(loyaltyLedger.guestId, id)).orderBy(desc(loyaltyLedger.at)).limit(30)
      const [g] = await db.select({ birthdayMonth: guests.birthdayMonth, birthdayDay: guests.birthdayDay, source: guests.source, createdAt: guests.createdAt }).from(guests).where(eq(guests.id, id)).limit(1)
      c.header('Cache-Control', 'no-store')
      return c.json({
        guest: { ...profile, ...g },
        visits: recent.map(r => ({ ...r, items: items.filter(i => i.checkId === r.id && i.state !== 'void').map(i => (i.qty > 1 ? i.qty + ' × ' : '') + i.name + (i.size ? ` (${i.size.toLowerCase()})` : '')) })),
        ledger,
      })
    } catch (e: any) {
      if (e instanceof GuestError) return c.json({ error: e.message }, e.status as 404)
      throw e
    }
  })

  app.patch('/guests/:id', auth, async (c) => {
    const id = c.req.param('id')
    if (!UUID.test(id)) return c.json({ error: 'Which guest?' }, 400)
    const b = await c.req.json().catch(() => ({})) as Record<string, any>
    const [g] = await db.select().from(guests).where(eq(guests.id, id)).limit(1)
    if (!g) return c.json({ error: 'Guest not found' }, 404)
    // A new phone must not belong to someone else (saveGuest matches by phone).
    const phone = toE164(String(b.phone ?? g.phone ?? ''))
    if (!phone) return c.json({ error: 'A phone number is required.' }, 400)
    if (phone !== g.phone) {
      const [other] = await db.select({ id: guests.id }).from(guests).where(eq(guests.phone, phone)).limit(1)
      if (other) return c.json({ error: 'Another guest has that number.' }, 409)
      await db.update(guests).set({ phone }).where(eq(guests.id, id))
    }
    try {
      await saveGuest(db, { name: b.name ?? g.name, phone, email: b.email ?? g.email, birthdayMonth: b.birthdayMonth ?? g.birthdayMonth, birthdayDay: b.birthdayDay ?? g.birthdayDay, note: b.note ?? g.note }, 'register')
    } catch (e: any) {
      if (e instanceof GuestError) return c.json({ error: e.message }, e.status as 400 | 409)
      throw e
    }
    await audit(c, { action: 'guest.update', target: id })
    return c.json({ ok: true })
  })

  app.post('/guests/:id/points', auth, requireAdmin, async (c) => {
    const id = c.req.param('id')
    if (!UUID.test(id)) return c.json({ error: 'Which guest?' }, 400)
    const b = await c.req.json().catch(() => ({})) as Record<string, any>
    const points = Math.round(Number(b.points))
    const reason = String(b.reason || '').trim().slice(0, 80)
    if (!Number.isFinite(points) || points === 0 || Math.abs(points) > 100000) return c.json({ error: 'Enter points to add (or subtract with a minus).' }, 400)
    if (!reason) return c.json({ error: 'Say why.' }, 400)
    const [g] = await db.select({ balance: guests.pointsBalance }).from(guests).where(eq(guests.id, id)).limit(1)
    if (!g) return c.json({ error: 'Guest not found' }, 404)
    if (g.balance + points < 0) return c.json({ error: `They only have ${g.balance} points.` }, 400)
    await db.transaction(async (tx) => {
      await tx.insert(loyaltyLedger).values({ guestId: id, points, reason: 'adjust', by: reason })
      await tx.update(guests).set({ pointsBalance: sql`${guests.pointsBalance} + ${points}`, updatedAt: new Date() }).where(eq(guests.id, id))
    })
    await audit(c, { action: 'guest.points', target: id, meta: { points, reason } })
    return c.json({ ok: true })
  })

  // ── The Regulars terms ─────────────────────────────────────────────────
  app.get('/loyalty', auth, async (c) => {
    const [s] = await db.select({ loyalty: settingsTbl.loyalty }).from(settingsTbl).limit(1)
    return c.json({ loyalty: loyaltyConfig(s?.loyalty) })
  })
  app.put('/loyalty', auth, requireAdmin, async (c) => {
    const b = await c.req.json().catch(() => ({})) as Record<string, unknown>
    const cfg = loyaltyConfig(b)
    // loyaltyConfig quietly replaces bad numbers with defaults; here we'd rather say so.
    for (const k of ['pointsPerDollar', 'rewardPoints', 'rewardCents'] as const) if (b[k] !== undefined && Number(b[k]) !== cfg[k]) return c.json({ error: `Check ${k === 'rewardCents' ? 'the reward value' : k === 'rewardPoints' ? 'the points for a reward' : 'points per dollar'}.` }, 400)
    const [s] = await db.select({ id: settingsTbl.id }).from(settingsTbl).limit(1)
    if (!s) return c.json({ error: 'Settings not initialized' }, 409)
    await db.update(settingsTbl).set({ loyalty: cfg, updatedAt: new Date() }).where(eq(settingsTbl.id, s.id))
    bustSiteData()
    await audit(c, { action: 'loyalty.update', meta: cfg })
    return c.json({ ok: true, loyalty: cfg })
  })

  // ── Birthday email ─────────────────────────────────────────────────────
  app.get('/birthday', auth, async (c) => {
    const [s] = await db.select({ b: settingsTbl.birthdayEmail }).from(settingsTbl).limit(1)
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(subscribers).where(and(isNull(subscribers.unsubscribedAt), sql`${subscribers.birthdayMonth} is not null`))
    return c.json({ birthday: birthdayConfig(s?.b), emailReady: !!process.env.RESEND_API_KEY, withBirthdays: n })
  })
  app.put('/birthday', auth, requireAdmin, async (c) => {
    const b = await c.req.json().catch(() => ({})) as Record<string, unknown>
    const cfg = birthdayConfig(b)
    if (cfg.enabled && !cfg.message) return c.json({ error: 'Write the message before turning it on.' }, 400)
    const [s] = await db.select({ id: settingsTbl.id }).from(settingsTbl).limit(1)
    if (!s) return c.json({ error: 'Settings not initialized' }, 409)
    await db.update(settingsTbl).set({ birthdayEmail: cfg, updatedAt: new Date() }).where(eq(settingsTbl.id, s.id))
    return c.json({ ok: true, birthday: cfg })
  })
  // Run today's birthday emails now instead of waiting for the hourly check (support + tests).
  app.post('/birthday/run', auth, requireAdmin, async (c) => c.json({ ok: true, ...(await sendBirthdays(db, new Date(), { force: true })) }))
  // Send the email as written to the signed-in admin, so the owner sees exactly what goes out.
  app.post('/birthday/test', auth, requireAdmin, async (c) => {
    const b = await c.req.json().catch(() => ({})) as Record<string, unknown>
    const cfg = birthdayConfig({ ...b, enabled: true })
    if (!cfg.message) return c.json({ error: 'Write the message first.' }, 400)
    const to = String((c as any).get('userEmail') || '')   // set by the admin auth middleware
    if (!to) return c.json({ error: 'No email on your account.' }, 400)
    if (!process.env.RESEND_API_KEY) return c.json({ error: 'Email is not set up on this site yet (RESEND_API_KEY).' }, 503)
    const [s] = await db.select().from(settingsTbl).limit(1)
    const origin = process.env.SITE_ORIGIN || process.env.SITE_URL || s?.siteOrigin || ''
    const ok = await sendEmail({ to, subject: '[Test] ' + cfg.subject, html: birthdayEmailHtml({ company: s?.companyName || 'The bar', name: 'Test Guest', message: cfg.message, address: [s?.streetAddress, s?.addressLocality, s?.addressRegion].filter(Boolean).join(', '), unsubUrl: unsubscribeUrl(origin, to) }) })
    return ok ? c.json({ ok: true, to }) : c.json({ error: 'The email service refused it. Check the sender setup.' }, 502)
  })

  return app
}
