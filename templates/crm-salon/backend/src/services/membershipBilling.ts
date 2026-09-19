// Membership billing — the salon's only recurring revenue line.
//
// Salon T20 H4: enrolling a client in the $99/month "Blowout Club" returned 201 and set credits
// correctly, but renewsAt came back null and no invoice was ever raised. There was no billing path at
// all — /bill, /charge and /billing/run were all 404, and the only enrolment action that shipped was
// /redeem. A pre-existing enrolment from nine days earlier still had a null renewsAt, so nothing was
// filling it in later either. The feature tracked entitlement perfectly and simply never charged for it.
//
// How it works, following the shape wellness plans use in crm-vet (the tester spotted they are the same
// gap): enrolling bills the first period immediately and sets renewsAt to the end of it. After that
// settleMembershipBilling() bills every active enrolment whose renewsAt has arrived and rolls it
// forward, catching up period by period if nobody looked for a few months. It runs from the enrolment
// reads and from POST /memberships/billing/run, because a tenant backend has no scheduler of its own.
//
// Billing twice is the thing to be afraid of, so every charge is CLAIMED first: the UPDATE that sets
// last_billed_for names the period it is claiming and only matches a row not yet billed for it. Two
// concurrent runs, or a retry after a half-finished one, can only produce one invoice per period.
import { and, eq, isNotNull, lte, or, sql } from 'drizzle-orm'
import { db } from '../../db/index.ts'
import { membershipPlan, membershipEnrollment, contact, invoice, invoiceLineItem, company } from '../../db/schema.ts'
import { dueDateFromTerms } from '../shared/index.ts'
import { nextInvoiceNumber } from './salonCheckout.ts'
import { emitToCompany, EVENTS } from './socket.ts'

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
const iso = (d: Date) => d.toISOString().slice(0, 10)
const today = () => iso(new Date())

const cycleOf = (plan: any) => String(plan?.billingCycle || 'monthly').toLowerCase()
/** A one-off membership is charged once and never renews. */
export const isOneTime = (cycle: string) => cycle === 'one_time' || cycle === 'once'

/** The next renewal date after `from`. Returns null for a plan that does not renew. */
export function nextRenewal(from: string, cycle: string): string | null {
  if (isOneTime(cycle)) return null
  const d = new Date(`${from}T00:00:00.000Z`)
  if (cycle === 'annual' || cycle === 'yearly') d.setUTCFullYear(d.getUTCFullYear() + 1)
  else d.setUTCMonth(d.getUTCMonth() + 1)
  return iso(d)
}

export type BilledOne = { enrollmentId: string; invoiceId: string; number: string; period: string; amount: number }

/**
 * Bill one enrolment for one period, in its own transaction. Returns null when there is nothing to
 * bill — the period was already claimed, or the plan is free.
 */
async function billPeriod(row: any, period: string): Promise<BilledOne | null> {
  return db.transaction(async (tx: any) => {
    // Claim the period first: only one caller can move last_billed_for to it.
    const claimed = await tx.update(membershipEnrollment)
      .set({ lastBilledFor: period, updatedAt: new Date() })
      .where(and(
        eq(membershipEnrollment.id, row.id),
        eq(membershipEnrollment.companyId, row.companyId),
        or(sql`${membershipEnrollment.lastBilledFor} IS NULL`, sql`${membershipEnrollment.lastBilledFor} < ${period}`),
      ))
      .returning({ id: membershipEnrollment.id })
    if (!claimed.length) return null

    const [plan] = await tx.select().from(membershipPlan).where(eq(membershipPlan.id, row.planId)).limit(1)
    const cycle = cycleOf(plan)
    const price = round2(Number(plan?.price) || 0)
    const renewsAt = nextRenewal(period, cycle)

    // A new period is a new allowance: a monthly membership that never refilled its credits is spent
    // after the first month and worthless after that.
    const credits = plan?.creditsTotal ?? null

    if (!(price > 0)) {
      // Free plan: no invoice, but the enrolment must still roll forward or it would be billed forever.
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
      number: await nextInvoiceNumber(row.companyId, tx),
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
      invoiceId: created.id,
      description: `${planName} (${period}, per ${unit})`,
      quantity: '1',
      unitPrice: price.toString(),
      total: price.toString(),
      sortOrder: 0,
    } as any)

    await tx.update(membershipEnrollment)
      .set({ lastInvoiceId: created.id, renewsAt, ...(credits != null ? { creditsRemaining: credits } : {}), updatedAt: new Date() })
      .where(eq(membershipEnrollment.id, row.id))

    return { enrollmentId: row.id, invoiceId: created.id, number: created.number, period, amount: price }
  })
}

/**
 * Give a renewal date to active enrolments that never got one.
 *
 * Every membership sold before this feature existed sits at renewsAt null, and the settle pass below
 * only looks at enrolments that HAVE a renewal date — so without this they would stay invisible
 * forever, which is exactly what the report found: an enrolment from nine days earlier still null,
 * with nothing filling it in later. (Salon T20 H4)
 *
 * They are adopted from TODAY, not back-billed. The periods that were never charged are not
 * retroactively invoiced: raising a pile of surprise invoices against real clients for months the
 * system never asked them to pay is not a decision this should make on its own. Anyone who wants that
 * history billed can set the renewal date back by hand. From here they bill normally.
 */
async function adoptUnscheduled(companyId?: string): Promise<number> {
  const orphans = await db.select().from(membershipEnrollment).where(and(
    eq(membershipEnrollment.status, 'active'),
    sql`${membershipEnrollment.renewsAt} IS NULL`,
    ...(companyId ? [eq(membershipEnrollment.companyId, companyId)] : []),
  ))
  for (const row of orphans) {
    const [plan] = await db.select().from(membershipPlan).where(eq(membershipPlan.id, row.planId)).limit(1)
    const cycle = cycleOf(plan)
    // A one-off package has nothing to renew; leave it alone rather than inventing a schedule.
    if (isOneTime(cycle)) continue
    const from = today()
    await db.update(membershipEnrollment)
      // last_billed_for is set to today as well: the current period is treated as settled, so the
      // adoption itself never raises a charge.
      .set({ renewsAt: nextRenewal(from, cycle), lastBilledFor: from, updatedAt: new Date() } as any)
      .where(and(eq(membershipEnrollment.id, row.id), sql`${membershipEnrollment.renewsAt} IS NULL`))
  }
  return orphans.length
}

/**
 * Bill every active enrolment that has come due. Catches up one period at a time — a membership nobody
 * looked at for three months raises three invoices, one per period — up to a ceiling per run.
 */
export async function settleMembershipBilling(companyId?: string, maxPeriodsPerEnrollment = 12): Promise<BilledOne[]> {
  await adoptUnscheduled(companyId)
  const billed: BilledOne[] = []
  const due = await db.select().from(membershipEnrollment).where(and(
    eq(membershipEnrollment.status, 'active'),
    isNotNull(membershipEnrollment.renewsAt),
    lte(membershipEnrollment.renewsAt, today()),
    ...(companyId ? [eq(membershipEnrollment.companyId, companyId)] : []),
  ))
  for (const row of due) {
    let cursor: any = { ...row }
    for (let i = 0; i < maxPeriodsPerEnrollment; i++) {
      const period = cursor.renewsAt
      if (!period || period > today()) break
      const one = await billPeriod(cursor, period)
      if (one) billed.push(one)
      const [fresh] = await db.select().from(membershipEnrollment).where(eq(membershipEnrollment.id, row.id)).limit(1)
      if (!fresh || fresh.renewsAt === cursor.renewsAt) break // nothing moved — don't spin
      cursor = fresh
    }
  }
  if (billed.length && companyId) emitToCompany(companyId, EVENTS.REFRESH, { entity: 'membership_enrollment' })
  return billed
}

/** Enrolling bills the first period straight away, so a membership sold today is invoiced today. */
export async function billFirstPeriod(enrollment: any): Promise<BilledOne | null> {
  const start = enrollment.startDate || today()
  const one = await billPeriod(enrollment, start)
  if (!one) {
    // Nothing billable (a free plan) — still schedule the renewal so the enrolment is not stuck with a
    // null renewsAt, which is the state the report found nine days after enrolling.
    const [plan] = await db.select().from(membershipPlan).where(eq(membershipPlan.id, enrollment.planId)).limit(1)
    await db.update(membershipEnrollment)
      .set({ renewsAt: nextRenewal(start, cycleOf(plan)), updatedAt: new Date() })
      .where(and(eq(membershipEnrollment.id, enrollment.id), sql`${membershipEnrollment.renewsAt} IS NULL`))
  }
  return one
}
