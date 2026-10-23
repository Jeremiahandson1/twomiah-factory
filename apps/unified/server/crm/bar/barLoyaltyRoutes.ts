// /api/loyalty for the bar — THE REGULARS: the programme's settings, the reward list, and a guest's points
// (barLoyalty.ts), behind the loyalty_rewards feature. Earning and spending happen on the register
// (barRegisterRoutes.ts). The same routes and permissions as the salon's programme:
//
//   GET    /config                      loyalty:read       the rate, welcome points, on/off
//   PUT    /config                      loyalty:configure  only what is sent changes
//   GET    /rewards                     loyalty:read
//   POST   /rewards  ·  PUT /rewards/:id  ·  DELETE /rewards/:id     loyalty:configure
//   GET    /members?q=                  loyalty:read       the regulars and their points (name or phone search)
//   GET    /members/:contactId          loyalty:read       the balance and the ledger
//   POST   /members/:contactId/adjust   loyalty:adjust     { points, reason } — points out of nothing, managers
//
// Moved from templates/crm-bar/backend/src/routes/barLoyalty.ts. The reward and member lists were { data } and are
// list replies now ({ data, pagination }); a delete is { success: true } as before.
import { Hono } from 'hono'
import { and, eq } from 'drizzle-orm'
import { loyaltyConfig, loyaltyConfigResponse, LOYALTY_SETTING_KEYS } from '@twomiah/tenant-backend'
import { company, loyaltyReward } from '../../db/schema/index.ts'
import type { AppEnv } from '../../http/env.ts'
import { done, fail, one, listAll } from '../../http/reply.ts'
import type { CrmDeps } from '../deps.ts'
import { BAR_LOYALTY_DEFAULTS, LoyaltyError } from './barLoyalty.ts'
import type { BarServices } from './services.ts'

type Ctx = any
const me = (c: Ctx) => c.get('user') as { userId: string; companyId: string }
const all = <T,>(c: Ctx, rows: T[]) => listAll(c, rows)

export function createBarLoyaltyRoutes(d: CrmDeps, bar: BarServices) {
  const { db, audit, logger } = d
  const { requirePermission } = d.permissions
  const on = d.features.requireEnabledFeature('loyalty_rewards')
  const { actorOf } = bar.managers
  const { adjustPoints, listMembers, listRewards, memberHistory, rewardInput } = bar.loyalty
  const app = new Hono<AppEnv>()

  async function act(c: Ctx, fn: () => Promise<unknown>, status: 200 | 201 = 200) {
    try {
      return one(c, await fn() as object, status)
    } catch (e: any) {
      if (e instanceof LoyaltyError) return fail(c, e.status as any, e.message)
      logger.error('[loyalty]', { error: e?.message || String(e) })
      return fail(c, 500, 'That did not save. Try again.')
    }
  }

  const readSettings = async (companyId: string) => {
    const [co] = await db.select({ settings: company.settings }).from(company).where(eq(company.id, companyId)).limit(1)
    return (typeof co?.settings === 'string' ? JSON.parse(co.settings || '{}') : co?.settings) || {}
  }

  app.get('/config', on, requirePermission('loyalty:read'), async (c) => {
    return one(c, loyaltyConfigResponse(await readSettings(me(c).companyId), BAR_LOYALTY_DEFAULTS))
  })

  app.put('/config', on, requirePermission('loyalty:configure'), async (c) => {
    const { companyId } = me(c)
    const body = await c.req.json().catch(() => ({})) as Record<string, any>
    const num = (k: string, min: number, max: number, int: boolean) => {
      if (body[k] === undefined) return undefined
      const n = Number(body[k])
      if (!Number.isFinite(n) || n < min || n > max || (int && !Number.isInteger(n))) throw new LoyaltyError(`${k === 'loyaltyPointsPerDollar' ? 'Points per dollar' : k === 'loyaltyWelcomePoints' ? 'Welcome points' : 'Birthday points'} must be ${min} to ${max}${int ? ', whole' : ''}.`)
      return n
    }
    return act(c, async () => {
      const sent: Record<string, unknown> = {
        loyaltyEnabled: body.loyaltyEnabled === undefined ? undefined : body.loyaltyEnabled === true,
        loyaltyPointsPerDollar: num('loyaltyPointsPerDollar', 0, 1000, false),
        loyaltyWelcomePoints: num('loyaltyWelcomePoints', 0, 1_000_000, true),
        loyaltyBirthdayBonus: num('loyaltyBirthdayBonus', 0, 1_000_000, true),
      }
      const settings: any = await readSettings(companyId)
      const before = loyaltyConfig(settings, BAR_LOYALTY_DEFAULTS)
      const next: any = { ...before, punchCard: { ...before.punchCard } }
      for (const [wireKey, storeKey] of Object.entries(LOYALTY_SETTING_KEYS)) {
        if (storeKey === 'punchCard' || sent[wireKey] === undefined) continue   // a bar runs points, not a punch card
        next[storeKey] = sent[wireKey]
      }
      await db.update(company).set({ settings: { ...settings, loyalty: loyaltyConfig({ loyalty: next }, BAR_LOYALTY_DEFAULTS) }, updatedAt: new Date() } as any).where(eq(company.id, companyId))
      audit.log({ action: audit.ACTIONS.UPDATE, entity: 'company', entityId: companyId, metadata: { loyalty: { before, after: next } }, req: c })
      return loyaltyConfigResponse(await readSettings(companyId), BAR_LOYALTY_DEFAULTS)
    })
  })

  app.get('/rewards', on, requirePermission('loyalty:read'), async (c) => all(c, await listRewards(me(c).companyId)))

  app.post('/rewards', on, requirePermission('loyalty:configure'), async (c) => {
    const { companyId } = me(c)
    const body = await c.req.json().catch(() => ({}))
    return act(c, async () => {
      const v = await rewardInput(companyId, body, true)
      const [row] = await db.insert(loyaltyReward).values({ companyId, ...v } as any).returning()
      audit.log({ action: audit.ACTIONS.CREATE, entity: 'loyalty_reward', entityId: row.id, entityName: row.name, req: c })
      return row
    }, 201)
  })

  app.put('/rewards/:id', on, requirePermission('loyalty:configure'), async (c) => {
    const { companyId } = me(c)
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>
    return act(c, async () => {
      const [cur] = await db.select().from(loyaltyReward).where(and(eq(loyaltyReward.id, c.req.param('id')), eq(loyaltyReward.companyId, companyId))).limit(1)
      if (!cur) throw new LoyaltyError('Reward not found', 404)
      const v = await rewardInput(companyId, { type: cur.type, ...body }, false)
      const [row] = await db.update(loyaltyReward).set({ ...v, updatedAt: new Date() } as any).where(eq(loyaltyReward.id, cur.id)).returning()
      audit.log({ action: audit.ACTIONS.UPDATE, entity: 'loyalty_reward', entityId: row.id, entityName: row.name, changes: v, req: c })
      return row
    })
  })

  app.delete('/rewards/:id', on, requirePermission('loyalty:configure'), async (c) => {
    const { companyId } = me(c)
    const [row] = await db.delete(loyaltyReward).where(and(eq(loyaltyReward.id, c.req.param('id')), eq(loyaltyReward.companyId, companyId))).returning()
    if (!row) return fail(c, 404, 'Reward not found')
    audit.log({ action: audit.ACTIONS.DELETE, entity: 'loyalty_reward', entityId: row.id, entityName: row.name, req: c })
    return done(c)
  })

  app.get('/members', on, requirePermission('loyalty:read'), async (c) => {
    c.header('Cache-Control', 'no-store')
    return all(c, await listMembers(me(c).companyId, c.req.query('q') || ''))
  })

  app.get('/members/:contactId', on, requirePermission('loyalty:read'), async (c) => {
    return one(c, await memberHistory(me(c).companyId, c.req.param('contactId')))
  })

  app.post('/members/:contactId/adjust', on, requirePermission('loyalty:adjust'), async (c) => {
    const actor = await actorOf(c)
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>
    return act(c, async () => {
      const r = await adjustPoints(actor.companyId, c.req.param('contactId'), body.points, body.reason, actor.name)
      audit.log({ action: audit.ACTIONS.UPDATE, entity: 'loyalty_member', entityId: c.req.param('contactId'), changes: { points: body.points, reason: body.reason }, req: c })
      return r
    })
  })

  return app
}
