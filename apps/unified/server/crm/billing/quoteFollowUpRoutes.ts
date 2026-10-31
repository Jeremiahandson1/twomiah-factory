// /api/quote-followup — the company's automatic quote follow-up (./quoteFollowUp.ts; feature quote_followup, not ready):
//   GET  /settings            quotes:read     the rules (Settings › Quote Follow-up)
//   PUT  /settings            company:update  change them — the owner and admins, as PUT /api/company
//   GET  /history/:quoteId    quotes:read     what was sent, or skipped and why, for one quote
import { Hono } from 'hono'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { company } from '../../db/schema/index.ts'
import type { AppEnv } from '../../http/env.ts'
import { one, listAll } from '../../http/reply.ts'
import { invalid } from '../../http/errors.ts'
import type { CrmDeps } from '../deps.ts'
import { SEND_FROM_HOUR } from './invoiceReminders.ts'
import { followUpSettings, type QuoteFollowUp } from './quoteFollowUp.ts'

const days = z.number({ error: 'Enter a whole number of days' }).int('Enter a whole number of days')
const settingsSchema = z.object({
  enabled: z.boolean(),
  afterDays: z.array(days.min(1, 'A follow-up is at least 1 day after the quote was sent').max(90, 'At most 90 days after')).max(3, 'At most 3 follow-ups'),
})

export function createQuoteFollowUpRoutes(d: CrmDeps, followUp: QuoteFollowUp) {
  const { db, audit } = d
  const { requirePermission } = d.permissions
  const app = new Hono<AppEnv>()
  const view = (settings: unknown) => ({ ...followUpSettings(settings), sendFromHour: SEND_FROM_HOUR })

  app.get('/settings', requirePermission('quotes:read'), async (c) => {
    const [co] = await db.select({ settings: company.settings }).from(company).where(eq(company.id, c.get('user').companyId)).limit(1)
    return one(c, view(co?.settings))
  })

  app.put('/settings', requirePermission('company:update'), async (c) => {
    const parsed = settingsSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return invalid(c, parsed.error)
    const companyId = c.get('user').companyId
    const [co] = await db.select({ settings: company.settings }).from(company).where(eq(company.id, companyId)).limit(1)
    const settings: any = (typeof co?.settings === 'string' ? JSON.parse(co.settings || '{}') : co?.settings) || {}
    const before = followUpSettings(settings)
    // Stored as the engine reads it back, so what the screen shows after saving is what will run.
    const next = followUpSettings({ quoteFollowUp: parsed.data })
    await db.update(company).set({ settings: { ...settings, quoteFollowUp: next }, updatedAt: new Date() } as any).where(eq(company.id, companyId))
    audit.log({ action: audit.ACTIONS.UPDATE, entity: 'company', entityId: companyId, metadata: { quoteFollowUp: { before, after: next } }, req: c })
    return one(c, view({ quoteFollowUp: next }))
  })

  app.get('/history/:quoteId', requirePermission('quotes:read'), async (c) => {
    return listAll(c, await followUp.historyFor(c.get('user').companyId, c.req.param('quoteId')))
  })

  return app
}
