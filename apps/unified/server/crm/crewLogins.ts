// Which logins are on a crew (crew_login): a roofing crew (Crews page, /api/crews/:id/logins, crews:update) or a roster
// crew (Team page, /api/team/:id/logins, team:update). A field seat without jobs:read-all reads its crews' jobs as its
// own (ownWork.ts). Crews held a foreman's name and no login, so no crew's work reached anyone's phone (2026-10-24).
import { Hono } from 'hono'
import { z } from 'zod'
import { and, eq, inArray } from 'drizzle-orm'
import { mayBeGivenWork } from '@twomiah/tenant-backend'
import { crewLogin, teamMember, user } from '../db/schema/index.ts'
import type { AppEnv } from '../http/env.ts'
import { fail, listAll, one } from '../http/reply.ts'

export type CrewKind = 'crewId' | 'teamMemberId'
export type LoginRef = { id: string; name: string }

const userIdsSchema = z.object({ userIds: z.array(z.string().min(1).max(64)).max(100) })

/** The logins on each of these crews: id → [{ id, name }]. */
export async function loginsOn(db: any, companyId: string, kind: CrewKind, ids: string[]): Promise<Record<string, LoginRef[]>> {
  const out: Record<string, LoginRef[]> = {}
  if (!ids.length) return out
  const col = crewLogin[kind]
  const rows = await db.select({ crew: col, id: user.id, firstName: user.firstName, lastName: user.lastName, email: user.email })
    .from(crewLogin).innerJoin(user, eq(user.id, crewLogin.userId))
    .where(and(eq(crewLogin.companyId, companyId), inArray(col, ids)))
  for (const r of rows) (out[r.crew] ||= []).push({ id: r.id, name: `${r.firstName || ''} ${r.lastName || ''}`.trim() || r.email })
  return out
}

/**
 * Put exactly these logins on the crew. Each must be a login of this company that can be given work (team/work.ts: not
 * a view-only or switched-off seat). Answers an error to show, or null when saved.
 */
export async function setLoginsOn(db: any, companyId: string, kind: CrewKind, crewId: string, body: unknown): Promise<string | null> {
  const parsed = userIdsSchema.safeParse(body)
  if (!parsed.success) return 'Send userIds: the logins on this crew.'
  const ids = [...new Set(parsed.data.userIds)]
  if (ids.length) {
    const found = await db.select({ id: user.id, role: user.role, isActive: user.isActive }).from(user).where(and(eq(user.companyId, companyId), inArray(user.id, ids)))
    if (found.length !== ids.length) return 'One of those logins is not on this account.'
    if (found.some((u: any) => !mayBeGivenWork(u))) return 'A view-only or switched-off login cannot be put on a crew.'
  }
  await db.transaction(async (tx: any) => {
    await tx.delete(crewLogin).where(and(eq(crewLogin.companyId, companyId), eq(crewLogin[kind], crewId)))
    if (ids.length) await tx.insert(crewLogin).values(ids.map((userId) => ({ companyId, userId, [kind]: crewId })))
  })
  return null
}

/** The Team page's side: GET /logins (team:read) and PUT /:id/logins (team:update), mounted ahead of /api/team. */
export function createTeamLoginRoutes(d: { db: any; requirePermission: (p: string) => any }) {
  const { db, requirePermission } = d
  const app = new Hono<AppEnv>()
  app.get('/logins', requirePermission('team:read'), async (c) => {
    const { companyId } = c.get('user')
    const members = await db.select({ id: teamMember.id }).from(teamMember).where(eq(teamMember.companyId, companyId))
    const map = await loginsOn(db, companyId, 'teamMemberId', members.map((m: any) => m.id))
    return listAll(c, Object.entries(map).map(([teamMemberId, logins]) => ({ teamMemberId, logins })))
  })
  app.put('/:id/logins', requirePermission('team:update'), async (c) => {
    const { companyId } = c.get('user')
    const id = c.req.param('id')
    const [m] = await db.select({ id: teamMember.id }).from(teamMember).where(and(eq(teamMember.id, id), eq(teamMember.companyId, companyId))).limit(1)
    if (!m) return fail(c, 404, 'Team member not found')
    const error = await setLoginsOn(db, companyId, 'teamMemberId', id, await c.req.json().catch(() => null))
    if (error) return fail(c, 400, error)
    return one(c, { teamMemberId: id, logins: (await loginsOn(db, companyId, 'teamMemberId', [id]))[id] || [] })
  })
  return app
}
