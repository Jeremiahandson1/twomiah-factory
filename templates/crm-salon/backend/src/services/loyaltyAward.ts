// Awarding loyalty when a visit completes.
//
// The rules are shared (src/shared → packages/tenant-backend/src/loyalty); this is the salon's wiring
// to them. It hangs off the same onVisitCompleted hook that raises the invoice and writes the service
// record, because those three things are the same event: the client sat in the chair and paid.
//
// Idempotent by construction. A status can be flipped completed → scheduled → completed, a retry can
// land twice, and an import can replay history — so the earn row is keyed to the APPOINTMENT by a
// unique index (member, type, appointment_id). A second award for the same visit hits that index and
// is dropped rather than doubling a client's points, which is the loyalty version of the
// double-completion bug that once applied inventory twice in crm-dispensary.
import { db } from '../../db/index.ts'
import { loyaltyMember, loyaltyTransaction, company, serviceMenu, clientProfile } from '../../db/schema.ts'
import { eq, and, sql } from 'drizzle-orm'
import { loyaltyConfig, pointsForSale, visitQualifies, inBirthdayMonth } from '../shared/index.ts'

export interface VisitAward {
  companyId: string
  contactId: string
  appointmentId: string
  serviceId?: string | null
  /** What the client was charged, in dollars — this template's unit. */
  price: number
  /**
   * The bill the visit raised. Run LY0928 L1: every earn row carried an appointmentId and a null
   * invoiceId, so "what did these points come from" could not be answered in money. The invoice is
   * created first in the same completion step, so it is there to record.
   */
  invoiceId?: string | null
}

export interface VisitAwardResult {
  awarded: boolean
  points: number
  countedAsVisit: boolean
  /**
   * Points granted on top of what the spend earned — the welcome bonus on joining, the birthday
   * bonus in their birthday month. Reported separately because `points` answers "what did this
   * visit earn", and a bonus is not earned, it is given. (LYR L4)
   */
  bonusPoints: number
}

const NONE: VisitAwardResult = { awarded: false, points: 0, countedAsVisit: false, bonusPoints: 0 }

/**
 * Grant points and a punch for one completed visit.
 *
 * Never throws: loyalty is a nice-to-have on top of a visit that has already happened, and a
 * programme misconfiguration must not stop an appointment being marked complete or an invoice being
 * raised. The caller logs and carries on.
 */
export async function awardForCompletedVisit(v: VisitAward): Promise<VisitAwardResult> {
  if (!v.contactId || !v.appointmentId) return NONE

  const [co] = await db.select({ settings: company.settings }).from(company)
    .where(eq(company.id, v.companyId)).limit(1)
  const cfg = loyaltyConfig(co?.settings)
  // The shop's own switch. A salon that turns the programme off expects it to stop, not to keep
  // quietly accruing points it will have to honour later.
  if (!cfg.enabled) return NONE

  // Price in dollars on the way in, cents through the engine.
  const points = pointsForSale(Math.round((Number(v.price) || 0) * 100), cfg)
  const counts = cfg.punchCard.visitsRequired > 0 && visitQualifies(v.serviceId, cfg)
  if (points <= 0 && !counts) return NONE

  // Enrolment is automatic: a client who has been sold to is in the programme, the same way their
  // first completed visit is what creates their service record.
  let [member] = await db.select().from(loyaltyMember)
    .where(and(eq(loyaltyMember.companyId, v.companyId), eq(loyaltyMember.contactId, v.contactId))).limit(1)
  // Whether THIS visit is the one that put them in the programme. A successful insert is the only
  // honest answer: the catch below runs when another request won the race, and that request is the
  // one that enrolled them. (LYR L4)
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

  // The ledger row FIRST, and let the unique index decide whether this visit has already paid out.
  // Doing the balance first and the row second would double the points whenever the row was the
  // thing that failed.
  try {
    await db.insert(loyaltyTransaction).values({
      companyId: v.companyId, memberId: member.id, type: 'earn',
      points, balanceAfter: member.pointsBalance + points,
      description: 'Visit', appointmentId: v.appointmentId, invoiceId: v.invoiceId || null,
    } as any)
  } catch {
    // Already awarded for this appointment.
    return NONE
  }

  // ── The bonuses the settings screen promises ──────────────────────────────────────────────
  //
  // LYR L4: welcome bonus 50 was saved and read back, and a new client's first $45 visit ended on
  // 45 points — not 95. The front desk's manual enrol granted it; this path, which is how almost
  // every client actually joins, created the member row and moved on. Joining is joining however
  // it happens, so both paths now pay the same thing.
  //
  // The birthday bonus was never granted anywhere in this template. crm-dispensary grants both on
  // its completion path already, so the rule is its rule, and the month test now lives in the
  // shared engine rather than being copied a second time.
  let bonusPoints = 0

  if (justEnrolled && cfg.welcomePoints > 0) {
    try {
      await db.insert(loyaltyTransaction).values({
        companyId: v.companyId, memberId: member.id, type: 'bonus',
        points: cfg.welcomePoints, balanceAfter: member.pointsBalance + points + cfg.welcomePoints,
        // No appointmentId: the welcome is for joining, not for the visit, and leaving it null keeps
        // it out of the way of the birthday row, which shares (member, 'bonus') on the same visit.
        description: 'Welcome bonus', invoiceId: v.invoiceId || null,
      } as any)
      bonusPoints += cfg.welcomePoints
    } catch { /* never fatal: the visit and its bill stand regardless */ }
  }

  if (cfg.birthdayBonus > 0) {
    try {
      // A salon keeps the birthday on the client's PROFILE, next to the allergies and the patch-test
      // date, not on the contact row — it is part of the record the chair keeps, and it is stored as
      // a plain 'YYYY-MM-DD' calendar date.
      const [prof] = await db.select({ birthday: clientProfile.birthday }).from(clientProfile)
        .where(and(eq(clientProfile.contactId, v.contactId), eq(clientProfile.companyId, v.companyId))).limit(1)
      if (inBirthdayMonth(prof?.birthday)) {
        // Once per calendar year, on the first completed visit of their birthday month. A client who
        // comes in three times that month gets one bonus, and it is available again next year.
        const already = await db.select({ id: loyaltyTransaction.id }).from(loyaltyTransaction)
          .where(and(
            eq(loyaltyTransaction.memberId, member.id),
            eq(loyaltyTransaction.type, 'bonus'),
            sql`${loyaltyTransaction.description} LIKE 'Birthday bonus%'`,
            sql`${loyaltyTransaction.createdAt} >= date_trunc('year', NOW())`,
          )).limit(1)
        if (!already.length) {
          await db.insert(loyaltyTransaction).values({
            companyId: v.companyId, memberId: member.id, type: 'bonus',
            points: cfg.birthdayBonus,
            balanceAfter: member.pointsBalance + points + bonusPoints + cfg.birthdayBonus,
            description: `Birthday bonus ${new Date().getFullYear()}`,
            // Keyed to the visit, so a completion replayed after the year check has been satisfied
            // hits the unique index instead of granting a second one.
            appointmentId: v.appointmentId, invoiceId: v.invoiceId || null,
          } as any)
          bonusPoints += cfg.birthdayBonus
        }
      }
    } catch { /* never fatal */ }
  }

  // One balance write for everything this visit granted — the earn and both bonuses — so a client
  // can never be left with ledger rows the balance does not account for.
  const credited = points + bonusPoints
  await db.update(loyaltyMember).set({
    pointsBalance: sql`${loyaltyMember.pointsBalance} + ${credited}`,
    lifetimePoints: sql`${loyaltyMember.lifetimePoints} + ${credited}`,
    qualifyingVisits: counts ? sql`${loyaltyMember.qualifyingVisits} + 1` : loyaltyMember.qualifyingVisits,
    lastActivityAt: new Date(),
    updatedAt: new Date(),
  } as any).where(eq(loyaltyMember.id, member.id))

  return { awarded: true, points, countedAsVisit: counts, bonusPoints }
}

/**
 * Take back what a visit earned, because the visit did not happen after all.
 *
 * Run LY0928 M1: a completed appointment flipped to cancelled kept its points and its punch, so
 * completing and cancelling repeatedly could fill a card for free. Reopening a visit is allowed by
 * design — so this has to leave the member in a state where completing it AGAIN earns again, which is
 * why the earn row is removed rather than left standing: the unique index on (member, type,
 * appointment) is what makes a re-completion pay out once and only once.
 *
 * Never throws, for the same reason awarding does not: cancelling an appointment must succeed.
 */
export async function reverseForCancelledVisit(v: {
  companyId: string
  appointmentId: string
  serviceId?: string | null
}): Promise<{ reversed: boolean; points: number }> {
  const NOTHING = { reversed: false, points: 0 }
  if (!v.appointmentId) return NOTHING

  const [earn] = await db.select().from(loyaltyTransaction)
    .where(and(
      eq(loyaltyTransaction.companyId, v.companyId),
      eq(loyaltyTransaction.appointmentId, v.appointmentId),
      eq(loyaltyTransaction.type, 'earn'),
    )).limit(1)
  if (!earn) return NOTHING

  const [member] = await db.select().from(loyaltyMember).where(eq(loyaltyMember.id, earn.memberId)).limit(1)
  if (!member) return NOTHING

  const [co] = await db.select({ settings: company.settings }).from(company).where(eq(company.id, v.companyId)).limit(1)
  const cfg = loyaltyConfig(co?.settings)
  // Whether this visit filled a punch is decided the same way it was decided when it was awarded.
  const counted = cfg.punchCard.visitsRequired > 0 && visitQualifies(v.serviceId, cfg)
  const earned = Number(earn.points) || 0

  // The birthday bonus rides on the visit, so it comes back with it. Without this, completing and
  // cancelling in your birthday month would leave the bonus standing on a visit that never happened
  // — the same shape as the LY0928 M1 defect this function exists to prevent. Removing the row also
  // restores the year, so a genuine later visit that month still gets the bonus. The WELCOME bonus
  // is deliberately left alone: they joined, and cancelling one appointment does not unjoin them.
  // (LYR L4)
  const [birthday] = await db.select().from(loyaltyTransaction)
    .where(and(
      eq(loyaltyTransaction.memberId, member.id),
      eq(loyaltyTransaction.type, 'bonus'),
      eq(loyaltyTransaction.appointmentId, v.appointmentId),
    )).limit(1)
  const bonus = birthday ? Number(birthday.points) || 0 : 0
  const points = earned + bonus

  // The earn row goes first: it is the idempotency key, and while it stands a re-completion is a
  // no-op. Removing it is what makes the visit earnable again.
  await db.delete(loyaltyTransaction).where(eq(loyaltyTransaction.id, earn.id))
  if (birthday) await db.delete(loyaltyTransaction).where(eq(loyaltyTransaction.id, birthday.id))

  await db.update(loyaltyMember).set({
    pointsBalance: sql`GREATEST(0, ${loyaltyMember.pointsBalance} - ${points})`,
    lifetimePoints: sql`GREATEST(0, ${loyaltyMember.lifetimePoints} - ${points})`,
    qualifyingVisits: counted ? sql`GREATEST(0, ${loyaltyMember.qualifyingVisits} - 1)` : loyaltyMember.qualifyingVisits,
    updatedAt: new Date(),
  } as any).where(eq(loyaltyMember.id, member.id))

  // One reversal row per visit, topped up rather than duplicated — a visit completed and cancelled
  // twice would otherwise collide with the same unique index.
  const [fresh] = await db.select({ b: loyaltyMember.pointsBalance }).from(loyaltyMember).where(eq(loyaltyMember.id, member.id)).limit(1)
  const [prior] = await db.select().from(loyaltyTransaction)
    .where(and(
      eq(loyaltyTransaction.memberId, member.id),
      eq(loyaltyTransaction.type, 'reversal'),
      eq(loyaltyTransaction.appointmentId, v.appointmentId),
    )).limit(1)
  if (prior) {
    await db.update(loyaltyTransaction)
      .set({ points: Number(prior.points) - points, balanceAfter: fresh?.b ?? 0 } as any)
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
export async function priceForVisit(companyId: string, serviceId: string | null | undefined, quoted: any): Promise<number> {
  const price = Number(quoted)
  if (price > 0) return price
  if (!serviceId) return 0
  const [svc] = await db.select({ price: serviceMenu.price }).from(serviceMenu)
    .where(and(eq(serviceMenu.id, serviceId), eq(serviceMenu.companyId, companyId))).limit(1)
  return Number(svc?.price) || 0
}
