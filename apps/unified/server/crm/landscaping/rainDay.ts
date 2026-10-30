// Rain day, on the Route Board's side: POST /api/recurring-routes/rain-day pushes a day's open jobs (or one route's) forward and
// can text the customers. Nothing is changed or sent unless `dryRun` is false; the screen previews first, then asks.
//
//   POST { date: YYYY-MM-DD, shift: 'day' | 'week' | 1–14 days, routeId?, excludeJobIds?, notify?, message?, dryRun? }
//
// Gated as the dispatch board's bulk reschedule is (jobs:update and jobs:dispatch), and the texts need sms:send as well — a
// request that asks for texts without it is refused whole, before anything moves. Mounted by landscaping/index.ts.
import { Hono } from 'hono'
import { JOB_DISPATCH_PERMISSION, companyTimeZone, businessToday } from '@twomiah/tenant-backend'
import { and, eq } from 'drizzle-orm'
import { recurringRoute } from '../../db/schema/index.ts'
import type { CrmDeps } from '../deps.ts'
import type { AppEnv } from '../../http/env.ts'
import { fail, one } from '../../http/reply.ts'
import { rainDay, rainDayTexts, queueRainDayTexts, RAIN_SHIFT_MAX, getRainDaySettings, setRainDaySkipSundays } from '../../data/routeRainDay.ts'

const DAY = /^\d{4}-\d{2}-\d{2}$/
const MAX_TEXT = 1600

export function createRainDayRoutes(d: CrmDeps) {
  const { db, audit } = d
  const { requirePermission, hasPermission, getExtraPermissions } = d.permissions
  const app = new Hono<AppEnv>()

  const may = async (c: any, perm: string): Promise<boolean> => {
    const u = c.get('user')
    try { return hasPermission(u?.role, perm, await getExtraPermissions(u?.userId)) } catch { return false }
  }

  // The business's rain day switch: "Skip Sundays when moving visits" (default on). Read by anyone who sees jobs; changed by the
  // seats that may run a rain day (the same two asks).
  app.get('/settings', requirePermission('jobs:read'), async (c) => one(c, await getRainDaySettings(db, c.get('user').companyId)))
  app.put('/settings', requirePermission('jobs:update'), requirePermission(JOB_DISPATCH_PERMISSION), async (c) => {
    const u = c.get('user')
    const b: any = await c.req.json().catch(() => ({}))
    if (typeof b?.skipSundays !== 'boolean') return fail(c, 400, 'Say whether to skip Sundays (on or off).', undefined, { skipSundays: 'Required' })
    const saved = await setRainDaySkipSundays(db, u.companyId, b.skipSundays)
    audit.log({ req: c, action: audit.ACTIONS.UPDATE, entity: 'landscaping_setting', entityId: u.companyId, entityName: `Rain day: skip Sundays ${saved.skipSundays ? 'on' : 'off'}`, userId: u.userId, companyId: u.companyId })
    return one(c, saved)
  })

  app.post('/', requirePermission('jobs:update'), requirePermission(JOB_DISPATCH_PERMISSION), async (c) => {
    const u = c.get('user')
    const b: any = await c.req.json().catch(() => ({}))
    const date = String(b?.date || '')
    if (!DAY.test(date) || Number.isNaN(Date.parse(date))) return fail(c, 400, 'Pick the day the rain stops work (YYYY-MM-DD).', undefined, { date: 'Required' })
    const tz = await companyTimeZone(db, u.companyId)
    const today = businessToday(tz).toISOString().slice(0, 10)
    if (date < today) return fail(c, 400, 'Pick today or a day coming up — a day that has passed has nothing left to push.', undefined, { date: 'In the past' })
    const shift = b?.shift === 'day' || b?.shift == null || b?.shift === '' ? 1 : b.shift === 'week' ? 7 : Number(b.shift)
    if (!Number.isInteger(shift) || shift < 1 || shift > RAIN_SHIFT_MAX) return fail(c, 400, `Push forward a day, a week, or 1 to ${RAIN_SHIFT_MAX} days.`, undefined, { shift: 'Invalid' })
    const notify = b?.notify === true
    if (notify && !(await may(c, 'sms:send'))) return fail(c, 403, 'Texting customers is for a seat that may send texts. Push the jobs without texts, or ask an owner or manager.', undefined, { notify: 'Not allowed' })
    const message = typeof b?.message === 'string' && b.message.trim() ? b.message.trim() : null
    if (message && message.length > MAX_TEXT) return fail(c, 400, `A text is at most ${MAX_TEXT} characters.`, undefined, { message: 'Too long' })
    const routeId = b?.routeId ? String(b.routeId) : null
    if (routeId) {
      const [found] = await db.select({ id: recurringRoute.id }).from(recurringRoute).where(and(eq(recurringRoute.id, routeId), eq(recurringRoute.companyId, u.companyId))).limit(1)
      if (!found) return fail(c, 404, 'Route not found')
    }
    const excludeJobIds: string[] = Array.isArray(b?.excludeJobIds) ? b.excludeJobIds.map(String) : []
    const dryRun = b?.dryRun !== false
    const opts = { date, shiftDays: shift, routeId, excludeJobIds, skipSundays: (await getRainDaySettings(db, u.companyId)).skipSundays }

    const plan = await rainDay(db, u.companyId, opts, !dryRun)
    const text = notify ? await rainDayTexts(db, u.companyId, plan.moves.map((m: any) => ({ contactId: m.contactId, title: m.title, from: m.from, to: m.to })), message, new Date(), tz) : null
    let queued = 0
    if (!dryRun) {
      if (text) queued = await queueRainDayTexts(db, u.companyId, u.userId, text.texts)
      for (const m of plan.moves) d.realtime.emitToCompany(u.companyId, d.realtime.EVENTS.JOB_UPDATED, { id: m.id, scheduledDate: m.to })
      audit.log({
        req: c, action: audit.ACTIONS.UPDATE, entity: 'rain_day', entityId: routeId || date, entityName: `Rain day ${date}`,
        userId: u.userId, companyId: u.companyId, metadata: { date, to: plan.toDate, moved: plan.moved, blocked: plan.blocked.length, texts: queued },
      })
    }
    return one(c, {
      dryRun, date, toDate: plan.toDate, shiftDays: shift, skippedSunday: !!plan.skippedSunday,
      moved: dryRun ? 0 : plan.moved,
      wouldMove: plan.moves.length,
      jobs: plan.moves.map((m: any) => ({ id: m.id, number: m.number, title: m.title, scheduledTime: m.scheduledTime, from: m.from, to: m.to })),
      blocked: plan.blocked, overlaps: plan.overlaps,
      texts: text ? {
        queued, willText: text.texts.length, sendAt: text.texts[0]?.sendAt ?? null,
        preview: text.texts.slice(0, 3).map((t) => ({ name: t.name, body: t.body })),
        skipped: text.skipped, jobsWithoutCustomer: text.noContact,
      } : null,
    })
  })

  return app
}
