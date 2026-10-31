// /api/visit-meals — what the client ate on a visit (care_family_content, not ready). The caregiver records breakfast, lunch, dinner or a
// snack: what was served and how much was eaten. The family sees it in their portal's "Daily care" tab; the office reads it here.
//
//   GET    /options                         { meals, amounts }   the lists the phone picks from   evv:read
//   GET    /visit/:timeEntryId              the meals recorded on that visit                     care-clients:read
//   PUT    /visit/:timeEntryId/:meal  { description, amountEaten, note?, savedAt? }   record or correct one meal   evv:update
//   DELETE /visit/:timeEntryId/:meal        take a wrongly recorded meal off the visit            evv:update
// A caregiver writes only their own visit, for a client they serve (careWriteRefusal); gated by the feature in the mount.
import { Hono } from 'hono'
import { and, eq } from 'drizzle-orm'
import { timeEntries } from '../../../db/schema/index.ts'
import type { AppEnv } from '../../../http/env.ts'
import { done, fail, one } from '../../../http/reply.ts'
import type { CrmDeps } from '../../deps.ts'
import type { HomecareCore } from '../core/index.ts'
import { AMOUNTS, MEALS } from '../core/familyContent.ts'
import { body, who, type ClientAccess } from '../clients/shared.ts'

export function createVisitMealRoutes(core: HomecareCore, d: CrmDeps, access: ClientAccess) {
  const app = new Hono<AppEnv>()
  const { requirePermission } = d.permissions
  const { db } = d
  const options = { meals: MEALS.map((m) => ({ code: m.code, label: m.label })), amounts: AMOUNTS.map((a) => ({ code: a.code, label: a.label })) }

  const loadEntry = async (companyId: string, id: string) =>
    (await db.select({ id: timeEntries.id, clientId: timeEntries.clientId, caregiverId: timeEntries.caregiverId }).from(timeEntries)
      .where(and(eq(timeEntries.id, id), eq(timeEntries.companyId, companyId))).limit(1))[0]

  app.get('/options', requirePermission('evv:read'), async (c) => one(c, options))

  app.get('/visit/:timeEntryId', requirePermission('care-clients:read'), async (c) => {
    const { user, companyId, me } = who(c)
    const entry = await loadEntry(companyId, c.req.param('timeEntryId')!)
    if (!entry) return fail(c, 404, 'Visit not found')
    if (entry.caregiverId !== me && !access.office(user)) return fail(c, 403, 'Not your shift')
    return one(c, { ...options, meals: await core.familyContent.mealsFor(companyId, entry.id) })
  })

  app.put('/visit/:timeEntryId/:meal', requirePermission('evv:update'), async (c) => {
    const { user, companyId, me } = who(c)
    const b = await body(c)
    const entry = await loadEntry(companyId, c.req.param('timeEntryId')!)
    if (!entry) return fail(c, 404, 'Visit not found')
    if (entry.caregiverId !== me && !access.office(user)) return fail(c, 403, 'Not your shift')
    const refused = await access.careWriteRefusal(c, entry.clientId)
    if (refused) return refused
    const res = await core.familyContent.recordMeal(companyId, entry, me, { ...b, meal: c.req.param('meal') })
    if (!res.ok) return fail(c, 400, res.message, res.code, res.fields)
    return one(c, { ...options, meals: await core.familyContent.mealsFor(companyId, entry.id) })
  })

  app.delete('/visit/:timeEntryId/:meal', requirePermission('evv:update'), async (c) => {
    const { user, companyId, me } = who(c)
    const entry = await loadEntry(companyId, c.req.param('timeEntryId')!)
    if (!entry) return fail(c, 404, 'Visit not found')
    if (entry.caregiverId !== me && !access.office(user)) return fail(c, 403, 'Not your shift')
    const refused = await access.careWriteRefusal(c, entry.clientId)
    if (refused) return refused
    await core.familyContent.removeMeal(companyId, entry.id, c.req.param('meal')!)
    return done(c)
  })

  return app
}
