// Awarding loyalty when a visit completes, and taking it back when it is cancelled. Moved from
// templates/crm-salon/backend/src/services/loyaltyAward.ts.
//
// The rules are shared (packages/tenant-backend loyalty); this is the salon's wiring to them. It hangs off the same
// completion that raises the invoice and writes the visit record, because those are the same event: the client sat in
// the chair and paid. Idempotent by construction: the earn row is keyed to the APPOINTMENT by a unique index
// (member, type, appointment_id), so a second award for the same visit hits that index and is dropped.
import { and, eq } from 'drizzle-orm'
import { loyaltyConfig, pointsForSale, pointsForSaleAtTier, tierFor, visitQualifies, inBirthdayMonth } from '@twomiah/tenant-backend'
import { loyaltyMember, loyaltyTransaction, company, serviceMenu, clientProfile } from '../../db/schema/index.ts'
import { birthdayBonusThisYear, creditMember, debitMember } from '../../data/salonLoyalty.ts'
import { tierReached } from './offers.ts'

export interface VisitAward {
  companyId: string
  contactId: string
  appointmentId: string
  serviceId?: string | null
  /** What the client was charged, in dollars. */
  price: number
  /** The bill the visit raised, so "what did these points come from" can be answered in money (LY0928 L1). */
  invoiceId?: string | null
}

export interface VisitAwardResult {
  awarded: boolean
  points: number
  countedAsVisit: boolean
  /** Points given on top of what the spend earned — the welcome and birthday bonuses (LYR L4). */
  bonusPoints: number
}

const NONE: VisitAwardResult = { awarded: false, points: 0, countedAsVisit: false, bonusPoints: 0 }

export function createLoyaltyAward(db: any) {
  /**
   * Grant points and a punch for one completed visit. Never throws for a programme's own reasons: loyalty rides on a
   * visit that has already happened, and must not stop it being completed or billed.
   */
  async function awardForCompletedVisit(v: VisitAward): Promise<VisitAwardResult> {
    if (!v.contactId || !v.appointmentId) return NONE

    const [co] = await db.select({ settings: company.settings }).from(company).where(eq(company.id, v.companyId)).limit(1)
    const cfg = loyaltyConfig(co?.settings)
    // The shop's own switch: a programme turned off stops accruing.
    if (!cfg.enabled) return NONE

    const priceCents = Math.round((Number(v.price) || 0) * 100)
    // At the programme's own rate first (does this visit earn anything at all); the member's tier multiplies it below.
    let points = pointsForSale(priceCents, cfg)
    const counts = cfg.punchCard.visitsRequired > 0 && visitQualifies(v.serviceId, cfg)
    if (points <= 0 && !counts) return NONE

    // Enrolment is automatic: a client who has been sold to is in the programme.
    let [member] = await db.select().from(loyaltyMember)
      .where(and(eq(loyaltyMember.companyId, v.companyId), eq(loyaltyMember.contactId, v.contactId))).limit(1)
    // Whether THIS visit put them in the programme: a successful insert is the only honest answer (LYR L4).
    let justEnrolled = false
    if (!member) {
      try {
        ;[member] = await db.insert(loyaltyMember).values({ companyId: v.companyId, contactId: v.contactId } as any).returning()
        justEnrolled = !!member
      } catch {
        ;[member] = await db.select().from(loyaltyMember)
          .where(and(eq(loyaltyMember.companyId, v.companyId), eq(loyaltyMember.contactId, v.contactId))).limit(1)
      }
    }
    if (!member) return NONE

    // The tier the member was in BEFORE this visit (lifetime points to date) sets its multiplier; the visit's own points
    // may lift them into the next tier, which counts from the next visit.
    const standing = tierFor(member.lifetimePoints, cfg)
    points = pointsForSaleAtTier(priceCents, cfg, member.lifetimePoints)

    // The ledger row FIRST, and the unique index decides whether this visit has already paid out.
    try {
      await db.insert(loyaltyTransaction).values({
        companyId: v.companyId, memberId: member.id, type: 'earn',
        points, balanceAfter: member.pointsBalance + points,
        description: standing.tier && standing.multiplier > 1 ? `Visit (${standing.tier.name}, ${standing.multiplier}× points)` : 'Visit',
        appointmentId: v.appointmentId, invoiceId: v.invoiceId || null,
      } as any)
    } catch {
      return NONE // already awarded for this appointment
    }

    // The bonuses the settings screen promises (LYR L4): joining is joining however it happens, and the birthday bonus
    // once per calendar year, on the first completed visit of their birthday month.
    let bonusPoints = 0
    if (justEnrolled && cfg.welcomePoints > 0) {
      try {
        await db.insert(loyaltyTransaction).values({
          companyId: v.companyId, memberId: member.id, type: 'bonus',
          points: cfg.welcomePoints, balanceAfter: member.pointsBalance + points + cfg.welcomePoints,
          // No appointmentId: the welcome is for joining, and leaving it null keeps it clear of the birthday row.
          description: 'Welcome bonus', invoiceId: v.invoiceId || null,
        } as any)
        bonusPoints += cfg.welcomePoints
      } catch { /* never fatal: the visit and its bill stand regardless */ }
    }

    if (cfg.birthdayBonus > 0) {
      try {
        // A salon keeps the birthday on the client's PROFILE, as a plain 'YYYY-MM-DD'.
        const [prof] = await db.select({ birthday: clientProfile.birthday }).from(clientProfile)
          .where(and(eq(clientProfile.contactId, v.contactId), eq(clientProfile.companyId, v.companyId))).limit(1)
        if (inBirthdayMonth(prof?.birthday) && !(await birthdayBonusThisYear(db, member.id))) {
          await db.insert(loyaltyTransaction).values({
            companyId: v.companyId, memberId: member.id, type: 'bonus',
            points: cfg.birthdayBonus,
            balanceAfter: member.pointsBalance + points + bonusPoints + cfg.birthdayBonus,
            description: `Birthday bonus ${new Date().getFullYear()}`,
            // Keyed to the visit, so a replayed completion hits the unique index instead of granting a second one.
            appointmentId: v.appointmentId, invoiceId: v.invoiceId || null,
          } as any)
          bonusPoints += cfg.birthdayBonus
        }
      } catch { /* never fatal */ }
    }

    // One balance write for everything this visit granted.
    await creditMember(db, member.id, points + bonusPoints, counts)
    // Moving up a tier is remembered (and when), for the "you reached Gold" message. Never fatal.
    try {
      const reached = tierReached(cfg.tiers, member.lifetimePoints, member.lifetimePoints + points + bonusPoints)
      if (reached) await db.update(loyaltyMember).set({ tierMin: reached.minPoints, tierAt: new Date() } as any).where(eq(loyaltyMember.id, member.id))
    } catch { /* the visit and its points stand regardless */ }
    return { awarded: true, points, countedAsVisit: counts, bonusPoints }
  }

  /**
   * Take back what a visit earned, because it did not happen after all (LY0928 M1). The earn row is removed rather
   * than left standing, so completing it again earns again — once. The birthday bonus rides on the visit and goes with
   * it; the welcome bonus stays (they joined). Never throws for the programme's own reasons.
   */
  async function reverseForCancelledVisit(v: { companyId: string; appointmentId: string; serviceId?: string | null }): Promise<{ reversed: boolean; points: number }> {
    const NOTHING = { reversed: false, points: 0 }
    if (!v.appointmentId) return NOTHING

    const [earn] = await db.select().from(loyaltyTransaction)
      .where(and(eq(loyaltyTransaction.companyId, v.companyId), eq(loyaltyTransaction.appointmentId, v.appointmentId), eq(loyaltyTransaction.type, 'earn'))).limit(1)
    if (!earn) return NOTHING

    const [member] = await db.select().from(loyaltyMember).where(eq(loyaltyMember.id, earn.memberId)).limit(1)
    if (!member) return NOTHING

    const [co] = await db.select({ settings: company.settings }).from(company).where(eq(company.id, v.companyId)).limit(1)
    const cfg = loyaltyConfig(co?.settings)
    // Whether this visit filled a punch is decided the way it was when it was awarded.
    const counted = cfg.punchCard.visitsRequired > 0 && visitQualifies(v.serviceId, cfg)
    const earned = Number(earn.points) || 0

    const [birthday] = await db.select().from(loyaltyTransaction)
      .where(and(eq(loyaltyTransaction.memberId, member.id), eq(loyaltyTransaction.type, 'bonus'), eq(loyaltyTransaction.appointmentId, v.appointmentId))).limit(1)
    const bonus = birthday ? Number(birthday.points) || 0 : 0
    const points = earned + bonus

    await db.delete(loyaltyTransaction).where(eq(loyaltyTransaction.id, earn.id))
    if (birthday) await db.delete(loyaltyTransaction).where(eq(loyaltyTransaction.id, birthday.id))
    await debitMember(db, member.id, points, counted)

    // One reversal row per visit, topped up rather than duplicated.
    const [fresh] = await db.select({ b: loyaltyMember.pointsBalance }).from(loyaltyMember).where(eq(loyaltyMember.id, member.id)).limit(1)
    const [prior] = await db.select().from(loyaltyTransaction)
      .where(and(eq(loyaltyTransaction.memberId, member.id), eq(loyaltyTransaction.type, 'reversal'), eq(loyaltyTransaction.appointmentId, v.appointmentId))).limit(1)
    if (prior) {
      await db.update(loyaltyTransaction).set({ points: Number(prior.points) - points, balanceAfter: fresh?.b ?? 0 } as any)
        .where(eq(loyaltyTransaction.id, prior.id))
    } else {
      await db.insert(loyaltyTransaction).values({
        companyId: v.companyId, memberId: member.id, type: 'reversal',
        points: -points, balanceAfter: fresh?.b ?? 0,
        description: 'Visit cancelled', appointmentId: v.appointmentId, invoiceId: earn.invoiceId,
      } as any)
    }
    return { reversed: true, points }
  }

  /** The price a visit should earn on, when the appointment itself does not carry one. */
  async function priceForVisit(companyId: string, serviceId: string | null | undefined, quoted: unknown): Promise<number> {
    const price = Number(quoted)
    if (price > 0) return price
    if (!serviceId) return 0
    const [svc] = await db.select({ price: serviceMenu.price }).from(serviceMenu)
      .where(and(eq(serviceMenu.id, serviceId), eq(serviceMenu.companyId, companyId))).limit(1)
    return Number(svc?.price) || 0
  }

  return { awardForCompletedVisit, reverseForCancelledVisit, priceForVisit }
}

export type LoyaltyAward = ReturnType<typeof createLoyaltyAward>
