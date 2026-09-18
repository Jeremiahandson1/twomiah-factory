// Wellness plan billing — the practice's only recurring revenue line.
//
// An enrolment used to store a billing cycle and do nothing else: no invoice was ever raised and no renewal was
// scheduled, so a plan sold as "billed monthly" collected nothing. (Vet T12 H3)
//
// How it works. Enrolling bills the first period immediately and sets renewsAt to the end of it. After that,
// settleWellnessBilling() bills every active enrolment whose renewsAt has arrived and rolls renewsAt forward —
// catching up period by period if nobody looked for a few months. It is called at the top of the enrolment reads
// and by POST /wellness-plans/billing-run, the same settle-on-read pattern service agreements use, because a
// tenant backend has no scheduler of its own.
//
// Billing twice is the thing to be afraid of, so every charge is claimed first: the UPDATE that sets
// last_billed_for names the period it is claiming and only matches a row that has not been billed for it yet.
// Two concurrent runs, or a retry after a half-finished one, can only produce one invoice per period.
import { and, eq, isNotNull, lte, ne, or, sql } from 'drizzle-orm'
import { db } from '../../db/index.ts'
import { wellnessPlan, wellnessEnrollment, patient, contact, invoice, invoiceLineItem, company } from '../../db/schema.ts'
import { insertInvoice, dueDateFromTerms, defaultTaxRateFrom } from '../shared/index.ts'

const INVOICE_NUMBERING = { prefix: 'INV', pad: 5, seed: 0 }
const iso = (d: Date) => d.toISOString().slice(0, 10)
const today = () => iso(new Date())

/** The next renewal date after `from` for a cycle — monthly plans roll a month, annual plans roll a year. */
export function nextRenewal(from: string, cycle: string): string {
  const d = new Date(`${from}T00:00:00.000Z`)
  if (String(cycle).toLowerCase() === 'annual' || String(cycle).toLowerCase() === 'yearly') d.setUTCFullYear(d.getUTCFullYear() + 1)
  else d.setUTCMonth(d.getUTCMonth() + 1)
  return iso(d)
}

/** What one period of this plan costs, and what the invoice line says. */
export function periodCharge(plan: any, cycle: string) {
  const annual = String(cycle).toLowerCase() === 'annual' || String(cycle).toLowerCase() === 'yearly'
  const price = Number(annual ? plan?.annualPrice : plan?.monthlyPrice) || 0
  return { price, unit: annual ? 'year' : 'month' }
}

type BilledOne = { enrollmentId: string; invoiceId: string; number: string; period: string; amount: number }

/**
 * Bill one enrolment for one period, inside its own transaction. Returns null when there is nothing to bill —
 * the period was already claimed, the plan has no price for that cycle, or the pet has no owner to bill.
 */
async function billPeriod(row: any, period: string): Promise<BilledOne | null> {
  return db.transaction(async (tx: any) => {
    // Claim the period first: only one caller can move last_billed_for to it.
    const claimed = await tx.update(wellnessEnrollment)
      .set({ lastBilledFor: period, updatedAt: new Date() })
      .where(and(
        eq(wellnessEnrollment.id, row.id),
        eq(wellnessEnrollment.companyId, row.companyId),
        or(sql`${wellnessEnrollment.lastBilledFor} IS NULL`, sql`${wellnessEnrollment.lastBilledFor} < ${period}`),
      ))
      .returning({ id: wellnessEnrollment.id })
    if (!claimed.length) return null

    const [plan] = await tx.select().from(wellnessPlan).where(eq(wellnessPlan.id, row.planId)).limit(1)
    const { price, unit } = periodCharge(plan, row.billingCycle)
    const [pet] = await tx.select({ name: patient.name, ownerId: patient.ownerId }).from(patient).where(eq(patient.id, row.patientId)).limit(1)
    const contactId = row.ownerId || pet?.ownerId
    // Nothing to charge, or nobody to charge: leave the period claimed so the run doesn't spin on it, and move on.
    if (!(price > 0) || !contactId) return null

    const [co] = await tx.select({ settings: company.settings }).from(company).where(eq(company.id, row.companyId)).limit(1)
    const settings = (co?.settings as any) || {}
    const created = await insertInvoice(tx, { invoice, invoiceLineItem } as any, INVOICE_NUMBERING, {
      companyId: row.companyId, contactId,
      notes: `Wellness plan — ${plan?.name || 'plan'}${pet?.name ? ` for ${pet.name}` : ''}`,
      dueDate: dueDateFromTerms(settings), issueDate: new Date(), taxRate: defaultTaxRateFrom(settings),
    }, [{ description: `${plan?.name || 'Wellness plan'}${pet?.name ? ` — ${pet.name}` : ''} (${period}, per ${unit})`, quantity: 1, unitPrice: price }])

    await tx.update(wellnessEnrollment)
      .set({ lastInvoiceId: created.id, renewsAt: nextRenewal(period, row.billingCycle), updatedAt: new Date() })
      .where(eq(wellnessEnrollment.id, row.id))
    return { enrollmentId: row.id, invoiceId: created.id, number: created.number, period, amount: price }
  })
}

/**
 * Bill every active enrolment that has come due. Catches up one period at a time (a plan nobody looked at for
 * three months raises three invoices, each for its own period) up to a sane ceiling per run.
 */
export async function settleWellnessBilling(companyId?: string, maxPeriodsPerEnrollment = 12): Promise<BilledOne[]> {
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
export async function billFirstPeriod(enrollment: any): Promise<BilledOne | null> {
  const start = enrollment.startDate || today()
  const one = await billPeriod(enrollment, start)
  if (!one) {
    // Nothing billable (free plan, or no owner) — still schedule the renewal so the enrolment is not stuck.
    await db.update(wellnessEnrollment)
      .set({ renewsAt: nextRenewal(start, enrollment.billingCycle), updatedAt: new Date() })
      .where(and(eq(wellnessEnrollment.id, enrollment.id), sql`${wellnessEnrollment.renewsAt} IS NULL`))
  }
  return one
}
