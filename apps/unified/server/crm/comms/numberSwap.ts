// THE WEBSITE NUMBER SWAP (CallRail's dynamic number insertion), on the tracking numbers Twomiah sells (call_tracking_numbers):
// the business's website — its own Twomiah site, or any site it pastes the script on — shows a visitor the tracking number for
// where they came from, in place of the business's own number, so the call says which ad or search brought it.
//
//   POST /api/public/number-swap/:slug/visit   public; { visitor, page, referrer } as text/plain (no preflight from another site)
//     → { number, tel, replace } — the number to show, its tel: address, and the business's own number to put it in place of —
//       or { number: null } when this visitor is shown no tracking number.
//
// Each tracking number says which visitors see it (tracking_number.swap_source — numberSwapRules.ts): the most particular rule a
// visit matches wins (a utm_source of its own, then the source, then 'all'). A number in a VISITOR POOL (in_pool) is handed to one
// visitor at a time — the one no live visit holds, else the one held longest ago — and the visit is kept (call_tracking_visit), so
// a call to it while the visit is live (seen in the last 30 minutes) is credited with that visit's source, campaign, keyword and
// landing page (calltrackingService.ts logCall → visitForCall). A visitor keeps their number for the visit: each page asks again.
import { Hono } from 'hono'
import { and, desc, eq, gte, inArray, isNotNull, max } from 'drizzle-orm'
import { callTrackingVisit, company, trackingNumber } from '../../db/schema/index.ts'
import { createRateLimiter } from '../../http/guards.ts'
import { fail, one } from '../../http/reply.ts'
import type { CrmDeps } from '../deps.ts'
import { classifyVisit } from './numberSwapRules.ts'

/** A visit is live while it was seen this recently; a pool number is free once no live visit holds it. */
export const VISIT_LIVE_MS = 30 * 60_000
/** Asks one address may make an hour (every page view asks once, and every 5 minutes while a page stays open). */
const ASKS_PER_HOUR = 600

const last10 = (x: unknown) => String(x ?? '').replace(/\D/g, '').slice(-10)
export const displayNumber = (e164: string) => { const d = last10(e164); return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : e164 }

/** The live visit a call to this pool number belongs to: the last one seen before the call, and seen within the 30 minutes before it. */
export async function visitForCall(db: any, trackingNumberId: string, at: Date) {
  const [v] = await db.select().from(callTrackingVisit)
    .where(and(eq(callTrackingVisit.trackingNumberId, trackingNumberId), gte(callTrackingVisit.lastSeenAt, new Date(at.getTime() - VISIT_LIVE_MS))))
    .orderBy(desc(callTrackingVisit.lastSeenAt)).limit(1)
  return v ?? null
}

export function createNumberSwapRoutes(d: CrmDeps) {
  const { db } = d
  const app = new Hono()

  app.post('/:slug/visit', createRateLimiter(60 * 60_000, process.env.NODE_ENV === 'production' ? ASKS_PER_HOUR : 100000), async (c) => {
    // Asked from the business's own pages or any site it embedded the script on: readable from anywhere, nothing private in it.
    c.header('Access-Control-Allow-Origin', '*')
    c.header('Cache-Control', 'no-store')
    let body: any
    try { body = JSON.parse(await c.req.text()) } catch { return fail(c, 400, 'Send { visitor, page, referrer }') }
    const visitor = typeof body?.visitor === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(body.visitor) ? body.visitor : null
    const page = typeof body?.page === 'string' ? body.page.slice(0, 2000) : ''
    const referrer = typeof body?.referrer === 'string' ? body.referrer.slice(0, 2000) : ''
    if (!visitor || !/^https?:\/\//.test(page)) return fail(c, 400, 'Send { visitor, page, referrer }')
    const [co] = await db.select({ id: company.id, phone: company.phone }).from(company).where(eq(company.slug, c.req.param('slug'))).limit(1)
    const none = () => one(c, { number: null })
    if (!co || !(await d.features.isFeatureEnabled(co.id, 'call_tracking_numbers').catch(() => false))) return none()
    const numbers: any[] = await db.select().from(trackingNumber)
      .where(and(eq(trackingNumber.companyId, co.id), eq(trackingNumber.active, true), isNotNull(trackingNumber.swapSource), isNotNull(trackingNumber.forwardTo)))
    if (!numbers.length) return none()
    const now = new Date()
    const answer = (n: any) => one(c, { number: displayNumber(n.phoneNumber), tel: `+1${last10(n.phoneNumber)}`, replace: last10(co.phone) || null })

    // This visitor's live visit keeps its pool number.
    const [mine] = await db.select().from(callTrackingVisit)
      .where(and(eq(callTrackingVisit.companyId, co.id), eq(callTrackingVisit.visitorId, visitor), gte(callTrackingVisit.lastSeenAt, new Date(now.getTime() - VISIT_LIVE_MS))))
      .orderBy(desc(callTrackingVisit.lastSeenAt)).limit(1)
    const held = mine && numbers.find((n) => n.id === mine.trackingNumberId && n.inPool)
    if (held) {
      await db.update(callTrackingVisit).set({ lastSeenAt: now }).where(eq(callTrackingVisit.id, mine.id))
      return answer(held)
    }

    const visit = classifyVisit({ page, referrer })
    const rule = visit.rules.find((r) => numbers.some((n) => n.swapSource === r))
    if (!rule) return none()
    const matched = numbers.filter((n) => n.swapSource === rule)
    const pool = matched.filter((n) => n.inPool)
    if (!pool.length) return answer(matched[0])

    // A pool: the number no live visit holds, else the one whose last visit was seen longest ago.
    const lastSeen = new Map<string, number>()
    const recent: any[] = await db.select({ id: callTrackingVisit.trackingNumberId, at: max(callTrackingVisit.lastSeenAt) }).from(callTrackingVisit)
      .where(inArray(callTrackingVisit.trackingNumberId, pool.map((n) => n.id))).groupBy(callTrackingVisit.trackingNumberId)
    for (const r of recent) lastSeen.set(r.id, new Date(r.at).getTime())
    const pick = [...pool].sort((a, b) => (lastSeen.get(a.id) ?? 0) - (lastSeen.get(b.id) ?? 0) || String(a.id).localeCompare(String(b.id)))[0]
    await db.insert(callTrackingVisit).values({
      companyId: co.id, trackingNumberId: pick.id, visitorId: visitor, source: visit.source, medium: visit.medium, campaign: visit.campaign,
      keyword: visit.keyword, landingPage: visit.landingPage, referrer: visit.referrer, startedAt: now, lastSeenAt: now,
    })
    return answer(pick)
  })

  return app
}
