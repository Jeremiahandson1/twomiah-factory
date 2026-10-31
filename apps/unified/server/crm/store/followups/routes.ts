// The post-purchase emails' settings at /api/admin/followups (access 'user', behind the hidden feature store_followups;
// 2026-10-31, parity row 3). The Menu row asks the same feature and permission (marketing:read to look, marketing:update to
// change). GET returns the settings, the wording each email falls back to, how many have gone out, and the saved segments
// an email can be limited to; PUT changes any part of them.
import { Hono } from 'hono'
import { z } from 'zod'
import { asc, eq } from 'drizzle-orm'
import type { Context } from 'hono'
import { MERGE_FIELDS } from '@twomiah/tenant-backend'
import { storeSegment } from '../../../db/schema/store.ts'
import { followupsSent } from '../../../data/storeFollowups.ts'
import type { AppEnv } from '../../../http/env.ts'
import { fail, one } from '../../../http/reply.ts'
import type { CrmDeps } from '../../deps.ts'
import { DAYS_MAX, DAYS_MIN, DEFAULTS, FollowupError, SHIPPED_NOTE, type Followups } from './followups.ts'

const text = (max: number) => z.string().max(max).nullable().optional()
const one3 = (extra: z.ZodRawShape = {}) => z.object({ on: z.boolean().optional(), subject: text(300), body: text(100_000), ...extra }).strict().optional()
const inputSchema = z.object({
  segmentId: z.string().min(1).max(100).nullable().optional(),
  firstOrder: one3({ days: z.number().int().optional() }),
  crossSell: one3({ days: z.number().int().optional() }),
  replenish: one3(),
}).strict()

export function createFollowupRoutes(d: CrmDeps, followups: Followups) {
  const { db } = d
  const { requirePermission } = d.permissions
  const app = new Hono<AppEnv>()
  const own = (c: Context) => (c as any).get('user').companyId as string
  app.use('*', requirePermission('marketing:read'))

  app.get('/', async (c) => {
    const companyId = own(c)
    const [settings, sent, segments] = await Promise.all([
      followups.get(companyId), followupsSent(db, companyId),
      db.select({ id: storeSegment.id, name: storeSegment.name }).from(storeSegment).where(eq(storeSegment.companyId, companyId)).orderBy(asc(storeSegment.name)).limit(200),
    ])
    return one(c, {
      ...settings,
      sent: { firstOrder: sent.store_first_order, crossSell: sent.store_cross_sell, replenish: sent.store_replenish },
      defaults: { firstOrder: DEFAULTS.first_order, crossSell: DEFAULTS.cross_sell, replenish: DEFAULTS.replenish },
      days: { min: DAYS_MIN, max: DAYS_MAX },
      mergeFields: MERGE_FIELDS,
      segments,
      note: SHIPPED_NOTE,
    })
  })

  app.put('/', requirePermission('marketing:update'), async (c) => {
    const parsed = inputSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return fail(c, 400, 'Check the follow-up emails: days are whole numbers and the wording must be text.', 'validation_failed')
    try {
      const saved = await followups.save(own(c), parsed.data)
      await d.audit.log({ action: 'update', entity: 'followup_emails', entityId: own(c), entityName: 'Post-purchase emails', companyId: own(c), req: c })
      return one(c, saved)
    } catch (e: any) {
      if (e instanceof FollowupError) return fail(c, e.status as 400, e.message, 'validation_failed', e.fields)
      throw e
    }
  })
  return app
}
