// /api/calltracking-lines — call tracking numbers Twomiah sells (feature call_tracking_numbers, not ready): ServiceTitan's
// built-in tracking numbers, so a business needs no CallRail account. The Factory buys and bills them (its
// services/callTrackingNumbers.ts: $3 a month a number on a subscription, each call at Twilio's cost from the wallet); this app
// keeps each as a tracking number (provider 'twomiah'), rings the business's line when it is called (calltracking.ts
// POST /voice/:companyId) and logs the call from Twilio's status callback (POST /webhook/twilio/:companyId).
//
//   GET  /               the numbers — the Factory's list, kept in step with this app's tracking numbers   calltracking:read
//   POST /               a new one: bought now, or the checkout for the first one                          calltracking:create
//   POST /:id/release    give one back                                                                      calltracking:update
import { Hono } from 'hono'
import { and, eq } from 'drizzle-orm'
import { trackingNumber } from '../../db/schema/index.ts'
import type { AppEnv } from '../../http/env.ts'
import { fail, one } from '../../http/reply.ts'
import type { CrmDeps } from '../deps.ts'

export interface TrackingLinesFactory {
  listTrackingLines(): Promise<{ monthlyCents: number; subscribed: boolean; lines: Array<{ sid: string; phoneNumber: string; label: string; forwardTo: string | null }> }>
  buyTrackingLine(req: { label: string; forwardTo: string; areaCode?: string; voiceUrl: string; statusUrl: string; returnUrl: string }): Promise<{ line?: { sid: string; phoneNumber: string; label: string; forwardTo: string | null }; checkoutUrl?: string }>
  releaseTrackingLine(sid: string): Promise<{ success: boolean }>
}

/** A Factory refusal in its own words and status (a 409 "no number in that area" stays a 409). */
const passOn = (c: any, e: any) => {
  const status = Number(e?.status) >= 400 && Number(e?.status) < 600 ? Number(e.status) : 502
  const up = e?.upstream && typeof e.upstream === 'object' ? e.upstream : {}
  return fail(c, status as any, String(up.error || e?.message || 'Twomiah could not be reached'), typeof up.code === 'string' ? up.code : undefined)
}

/** This app's own public address — the one Twilio calls back (the Factory accepts only the business's own app). */
export function ownOrigin(reqUrl: string): string {
  const fromEnv = String(process.env.RENDER_EXTERNAL_URL || process.env.FRONTEND_URL || '').trim()
  const base = fromEnv || new URL(reqUrl).origin
  return base.replace(/\/+$/, '').replace(/^http:\/\//, 'https://')
}

export const PROVIDER = 'twomiah'

export function createTrackingLineRoutes(d: CrmDeps, factory: TrackingLinesFactory) {
  const { db } = d
  const { requirePermission } = d.permissions
  const app = new Hono<AppEnv>()

  /**
   * The Factory's list is the truth (a first number bought after its checkout arrives only there): each number becomes — or
   * stays — one of this app's tracking numbers, and one given back is switched off here. The line it rings is this app's
   * (changed on the number itself); a new one starts with the line asked for when it was bought.
   */
  async function inStep(companyId: string) {
    const r = await factory.listTrackingLines()
    const mine = await db.select().from(trackingNumber).where(and(eq(trackingNumber.companyId, companyId), eq(trackingNumber.provider, PROVIDER)))
    const bySid = new Map((mine as any[]).map((t) => [t.providerId, t]))
    for (const l of r.lines) {
      const have = bySid.get(l.sid)
      if (!have) await db.insert(trackingNumber).values({ companyId, phoneNumber: l.phoneNumber, forwardTo: l.forwardTo, name: l.label, source: l.label, provider: PROVIDER, providerId: l.sid, active: true })
      else if (!have.active) await db.update(trackingNumber).set({ active: true, updatedAt: new Date() }).where(eq(trackingNumber.id, have.id))
    }
    const held = new Set(r.lines.map((l) => l.sid))
    for (const t of mine as any[]) if (t.active && !held.has(t.providerId)) await db.update(trackingNumber).set({ active: false, updatedAt: new Date() }).where(eq(trackingNumber.id, t.id))
    const rows = await db.select().from(trackingNumber).where(and(eq(trackingNumber.companyId, companyId), eq(trackingNumber.provider, PROVIDER), eq(trackingNumber.active, true)))
    return { monthlyCents: r.monthlyCents, subscribed: r.subscribed, numbers: rows }
  }

  app.get('/', requirePermission('calltracking:read'), async (c) => {
    try { return one(c, { connected: true, ...(await inStep(c.get('user').companyId)) }) } catch (e: any) {
      // An app with no link to the Factory (the demo, a developer's machine — every business's app has one) is not a fault:
      // it has the numbers it already holds and cannot buy more here, and the screen says so instead of an error.
      if (Number(e?.status) === 503 && /not connected to Twomiah yet/.test(String(e?.message))) {
        const companyId = c.get('user').companyId
        const numbers = await db.select().from(trackingNumber).where(and(eq(trackingNumber.companyId, companyId), eq(trackingNumber.provider, PROVIDER), eq(trackingNumber.active, true)))
        return one(c, { connected: false, monthlyCents: null, subscribed: false, numbers })
      }
      return passOn(c, e)
    }
  })

  app.post('/', requirePermission('calltracking:create'), async (c) => {
    const user = c.get('user')
    const body = await c.req.json().catch(() => null) as { label?: unknown; forwardTo?: unknown; areaCode?: unknown } | null
    const label = typeof body?.label === 'string' ? body.label.trim() : ''
    const forwardTo = typeof body?.forwardTo === 'string' ? body.forwardTo.trim() : ''
    if (!label) return fail(c, 400, 'Name the number — what it is for ("Google Ads", "Yard signs").', 'validation_failed')
    if (String(forwardTo).replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '').length !== 10) return fail(c, 400, 'The number to ring must be a US phone number.', 'validation_failed')
    const origin = ownOrigin(c.req.url)
    try {
      const r = await factory.buyTrackingLine({
        label, forwardTo, areaCode: typeof body?.areaCode === 'string' && body.areaCode.trim() ? body.areaCode.trim() : undefined,
        voiceUrl: `${origin}/api/calltracking/voice/${user.companyId}`, statusUrl: `${origin}/api/calltracking/webhook/twilio/${user.companyId}`,
        returnUrl: `${origin}/crm/call-tracking`,
      })
      if (r.checkoutUrl) return one(c, { checkoutUrl: r.checkoutUrl })
      const l = r.line!
      const [row] = await db.insert(trackingNumber).values({ companyId: user.companyId, phoneNumber: l.phoneNumber, forwardTo: l.forwardTo, name: l.label, source: l.label, provider: PROVIDER, providerId: l.sid, active: true }).returning()
      return one(c, { number: row }, 201)
    } catch (e: any) { return passOn(c, e) }
  })

  app.post('/:id/release', requirePermission('calltracking:update'), async (c) => {
    const user = c.get('user')
    const [row] = await db.select().from(trackingNumber).where(and(eq(trackingNumber.id, c.req.param('id')), eq(trackingNumber.companyId, user.companyId), eq(trackingNumber.provider, PROVIDER))).limit(1)
    if (!row || !(row as any).active) return fail(c, 404, 'Not one of your numbers')
    try {
      await factory.releaseTrackingLine((row as any).providerId)
      await db.update(trackingNumber).set({ active: false, updatedAt: new Date() }).where(eq(trackingNumber.id, (row as any).id))
      return one(c, { released: true })
    } catch (e: any) { return passOn(c, e) }
  })

  return app
}
