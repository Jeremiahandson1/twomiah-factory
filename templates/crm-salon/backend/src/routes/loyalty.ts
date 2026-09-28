import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { loyaltyMember, loyaltyTransaction, loyaltyReward, contact, company, serviceMenu, appointment, invoice } from '../../db/schema.ts'
import { eq, and, desc, sql, ilike } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'
import audit from '../services/audit.ts'
import { loyaltyConfig, loyaltyConfigResponse, LOYALTY_SETTING_KEYS, punchCardProgress, rewardDiscountCents, canRedeem, type Reward, type BasketLine } from '../shared/index.ts'

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
/** The same figure with a currency mark, for a message a person reads at the desk. */
const toMoney = (c: number) => '$' + toDollars(c)

/**
 * A salon has clients and visits. The shared engine's refusals default to a shop's customers and
 * orders, which is what run LY0928 M3 saw at the desk — "add the free cut to the order". The rule
 * was right; only the trade was wrong.
 */
const SALON_WORDS = { buyer: 'client', sale: 'visit' }

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

app.get('/config', requirePermission('loyalty:read'), async (c) => {
  const u = c.get('user')
  const [co] = await db.select({ settings: company.settings }).from(company).where(eq(company.id, u.companyId)).limit(1)
  return c.json(loyaltyConfigResponse(co?.settings))
})

/**
 * Set the programme up.
 *
 * Run LY0928 B3: there was no way to do this. PUT and PATCH /api/loyalty/config were 404, the only
 * writer was PUT /api/company — which the report found by probing — and the punch card therefore sat
 * at 0 visits (off) forever, because nothing in the CRM could raise it. Every field the engine reads
 * is settable here, welcome and birthday bonus included (L4).
 *
 * Every key is optional and only what is sent is changed, so the settings panel can save one switch
 * without having to resend the whole programme.
 */
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

app.put('/config', requirePermission('loyalty:configure'), async (c) => {
  const u = c.get('user')
  const body = configSchema.parse(await c.req.json())

  const [co] = await db.select({ settings: company.settings }).from(company).where(eq(company.id, u.companyId)).limit(1)
  const settings: any = (typeof co?.settings === 'string' ? JSON.parse(co.settings || '{}') : co?.settings) || {}
  const before = loyaltyConfig(settings)

  // Merged onto what loyaltyConfig() would actually use, not onto the raw blob — so a half-written
  // settings row from an older build comes out complete rather than half-defaulted at read time.
  const next: any = { ...before, punchCard: { ...before.punchCard } }
  for (const [wireKey, storeKey] of Object.entries(LOYALTY_SETTING_KEYS)) {
    const sent = (body as any)[wireKey]
    if (sent === undefined) continue
    next[storeKey] = storeKey === 'punchCard' ? { ...before.punchCard, ...sent } : sent
  }

  // A card that only counts named services has to name services that exist here.
  const wanted = next.punchCard.qualifyingServiceIds || []
  if (wanted.length) {
    const rows = await db.select({ id: serviceMenu.id }).from(serviceMenu).where(eq(serviceMenu.companyId, u.companyId))
    const known = new Set(rows.map((r) => r.id))
    const strangers = wanted.filter((id: string) => !known.has(id))
    if (strangers.length) {
      return c.json({ error: 'One of the chosen services is not on this salon’s menu.', code: 'unknown_service' }, 400)
    }
  }

  await db.update(company).set({
    settings: { ...settings, loyalty: loyaltyConfig({ loyalty: next }) }, updatedAt: new Date(),
  } as any).where(eq(company.id, u.companyId))

  audit.log({
    action: audit.ACTIONS.UPDATE, entity: 'company', entityId: u.companyId,
    metadata: { loyalty: { before, after: next } }, req: c,
  })

  const [fresh] = await db.select({ settings: company.settings }).from(company).where(eq(company.id, u.companyId)).limit(1)
  return c.json(loyaltyConfigResponse(fresh?.settings))
})

// ==================== MEMBERS ====================

app.get('/members', requirePermission('loyalty:read'), async (c) => {
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

app.get('/members/:id', requirePermission('loyalty:read'), async (c) => {
  const u = c.get('user')
  const [member] = await db.select().from(loyaltyMember)
    .where(and(eq(loyaltyMember.id, c.req.param('id')), eq(loyaltyMember.companyId, u.companyId))).limit(1)
  if (!member) return c.json({ error: 'Loyalty member not found' }, 404)

  const history = await db.select().from(loyaltyTransaction)
    .where(eq(loyaltyTransaction.memberId, member.id))
    .orderBy(desc(loyaltyTransaction.createdAt)).limit(50)

  return c.json({ ...withProgress(member, await configFor(u.companyId)), transactions: history })
})

/**
 * The visits a reward could be applied to.
 *
 * Redeeming lands on a bill, and the desk has to be able to pick which one. Run LY0928 B3 found no
 * redeem control anywhere in the CRM and an endpoint that wanted e-commerce order lines the salon
 * never sends; this is what the screen needs to offer the choice honestly — the client's recent
 * completed visits, each with the bill it raised, what is still chargeable on it, and whether a
 * reward has already been used on it.
 */
app.get('/members/:id/visits', requirePermission('loyalty:read'), async (c) => {
  const u = c.get('user')
  const [member] = await db.select().from(loyaltyMember)
    .where(and(eq(loyaltyMember.id, c.req.param('id')), eq(loyaltyMember.companyId, u.companyId))).limit(1)
  if (!member) return c.json({ error: 'Loyalty member not found' }, 404)

  const rows = await db.select({
    appointmentId: appointment.id,
    startTime: appointment.startTime,
    serviceId: appointment.serviceId,
    serviceName: serviceMenu.name,
    invoiceId: invoice.id,
    invoiceNumber: invoice.number,
    subtotal: invoice.subtotal,
    discount: invoice.discount,
    total: invoice.total,
  })
    .from(appointment)
    .innerJoin(invoice, and(eq(invoice.appointmentId, appointment.id), eq(invoice.companyId, u.companyId)))
    .leftJoin(serviceMenu, eq(serviceMenu.id, appointment.serviceId))
    .where(and(
      eq(appointment.companyId, u.companyId),
      eq(appointment.contactId, member.contactId),
      eq(appointment.status, 'completed'),
    ))
    .orderBy(desc(appointment.startTime))
    .limit(20)

  // One reward per visit, so a visit that already carries one is offered as spent rather than hidden
  // — the desk needs to see WHY it cannot be picked.
  const spent = new Set(
    (await db.select({ appointmentId: loyaltyTransaction.appointmentId }).from(loyaltyTransaction)
      .where(and(
        eq(loyaltyTransaction.memberId, member.id),
        sql`${loyaltyTransaction.type} IN ('redeem', 'punch_reward')`,
      ))).map((r) => r.appointmentId),
  )

  return c.json({
    data: rows.map((r) => ({
      ...r,
      remaining: Number(toDollars(Math.max(0, toCents(r.subtotal) - toCents(r.discount)))),
      rewardUsed: spent.has(r.appointmentId),
    })),
  })
})

/** Enrol a client by hand. Completing a visit enrols them anyway; this is for the front desk. */
app.post('/members', requirePermission('loyalty:enroll'), async (c) => {
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
 *
 * Two rules run LY0928 asked us to decide and state:
 *
 *   L2  A correction still works with the programme switched off, and deliberately so — a salon that
 *       pauses the programme must still be able to undo a mistake made while it was running. The
 *       answer says `programmeOff` so the screen can tell the truth about what it just did.
 *   L3  Earned-to-date is the client's record of what their VISITS earned. A -999,999 that floors the
 *       balance used to take it to zero as well, erasing points from real visits. A correction can
 *       now only take back what corrections previously added — no more.
 */
app.post('/members/:id/adjust', requirePermission('loyalty:adjust'), async (c) => {
  const u = c.get('user')
  const data = z.object({ points: z.number().int(), reason: z.string().min(1) }).parse(await c.req.json())

  const [member] = await db.select().from(loyaltyMember)
    .where(and(eq(loyaltyMember.id, c.req.param('id')), eq(loyaltyMember.companyId, u.companyId))).limit(1)
  if (!member) return c.json({ error: 'Loyalty member not found' }, 404)

  const newBalance = Math.max(0, member.pointsBalance + data.points)
  const applied = newBalance - member.pointsBalance

  // What earlier corrections put INTO the lifetime figure. That is the ceiling on what this one can
  // take back out of it; everything above it was earned at the chair. (LY0928 L3)
  let lifetimeDelta = applied
  if (applied < 0) {
    const [net] = await db.select({ standing: sql<number>`COALESCE(SUM(${loyaltyTransaction.points}), 0)` })
      .from(loyaltyTransaction)
      .where(and(
        eq(loyaltyTransaction.memberId, member.id),
        sql`${loyaltyTransaction.type} IN ('adjustment_add', 'adjustment_subtract')`,
      ))
    const reversible = Math.max(0, Number(net?.standing || 0))
    lifetimeDelta = -Math.min(-applied, reversible)
  }

  await db.update(loyaltyMember).set({
    pointsBalance: newBalance,
    // Lifetime moves with a correction in both directions, so a mistaken grant can be undone — but
    // only as far as the grants themselves go.
    lifetimePoints: Math.max(0, member.lifetimePoints + lifetimeDelta),
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

  const cfg = await configFor(u.companyId)
  return c.json({
    pointsBalance: newBalance,
    adjustment: applied,
    requested: data.points,
    lifetimePoints: Math.max(0, member.lifetimePoints + lifetimeDelta),
    // The correction stands either way; the desk just needs to know clients are not earning.
    programmeOff: !cfg.enabled,
  })
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

app.get('/rewards', requirePermission('loyalty:read'), async (c) => {
  const u = c.get('user')
  const rows = await db.select().from(loyaltyReward)
    .where(eq(loyaltyReward.companyId, u.companyId)).orderBy(loyaltyReward.pointsCost)
  return c.json({ data: rows.map(rewardOut) })
})

app.post('/rewards', requirePermission('loyalty:configure'), async (c) => {
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

app.put('/rewards/:id', requirePermission('loyalty:configure'), async (c) => {
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

app.delete('/rewards/:id', requirePermission('loyalty:configure'), async (c) => {
  const u = c.get('user')
  const [row] = await db.delete(loyaltyReward)
    .where(and(eq(loyaltyReward.id, c.req.param('id')), eq(loyaltyReward.companyId, u.companyId))).returning()
  if (!row) return c.json({ error: 'Reward not found' }, 404)
  audit.log({ action: audit.ACTIONS.DELETE, entity: 'loyalty_reward', entityId: row.id, entityName: row.name, req: c })
  return c.json({ success: true })
})

// ==================== REDEEM ====================


/**
 * Spend points, or a completed punch card, against a visit.
 *
 * Rewritten after run LY0928, which broke the previous version four ways at once:
 *
 *   B1  Ten simultaneous requests spent 1,400 points from a 400-point balance. The check and the
 *       deduction were separate statements, so every request read the balance before any of them
 *       wrote it — and GREATEST(0, …) then floored the result, hiding the overspend on the screen.
 *   B2  One full card paid out two free services, for the same reason.
 *   H2  The points were taken and no invoice ever changed, so the discount existed nowhere but the
 *       response body. The basket also came from the CALLER: itemId "not-a-real-item" was accepted.
 *   M2  A $10 reward against a $5 bill took $5 off and charged the full 200 points.
 *
 * The shape that fixes the first two is a single conditional UPDATE whose WHERE clause carries the
 * check, plus a refusal when it changes no row. Nothing is read and then written back.
 *
 * The invoice — not the request — is now the basket. A salon visit already has one, raised when the
 * appointment was completed, so there is no reason to ask the caller what the customer is buying.
 */
app.post('/members/:id/redeem', requirePermission('loyalty:redeem'), async (c) => {
  const u = c.get('user')
  const d = z.object({
    rewardId: z.string().min(1),
    // Required now. A redemption has to land ON something, or it is just points vanishing.
    appointmentId: z.string().min(1, 'Say which visit this reward is being used against'),
    preview: z.boolean().default(false),
  }).parse(await c.req.json())

  const cfg = await configFor(u.companyId)
  if (!cfg.enabled) {
    return c.json({ error: 'The loyalty programme is switched off for this salon. An admin can turn it back on under Loyalty → Settings.' }, 403)
  }

  const [member] = await db.select().from(loyaltyMember)
    .where(and(eq(loyaltyMember.id, c.req.param('id')), eq(loyaltyMember.companyId, u.companyId))).limit(1)
  if (!member) return c.json({ error: 'This client is not on the loyalty programme' }, 404)

  const [reward] = await db.select().from(loyaltyReward)
    .where(and(eq(loyaltyReward.id, d.rewardId), eq(loyaltyReward.companyId, u.companyId))).limit(1)
  if (!reward) return c.json({ error: 'Reward not found' }, 404)
  if (!reward.active) return c.json({ error: 'That reward is not currently available.', code: 'cannot_redeem' }, 400)

  // ── the visit, and the bill it raised ───────────────────────────────────────────────────────
  const [visit] = await db.select().from(appointment)
    .where(and(eq(appointment.id, d.appointmentId), eq(appointment.companyId, u.companyId))).limit(1)
  if (!visit) return c.json({ error: 'Visit not found' }, 404)
  if (visit.contactId !== member.contactId) {
    return c.json({ error: 'That visit belongs to a different client.' }, 400)
  }

  const [bill] = await db.select().from(invoice)
    .where(and(eq(invoice.appointmentId, d.appointmentId), eq(invoice.companyId, u.companyId))).limit(1)
  if (!bill) {
    return c.json({ error: 'That visit has no bill yet. Complete the appointment first, then apply the reward.', code: 'no_invoice' }, 400)
  }

  // The basket is what the salon actually charged, not what the caller says it charged.
  const billSubtotalCents = toCents(bill.subtotal)
  const alreadyOffCents = toCents(bill.discount)
  const roomCents = Math.max(0, billSubtotalCents - alreadyOffCents)
  const basket: BasketLine[] = [{ itemId: visit.serviceId || 'service', lineTotalCents: roomCents }]

  const asReward: Reward = {
    id: reward.id, name: reward.name, pointsCost: reward.pointsCost,
    type: reward.type as any, value: reward.valueCents,
    // A free-service reward pays for THIS visit's service, so it matches when the visit is for it.
    itemId: reward.serviceId, active: reward.active,
  }

  const progress = punchCardProgress(
    { qualifyingVisits: member.qualifyingVisits, rewardsEarned: member.punchRewardsEarned }, cfg,
  )
  const isPunchReward = reward.pointsCost === 0 && reward.type === 'free_item'
  const onTheHouse = isPunchReward && progress.unclaimed > 0

  // A reward costing nothing is a punch-card payout and NOTHING else — 0 points is a price every
  // balance can meet, so without this the card would be decoration.
  if (isPunchReward && !onTheHouse) {
    return c.json({
      error: progress.enabled
        ? `That reward is earned with a full card. ${progress.remaining} more visit${progress.remaining === 1 ? '' : 's'} to go.`
        : 'That reward is earned with a punch card, and this salon does not run one.',
      code: 'card_not_complete',
      punchCard: progress,
    }, 400)
  }

  if (reward.type === 'free_item' && reward.serviceId && visit.serviceId !== reward.serviceId) {
    const [svc] = await db.select({ name: serviceMenu.name }).from(serviceMenu).where(eq(serviceMenu.id, reward.serviceId)).limit(1)
    return c.json({ error: `This reward pays for ${svc?.name || 'a different service'}, and this visit is not for it.`, code: 'cannot_redeem' }, 400)
  }

  const gate = canRedeem({ ...asReward, pointsCost: onTheHouse ? 0 : reward.pointsCost }, member.pointsBalance, basket, SALON_WORDS)
  if (!gate.ok) return c.json({ error: gate.reason, code: 'cannot_redeem' }, 400)

  const discountCents = rewardDiscountCents(asReward, basket)

  // A reward worth more than the bill would charge full price in points for part of the value. Say
  // so rather than quietly short-changing the client. (LY0928 M2)
  if (reward.type === 'fixed' && discountCents < reward.valueCents) {
    return c.json({
      error: `This reward takes ${toMoney(reward.valueCents)} off, but there is only ${toMoney(roomCents)} left on this visit. Use a smaller reward, or apply it to a larger bill.`,
      code: 'reward_larger_than_bill',
    }, 400)
  }

  const spend = onTheHouse ? 0 : reward.pointsCost
  if (d.preview) {
    return c.json({ preview: true, discount: Number(toDollars(discountCents)), pointsCost: spend, onTheHouse, invoiceId: bill.id })
  }

  // ── claim it, atomically ────────────────────────────────────────────────────────────────────
  // All four writes go in one transaction. The old version deducted first and wrote the ledger row
  // afterwards, so anything that refused the row — including the unique index below — took the
  // client's points and left no record of where they went.
  let balanceAfter = 0
  let already = false
  try {
    await db.transaction(async (tx) => {
      if (onTheHouse) {
        // The card is consumed by the same statement that checks it is full. floor(visits / required)
        // is how many cards this member has completed all told; it has to exceed the number already
        // paid out. Two simultaneous requests cannot both satisfy that, because the second one reads
        // what the first committed. (LY0928 B2)
        const claimed: any = await tx.execute(sql`
          UPDATE loyalty_members
          SET punch_rewards_earned = punch_rewards_earned + 1,
              last_activity_at = NOW(), updated_at = NOW()
          WHERE id = ${member.id}
            AND company_id = ${u.companyId}
            AND floor(qualifying_visits::numeric / ${cfg.punchCard.visitsRequired}) > punch_rewards_earned
          RETURNING points_balance
        `)
        const row = (claimed.rows || claimed)?.[0]
        if (!row) { already = true; throw new Error('card_already_claimed') }
        balanceAfter = Number(row.points_balance)
      } else {
        // The balance check IS the WHERE clause, so ten simultaneous requests cannot each read the
        // same 400 and each spend it. No row changed means they could not afford it — which is also
        // the honest answer when a simultaneous request got there first. (LY0928 B1)
        const spentRow: any = await tx.execute(sql`
          UPDATE loyalty_members
          SET points_balance = points_balance - ${spend},
              last_activity_at = NOW(), updated_at = NOW()
          WHERE id = ${member.id}
            AND company_id = ${u.companyId}
            AND points_balance >= ${spend}
          RETURNING points_balance
        `)
        const row = (spentRow.rows || spentRow)?.[0]
        if (!row) throw new Error('insufficient')
        balanceAfter = Number(row.points_balance)
      }

      // The discount reaches the bill, which is the entire point of redeeming. Recomputed from the
      // stored figures rather than the ones read above, so a bill edited in between cannot be driven
      // negative. (LY0928 H2)
      await tx.execute(sql`
        UPDATE invoice
        SET discount = LEAST(COALESCE(discount, 0) + ${toDollars(discountCents)}, COALESCE(subtotal, 0)),
            total = GREATEST(0, COALESCE(subtotal, 0) - LEAST(COALESCE(discount, 0) + ${toDollars(discountCents)}, COALESCE(subtotal, 0)) + COALESCE(tax_amount, 0)),
            updated_at = NOW()
        WHERE id = ${bill.id} AND company_id = ${u.companyId}
      `)

      // loyalty_tx_earn_per_appointment is unique on (member, type, appointment), so this row is also
      // the rule "one reward per visit" — the second attempt raises here and the whole transaction
      // unwinds, points included.
      await tx.insert(loyaltyTransaction).values({
        companyId: u.companyId, memberId: member.id,
        type: onTheHouse ? 'punch_reward' : 'redeem',
        points: -spend, balanceAfter,
        description: `${reward.name}${onTheHouse ? ' (punch card)' : ''}`,
        appointmentId: d.appointmentId,
        // Which bill it came off. Without this there was no record of what the money was applied to.
        invoiceId: bill.id,
        createdBy: u.userId,
      } as any)

      await tx.update(loyaltyReward).set({ usageCount: sql`${loyaltyReward.usageCount} + 1`, updatedAt: new Date() } as any)
        .where(eq(loyaltyReward.id, reward.id))
    })
  } catch (err: any) {
    if (already) {
      return c.json({ error: 'That card has already been used. Another till may have just claimed it.', code: 'card_already_claimed' }, 409)
    }
    if (err?.message === 'insufficient') {
      const [fresh] = await db.select({ b: loyaltyMember.pointsBalance }).from(loyaltyMember).where(eq(loyaltyMember.id, member.id)).limit(1)
      return c.json({
        error: `This reward costs ${reward.pointsCost} points and the client has ${fresh?.b ?? 0}.`,
        code: 'cannot_redeem',
      }, 400)
    }
    if (/unique|duplicate key/i.test(String(err?.message || err))) {
      return c.json({ error: 'A reward has already been used on this visit.', code: 'reward_already_used' }, 409)
    }
    throw err
  }

  audit.log({
    action: audit.ACTIONS.UPDATE, entity: 'loyalty_member', entityId: member.id,
    metadata: { redeemed: reward.name, pointsSpent: spend, discount: toDollars(discountCents), onTheHouse, invoiceId: bill.id }, req: c,
  })

  return c.json({
    discount: Number(toDollars(discountCents)),
    pointsSpent: spend,
    pointsBalance: balanceAfter,
    onTheHouse,
    invoiceId: bill.id,
  })
})

export default app
