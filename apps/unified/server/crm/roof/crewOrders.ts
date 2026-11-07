// /api/crew-orders — a crew member's work orders in the phone app (roofing parity row 29; AccuLynx Crew App; feature crew_app, not
// ready). A seat is on a crew through its crew login (crew_login, set on the Crews page); it sees that crew's open work orders (sent,
// accepted, in progress) and the ones it finished in the last week. Each comes with its token: the phone answers through the crew
// link's own routes (/api/crew-link/:token/accept | reject | arrive | leave | check | complete — crewLink.ts), the same rules the
// no-sign-in page has, so there is one way an order moves. The page itself (linkUrl) is where photos are added.
//
//   GET /         the seat's crews' work orders, as the crew page shows each            jobs:read
//   GET /:token   one of them (only a token of the seat's own crews)                   jobs:read
import { Hono } from 'hono'
import { and, desc, eq, gte, inArray, or } from 'drizzle-orm'
import { crewLogin, workOrder } from '../../db/schema/index.ts'
import type { CrmDeps } from '../deps.ts'
import type { AppEnv } from '../../http/env.ts'
import { fail, listAll, one } from '../../http/reply.ts'
import { createCrewView } from './crewLink.ts'
import { appOrigin, WORK_ORDER_PAGE } from './workOrders.ts'

export const CREW_APP = 'crew_app'
const OPEN = ['sent', 'accepted', 'in_progress']

export function createCrewOrderRoutes(d: CrmDeps) {
  const { db } = d
  const app = new Hono<AppEnv>()
  const crewView = createCrewView(d)
  const on = (c: any) => d.features.isFeatureEnabled(c.get('user').companyId, CREW_APP).catch(() => false)
  /** The seat's crews' orders it may see: open ones, and ones finished in the last week. */
  const mine = async (companyId: string, userId: string) => {
    const crews = (await db.select({ crewId: crewLogin.crewId }).from(crewLogin).where(and(eq(crewLogin.companyId, companyId), eq(crewLogin.userId, userId)))).map((r: any) => r.crewId).filter(Boolean)
    if (!crews.length) return []
    const weekAgo = new Date(Date.now() - 7 * 86_400_000)
    return db.select().from(workOrder).where(and(eq(workOrder.companyId, companyId), inArray(workOrder.crewId, crews),
      or(inArray(workOrder.status, OPEN), and(eq(workOrder.status, 'completed'), gte(workOrder.completedAt, weekAgo)))))
      .orderBy(desc(workOrder.startDate), desc(workOrder.createdAt))
  }
  const shape = async (row: any) => {
    const origin = appOrigin()
    return { id: row.publicToken, ...(await crewView(row)), ...(origin ? { linkUrl: `${origin}${WORK_ORDER_PAGE}/${row.publicToken}` } : {}) }
  }

  app.get('/', d.permissions.requirePermission('jobs:read'), async (c) => {
    if (!(await on(c))) return fail(c, 404, 'Not found')
    const u = c.get('user')
    const rows = (await mine(u.companyId, u.userId)).filter((r: any) => r.publicToken)
    return listAll(c, await Promise.all(rows.map(shape)))
  })

  app.get('/:token', d.permissions.requirePermission('jobs:read'), async (c) => {
    if (!(await on(c))) return fail(c, 404, 'Not found')
    const u = c.get('user')
    const row = (await mine(u.companyId, u.userId)).find((r: any) => r.publicToken && r.publicToken === c.req.param('token'))
    if (!row) return fail(c, 404, 'Work order not found')
    return one(c, await shape(row))
  })

  return app
}
