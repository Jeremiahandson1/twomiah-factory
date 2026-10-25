// The store's loyalty programme, its admin side, at /api/admin/loyalty: the settings, who is on it, and what they can
// spend on. Moved from templates/crm-store/backend/src/routes/loyalty.ts. Earning and spending happen when an order is
// paid (core.settleLoyaltyForPaidOrder); nothing here moves points.
//
// The programme is the shared one (UNIFIED_STORE_PLAN decision 2): members are contacts, as the salon's and the bar's
// are; the rules are packages/tenant-backend's loyalty. The salon's routes (server/crm/salon/loyalty.ts) are the same
// programme over the same tables for a business that redeems at the desk; the store's shoppers redeem at checkout, so
// this is the store's own admin, as the template's was.
//
// Who may do what. This shipped with nothing but `authenticate`, so any signed-in staff member could rewrite the reward
// list — make a $50-off reward cost 1 point and then spend it (the salon's LY0928 H3, worse here). It asks the fleet's
// loyalty permissions:
//   read       — everyone (loyalty:read). Looking up a shopper's balance is desk work.
//   configure  — manager and owner (loyalty:configure). The reward list and the earn rate are the programme's price
//                list (verticals/store/settings.ts gives the manager loyalty:configure).
//
// Kept as the template had it: the settings schema (on/off, points per dollar, welcome points, the punch card counted
// in orders and its reward's name) merged, not replaced, and merged under a lock — two managers saving two settings at
// once both keep theirs (admin-concurrency); the store's punch-card reward name default ('Free item', Store QA T1 L1);
// the audit row for the settings, flat and readable (pointsPerDollar, punchCardOrders, punchCardReward); rewards are
// money off only — fixed (cents) or percent — never goods, since a guessed email could walk away with them; a percent
// reward at most 100%; a reward worth nothing refused; a reward's minimum spend.
//
// Changes from the template:
//   · the programme's settings are company.settings.loyalty, as the salon keeps them (core.loyaltySettings reads
//     them), locked on the company row for the merge (the template locked its store_settings row);
//   · members are contacts: the list and a member carry the contact's name, email and phone (contactId, name, email,
//     phone); ?search= matches the email or the name (the template's matched the member's email); the punch-card count
//     is qualifyingVisits (the shared column; the template's was qualifyingOrders);
//   · a reward's use count is usageCount (the shared column; the template's was usedCount);
//   · replies (RULEBOOK §3): members and rewards are { data, pagination } (were { members } and { rewards }); a deleted
//     reward is { success: true } as before; a validation failure is the rulebook's (it was the first message);
//   · rewards and members are the company's (company_id), another company's is a 404;
//   · the reward list's writes record their own audit rows (loyalty_reward), as the salon's do — the template left them
//     to the write floor.
import { Hono } from 'hono'
import { z } from 'zod'
import { and, asc, desc, eq, ilike, or } from 'drizzle-orm'
import { loyaltyConfigResponse, punchCardProgress } from '@twomiah/tenant-backend'
import { company, contact, loyaltyMember, loyaltyReward } from '../../../db/schema/index.ts'
import { invalid } from '../../../http/errors.ts'
import type { AppEnv } from '../../../http/env.ts'
import { done, fail, list, one, listAll } from '../../../http/reply.ts'
import type { CrmDeps } from '../../deps.ts'
import { normalizeEmail, STORE_LOYALTY_DEFAULTS, type StoreCore } from '../core.ts'
import { changedKeys } from './audit.ts'

const configSchema = z.object({
  loyaltyEnabled: z.boolean().optional(),
  loyaltyPointsPerDollar: z.number().min(0).max(1000).optional(),
  loyaltyWelcomePoints: z.number().int().min(0).max(1_000_000).optional(),
  loyaltyPunchCard: z.object({
    visitsRequired: z.number().int().min(0).max(100),
    rewardName: z.string().max(120).optional(),
  }).optional(),
})

/** The punch card is a nested object; the audit page prints values with String(), so it is flattened to its two settings. */
const flatLoyalty = (l: any) => ({
  enabled: l?.enabled, pointsPerDollar: l?.pointsPerDollar, welcomePoints: l?.welcomePoints,
  punchCardOrders: l?.punchCard?.visitsRequired, punchCardReward: l?.punchCard?.rewardName,
})

const rewardSchema = z.object({
  name: z.string().min(1, 'Give the reward a name shoppers will recognise').max(120),
  description: z.string().max(500).optional(),
  pointsCost: z.number().int().min(0).default(0),
  // Money off only. With no shopper login the address is the only identity, so a reward that hands
  // over goods is one a guessed email could walk away with; a coupon is a bounded loss.
  type: z.enum(['fixed', 'percent']),
  /** Cents for 'fixed', whole percent for 'percent'. */
  valueCents: z.number().int().min(0),
  minSubtotalCents: z.number().int().min(0).default(0),
  active: z.boolean().default(true),
}).superRefine((v, ctx) => {
  if (v.type === 'percent' && v.valueCents > 100) {
    ctx.addIssue({ code: 'custom', path: ['valueCents'], message: 'A percentage reward cannot exceed 100%' })
  }
  if (v.valueCents === 0) {
    ctx.addIssue({ code: 'custom', path: ['valueCents'], message: 'A reward worth nothing takes nothing off' })
  }
})

const settingsOf = (raw: unknown): Record<string, any> => {
  if (typeof raw === 'string') { try { return JSON.parse(raw || '{}') || {} } catch { return {} } }
  return (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>
}

export function createLoyaltyAdminRoutes(d: CrmDeps, core: StoreCore) {
  const { db, audit } = d
  const { requirePermission } = d.permissions
  const app = new Hono<AppEnv>()

  const withCard = <T extends { qualifyingVisits?: number | null; punchRewardsEarned?: number | null }>(m: T, cfg: Awaited<ReturnType<StoreCore['loyaltySettings']>>) => ({
    ...m,
    punchCard: punchCardProgress({ qualifyingVisits: m.qualifyingVisits ?? 0, rewardsEarned: m.punchRewardsEarned ?? 0 }, cfg),
  })
  const memberColumns = {
    id: loyaltyMember.id, contactId: loyaltyMember.contactId, pointsBalance: loyaltyMember.pointsBalance, lifetimePoints: loyaltyMember.lifetimePoints,
    qualifyingVisits: loyaltyMember.qualifyingVisits, punchRewardsEarned: loyaltyMember.punchRewardsEarned, joinedAt: loyaltyMember.joinedAt,
    lastActivityAt: loyaltyMember.lastActivityAt, createdAt: loyaltyMember.createdAt,
    name: contact.name, email: contact.email, phone: contact.phone,
  }

  // ==================== SETTINGS ====================

  app.get('/config', requirePermission('loyalty:read'), async (c) => {
    const [co] = await db.select({ settings: company.settings }).from(company).where(eq(company.id, c.get('user').companyId)).limit(1)
    return one(c, loyaltyConfigResponse(co?.settings, STORE_LOYALTY_DEFAULTS))
  })

  app.put('/config', requirePermission('loyalty:configure'), async (c) => {
    const u = c.get('user')
    const parsed = configSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return invalid(c, parsed.error)
    const v = parsed.data
    // Merged, not replaced: saving the points rate must not wipe the punch card the shop set up
    // last week. Same lesson as the loyalty settings that silently dropped every field but one.
    //
    // And merged UNDER A LOCK. Each field saves on its own (the screen saves on leaving the box), so two managers
    // changing two different settings send two saves at once. Both read the same settings, each merged its one field
    // into that, and the second write put the first field back as it was. The company row is locked for the
    // read-merge-write, so the second save merges into what the first wrote.
    let before: Record<string, unknown> = {}
    const next = await db.transaction(async (tx: any) => {
      const [row] = await tx.select({ id: company.id, settings: company.settings }).from(company).where(eq(company.id, u.companyId)).for('update')
      if (!row) return null
      const settings = settingsOf(row.settings)
      const current: any = settings.loyalty || {}
      before = current
      const merged = {
        ...current,
        ...(v.loyaltyEnabled !== undefined ? { enabled: v.loyaltyEnabled } : {}),
        ...(v.loyaltyPointsPerDollar !== undefined ? { pointsPerDollar: v.loyaltyPointsPerDollar } : {}),
        ...(v.loyaltyWelcomePoints !== undefined ? { welcomePoints: v.loyaltyWelcomePoints } : {}),
        ...(v.loyaltyPunchCard !== undefined ? { punchCard: { ...(current.punchCard || {}), ...v.loyaltyPunchCard } } : {}),
      }
      await tx.update(company).set({ settings: { ...settings, loyalty: merged }, updatedAt: new Date() } as any).where(eq(company.id, row.id))
      return merged
    })
    if (!next) return fail(c, 404, 'Company not found')
    // After the transaction, not inside it: audit.log writes through the pool, and the lock above is still held there.
    await audit.log({ action: audit.ACTIONS.UPDATE, entity: 'loyalty_config', entityName: 'Loyalty program', changes: changedKeys(flatLoyalty(before), flatLoyalty(next)), req: c })
    return one(c, loyaltyConfigResponse({ loyalty: next }, STORE_LOYALTY_DEFAULTS))
  })

  // ==================== MEMBERS ====================

  app.get('/members', requirePermission('loyalty:read'), async (c) => {
    const u = c.get('user')
    const search = normalizeEmail(c.req.query('search') || '')
    const limit = Math.min(200, Math.max(1, Number(c.req.query('limit')) || 50))
    const cfg = await core.loyaltySettings(u.companyId)
    const rows: any[] = await db.select(memberColumns).from(loyaltyMember)
      .innerJoin(contact, eq(contact.id, loyaltyMember.contactId))
      .where(and(
        eq(loyaltyMember.companyId, u.companyId),
        search ? or(ilike(contact.email, `%${search}%`), ilike(contact.name, `%${search}%`)) : undefined,
      ))
      .orderBy(desc(loyaltyMember.lastActivityAt), asc(loyaltyMember.id))
      .limit(limit)
    const data = rows.map((m) => withCard(m, cfg))
    return list(c, data, { page: 1, limit, total: data.length })
  })

  app.get('/members/:id', requirePermission('loyalty:read'), async (c) => {
    const u = c.get('user')
    const [m] = await db.select(memberColumns).from(loyaltyMember)
      .innerJoin(contact, eq(contact.id, loyaltyMember.contactId))
      .where(and(eq(loyaltyMember.id, c.req.param('id')), eq(loyaltyMember.companyId, u.companyId))).limit(1)
    if (!m) return fail(c, 404, 'Member not found')
    const cfg = await core.loyaltySettings(u.companyId)
    return one(c, { ...withCard(m, cfg), transactions: await core.memberHistory(u.companyId, m.id) })
  })

  // ==================== REWARDS ====================

  app.get('/rewards', requirePermission('loyalty:read'), async (c) => {
    const rewards = await db.select().from(loyaltyReward).where(eq(loyaltyReward.companyId, c.get('user').companyId))
      .orderBy(asc(loyaltyReward.pointsCost), asc(loyaltyReward.id))
    return listAll(c, rewards)
  })

  app.post('/rewards', requirePermission('loyalty:configure'), async (c) => {
    const u = c.get('user')
    const parsed = rewardSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return invalid(c, parsed.error)
    const [row] = await db.insert(loyaltyReward).values({ ...parsed.data, description: parsed.data.description ?? null, companyId: u.companyId } as any).returning()
    await audit.log({ action: audit.ACTIONS.CREATE, entity: 'loyalty_reward', entityId: row.id, entityName: row.name, req: c })
    return one(c, row, 201)
  })

  app.put('/rewards/:id', requirePermission('loyalty:configure'), async (c) => {
    const u = c.get('user')
    const parsed = rewardSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return invalid(c, parsed.error)
    const mine = and(eq(loyaltyReward.id, c.req.param('id')), eq(loyaltyReward.companyId, u.companyId))
    const [before] = await db.select().from(loyaltyReward).where(mine).limit(1)
    if (!before) return fail(c, 404, 'Reward not found')
    const [row] = await db.update(loyaltyReward).set({ ...parsed.data, updatedAt: new Date() } as any).where(mine).returning()
    if (!row) return fail(c, 404, 'Reward not found')
    await audit.log({ action: audit.ACTIONS.UPDATE, entity: 'loyalty_reward', entityId: row.id, entityName: row.name, changes: changedKeys(before, row, Object.keys(parsed.data)), req: c })
    return one(c, row)
  })

  app.delete('/rewards/:id', requirePermission('loyalty:configure'), async (c) => {
    const u = c.get('user')
    const [row] = await db.delete(loyaltyReward).where(and(eq(loyaltyReward.id, c.req.param('id')), eq(loyaltyReward.companyId, u.companyId))).returning()
    if (!row) return fail(c, 404, 'Reward not found')
    await audit.log({ action: audit.ACTIONS.DELETE, entity: 'loyalty_reward', entityId: row.id, entityName: row.name, req: c })
    return done(c)
  })

  return app
}
