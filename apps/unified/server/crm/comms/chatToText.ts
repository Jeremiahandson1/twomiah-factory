// CHAT-TO-TEXT (parity tier 3, field service — ServiceTitan's and Podium's website chat that continues by text; feature chat_to_text,
// not ready, and two_way_texting). A visitor types their name, mobile and a message into the website's "Text us" box
// (site/public/scripts/chat.ts) and:
//   · it is a lead in the Lead Inbox (platform website_chat) and the customer is found by their number, or made;
//   · with the "text me" box ticked — never required, the site's consent rule (site/smsConsent.ts) — the consent is kept and the
//     message lands in the texting inbox as a text from their number, so the office simply replies by text. Unticked, the office
//     answers by phone or email; nothing is texted to them.
//
//   POST /api/chat-to-text   { name, phone, message, smsConsent?, website? (honeypot), page? }   public, a few a quarter-hour per address
import { Hono } from 'hono'
import { z } from 'zod'
import { asc } from 'drizzle-orm'
import { insertLead } from '@twomiah/tenant-backend'
import { company, lead } from '../../db/schema/index.ts'
import { contactForPhone, threadWebsiteMessage } from '../../data/chatToText.ts'
import type { AppEnv } from '../../http/env.ts'
import { done, fail } from '../../http/reply.ts'
import type { CrmDeps } from '../deps.ts'
import { phoneE164, recordConsent, ticked } from '../../site/smsConsent.ts'

export const CHAT_TO_TEXT = 'chat_to_text'
const WINDOW_MS = 15 * 60 * 1000
const MAX_PER_WINDOW = 4
const body = z.object({
  name: z.string({ error: 'Your name, please' }).trim().min(1, 'Your name, please').max(80),
  phone: z.string({ error: 'Your mobile number, please' }).trim().min(7, 'Your mobile number, please').max(30),
  message: z.string({ error: 'Your message, please' }).trim().min(1, 'Your message, please').max(1000, 'At most 1,000 characters'),
  website: z.string().max(200).optional(),
  page: z.string().max(300).optional(),
}).passthrough()

const clientIp = (c: any) => (c.req.header('X-Forwarded-For') || '').split(',')[0].trim() || c.req.header('CF-Connecting-IP') || c.req.header('X-Real-IP') || 'unknown'

export function createChatToTextRoutes(d: CrmDeps) {
  const { db, logger } = d
  const app = new Hono<AppEnv>()
  const recent = new Map<string, number[]>()

  app.post('/', async (c) => {
    const ip = clientIp(c)
    const now = Date.now()
    const hits = (recent.get(ip) || []).filter((t) => now - t < WINDOW_MS)
    if (hits.length >= MAX_PER_WINDOW) return fail(c, 429, 'Thanks — we already have your messages. We will be in touch soon.')
    recent.set(ip, [...hits, now])
    const raw = await c.req.json().catch(() => null)
    const parsed = body.safeParse(raw)
    if (!parsed.success) return fail(c, 400, parsed.error.issues[0]?.message || 'Check the form.')
    const b = parsed.data
    if (b.website) return done(c, 'Thanks — we will text you back soon.') // a bot filled the hidden box: thanked, nothing kept
    const phone = phoneE164(b.phone)
    if (!phone) return fail(c, 400, 'That does not look like a mobile number.')
    const [co] = await db.select({ id: company.id }).from(company).orderBy(asc(company.createdAt)).limit(1)
    if (!co || !(await d.features.isFeatureEnabled(co.id, [CHAT_TO_TEXT])) || !(await d.features.isFeatureEnabled(co.id, ['two_way_texting']))) return fail(c, 404, 'Not found')
    const wantsTexts = ticked(raw as any)

    // The customer, by their number; else a new one from the chat.
    const contactId = await contactForPhone(db, co.id, phone, b.name)

    // The Lead Inbox, where the office works new enquiries.
    await insertLead(db, lead, { companyId: co.id, sourceId: null, platform: 'website_chat', parsed: { name: b.name, phone, description: b.message }, rawPayload: { page: b.page ?? null, textsOk: wantsTexts } } as any)
      .catch((e: any) => logger.warn?.('[chat-to-text] lead not saved', { error: e?.message }))

    if (wantsTexts) {
      await recordConsent(db, co.id, { phone, source: 'website_form', topic: 'enquiry', page: b.page ?? null, ip })
      // In the texting inbox as their text, so a reply goes back to their phone.
      await threadWebsiteMessage(db, co.id, phone, contactId, `[From the website chat] ${b.message}`)
      d.realtime.emitToCompany(co.id, d.realtime.EVENTS.LEAD_CREATED, { sourcePlatform: 'website_chat' })
      return done(c, 'Thanks — we will text you back soon.')
    }
    d.realtime.emitToCompany(co.id, d.realtime.EVENTS.LEAD_CREATED, { sourcePlatform: 'website_chat' })
    return done(c, 'Thanks — we will be in touch soon.')
  })

  return app
}
