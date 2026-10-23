// The salon's loyalty programme. Moved from templates/crm-salon/backend/src/routes/loyalty.ts.
//
// Storage is here; the RULES are the shared package's (packages/tenant-backend loyalty), which other verticals run on
// too. Two ways to earn: points on what a client spends, redeemed for money off or a named free service; and a punch
// card on how often they come ("6 cuts, 7th free"). No tiers. Earning happens when a visit completes (./loyaltyAward.ts).
import { Hono } from 'hono'
import { z } from 'zod'
import { and, desc, eq, ilike, inArray } from 'drizzle-orm'
import {
  loyaltyConfig, loyaltyConfigResponse, LOYALTY_SETTING_KEYS, punchCardProgress, rewardDiscountCents, canRedeem,
  type Reward, type BasketLine,
} from '@twomiah/tenant-backend'
import { loyaltyMember, loyaltyTransaction, loyaltyReward, contact, company, serviceMenu, appointment, invoice } from '../../db/schema/index.ts'
import {
  claimPunchCard, spendPoints, discountInvoice, countRewardUse, liveBillsWithVisitStatus, voidBillWithNote, setBillTax, markBillPaid,
} from '../../data/salonLoyalty.ts'
import type { AppEnv } from '../../http/env.ts'
import { fail, list, one, done, listAll } from '../../http/reply.ts'
import type { CrmDeps } from '../deps.ts'
import { VOIDED_ON_CANCEL } from './checkout.ts'

/** Money crosses into the engine in cents and comes back out in dollars for this schema's columns. */
const toCents = (dollars: unknown) => Math.round((Number(dollars) || 0) * 100)
const toDollars = (c: number) => (Math.max(0, Math.round(c)) / 100).toFixed(2)
const toMoney = (c: number) => '$' + toDollars(c)

/** Has this bill been settled? The status says so, or the money does. (LYR N2) */
const isSettled = (bill: { status?: unknown; amountPaid?: unknown; total?: unknown }) => {
  if (String(bill?.status || '').toLowerCase() === 'paid') return true
  const total = toCents(bill?.total)
  return total > 0 && toCents(bill?.amountPaid) >= total
}

/** A salon has clients and visits; the shared engine's refusals default to a shop's customers and orders. (LY0928 M3) */
const SALON_WORDS = { buyer: 'client', sale: 'visit' }

const configSchema = z.object({
  loyaltyEnabled: z.boolean().optional(),
  loyaltyPointsPerDollar: z.number().min(0).max(1000).optional(),
  loyaltyWelcomePoints: z.number().int().min(0).max(1_000_000).optional(),
  loyaltyBirthdayBonus: z.number().int().min(0).max(1_000_000).optional(),
  loyaltyPunchCard: z.object({
    visitsRequired: z.number().int().min(0).max(100).optional(),
    rewardName: z.string().max(120).optional(),
    qualifyingServiceIds: z.array(z.string()).max(200).optional(),
  }).optional(),
})

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
  if (v.type === 'free_item' && !v.serviceId) ctx.addIssue({ code: 'custom', path: ['serviceId'], message: 'Choose which service this reward pays for' })
  if (v.type === 'percent' && v.value > 100) ctx.addIssue({ code: 'custom', path: ['value'], message: 'A percentage reward cannot exceed 100%' })
})

type RewardRow = typeof loyaltyReward.$inferSelect
type MemberRow = typeof loyaltyMember.$inferSelect

/** Back out in the unit the form works in; a percent is already a percent. */
const rewardOut = (r: RewardRow) => ({ ...r, value: r.type === 'percent' ? r.valueCents : Number(toDollars(r.valueCents)) })

export function createLoyaltyRoutes(d: CrmDeps) {
  const { db, audit } = d
  const { requirePermission } = d.permissions
  const app = new Hono<AppEnv>()

  async function configFor(companyId: string) {
    const [co] = await db.select({ settings: company.settings }).from(company).where(eq(company.id, companyId)).limit(1)
    return loyaltyConfig(co?.settings)
  }

  /** The member row, created on first need; racing completions are settled by the unique index. */
  async function ensureMember(companyId: string, contactId: string): Promise<MemberRow> {
    const [existing] = await db.select().from(loyaltyMember).where(and(eq(loyaltyMember.companyId, companyId), eq(loyaltyMember.contactId, contactId))).limit(1)
    if (existing) return existing
    try {
      const [created] = await db.insert(loyaltyMember).values({ companyId, contactId } as any).returning()
      return created
    } catch {
      const [row] = await db.select().from(loyaltyMember).where(and(eq(loyaltyMember.companyId, companyId), eq(loyaltyMember.contactId, contactId))).limit(1)
      return row
    }
  }

  const withProgress = <T extends { qualifyingVisits?: number | null; punchRewardsEarned?: number | null }>(member: T, cfg: ReturnType<typeof loyaltyConfig>) => ({
    ...member,
    punchCard: punchCardProgress({ qualifyingVisits: member?.qualifyingVisits ?? 0, rewardsEarned: member?.punchRewardsEarned ?? 0 }, cfg),
  })

  // ── Config ──

  app.get('/config', requirePermission('loyalty:read'), async (c) => {
    const u = c.get('user')
    const [co] = await db.select({ settings: company.settings }).from(company).where(eq(company.id, u.companyId)).limit(1)
    return one(c, loyaltyConfigResponse(co?.settings))
  })

  /** Set the programme up — only what is sent changes (LY0928 B3, L4). */
  app.put('/config', requirePermission('loyalty:configure'), async (c) => {
    const u = c.get('user')
    const body = configSchema.parse(await c.req.json())
    const [co] = await db.select({ settings: company.settings }).from(company).where(eq(company.id, u.companyId)).limit(1)
    const settings: any = (typeof co?.settings === 'string' ? JSON.parse(co.settings || '{}') : co?.settings) || {}
    const before = loyaltyConfig(settings)

    // Merged onto what loyaltyConfig() would use, so a half-written settings row comes out complete.
    const next: any = { ...before, punchCard: { ...before.punchCard } }
    for (const [wireKey, storeKey] of Object.entries(LOYALTY_SETTING_KEYS)) {
      const sent = (body as any)[wireKey]
      if (sent === undefined) continue
      next[storeKey] = storeKey === 'punchCard' ? { ...before.punchCard, ...sent } : sent
    }

    // A card that only counts named services has to name services that exist here.
    const wanted: string[] = next.punchCard.qualifyingServiceIds || []
    if (wanted.length) {
      const rows: Array<{ id: string }> = await db.select({ id: serviceMenu.id }).from(serviceMenu).where(eq(serviceMenu.companyId, u.companyId))
      const known = new Set(rows.map((r) => r.id))
      if (wanted.some((id) => !known.has(id))) return fail(c, 400, 'One of the chosen services is not on this salon’s menu.', 'unknown_service')
    }

    await db.update(company).set({ settings: { ...settings, loyalty: loyaltyConfig({ loyalty: next }) }, updatedAt: new Date() } as any).where(eq(company.id, u.companyId))
    audit.log({ action: audit.ACTIONS.UPDATE, entity: 'company', entityId: u.companyId, metadata: { loyalty: { before, after: next } }, req: c })
    const [fresh] = await db.select({ settings: company.settings }).from(company).where(eq(company.id, u.companyId)).limit(1)
    return one(c, loyaltyConfigResponse(fresh?.settings))
  })

  // ── Members ──

  app.get('/members', requirePermission('loyalty:read'), async (c) => {
    const u = c.get('user')
    const search = c.req.query('search')
    const limit = Math.min(200, Math.max(1, Number(c.req.query('limit')) || 50))
    const cfg = await configFor(u.companyId)
    const rows: any[] = await db.select({
      id: loyaltyMember.id, contactId: loyaltyMember.contactId, pointsBalance: loyaltyMember.pointsBalance, lifetimePoints: loyaltyMember.lifetimePoints,
      qualifyingVisits: loyaltyMember.qualifyingVisits, punchRewardsEarned: loyaltyMember.punchRewardsEarned, lastActivityAt: loyaltyMember.lastActivityAt,
      clientName: contact.name, clientPhone: contact.phone, clientEmail: contact.email,
    })
      .from(loyaltyMember)
      .innerJoin(contact, eq(contact.id, loyaltyMember.contactId))
      .where(and(eq(loyaltyMember.companyId, u.companyId), search ? ilike(contact.name, `%${search}%`) : undefined))
      .orderBy(desc(loyaltyMember.lastActivityAt))
      .limit(limit)
    const data = rows.map((r) => withProgress(r, cfg))
    return list(c, data, { page: 1, limit, total: data.length })
  })

  app.get('/members/:id', requirePermission('loyalty:read'), async (c) => {
    const u = c.get('user')
    const [member] = await db.select().from(loyaltyMember).where(and(eq(loyaltyMember.id, c.req.param('id')), eq(loyaltyMember.companyId, u.companyId))).limit(1)
    if (!member) return fail(c, 404, 'Loyalty member not found')
    const history = await db.select().from(loyaltyTransaction).where(eq(loyaltyTransaction.memberId, member.id)).orderBy(desc(loyaltyTransaction.createdAt)).limit(50)
    return one(c, { ...withProgress(member, await configFor(u.companyId)), transactions: history })
  })

  /**
   * The visits a reward could be applied to: the client's recent completed visits, each with the bill it raised, what is
   * still chargeable on it, and whether a reward has been used or the bill settled — offered with the reason rather than
   * hidden. (LY0928 B3, LYR N2)
   */
  app.get('/members/:id/visits', requirePermission('loyalty:read'), async (c) => {
    const u = c.get('user')
    const [member] = await db.select().from(loyaltyMember).where(and(eq(loyaltyMember.id, c.req.param('id')), eq(loyaltyMember.companyId, u.companyId))).limit(1)
    if (!member) return fail(c, 404, 'Loyalty member not found')

    const rows: any[] = await db.select({
      appointmentId: appointment.id, startTime: appointment.startTime, serviceId: appointment.serviceId, serviceName: serviceMenu.name,
      invoiceId: invoice.id, invoiceNumber: invoice.number, subtotal: invoice.subtotal, discount: invoice.discount, total: invoice.total,
      amountPaid: invoice.amountPaid, invoiceStatus: invoice.status,
    })
      .from(appointment)
      .innerJoin(invoice, and(eq(invoice.appointmentId, appointment.id), eq(invoice.companyId, u.companyId)))
      .leftJoin(serviceMenu, eq(serviceMenu.id, appointment.serviceId))
      .where(and(eq(appointment.companyId, u.companyId), eq(appointment.contactId, member.contactId), eq(appointment.status, 'completed')))
      .orderBy(desc(appointment.startTime))
      .limit(20)

    const spent = new Set(
      (await db.select({ appointmentId: loyaltyTransaction.appointmentId }).from(loyaltyTransaction)
        .where(and(eq(loyaltyTransaction.memberId, member.id), inArray(loyaltyTransaction.type, ['redeem', 'punch_reward']))))
        .map((r: { appointmentId: string | null }) => r.appointmentId),
    )
    const data = rows.map((r) => ({
      ...r,
      remaining: Number(toDollars(Math.max(0, toCents(r.subtotal) - toCents(r.discount)))),
      rewardUsed: spent.has(r.appointmentId),
      settled: isSettled({ status: r.invoiceStatus, amountPaid: r.amountPaid, total: r.total }),
    }))
    return list(c, data, { page: 1, limit: 20, total: data.length })
  })

  /** Enrol a client by hand — they get the welcome bonus their first visit would have given. */
  app.post('/members', requirePermission('loyalty:enroll'), async (c) => {
    const u = c.get('user')
    const { contactId } = z.object({ contactId: z.string().min(1) }).parse(await c.req.json())
    const [client] = await db.select({ id: contact.id, name: contact.name }).from(contact).where(and(eq(contact.id, contactId), eq(contact.companyId, u.companyId))).limit(1)
    if (!client) return fail(c, 404, 'Client not found')

    const existing = await db.select({ id: loyaltyMember.id }).from(loyaltyMember).where(and(eq(loyaltyMember.companyId, u.companyId), eq(loyaltyMember.contactId, contactId))).limit(1)
    if (existing.length) return fail(c, 409, 'This client is already in the loyalty programme')

    const cfg = await configFor(u.companyId)
    const member = await ensureMember(u.companyId, contactId)
    if (cfg.enabled && cfg.welcomePoints > 0) {
      await db.update(loyaltyMember).set({ pointsBalance: cfg.welcomePoints, lifetimePoints: cfg.welcomePoints, updatedAt: new Date() } as any).where(eq(loyaltyMember.id, member.id))
      await db.insert(loyaltyTransaction).values({
        companyId: u.companyId, memberId: member.id, type: 'bonus', points: cfg.welcomePoints, balanceAfter: cfg.welcomePoints,
        description: 'Welcome bonus', createdBy: u.userId,
      } as any)
    }
    audit.log({ action: audit.ACTIONS.CREATE, entity: 'loyalty_member', entityId: member.id, entityName: client.name, req: c })
    const [fresh] = await db.select().from(loyaltyMember).where(eq(loyaltyMember.id, member.id)).limit(1)
    return one(c, withProgress(fresh, cfg), 201)
  })

  /**
   * Correct a balance by hand. A deduction is clamped at the balance and the APPLIED figure is recorded; it works with the
   * programme off (L2); and it can only take back from earned-to-date what corrections put in — replayed row by row,
   * clamping at zero after each (LY0928 L3, LYR L3).
   */
  app.post('/members/:id/adjust', requirePermission('loyalty:adjust'), async (c) => {
    const u = c.get('user')
    const data = z.object({ points: z.number().int(), reason: z.string().min(1) }).parse(await c.req.json())
    const [member] = await db.select().from(loyaltyMember).where(and(eq(loyaltyMember.id, c.req.param('id')), eq(loyaltyMember.companyId, u.companyId))).limit(1)
    if (!member) return fail(c, 404, 'Loyalty member not found')

    const newBalance = Math.max(0, member.pointsBalance + data.points)
    const applied = newBalance - member.pointsBalance
    let lifetimeDelta = applied
    if (applied < 0) {
      const priors: Array<{ points: number }> = await db.select({ points: loyaltyTransaction.points }).from(loyaltyTransaction)
        .where(and(eq(loyaltyTransaction.memberId, member.id), inArray(loyaltyTransaction.type, ['adjustment_add', 'adjustment_subtract'])))
        .orderBy(loyaltyTransaction.createdAt, loyaltyTransaction.id)
      let reversible = 0
      for (const p of priors) reversible = Math.max(0, reversible + (Number(p.points) || 0))
      lifetimeDelta = -Math.min(-applied, reversible)
    }

    await db.update(loyaltyMember).set({ pointsBalance: newBalance, lifetimePoints: Math.max(0, member.lifetimePoints + lifetimeDelta), updatedAt: new Date() } as any).where(eq(loyaltyMember.id, member.id))
    await db.insert(loyaltyTransaction).values({
      companyId: u.companyId, memberId: member.id, type: applied >= 0 ? 'adjustment_add' : 'adjustment_subtract',
      points: applied, balanceAfter: newBalance, description: data.reason, createdBy: u.userId,
    } as any)
    audit.log({
      action: audit.ACTIONS.UPDATE, entity: 'loyalty_member', entityId: member.id,
      changes: { pointsBalance: { old: member.pointsBalance, new: newBalance } },
      metadata: { reason: data.reason, adjustment: applied, requested: data.points }, req: c,
    })
    const cfg = await configFor(u.companyId)
    return one(c, {
      pointsBalance: newBalance, adjustment: applied, requested: data.points,
      lifetimePoints: Math.max(0, member.lifetimePoints + lifetimeDelta),
      programmeOff: !cfg.enabled,
    })
  })

  // ── Rewards ──

  app.get('/rewards', requirePermission('loyalty:read'), async (c) => {
    const u = c.get('user')
    const rows: RewardRow[] = await db.select().from(loyaltyReward).where(eq(loyaltyReward.companyId, u.companyId)).orderBy(loyaltyReward.pointsCost)
    return listAll(c, rows.map(rewardOut))
  })

  app.post('/rewards', requirePermission('loyalty:configure'), async (c) => {
    const u = c.get('user')
    const r = rewardSchema.parse(await c.req.json())
    if (r.serviceId) {
      const [svc] = await db.select({ id: serviceMenu.id }).from(serviceMenu).where(and(eq(serviceMenu.id, r.serviceId), eq(serviceMenu.companyId, u.companyId))).limit(1)
      if (!svc) return fail(c, 404, 'That service is not on the menu')
    }
    const [row] = await db.insert(loyaltyReward).values({
      companyId: u.companyId, name: r.name, description: r.description || null, pointsCost: r.pointsCost, type: r.type,
      valueCents: r.type === 'percent' ? Math.round(r.value) : toCents(r.value), serviceId: r.serviceId || null, active: r.active,
    } as any).returning()
    audit.log({ action: audit.ACTIONS.CREATE, entity: 'loyalty_reward', entityId: row.id, entityName: row.name, req: c })
    return one(c, rewardOut(row), 201)
  })

  app.put('/rewards/:id', requirePermission('loyalty:configure'), async (c) => {
    const u = c.get('user')
    const r = rewardSchema.parse(await c.req.json())
    const [row] = await db.update(loyaltyReward).set({
      name: r.name, description: r.description || null, pointsCost: r.pointsCost, type: r.type,
      valueCents: r.type === 'percent' ? Math.round(r.value) : toCents(r.value), serviceId: r.serviceId || null, active: r.active, updatedAt: new Date(),
    } as any).where(and(eq(loyaltyReward.id, c.req.param('id')), eq(loyaltyReward.companyId, u.companyId))).returning()
    if (!row) return fail(c, 404, 'Reward not found')
    return one(c, rewardOut(row))
  })

  app.delete('/rewards/:id', requirePermission('loyalty:configure'), async (c) => {
    const u = c.get('user')
    const [row] = await db.delete(loyaltyReward).where(and(eq(loyaltyReward.id, c.req.param('id')), eq(loyaltyReward.companyId, u.companyId))).returning()
    if (!row) return fail(c, 404, 'Reward not found')
    audit.log({ action: audit.ACTIONS.DELETE, entity: 'loyalty_reward', entityId: row.id, entityName: row.name, req: c })
    return done(c)
  })

  // ── Redeem ──

  /**
   * Spend points, or a completed punch card, against a visit (rewritten after LY0928): the check is the WHERE clause of
   * one conditional UPDATE (B1, B2); the invoice — not the request — is the basket, and the discount reaches it (H2); a
   * reward worth more than the bill is refused (M2); a settled bill cannot take a discount (LYR N2).
   */
  app.post('/members/:id/redeem', requirePermission('loyalty:redeem'), async (c) => {
    const u = c.get('user')
    const r = z.object({
      rewardId: z.string().min(1),
      appointmentId: z.string().min(1, 'Say which visit this reward is being used against'),
      preview: z.boolean().default(false),
    }).parse(await c.req.json())

    const cfg = await configFor(u.companyId)
    if (!cfg.enabled) return fail(c, 403, 'The loyalty programme is switched off for this salon. An admin can turn it back on under Loyalty → Settings.')

    const [member]: MemberRow[] = await db.select().from(loyaltyMember).where(and(eq(loyaltyMember.id, c.req.param('id')), eq(loyaltyMember.companyId, u.companyId))).limit(1)
    if (!member) return fail(c, 404, 'This client is not on the loyalty programme')
    const [reward]: RewardRow[] = await db.select().from(loyaltyReward).where(and(eq(loyaltyReward.id, r.rewardId), eq(loyaltyReward.companyId, u.companyId))).limit(1)
    if (!reward) return fail(c, 404, 'Reward not found')
    if (!reward.active) return fail(c, 400, 'That reward is not currently available.', 'cannot_redeem')

    const [visit] = await db.select().from(appointment).where(and(eq(appointment.id, r.appointmentId), eq(appointment.companyId, u.companyId))).limit(1)
    if (!visit) return fail(c, 404, 'Visit not found')
    if (visit.contactId !== member.contactId) return fail(c, 400, 'That visit belongs to a different client.')

    const [bill] = await db.select().from(invoice).where(and(eq(invoice.appointmentId, r.appointmentId), eq(invoice.companyId, u.companyId))).limit(1)
    if (!bill) return fail(c, 400, 'That visit has no bill yet. Complete the appointment first, then apply the reward.', 'no_invoice')
    // (The template also sent the invoice's id and number; the sentence names it.)
    if (isSettled(bill)) return fail(c, 400, `${bill.number} has already been paid. Refund the client or apply a credit instead — a reward cannot be taken off a settled bill.`, 'invoice_already_paid')

    // The basket is what the salon actually charged.
    const roomCents = Math.max(0, toCents(bill.subtotal) - toCents(bill.discount))
    const basket: BasketLine[] = [{ itemId: visit.serviceId || 'service', lineTotalCents: roomCents }]
    const asReward: Reward = {
      id: reward.id, name: reward.name, pointsCost: reward.pointsCost, type: reward.type as Reward['type'], value: reward.valueCents,
      // A free-service reward pays for THIS visit's service, so it matches when the visit is for it.
      itemId: reward.serviceId, active: reward.active,
    }

    const progress = punchCardProgress({ qualifyingVisits: member.qualifyingVisits, rewardsEarned: member.punchRewardsEarned }, cfg)
    const isPunchReward = reward.pointsCost === 0 && reward.type === 'free_item'
    const onTheHouse = isPunchReward && progress.unclaimed > 0
    // A reward costing nothing is a punch-card payout and nothing else. (The template also sent the card's progress.)
    if (isPunchReward && !onTheHouse) {
      return fail(c, 400, progress.enabled
        ? `That reward is earned with a full card. ${progress.remaining} more visit${progress.remaining === 1 ? '' : 's'} to go.`
        : 'That reward is earned with a punch card, and this salon does not run one.', 'card_not_complete')
    }
    if (reward.type === 'free_item' && reward.serviceId && visit.serviceId !== reward.serviceId) {
      const [svc] = await db.select({ name: serviceMenu.name }).from(serviceMenu).where(eq(serviceMenu.id, reward.serviceId)).limit(1)
      return fail(c, 400, `This reward pays for ${svc?.name || 'a different service'}, and this visit is not for it.`, 'cannot_redeem')
    }

    const gate = canRedeem({ ...asReward, pointsCost: onTheHouse ? 0 : reward.pointsCost }, member.pointsBalance, basket, SALON_WORDS)
    if (!gate.ok) return fail(c, 400, gate.reason || 'That reward cannot be used on this visit.', 'cannot_redeem')

    const discountCents = rewardDiscountCents(asReward, basket)
    if (reward.type === 'fixed' && discountCents < reward.valueCents) {
      return fail(c, 400, `This reward takes ${toMoney(reward.valueCents)} off, but there is only ${toMoney(roomCents)} left on this visit. Use a smaller reward, or apply it to a larger bill.`, 'reward_larger_than_bill')
    }

    const spend = onTheHouse ? 0 : reward.pointsCost
    if (r.preview) return one(c, { preview: true, discount: Number(toDollars(discountCents)), pointsCost: spend, onTheHouse, invoiceId: bill.id })

    // All four writes in one transaction: the claim, the bill, the ledger row (unique per member, type and visit — one
    // reward per visit), and the reward's use count.
    let balanceAfter = 0
    let already = false
    try {
      await db.transaction(async (tx: any) => {
        if (onTheHouse) {
          const after = await claimPunchCard(tx, member.id, u.companyId, cfg.punchCard.visitsRequired)
          if (after === null) { already = true; throw new Error('card_already_claimed') }
          balanceAfter = after
        } else {
          const after = await spendPoints(tx, member.id, u.companyId, spend)
          if (after === null) throw new Error('insufficient')
          balanceAfter = after
        }
        await discountInvoice(tx, bill.id, u.companyId, toDollars(discountCents))
        await tx.insert(loyaltyTransaction).values({
          companyId: u.companyId, memberId: member.id, type: onTheHouse ? 'punch_reward' : 'redeem',
          points: -spend, balanceAfter, description: `${reward.name}${onTheHouse ? ' (punch card)' : ''}`,
          appointmentId: r.appointmentId, invoiceId: bill.id, createdBy: u.userId,
        } as any)
        await countRewardUse(tx, reward.id)
      })
    } catch (err: any) {
      if (already) return fail(c, 409, 'That card has already been used. Someone at the front desk may have just claimed it.', 'card_already_claimed')
      if (err?.message === 'insufficient') {
        const [fresh] = await db.select({ b: loyaltyMember.pointsBalance }).from(loyaltyMember).where(eq(loyaltyMember.id, member.id)).limit(1)
        return fail(c, 400, `This reward costs ${reward.pointsCost} points and the client has ${fresh?.b ?? 0}.`, 'cannot_redeem')
      }
      if (/unique|duplicate key/i.test(String(err?.message || err)) || err?.code === '23505' || err?.cause?.code === '23505') {
        return fail(c, 409, 'A reward has already been used on this visit.', 'reward_already_used')
      }
      throw err
    }

    audit.log({
      action: audit.ACTIONS.UPDATE, entity: 'loyalty_member', entityId: member.id,
      metadata: { redeemed: reward.name, pointsSpent: spend, discount: toDollars(discountCents), onTheHouse, invoiceId: bill.id }, req: c,
    })
    return one(c, { discount: Number(toDollars(discountCents)), pointsSpent: spend, pointsBalance: balanceAfter, onTheHouse, invoiceId: bill.id })
  })

  /**
   * Repair the bills raised before the loyalty fixes landed (FULL0929 F2): over-taxed bills re-cut DOWNWARDS at their own
   * rate; a cancelled visit's untouched bill voided with the cancel path's note; a $0.00 open bill marked paid; an
   * over-paid bill REPORTED, never moved — where a client's money goes is the salon's decision. Idempotent.
   */
  app.post('/repair-legacy-invoices', requirePermission('company:update'), async (c) => {
    const u = c.get('user')
    const bills = await liveBillsWithVisitStatus(db, u.companyId)
    const retaxed: Array<{ id: string; number: string; taxWas: number; taxNow: number; total: number }> = []
    const voided: Array<{ id: string; number: string; wasOutstanding: number }> = []
    const closed: Array<{ id: string; number: string }> = []
    const overpaid: Array<{ id: string; number: string; paid: number; total: number; owedBack: number }> = []

    for (const b of bills) {
      const subtotalCents = toCents(b.subtotal)
      const discountCents = Math.min(toCents(b.discount), subtotalCents)
      const baseCents = Math.max(0, subtotalCents - discountCents)
      const rate = Number(b.taxRate) || 0
      const rightTaxCents = Math.round((baseCents * rate) / 100)
      const storedTaxCents = toCents(b.taxAmount)
      const heldCents = toCents(b.amountPaid) - toCents(b.amountRefunded)
      let totalCents = toCents(b.total)

      if ((b.appointmentStatus === 'cancelled' || b.appointmentStatus === 'no_show') && heldCents <= 0) {
        const note = String(b.notes || '')
        await voidBillWithNote(db, b.id, u.companyId, note ? `${note}\n${VOIDED_ON_CANCEL}` : VOIDED_ON_CANCEL)
        voided.push({ id: b.id, number: b.number, wasOutstanding: Number(toDollars(totalCents)) })
        continue
      }
      if (storedTaxCents > rightTaxCents) {
        totalCents = baseCents + rightTaxCents
        await setBillTax(db, b.id, u.companyId, toDollars(rightTaxCents), toDollars(totalCents))
        retaxed.push({ id: b.id, number: b.number, taxWas: Number(toDollars(storedTaxCents)), taxNow: Number(toDollars(rightTaxCents)), total: Number(toDollars(totalCents)) })
      }
      if (totalCents <= 0 && String(b.status).toLowerCase() !== 'paid') {
        await markBillPaid(db, b.id, u.companyId)
        closed.push({ id: b.id, number: b.number })
      }
      if (heldCents > totalCents) {
        overpaid.push({ id: b.id, number: b.number, paid: Number(toDollars(heldCents)), total: Number(toDollars(totalCents)), owedBack: Number(toDollars(heldCents - totalCents)) })
      }
    }

    audit.log({
      action: audit.ACTIONS.UPDATE, entity: 'invoice', entityId: 'repair-legacy-invoices',
      metadata: { retaxed: retaxed.length, voided: voided.length, closed: closed.length, overpaid: overpaid.length }, req: c,
    })
    return one(c, {
      scanned: bills.length, retaxed, voided, closed, overpaid,
      needsAPerson: overpaid.length
        ? `${overpaid.length === 1 ? 'One bill was' : `${overpaid.length} bills were`} paid for more than ${overpaid.length === 1 ? 'it is' : 'they are'} now worth. Refund the client or raise a credit — whichever they would rather have.`
        : undefined,
    })
  })

  return app
}
