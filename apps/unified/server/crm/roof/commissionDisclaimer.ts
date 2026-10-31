// The commission DISCLAIMER (roofing parity row 4; docs/parity/roof-commissions-costing.md #13): AccuLynx lets a company put words in
// front of the people who collect commissions, and has each accept them. The words are the company's money rule
// (roof_money_setting.commission_disclaimer, changed with the other rules at PUT /api/roof-money/settings, commissions:update).
// Here is the person's side, at /api/commission-disclaimer (existing feature commission_tracking):
//
//   GET  /               the words, their version and whether THIS person has accepted that version     any signed-in seat
//   POST /accept         accept the current version (kept with the words as they were, and when)          any signed-in seat
//   GET  /acceptances    who has accepted the current version, among the people who have a commission     commissions:read
//
// Until a person has accepted the current words, their OWN commissions are withheld from the list and the statement (the shared
// commission routes ask pendingFor); what the owner sees of other people's is unchanged. A changed disclaimer is accepted again.
import { Hono } from 'hono'
import { and, eq, inArray, notInArray } from 'drizzle-orm'
import { commission, commissionDisclaimerAcceptance, user } from '../../db/schema/index.ts'
import type { AppEnv } from '../../http/env.ts'
import { fail, listAll, one } from '../../http/reply.ts'
import type { CrmDeps } from '../deps.ts'
import { createRoofMoneySettings } from './moneySettings.ts'

export function createCommissionDisclaimer(d: CrmDeps) {
  const { db } = d
  const money = createRoofMoneySettings(d)

  /** The person's standing against the company's current words. */
  async function standing(companyId: string, userId: string) {
    const s = await money.read(companyId)
    if (!s.commissionDisclaimer) return { text: null as string | null, version: s.commissionDisclaimerVersion, accepted: true, acceptedAt: null as Date | null }
    const [row] = await db.select().from(commissionDisclaimerAcceptance)
      .where(and(eq(commissionDisclaimerAcceptance.userId, userId), eq(commissionDisclaimerAcceptance.version, s.commissionDisclaimerVersion), eq(commissionDisclaimerAcceptance.companyId, companyId))).limit(1)
    return { text: s.commissionDisclaimer, version: s.commissionDisclaimerVersion, accepted: !!row, acceptedAt: (row?.acceptedAt as Date | undefined) ?? null }
  }
  /** True while the company has a disclaimer this person has not accepted. */
  async function pendingFor(companyId: string, userId: string): Promise<boolean> {
    return !(await standing(companyId, userId)).accepted
  }

  return { standing, pendingFor }
}

export function createCommissionDisclaimerRoutes(d: CrmDeps) {
  const { db } = d
  const { requirePermission } = d.permissions
  const disclaimer = createCommissionDisclaimer(d)
  const money = createRoofMoneySettings(d)
  const app = new Hono<AppEnv>()

  app.get('/', async (c) => { const me = c.get('user'); return one(c, await disclaimer.standing(me.companyId, me.userId)) })

  app.post('/accept', async (c) => {
    const me = c.get('user')
    const s = await money.read(me.companyId)
    if (!s.commissionDisclaimer) return fail(c, 409, 'There is no commission disclaimer to accept.', 'no_disclaimer')
    await db.insert(commissionDisclaimerAcceptance).values({
      companyId: me.companyId, userId: me.userId, version: s.commissionDisclaimerVersion, disclaimerText: s.commissionDisclaimer,
    } as any).onConflictDoNothing()
    return one(c, await disclaimer.standing(me.companyId, me.userId))
  })

  app.get('/acceptances', requirePermission('commissions:read'), async (c) => {
    const me = c.get('user')
    const s = await money.read(me.companyId)
    const earners = await db.selectDistinct({ userId: commission.userId }).from(commission)
      .where(and(eq(commission.companyId, me.companyId), notInArray(commission.status, ['void', 'cancelled'])))
    const ids = earners.map((e: any) => e.userId) as string[]
    const people = ids.length
      ? await db.select({ id: user.id, firstName: user.firstName, lastName: user.lastName, email: user.email }).from(user).where(and(eq(user.companyId, me.companyId), inArray(user.id, ids)))
      : []
    const accepted = s.commissionDisclaimer
      ? await db.select().from(commissionDisclaimerAcceptance).where(and(eq(commissionDisclaimerAcceptance.companyId, me.companyId), eq(commissionDisclaimerAcceptance.version, s.commissionDisclaimerVersion)))
      : []
    const at = new Map((accepted as any[]).map((a) => [a.userId, a.acceptedAt]))
    const rows = (people as any[])
      .map((p) => ({ userId: p.id, userName: [p.firstName, p.lastName].filter(Boolean).join(' ') || p.email, accepted: !s.commissionDisclaimer || at.has(p.id), acceptedAt: at.get(p.id) ?? null }))
      .sort((a, b) => a.userName.localeCompare(b.userName))
    return listAll(c, rows)
  })

  return app
}
