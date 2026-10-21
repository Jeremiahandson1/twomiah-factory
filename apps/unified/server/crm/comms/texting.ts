// Texting from the business's OWN number — Settings › Texting (web/src/crm/pages/TextingPage.tsx).
//
// The business registers itself with the carriers (A2P 10DLC) through Twomiah: its own brand, campaign and local
// number, the way Jobber and Housecall Pro do it, so a customer's reply comes back here and its sending reputation is
// its own. The Factory holds the registration (services/a2p.ts there) — the EIN is encrypted there and never kept
// here; these routes pass the owner's details through with the business's own Factory key (never the browser's).
//
//   GET  /api/texting                       where it stands, and the number texts go out from
//   POST /api/texting/registration          save the details and submit them              company:update
//   POST /api/texting/registration/refresh  ask the carriers again                         company:update
//   POST /api/texting/registration/resend   a sole proprietor's YES text, again            company:update
//   POST /api/internal/texting              the Factory, once approved: the business's Messaging Service and number
//                                           into company.integrations (packages twilio.ts twilioConfigFor reads them)
import { Hono } from 'hono'
import { asc, eq } from 'drizzle-orm'
import { company } from '../../db/schema/index.ts'
import { fail, one } from '../../http/reply.ts'
import type { AppEnv } from '../../http/env.ts'
import type { CrmDeps } from '../deps.ts'

export interface TextingFactory {
  getTextingRegistration(): Promise<any>
  submitTextingRegistration(details: Record<string, unknown>): Promise<any>
  refreshTextingRegistration(): Promise<any>
  resendTextingConfirmation(): Promise<any>
}

/** A Factory refusal carried through in its own words, status and code (a 402 "add funds first" stays a 402). */
const passOn = (c: any, e: any) => {
  const status = Number(e?.status) >= 400 && Number(e?.status) < 600 ? Number(e.status) : 502
  const up = e?.upstream && typeof e.upstream === 'object' ? e.upstream : {}
  return fail(c, status as any, String(up.rejectionReason || up.error || e?.message || 'Twomiah could not be reached'), typeof up.code === 'string' ? up.code : undefined)
}

export function createTextingRoutes(d: CrmDeps, factory: TextingFactory) {
  const { db } = d
  const { requirePermission } = d.permissions
  const app = new Hono<AppEnv>()

  const sender = async (companyId: string) => {
    const [row] = await db.select({ integrations: company.integrations }).from(company).where(eq(company.id, companyId)).limit(1)
    const j = (row?.integrations || {}) as Record<string, any>
    return j.twilioMessagingServiceSid ? { phoneNumber: j.twilioPhoneNumber || null } : null
  }

  app.get('/', requirePermission('company:read'), async (c) => {
    const own = await sender(c.get('user').companyId)
    let registration: any = null
    try { registration = await factory.getTextingRegistration() } catch (e: any) { registration = { error: e?.message || 'Twomiah could not be reached' } }
    return one(c, { sender: own, registration })
  })

  app.post('/registration', requirePermission('company:update'), async (c) => {
    const details = await c.req.json().catch(() => null)
    if (!details || typeof details !== 'object') return fail(c, 400, 'Send the registration details.')
    try { return one(c, await factory.submitTextingRegistration(details)) } catch (e: any) { return passOn(c, e) }
  })
  app.post('/registration/refresh', requirePermission('company:update'), async (c) => {
    try { return one(c, await factory.refreshTextingRegistration()) } catch (e: any) { return passOn(c, e) }
  })
  app.post('/registration/resend', requirePermission('company:update'), async (c) => {
    try { return one(c, await factory.resendTextingConfirmation()) } catch (e: any) { return passOn(c, e) }
  })
  return app
}

/** The Factory, once the carriers approve: this business's own sender. Mounted access 'factory'. */
export function createTextingInternalRoutes(d: CrmDeps) {
  const app = new Hono<AppEnv>()
  // One business per tenant database (SPEC §2): the oldest row is the business.
  const companyId = async () => (await d.db.select({ id: company.id }).from(company).orderBy(asc(company.createdAt)).limit(1))[0]?.id ?? null
  app.post('/', async (c) => {
    const b = await c.req.json().catch(() => ({} as any))
    const sid = String(b?.messagingServiceSid || '')
    const phone = String(b?.phoneNumber || '')
    if (!/^MG[0-9a-f]{32}$/.test(sid)) return fail(c, 400, 'messagingServiceSid must be a Twilio Messaging Service SID')
    if (!/^\+1\d{10}$/.test(phone)) return fail(c, 400, 'phoneNumber must be a US number in E.164 (+1…)')
    const id = await companyId()
    if (!id) return fail(c, 404, 'No business here yet')
    const [row] = await d.db.select({ integrations: company.integrations }).from(company).where(eq(company.id, id)).limit(1)
    const next = { ...((row?.integrations as Record<string, unknown>) || {}), twilioMessagingServiceSid: sid, twilioPhoneNumber: phone }
    await d.db.update(company).set({ integrations: next, updatedAt: new Date() }).where(eq(company.id, id))
    return one(c, { messagingServiceSid: sid, phoneNumber: phone })
  })
  return app
}
