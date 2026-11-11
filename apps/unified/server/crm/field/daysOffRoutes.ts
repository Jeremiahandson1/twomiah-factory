// /api/days-off — the business's whole days off (holidays), for every trade (parity tier 2, 11/10). The rows are online booking's
// own (data/daysOff.ts), so a day off set here closes online booking too, and one set under Bookings shows here.
//   GET    ?from&to   jobs:read      the days in a stretch (the Dispatch Board's banner; the page's list from today)
//   POST   {date, reason}  jobs:dispatch  add one (the same day again answers the one there)
//   DELETE /:id        jobs:dispatch  remove one (never a person's own time off)
import { Hono } from 'hono'
import { z } from 'zod'
import { companyTimeZone, storeDateString } from '@twomiah/tenant-backend'
import type { AppEnv } from '../../http/env.ts'
import type { CrmDeps } from '../deps.ts'
import { done, fail, listAll, one } from '../../http/reply.ts'
import { invalid } from '../../http/errors.ts'
import { addDayOff, daysOffBetween, removeDayOff } from '../../data/daysOff.ts'

const YMD = /^\d{4}-\d{2}-\d{2}$/
const realDay = (v: string) => YMD.test(v) && !isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v
const day = z.string().refine(realDay, 'A day like 2026-11-26')
const addSchema = z.object({ date: day, reason: z.string().trim().max(200).optional().nullable() })
const DAY_MS = 86_400_000
const plus = (key: string, n: number) => new Date(Date.parse(`${key}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10)

export function createDaysOffRoutes(d: CrmDeps) {
  const { db, audit } = d
  const { requirePermission } = d.permissions
  const app = new Hono<AppEnv>()

  app.get('/', requirePermission('jobs:read'), async (c) => {
    const companyId = c.get('user').companyId
    const today = storeDateString(new Date(), await companyTimeZone(db, companyId))
    const from = c.req.query('from') || today
    const to = c.req.query('to') || plus(from, 366)
    if (!realDay(from) || !realDay(to) || to < from) return fail(c, 400, 'from and to are days like 2026-11-26, to on or after from.')
    if ((Date.parse(to) - Date.parse(from)) / DAY_MS > 800) return fail(c, 400, 'Ask for at most two years at a time.')
    return listAll(c, await daysOffBetween(db, companyId, from, to))
  })

  app.post('/', requirePermission('jobs:dispatch'), async (c) => {
    const parsed = addSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return invalid(c, parsed.error)
    const companyId = c.get('user').companyId
    const row = await addDayOff(db, companyId, parsed.data.date, parsed.data.reason || null)
    audit.log({ action: audit.ACTIONS.CREATE, entity: 'day_off', entityId: row.id, entityName: row.date, metadata: { description: `Closed on ${row.date}${row.reason ? ` (${row.reason})` : ''}` }, req: c })
    return one(c, row, 201)
  })

  app.delete('/:id', requirePermission('jobs:dispatch'), async (c) => {
    const companyId = c.get('user').companyId
    if (!(await removeDayOff(db, companyId, c.req.param('id')))) return fail(c, 404, 'That day off is not there.')
    audit.log({ action: audit.ACTIONS.DELETE, entity: 'day_off', entityId: c.req.param('id'), metadata: { description: 'Day off removed' }, req: c })
    return done(c)
  })

  return app
}
