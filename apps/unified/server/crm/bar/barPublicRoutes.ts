// /api/public/bar — what the bar's WEBSITE reads, live: GET live, menu, menu/:slug, taps, hours, events and the
// speakeasy door's POST. No sign-in — a customer's phone — so every answer is public fields only: no keg levels, no
// blown kegs, no inactive items, no password. The site's own pages read the same answers directly (barSite.ts); the
// board's poller (/scripts/live.js) and the speakeasy door (/scripts/speakeasy.js) ask here.
//
// The company is the oldest row in this database (one bar per tenant database). A cancelled company's live facts stop
// (402 ACCOUNT_LOCKED) — the website falls back to its static page — and a feature the owner switched off answers 404.
//
// Moved from templates/crm-bar/backend/src/routes/barPublic.ts. The speakeasy's "too many knocks" is an error reply
// ({ error }); a right or wrong answer is { ok } as before. The answers themselves are built in barSite.ts, shared with
// the website's pages.
import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { barSettings } from '../../db/schema/index.ts'
import { fail, one } from '../../http/reply.ts'
import type { CrmDeps } from '../deps.ts'
import type { BarServices } from './services.ts'
import { createBarPublic, type PublicRefusal } from './barSite.ts'
import type { BarDb } from './db.ts'

export function createBarPublicRoutes(d: CrmDeps, bar: BarServices) {
  const { db } = d
  const pub = createBarPublic(db as BarDb, bar.live)
  const app = new Hono()

  /** The company, or the answer to give instead (no bar / locked / feature off). */
  async function gate(c: any, feature: string): Promise<{ id: string } | Response> {
    const g = pub.gate(await pub.theBar(), feature)
    if ('status' in g) { const r = g as PublicRefusal; return fail(c, r.status, r.error, r.code) }
    return g
  }
  const isResponse = (x: unknown): x is Response => x instanceof Response

  app.get('/live', async (c) => {
    const co = await gate(c, 'bar_tonight'); if (isResponse(co)) return co
    return one(c, await pub.liveState(co.id))
  })

  app.get('/menu', async (c) => {
    const co = await gate(c, 'bar_menu'); if (isResponse(co)) return co
    return one(c, await pub.menu(co.id))
  })

  app.get('/menu/:slug', async (c) => {
    const co = await gate(c, 'bar_menu'); if (isResponse(co)) return co
    const item = await pub.menuItem(co.id, c.req.param('slug'))
    if (!item) return fail(c, 404, 'Not on the menu')
    return one(c, item)
  })

  app.get('/taps', async (c) => {
    const co = await gate(c, 'bar_menu'); if (isResponse(co)) return co
    return one(c, await pub.taps(co.id))
  })

  app.get('/hours', async (c) => {
    const co = await gate(c, 'bar_tonight'); if (isResponse(co)) return co
    return one(c, await pub.hours(co.id))
  })

  app.get('/events', async (c) => {
    const co = await gate(c, 'bar_tonight'); if (isResponse(co)) return co
    return one(c, await pub.events(co.id))
  })

  // The speakeasy door: a riddle on the website, the password checked here so it never leaves the server.
  // Ten tries per address per ten minutes; a wrong answer is just "no", never a hint.
  const tries = new Map<string, { n: number; resetAt: number }>()
  app.post('/speakeasy', async (c) => {
    const co = await gate(c, 'bar_tonight'); if (isResponse(co)) return co
    const ip = (c.req.header('x-forwarded-for') || '').split(',')[0].trim() || c.req.header('x-real-ip') || 'unknown'
    const now = Date.now()
    const t = tries.get(ip)
    if (t && t.resetAt > now && t.n >= 10) return fail(c, 429, 'Too many knocks. Try again later.')
    tries.set(ip, t && t.resetAt > now ? { n: t.n + 1, resetAt: t.resetAt } : { n: 1, resetAt: now + 10 * 60_000 })
    if (tries.size > 5000) for (const [k, v] of tries) if (v.resetAt <= now) tries.delete(k)
    const body = await c.req.json().catch(() => ({}))
    const answer = String(body?.answer ?? '').trim().toLowerCase().slice(0, 60)
    const [s] = await db.select({ hash: barSettings.speakeasyPasswordHash, note: barSettings.speakeasyNote }).from(barSettings).where(eq(barSettings.companyId, co.id)).limit(1)
    if (!s?.hash) return fail(c, 404, 'Not available')
    const ok = !!answer && await Bun.password.verify(answer, s.hash)
    return one(c, ok ? { ok: true, note: s.note || null } : { ok: false })
  })

  return app
}
