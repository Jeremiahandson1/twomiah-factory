// Wellness plan billing — the practice's recurring revenue line. Moved from
// templates/crm-vet/backend/src/services/wellnessBilling.ts.
//
// An enrolment used to store a billing cycle and do nothing else: no invoice was raised and no renewal scheduled, so a
// plan sold as "billed monthly" collected nothing. (Vet T12 H3)
//
// Enrolling bills the first period at once and sets renewsAt to the end of it. After that, settle() bills every
// active enrolment whose renewsAt has arrived and rolls renewsAt forward, catching up period by period. It runs at the
// top of the enrolment reads and from POST /wellness-plans/billing-run (settle-on-read: the template had no scheduler).
//
// Billing twice is the thing to be afraid of, so every charge is claimed first: the UPDATE that sets last_billed_for
// names the period and only matches a row not yet billed for it. Two concurrent runs, or a retry after a half-finished
// one, can only produce one invoice per period.
import { and, eq, isNotNull, isNull, lt, lte, or } from 'drizzle-orm'
import { insertInvoice, dueDateFromTerms, defaultTaxRateFrom, businessToday, companyTimeZone } from '@twomiah/tenant-backend'
import { wellnessPlan, wellnessEnrollment, patient, invoice, invoiceLineItem, company } from '../../db/schema/index.ts'

const INVOICE_NUMBERING = { prefix: 'INV', pad: 5, seed: 0 }
const iso = (d: Date) => d.toISOString().slice(0, 10)
const today = () => iso(new Date())
const isAnnual = (cycle: string) => ['annual', 'yearly'].includes(String(cycle).toLowerCase())

/** The next renewal date after `from`: monthly plans roll a month, annual plans a year. */
export function nextRenewal(from: string, cycle: string): string {
  const d = new Date(`${from}T00:00:00.000Z`)
  if (isAnnual(cycle)) d.setUTCFullYear(d.getUTCFullYear() + 1)
  else d.setUTCMonth(d.getUTCMonth() + 1)
  return iso(d)
}

/** What one period of this plan costs, and what the invoice line says. */
export function periodCharge(plan: any, cycle: string) {
  const annual = isAnnual(cycle)
  const price = Number(annual ? plan?.annualPrice : plan?.monthlyPrice) || 0
  return { price, unit: annual ? 'year' : 'month' }
}

export type BilledOne = { enrollmentId: string; invoiceId: string; number: string; period: string; amount: number }

export function createWellnessBillingService(db: any) {
  /**
   * Bill one enrolment for one period, in its own transaction. Null when there is nothing to bill — the period was
   * already claimed, the plan has no price for the cycle, or the pet has no owner.
   */
  async function billPeriod(row: any, period: string): Promise<BilledOne | null> {
    return db.transaction(async (tx: any) => {
      // Claim the period first: only one caller can move last_billed_for to it.
      const claimed = await tx.update(wellnessEnrollment)
        .set({ lastBilledFor: period, updatedAt: new Date() })
        .where(and(
          eq(wellnessEnrollment.id, row.id),
          eq(wellnessEnrollment.companyId, row.companyId),
          or(isNull(wellnessEnrollment.lastBilledFor), lt(wellnessEnrollment.lastBilledFor, period)),
        ))
        .returning({ id: wellnessEnrollment.id })
      if (!claimed.length) return null

      const [plan] = await tx.select().from(wellnessPlan).where(eq(wellnessPlan.id, row.planId)).limit(1)
      const { price, unit } = periodCharge(plan, row.billingCycle)
      const [pet] = await tx.select({ name: patient.name, ownerId: patient.ownerId }).from(patient).where(eq(patient.id, row.patientId)).limit(1)
      const contactId = row.ownerId || pet?.ownerId
      // Nothing to charge, or nobody to charge: leave the period claimed so the run doesn't spin on it.
      if (!(price > 0) || !contactId) return null

      const [co] = await tx.select({ settings: company.settings }).from(company).where(eq(company.id, row.companyId)).limit(1)
      const settings = (co?.settings as any) || {}
      // Today on the PRACTICE's calendar, read through `tx` (an outer db read here deadlocks PGlite). (T59)
      const issued = businessToday(await companyTimeZone(tx, row.companyId))
      const created = await insertInvoice(tx, { invoice, invoiceLineItem } as any, INVOICE_NUMBERING, {
        companyId: row.companyId, contactId,
        notes: `Wellness plan — ${plan?.name || 'plan'}${pet?.name ? ` for ${pet.name}` : ''}`,
        dueDate: dueDateFromTerms(settings, issued), issueDate: issued, taxRate: defaultTaxRateFrom(settings),
      } as any, [{ description: `${plan?.name || 'Wellness plan'}${pet?.name ? ` — ${pet.name}` : ''} (${period}, per ${unit})`, quantity: 1, unitPrice: price }] as any)

      await tx.update(wellnessEnrollment)
        .set({ lastInvoiceId: created.id, renewsAt: nextRenewal(period, row.billingCycle), updatedAt: new Date() })
        .where(eq(wellnessEnrollment.id, row.id))
      return { enrollmentId: row.id, invoiceId: created.id, number: created.number, period, amount: price }
    })
  }

  /**
   * Bill every active enrolment that has come due, one period at a time (a plan nobody looked at for three months
   * raises three invoices, each for its own period), up to a ceiling per run.
   */
  async function settle(companyId?: string, maxPeriodsPerEnrollment = 12): Promise<BilledOne[]> {
    const billed: BilledOne[] = []
    const due = await db.select().from(wellnessEnrollment).where(and(
      eq(wellnessEnrollment.status, 'active'),
      isNotNull(wellnessEnrollment.renewsAt),
      lte(wellnessEnrollment.renewsAt, today()),
      ...(companyId ? [eq(wellnessEnrollment.companyId, companyId)] : []),
    ))
    for (const row of due) {
      let cursor = { ...row }
      for (let i = 0; i < maxPeriodsPerEnrollment; i++) {
        const period = cursor.renewsAt
        if (!period || period > today()) break
        const one = await billPeriod(cursor, period)
        if (one) billed.push(one)
        const [fresh] = await db.select().from(wellnessEnrollment).where(eq(wellnessEnrollment.id, row.id)).limit(1)
        if (!fresh || fresh.renewsAt === cursor.renewsAt) break // nothing moved — don't spin
        cursor = fresh
      }
    }
    return billed
  }

  /** Enrolling bills the first period straight away, so a plan sold today is invoiced today. */
  async function billFirstPeriod(enrollment: any): Promise<BilledOne | null> {
    const start = enrollment.startDate || today()
    const one = await billPeriod(enrollment, start)
    if (!one) {
      // Nothing billable (a free plan, or no owner): still schedule the renewal so the enrolment is not stuck.
      await db.update(wellnessEnrollment)
        .set({ renewsAt: nextRenewal(start, enrollment.billingCycle), updatedAt: new Date() })
        .where(and(eq(wellnessEnrollment.id, enrollment.id), isNull(wellnessEnrollment.renewsAt)))
    }
    return one
  }

  return { settle, billFirstPeriod }
}
