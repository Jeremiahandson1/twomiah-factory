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
import { loyaltyMember, loyaltyTransaction, company, serviceMenu } from '../../db/schema.ts'
import { eq, and, sql } from 'drizzle-orm'
import { loyaltyConfig, pointsForSale, visitQualifies } from '../shared/index.ts'

export interface VisitAward {
  companyId: string
  contactId: string
  appointmentId: string
  serviceId?: string | null
  /** What the client was charged, in dollars — this template's unit. */
  price: number
}

export interface VisitAwardResult {
  awarded: boolean
  points: number
  countedAsVisit: boolean
}

const NONE: VisitAwardResult = { awarded: false, points: 0, countedAsVisit: false }

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
  if (!member) {
    try {
      ;[member] = await db.insert(loyaltyMember).values({ companyId: v.companyId, contactId: v.contactId } as any).returning()
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
      description: 'Visit', appointmentId: v.appointmentId,
    } as any)
  } catch {
    // Already awarded for this appointment.
    return NONE
  }

  await db.update(loyaltyMember).set({
    pointsBalance: sql`${loyaltyMember.pointsBalance} + ${points}`,
    lifetimePoints: sql`${loyaltyMember.lifetimePoints} + ${points}`,
    qualifyingVisits: counts ? sql`${loyaltyMember.qualifyingVisits} + 1` : loyaltyMember.qualifyingVisits,
    lastActivityAt: new Date(),
    updatedAt: new Date(),
  } as any).where(eq(loyaltyMember.id, member.id))

  return { awarded: true, points, countedAsVisit: counts }
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
