// Membership billing — the salon's recurring revenue line. Moved from templates/crm-salon/backend/src/services/membershipBilling.ts.
//
// Enrolling bills the first period immediately and sets renewsAt to the end of it (Salon T20 H4: renewsAt was null and
// no invoice was ever raised). After that settleMembershipBilling() bills every active enrolment whose renewsAt has
// arrived and rolls it forward, catching up period by period. It runs from the enrolment reads and from
// POST /api/memberships/billing/run. Every charge is CLAIMED first: the UPDATE that sets last_billed_for names the
// period and only matches a row not yet billed for it, so two runs can only produce one invoice per period.
import { and, eq, isNotNull, isNull, lt, lte, or } from 'drizzle-orm'
import { dueDateFromTerms, addMonthsClamped } from '@twomiah/tenant-backend'
import { membershipPlan, membershipEnrollment, contact, invoice, invoiceLineItem, company } from '../../db/schema/index.ts'
import type { CrmDeps } from '../deps.ts'
import type { SalonClock } from './days.ts'
import type { SalonCheckout } from './checkout.ts'

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
const iso = (d: Date) => d.toISOString().slice(0, 10)
/** The UTC day — only ever the WIDE end of a "has this period arrived?" filter, never a written date. (Salon T25 N2) */
const utcToday = () => iso(new Date())

type PlanRow = typeof membershipPlan.$inferSelect
type EnrollmentRow = typeof membershipEnrollment.$inferSelect

const cycleOf = (plan: PlanRow | undefined | null) => String(plan?.billingCycle || 'monthly').toLowerCase()
/** A one-off membership is charged once and never renews. */
export const isOneTime = (cycle: string) => cycle === 'one_time' || cycle === 'once'

/**
 * The next renewal date after `from`, on the membership's own day of the month (`anchor`, its start date) or that
 * month's last day: joined on the 31st, it renews Nov 30, then Dec 31. Null for a plan that does not renew. Rolling the
 * Date's month instead turned Oct 31 into Dec 1, skipping November (CI on a Kiritimati shop's Oct 31, 10/30).
 */
export function nextRenewal(from: string, cycle: string, anchor: string = from): string | null {
  if (isOneTime(cycle)) return null
  return addMonthsClamped(from.slice(0, 8) + anchor.slice(8, 10), cycle === 'annual' || cycle === 'yearly' ? 12 : 1)
}

export type BilledOne = { enrollmentId: string; invoiceId: string; number: string; period: string; amount: number }

export function createMembershipBilling(d: CrmDeps, clock: SalonClock, checkout: SalonCheckout) {
  const { db } = d
  /** Every date this writes is a calendar day on the shop's wall. (Salon T25 N2) */
  const today = (companyId: string) => clock.salonToday(companyId)

  /** Bill one enrolment for one period, in its own transaction. Null when the period was claimed or the plan is free. */
  async function billPeriod(row: EnrollmentRow, period: string): Promise<BilledOne | null> {
    return db.transaction(async (tx: any) => {
      const claimed = await tx.update(membershipEnrollment)
        .set({ lastBilledFor: period, updatedAt: new Date() })
        .where(and(
          eq(membershipEnrollment.id, row.id),
          eq(membershipEnrollment.companyId, row.companyId),
          or(isNull(membershipEnrollment.lastBilledFor), lt(membershipEnrollment.lastBilledFor, period)),
        ))
        .returning({ id: membershipEnrollment.id })
      if (!claimed.length) return null

      const [plan] = await tx.select().from(membershipPlan).where(eq(membershipPlan.id, row.planId)).limit(1)
      const cycle = cycleOf(plan)
      const price = round2(Number(plan?.price) || 0)
      const renewsAt = nextRenewal(period, cycle, row.startDate || period)
      // A new period is a new allowance.
      const credits = plan?.creditsTotal ?? null

      if (!(price > 0)) {
        // Free plan: no invoice, but the enrolment still rolls forward.
        await tx.update(membershipEnrollment)
          .set({ renewsAt, ...(credits != null ? { creditsRemaining: credits } : {}), updatedAt: new Date() })
          .where(eq(membershipEnrollment.id, row.id))
        return null
      }

      const [co] = await tx.select({ settings: company.settings }).from(company).where(eq(company.id, row.companyId)).limit(1)
      const settings = (co?.settings as any) || {}
      const rate = Number(settings?.defaultTaxRate)
      const taxRate = Number.isFinite(rate) && rate >= 0 && rate <= 100 ? rate : 0
      const taxAmount = round2(price * (taxRate / 100))
      const total = round2(price + taxAmount)

      const [ct] = await tx.select({ name: contact.name }).from(contact).where(eq(contact.id, row.contactId)).limit(1)
      const planName = plan?.name || 'Membership'
      const unit = isOneTime(cycle) ? 'one-off' : cycle === 'annual' || cycle === 'yearly' ? 'year' : 'month'

      const [created] = await tx.insert(invoice).values({
        companyId: row.companyId,
        contactId: row.contactId,
        number: await checkout.nextInvoiceNumber(row.companyId, tx),
        status: 'open',
        subtotal: price.toString(),
        taxRate: String(taxRate),
        taxAmount: taxAmount.toString(),
        discount: '0',
        total: total.toString(),
        amountPaid: '0',
        dueDate: dueDateFromTerms(settings),
        sentAt: null,
        notes: `Membership — ${planName}${ct?.name ? ` for ${ct.name}` : ''}`,
      } as any).returning()

      await tx.insert(invoiceLineItem).values({
        invoiceId: created.id, description: `${planName} (${period}, per ${unit})`, quantity: '1',
        unitPrice: price.toString(), total: price.toString(), sortOrder: 0,
      } as any)

      await tx.update(membershipEnrollment)
        .set({ lastInvoiceId: created.id, renewsAt, ...(credits != null ? { creditsRemaining: credits } : {}), updatedAt: new Date() })
        .where(eq(membershipEnrollment.id, row.id))

      return { enrollmentId: row.id, invoiceId: created.id, number: created.number, period, amount: price }
    })
  }

  /**
   * Give a renewal date to active enrolments that never got one, from TODAY — the periods never charged are not
   * back-billed (a pile of surprise invoices is not a decision this should make on its own). (Salon T20 H4)
   */
  async function adoptUnscheduled(companyId?: string): Promise<number> {
    const orphans: EnrollmentRow[] = await db.select().from(membershipEnrollment).where(and(
      eq(membershipEnrollment.status, 'active'),
      isNull(membershipEnrollment.renewsAt),
      ...(companyId ? [eq(membershipEnrollment.companyId, companyId)] : []),
    ))
    for (const row of orphans) {
      const [plan] = await db.select().from(membershipPlan).where(eq(membershipPlan.id, row.planId)).limit(1)
      const cycle = cycleOf(plan)
      if (isOneTime(cycle)) continue
      const from = await today(row.companyId)
      await db.update(membershipEnrollment)
        // last_billed_for is today as well: the current period is treated as settled, so adopting raises no charge.
        .set({ renewsAt: nextRenewal(from, cycle, row.startDate || from), lastBilledFor: from, updatedAt: new Date() } as any)
        .where(and(eq(membershipEnrollment.id, row.id), isNull(membershipEnrollment.renewsAt)))
    }
    return orphans.length
  }

  /** Bill every active enrolment that has come due, one period at a time, up to a ceiling per run. */
  async function settleMembershipBilling(companyId?: string, maxPeriodsPerEnrollment = 12): Promise<BilledOne[]> {
    await adoptUnscheduled(companyId)
    const billed: BilledOne[] = []
    const due: EnrollmentRow[] = await db.select().from(membershipEnrollment).where(and(
      eq(membershipEnrollment.status, 'active'),
      isNotNull(membershipEnrollment.renewsAt),
      // The UTC day is the WIDE end; the per-enrolment guard below decides on the shop's calendar. (Salon T25 N2)
      lte(membershipEnrollment.renewsAt, utcToday()),
      ...(companyId ? [eq(membershipEnrollment.companyId, companyId)] : []),
    ))
    for (const row of due) {
      let cursor: EnrollmentRow = { ...row }
      for (let i = 0; i < maxPeriodsPerEnrollment; i++) {
        const period = cursor.renewsAt
        if (!period || period > (await today(row.companyId))) break
        const one = await billPeriod(cursor, period)
        if (one) billed.push(one)
        const [fresh] = await db.select().from(membershipEnrollment).where(eq(membershipEnrollment.id, row.id)).limit(1)
        if (!fresh || fresh.renewsAt === cursor.renewsAt) break // nothing moved — don't spin
        cursor = fresh
      }
    }
    if (billed.length && companyId) d.realtime.emitToCompany(companyId, d.realtime.EVENTS.REFRESH, { entity: 'membership_enrollment' })
    return billed
  }

  /** Enrolling bills the first period straight away, so a membership sold today is invoiced today. */
  async function billFirstPeriod(enrollment: EnrollmentRow): Promise<BilledOne | null> {
    const start = enrollment.startDate || (await today(enrollment.companyId))
    const one = await billPeriod(enrollment, start)
    if (!one) {
      // Nothing billable (a free plan) — still schedule the renewal so the enrolment is not stuck at null.
      const [plan] = await db.select().from(membershipPlan).where(eq(membershipPlan.id, enrollment.planId)).limit(1)
      await db.update(membershipEnrollment)
        .set({ renewsAt: nextRenewal(start, cycleOf(plan)), updatedAt: new Date() })
        .where(and(eq(membershipEnrollment.id, enrollment.id), isNull(membershipEnrollment.renewsAt)))
    }
    return one
  }

  return { settleMembershipBilling, billFirstPeriod }
}

export type MembershipBilling = ReturnType<typeof createMembershipBilling>
