// Home care's texting screen (/api/sms): its message templates, a single text and the bulk message to caregivers or
// clients. Moved from templates/crm-homecare/backend/src/routes/sms.ts.
//
// Mounted at /api/sms IN FRONT OF the CRM's shared texting module (packages/tenant-backend integrations/sms.ts — the
// conversations, auto-responders and Twilio's webhooks), composed for the home-care vertical in server/modules/crm.ts.
// Home care's /templates (its own sms_templates rows), /messages, /send and /send-bulk answer first; every other path
// is the CRM's. Nothing here is mounted with `use('*')`, so the CRM's webhooks are untouched.
//
// Changes from the template:
//   · permissions, not rank: the whole router was requireAdmin; reading is care-portal:update and sending or writing a
//     template care-portal:create / :update (a caregiver holds only care-portal:read);
//   · POST /send goes through the CRM's ONE texting service (services.sms.sendSMS: the company's own number or the
//     platform's, the usage wallet, the number check, and the text filed in the conversation) instead of a second
//     Twilio client; a refused send (no number set up, an empty wallet) is a 503 with the service's words, a number
//     that cannot be dialled a 400, a carrier failure a 502;
//   · POST /send-bulk texts through the home-care foundation's sender (core.notify.sendText), as the template did,
//     after the one preference gate (core.prefs.shouldNotify); a caregiver id is a caregiver of THIS company
//     (the template compared role 'caregiver' only; a moved tenant's caregivers are 'caregiver', a new one's 'field');
//   · templates are the company's; GET /messages is an empty list reply ({ data, pagination }; was { messages: [] }),
//     GET /templates a list reply.
import { Hono, type Context } from 'hono'
import { twilioConfigured } from '@twomiah/tenant-backend'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { smsTemplates, user, clients } from '../../../db/schema/index.ts'
import { done, fail, list, one } from '../../../http/reply.ts'
import type { AppEnv } from '../../../http/env.ts'
import type { CrmDeps } from '../../deps.ts'
import type { HomecareCore } from '../core/index.ts'

const all = <T,>(c: Context, rows: T[]) => list(c, rows, { page: 1, limit: rows.length, total: rows.length })
const NOT_CONFIGURED = 'SMS not configured. Add Twilio credentials to enable SMS.'

export function createHomecareSmsRoutes(core: HomecareCore, d: CrmDeps) {
  const { db } = d
  const app = new Hono<AppEnv>()
  // A public mount (the CRM's webhooks share the path): each route signs the person in itself — and is the Two-Way Texting
  // switch's (two_way_texting): off, the agency's SMS page and its sends are refused, as its menu item is gone (2026-10-22).
  const staff = (permission: string) => [d.authenticate, d.features.requireEnabledFeature('two_way_texting'), d.permissions.requirePermission(permission)] as const

  // GET /messages — outbound texts from this screen are not kept as a history of their own (the CRM's conversations
  // hold what /send sends), so there is nothing to list here yet: an empty list, not a 404.
  app.get('/messages', ...staff('care-portal:update'), async (c) => all(c, []))

  // GET /templates — the company's reusable texts.
  app.get('/templates', ...staff('care-portal:update'), async (c) => {
    const rows = await db.select().from(smsTemplates)
      .where(and(eq(smsTemplates.companyId, c.get('user').companyId), eq(smsTemplates.isActive, true)))
      .orderBy(asc(smsTemplates.name))
    return all(c, rows)
  })

  app.post('/templates', ...staff('care-portal:create'), async (c) => {
    const b = await c.req.json().catch(() => ({} as any))
    if (!b?.name || !b?.body) return fail(c, 400, 'name and body are required')
    const [row] = await db.insert(smsTemplates).values({
      companyId: c.get('user').companyId, name: String(b.name), body: String(b.body), category: b.category || null,
    }).returning()
    return one(c, row, 201)
  })

  // Edit was missing — the pencil control 404'd (create + delete worked). (M-15)
  app.put('/templates/:id', ...staff('care-portal:update'), async (c) => {
    const b = await c.req.json().catch(() => ({} as any))
    const patch: Record<string, any> = {}
    if (b.name !== undefined) patch.name = b.name
    if (b.body !== undefined) patch.body = b.body
    if (b.category !== undefined) patch.category = b.category || null
    if (!Object.keys(patch).length) return fail(c, 400, 'Nothing to change')
    const [row] = await db.update(smsTemplates).set(patch)
      .where(and(eq(smsTemplates.id, c.req.param('id')), eq(smsTemplates.companyId, c.get('user').companyId))).returning()
    if (!row) return fail(c, 404, 'Template not found')
    return one(c, row)
  })

  // DELETE /templates/:id — the screen's delete. The template's router had none, so the button fell through to another
  // router (here the CRM's texting module, which answered success and removed nothing). Retired, not erased: the list
  // shows active templates.
  app.delete('/templates/:id', ...staff('care-portal:delete'), async (c) => {
    const [row] = await db.update(smsTemplates).set({ isActive: false })
      .where(and(eq(smsTemplates.id, c.req.param('id')), eq(smsTemplates.companyId, c.get('user').companyId))).returning({ id: smsTemplates.id })
    if (!row) return fail(c, 404, 'Template not found')
    return done(c)
  })

  // POST /send { to, body } — one text, through the CRM's texting service.
  app.post('/send', ...staff('care-portal:create'), async (c) => {
    const me = c.get('user')
    const { to, body } = await c.req.json().catch(() => ({} as any))
    if (!to || typeof body !== 'string' || !body.trim()) return fail(c, 400, 'to and body are required')
    let sent: any
    try {
      sent = await d.services.sms.sendSMS(me.companyId, { toPhone: String(to), message: body, userId: me.userId })
    } catch (err) {
      // A number that cannot be dialled (or none) is refused before anything is spent.
      return fail(c, 400, (err as Error).message || 'That is not a phone number we can text')
    }
    if (!sent) return fail(c, 400, 'That number has opted out of texts')
    if (sent.refused) return fail(c, 503, sent.errorMessage || NOT_CONFIGURED, 'sms_not_configured')
    if (sent.status === 'failed') return fail(c, 502, sent.errorMessage || 'The text could not be sent', 'sms_failed')
    return one(c, { sid: sent.twilioSid ?? null, status: sent.status })
  })

  // POST /send-bulk — { recipientType: 'caregiver' | 'client', recipientIds, body }. Each text goes through the shared
  // sender (E.164, usage reporting); a caregiver who switched SMS off, or is in quiet hours, is skipped by the one
  // preference gate every other send path uses.
  app.post('/send-bulk', ...staff('care-portal:create'), async (c) => {
    const me = c.get('user')
    const b = await c.req.json().catch(() => ({} as any))
    const type = b?.recipientType
    const ids: string[] = Array.isArray(b?.recipientIds) ? [...new Set(b.recipientIds.map(String))] as string[] : []
    const text = typeof b?.body === 'string' ? b.body.trim() : ''
    if (type !== 'caregiver' && type !== 'client') return fail(c, 400, "recipientType must be 'caregiver' or 'client'")
    if (!ids.length || !text) return fail(c, 400, 'Select recipients and enter a message')
    if (ids.length > 500) return fail(c, 400, 'At most 500 recipients per send')
    // The business's own sender, as sendSMS reads it (its registered number, or none yet) — not the platform's env.
    if (!twilioConfigured(await d.services.sms.twilioConfigFor(me.companyId))) return fail(c, 503, NOT_CONFIGURED, 'sms_not_configured')
    let people: { id: string; phone: string | null }[]
    if (type === 'caregiver') {
      const rows = await db.select({ id: user.id, phone: user.phone, role: user.role }).from(user)
        .where(and(eq(user.companyId, me.companyId), inArray(user.id, ids)))
      // A caregiver is the field rung, whatever the stored name ('caregiver' on a moved tenant, 'field' on a new one).
      people = rows.filter((r: any) => d.permissions.normalizeRole(r.role) === 'field')
    } else {
      people = await db.select({ id: clients.id, phone: clients.phone }).from(clients)
        .where(and(eq(clients.companyId, me.companyId), inArray(clients.id, ids)))
    }
    let sent = 0, skipped = 0, failed = 0
    for (const p of people) {
      if (type === 'caregiver' && !(await core.prefs.shouldNotify(p.id, 'sms', 'message'))) { skipped++; continue }
      if (!p.phone) { skipped++; continue }
      if (await core.notify.sendText({ companyId: me.companyId, phone: p.phone, body: text })) sent++
      else failed++
    }
    return one(c, { sent, skipped, failed, unknown: ids.length - people.length })
  })

  return app
}
