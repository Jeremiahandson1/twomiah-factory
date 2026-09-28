import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { loyaltyMember, loyaltyTransaction, loyaltyReward, contact, company, serviceMenu } from '../../db/schema.ts'
import { eq, and, desc, sql, ilike } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'
import audit from '../services/audit.ts'
import { loyaltyConfig, loyaltyConfigResponse, punchCardProgress, rewardDiscountCents, canRedeem, type Reward, type BasketLine } from '../shared/index.ts'

/**
 * The salon's loyalty programme.
 *
 * Storage is here; the RULES are in shared/loyalty, which crm-store runs on too. That split is
 * deliberate: the two verticals disagree about tenancy, keys and money units, so copying the folder
 * would have produced a second implementation that drifts from the first. Sharing the arithmetic
 * means a bug fixed for one shop is fixed for both.
 *
 * Two ways to earn, because a salon wants both:
 *   points      on what a client spends, redeemed for money off or a named free service
 *   punch card  on how often they come — "6 cuts, 7th free"
 *
 * There are deliberately no tiers. They were not wanted at launch, and a tier ladder that only ever
 * ratchets upward is a discount you can never claw back.
 */
const app = new Hono<{ Variables: { user: any } }>()
app.use('*', authenticate)

/** Money crosses into the engine in cents and comes back out in dollars for this template's columns. */
const toCents = (dollars: any) => Math.round((Number(dollars) || 0) * 100)
const toDollars = (c: number) => (Math.max(0, Math.round(c)) / 100).toFixed(2)

async function configFor(companyId: string) {
  const [co] = await db.select({ settings: company.settings }).from(company).where(eq(company.id, companyId)).limit(1)
  return loyaltyConfig(co?.settings)
}

/** The member row, created on first need. Racing completions are settled by the unique index. */
async function ensureMember(companyId: string, contactId: string) {
  const [existing] = await db.select().from(loyaltyMember)
    .where(and(eq(loyaltyMember.companyId, companyId), eq(loyaltyMember.contactId, contactId))).limit(1)
  if (existing) return existing
  try {
    const [created] = await db.insert(loyaltyMember).values({ companyId, contactId } as any).returning()
    return created
  } catch {
    // Lost the race — the other side's row is the one that counts.
    const [row] = await db.select().from(loyaltyMember)
      .where(and(eq(loyaltyMember.companyId, companyId), eq(loyaltyMember.contactId, contactId))).limit(1)
    return row
  }
}

const withProgress = (member: any, cfg: ReturnType<typeof loyaltyConfig>) => ({
  ...member,
  punchCard: punchCardProgress(
    { qualifyingVisits: member?.qualifyingVisits ?? 0, rewardsEarned: member?.punchRewardsEarned ?? 0 },
    cfg,
  ),
})

// ==================== CONFIG ====================

app.get('/config', requirePermission('contacts:read'), async (c) => {
  const u = c.get('user')
  const [co] = await db.select({ settings: company.settings }).from(company).where(eq(company.id, u.companyId)).limit(1)
  return c.json(loyaltyConfigResponse(co?.settings))
})

// ==================== MEMBERS ====================

app.get('/members', requirePermission('contacts:read'), async (c) => {
  const u = c.get('user')
  const search = c.req.query('search')
  const limit = Math.min(200, Math.max(1, Number(c.req.query('limit')) || 50))
  const cfg = await configFor(u.companyId)

  const rows = await db.select({
    id: loyaltyMember.id,
    contactId: loyaltyMember.contactId,
    pointsBalance: loyaltyMember.pointsBalance,
    lifetimePoints: loyaltyMember.lifetimePoints,
    qualifyingVisits: loyaltyMember.qualifyingVisits,
    punchRewardsEarned: loyaltyMember.punchRewardsEarned,
    lastActivityAt: loyaltyMember.lastActivityAt,
    clientName: contact.name,
    clientPhone: contact.phone,
    clientEmail: contact.email,
  })
    .from(loyaltyMember)
    .innerJoin(contact, eq(contact.id, loyaltyMember.contactId))
    .where(and(
      eq(loyaltyMember.companyId, u.companyId),
      search ? ilike(contact.name, `%${search}%`) : undefined as any,
    ))
    .orderBy(desc(loyaltyMember.lastActivityAt))
    .limit(limit)

  return c.json({ data: rows.map((r) => withProgress(r, cfg)) })
})

app.get('/members/:id', requirePermission('contacts:read'), async (c) => {
  const u = c.get('user')
  const [member] = await db.select().from(loyaltyMember)
    .where(and(eq(loyaltyMember.id, c.req.param('id')), eq(loyaltyMember.companyId, u.companyId))).limit(1)
  if (!member) return c.json({ error: 'Loyalty member not found' }, 404)

  const history = await db.select().from(loyaltyTransaction)
    .where(eq(loyaltyTransaction.memberId, member.id))
    .orderBy(desc(loyaltyTransaction.createdAt)).limit(50)

  return c.json({ ...withProgress(member, await configFor(u.companyId)), transactions: history })
})

/** Enrol a client by hand. Completing a visit enrols them anyway; this is for the front desk. */
app.post('/members', requirePermission('contacts:update'), async (c) => {
  const u = c.get('user')
  const { contactId } = z.object({ contactId: z.string().min(1) }).parse(await c.req.json())

  const [client] = await db.select({ id: contact.id, name: contact.name }).from(contact)
    .where(and(eq(contact.id, contactId), eq(contact.companyId, u.companyId))).limit(1)
  if (!client) return c.json({ error: 'Client not found' }, 404)

  const existing = await db.select({ id: loyaltyMember.id }).from(loyaltyMember)
    .where(and(eq(loyaltyMember.companyId, u.companyId), eq(loyaltyMember.contactId, contactId))).limit(1)
  if (existing.length) return c.json({ error: 'This client is already in the loyalty programme' }, 409)

  const cfg = await configFor(u.companyId)
  const member = await ensureMember(u.companyId, contactId)

  // Joining is joining however it happens: a client signed up at the desk gets the same welcome
  // bonus the settings screen promises to one enrolled by their first visit.
  if (cfg.enabled && cfg.welcomePoints > 0) {
    await db.update(loyaltyMember).set({
      pointsBalance: cfg.welcomePoints, lifetimePoints: cfg.welcomePoints, updatedAt: new Date(),
    } as any).where(eq(loyaltyMember.id, member.id))
    await db.insert(loyaltyTransaction).values({
      companyId: u.companyId, memberId: member.id, type: 'bonus',
      points: cfg.welcomePoints, balanceAfter: cfg.welcomePoints,
      description: 'Welcome bonus', createdBy: u.userId,
    } as any)
  }

  audit.log({ action: audit.ACTIONS.CREATE, entity: 'loyalty_member', entityId: member.id, entityName: client.name, req: c })
  const [fresh] = await db.select().from(loyaltyMember).where(eq(loyaltyMember.id, member.id)).limit(1)
  return c.json(withProgress(fresh, cfg), 201)
})

/**
 * Correct a balance by hand.
 *
 * A deduction is clamped at the balance, and both the ledger row and the response report what was
 * APPLIED rather than what was asked for — a -999,999 that removes 245 points must not be recorded
 * as -999,999. (The same defect was found and fixed in crm-dispensary; it is not repeated here.)
 */
app.post('/members/:id/adjust', requirePermission('contacts:update'), async (c) => {
  const u = c.get('user')
  const data = z.object({ points: z.number().int(), reason: z.string().min(1) }).parse(await c.req.json())

  const [member] = await db.select().from(loyaltyMember)
    .where(and(eq(loyaltyMember.id, c.req.param('id')), eq(loyaltyMember.companyId, u.companyId))).limit(1)
  if (!member) return c.json({ error: 'Loyalty member not found' }, 404)

  const newBalance = Math.max(0, member.pointsBalance + data.points)
  const applied = newBalance - member.pointsBalance

  await db.update(loyaltyMember).set({
    pointsBalance: newBalance,
    // Lifetime moves with a correction in both directions, so a mistaken grant can be undone.
    lifetimePoints: Math.max(0, member.lifetimePoints + applied),
    updatedAt: new Date(),
  } as any).where(eq(loyaltyMember.id, member.id))

  await db.insert(loyaltyTransaction).values({
    companyId: u.companyId, memberId: member.id,
    type: applied >= 0 ? 'adjustment_add' : 'adjustment_subtract',
    points: applied, balanceAfter: newBalance, description: data.reason, createdBy: u.userId,
  } as any)

  audit.log({
    action: audit.ACTIONS.UPDATE, entity: 'loyalty_member', entityId: member.id,
    changes: { pointsBalance: { old: member.pointsBalance, new: newBalance } },
    metadata: { reason: data.reason, adjustment: applied, requested: data.points }, req: c,
  })

  return c.json({ pointsBalance: newBalance, adjustment: applied, requested: data.points })
})

// ==================== REWARDS ====================

const rewardSchema = z.object({
  name: z.string().min(1, 'Give the reward a name clients will recognise'),
  description: z.string().optional(),
  pointsCost: z.number().int().min(0).default(0),
  type: z.enum(['fixed', 'percent', 'free_item']),
  // Dollars on the wire (what the form shows); cents in the column.
  value: z.number().min(0).default(0),
  serviceId: z.string().nullish(),
  active: z.boolean().default(true),
}).superRefine((v, ctx) => {
  if (v.type === 'free_item' && !v.serviceId) {
    ctx.addIssue({ code: 'custom', path: ['serviceId'], message: 'Choose which service this reward pays for' })
  }
  if (v.type === 'percent' && v.value > 100) {
    ctx.addIssue({ code: 'custom', path: ['value'], message: 'A percentage reward cannot exceed 100%' })
  }
})

const rewardOut = (r: any) => ({
  ...r,
  // Back out in the unit the form works in; percent is already a percent.
  value: r.type === 'percent' ? r.valueCents : Number(toDollars(r.valueCents)),
})

app.get('/rewards', requirePermission('contacts:read'), async (c) => {
  const u = c.get('user')
  const rows = await db.select().from(loyaltyReward)
    .where(eq(loyaltyReward.companyId, u.companyId)).orderBy(loyaltyReward.pointsCost)
  return c.json({ data: rows.map(rewardOut) })
})

app.post('/rewards', requirePermission('contacts:update'), async (c) => {
  const u = c.get('user')
  const d = rewardSchema.parse(await c.req.json())
  if (d.serviceId) {
    const [svc] = await db.select({ id: serviceMenu.id }).from(serviceMenu)
      .where(and(eq(serviceMenu.id, d.serviceId), eq(serviceMenu.companyId, u.companyId))).limit(1)
    if (!svc) return c.json({ error: 'That service is not on the menu' }, 404)
  }
  const [row] = await db.insert(loyaltyReward).values({
    companyId: u.companyId, name: d.name, description: d.description || null,
    pointsCost: d.pointsCost, type: d.type,
    valueCents: d.type === 'percent' ? Math.round(d.value) : toCents(d.value),
    serviceId: d.serviceId || null, active: d.active,
  } as any).returning()
  audit.log({ action: audit.ACTIONS.CREATE, entity: 'loyalty_reward', entityId: row.id, entityName: row.name, req: c })
  return c.json(rewardOut(row), 201)
})

app.put('/rewards/:id', requirePermission('contacts:update'), async (c) => {
  const u = c.get('user')
  const d = rewardSchema.parse(await c.req.json())
  const [row] = await db.update(loyaltyReward).set({
    name: d.name, description: d.description || null, pointsCost: d.pointsCost, type: d.type,
    valueCents: d.type === 'percent' ? Math.round(d.value) : toCents(d.value),
    serviceId: d.serviceId || null, active: d.active, updatedAt: new Date(),
  } as any).where(and(eq(loyaltyReward.id, c.req.param('id')), eq(loyaltyReward.companyId, u.companyId))).returning()
  if (!row) return c.json({ error: 'Reward not found' }, 404)
  return c.json(rewardOut(row))
})

app.delete('/rewards/:id', requirePermission('contacts:delete'), async (c) => {
  const u = c.get('user')
  const [row] = await db.delete(loyaltyReward)
    .where(and(eq(loyaltyReward.id, c.req.param('id')), eq(loyaltyReward.companyId, u.companyId))).returning()
  if (!row) return c.json({ error: 'Reward not found' }, 404)
  audit.log({ action: audit.ACTIONS.DELETE, entity: 'loyalty_reward', entityId: row.id, entityName: row.name, req: c })
  return c.json({ success: true })
})

// ==================== REDEEM ====================

/**
 * Spend points (or a completed punch card) against a visit.
 *
 * The discount is priced from the basket sent with the request, not from a figure remembered when
 * the reward was created — a service whose price has gone up since would otherwise come off at the
 * old, lower one. `preview: true` answers "what would this take off" without spending anything, so
 * the front desk can tell the client before committing.
 */
app.post('/members/:id/redeem', requirePermission('contacts:update'), async (c) => {
  const u = c.get('user')
  const d = z.object({
    rewardId: z.string().min(1),
    lines: z.array(z.object({ itemId: z.string(), amount: z.number() })).default([]),
    appointmentId: z.string().nullish(),
    preview: z.boolean().default(false),
  }).parse(await c.req.json())

  const cfg = await configFor(u.companyId)
  if (!cfg.enabled) return c.json({ error: 'Loyalty is switched off for this salon. Turn it on in Settings to redeem.' }, 403)

  const [member] = await db.select().from(loyaltyMember)
    .where(and(eq(loyaltyMember.id, c.req.param('id')), eq(loyaltyMember.companyId, u.companyId))).limit(1)
  if (!member) return c.json({ error: 'Loyalty member not found' }, 404)

  const [reward] = await db.select().from(loyaltyReward)
    .where(and(eq(loyaltyReward.id, d.rewardId), eq(loyaltyReward.companyId, u.companyId))).limit(1)
  if (!reward) return c.json({ error: 'Reward not found' }, 404)

  const basket: BasketLine[] = d.lines.map((l) => ({ itemId: l.itemId, lineTotalCents: toCents(l.amount) }))
  const asReward: Reward = {
    id: reward.id, name: reward.name, pointsCost: reward.pointsCost,
    type: reward.type as any, value: reward.valueCents, itemId: reward.serviceId, active: reward.active,
  }

  // A completed punch card pays for a free service without spending points.
  const progress = punchCardProgress(
    { qualifyingVisits: member.qualifyingVisits, rewardsEarned: member.punchRewardsEarned }, cfg,
  )
  const isPunchReward = reward.pointsCost === 0 && reward.type === 'free_item'
  const onTheHouse = isPunchReward && progress.unclaimed > 0

  // A reward that costs nothing is a punch-card payout and NOTHING else. Letting the points gate
  // wave it through on its own terms would hand out a free service on every visit forever, because
  // 0 points is a price every balance can meet — the card would be decoration.
  if (isPunchReward && !onTheHouse) {
    return c.json({
      error: progress.enabled
        ? `That reward is earned with a full card. ${progress.remaining} more visit${progress.remaining === 1 ? '' : 's'} to go.`
        : 'That reward is earned with a punch card, and this salon does not run one.',
      code: 'card_not_complete',
      punchCard: progress,
    }, 400)
  }

  const gate = canRedeem({ ...asReward, pointsCost: onTheHouse ? 0 : reward.pointsCost }, member.pointsBalance, basket)
  if (!gate.ok) return c.json({ error: gate.reason, code: 'cannot_redeem' }, 400)

  const discountCents = rewardDiscountCents(asReward, basket)
  if (d.preview) {
    return c.json({ preview: true, discount: Number(toDollars(discountCents)), pointsCost: onTheHouse ? 0 : reward.pointsCost, onTheHouse })
  }

  const spend = onTheHouse ? 0 : reward.pointsCost
  const newBalance = Math.max(0, member.pointsBalance - spend)

  await db.update(loyaltyMember).set({
    pointsBalance: newBalance,
    // A punch card that pays out is a card consumed — otherwise the same completed card would buy
    // an unlimited number of free services.
    punchRewardsEarned: onTheHouse ? member.punchRewardsEarned + 1 : member.punchRewardsEarned,
    lastActivityAt: new Date(), updatedAt: new Date(),
  } as any).where(eq(loyaltyMember.id, member.id))

  await db.insert(loyaltyTransaction).values({
    companyId: u.companyId, memberId: member.id,
    type: onTheHouse ? 'punch_reward' : 'redeem',
    points: -spend, balanceAfter: newBalance,
    description: `${reward.name}${onTheHouse ? ' (punch card)' : ''}`,
    appointmentId: d.appointmentId || null, createdBy: u.userId,
  } as any)

  await db.update(loyaltyReward).set({ usageCount: sql`${loyaltyReward.usageCount} + 1`, updatedAt: new Date() } as any)
    .where(eq(loyaltyReward.id, reward.id))

  audit.log({
    action: audit.ACTIONS.UPDATE, entity: 'loyalty_member', entityId: member.id,
    metadata: { redeemed: reward.name, pointsSpent: spend, discount: toDollars(discountCents), onTheHouse }, req: c,
  })

  return c.json({ discount: Number(toDollars(discountCents)), pointsSpent: spend, pointsBalance: newBalance, onTheHouse })
})

export default app
