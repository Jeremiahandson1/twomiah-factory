// The seller of the signed quote, paid as the invoices that come from it are paid (plan autoEarn 'quote_salesperson' — the contractor;
// contractor live test 11/07: "Paying INV-00002 in full earned nothing automatically"). The trades' engine (packages/tenant-backend
// commissions.ts createCommissionEarner) pays a person on a JOB; a builder bills a PROJECT — a deposit, then draws from the payment
// schedule — and the person who sold it is the quote's salesperson (or whoever wrote the quote). So:
//   · which quote: the invoice's own (invoice.quote_id, or the quote a deposit was raised from), else the project's signed quote
//     (the first approved on it);
//   · who: that quote's salesperson, else its writer — a login of this company, paid where the plan pays them (planPaysPerson);
//   · on what: the invoice before tax, after its discount (the shared engine's base), so a % plan earns a % of the contract over its
//     invoices, each as it is paid in full;
//   · once per invoice, plan and person (commission_auto_once); a full refund is taken back by the shared engine, which takes back every
//     automatic commission on the invoice.
import { and, asc, desc, eq, gte, inArray, isNotNull, notExists, sql } from 'drizzle-orm'
import { commissionFor, planPaysPerson, QUOTE_SELLER } from '@twomiah/tenant-backend'
import { commission, commissionPlan, invoice, quote, serviceAgreement, user } from '../../db/schema/index.ts'
import type { CrmDeps } from '../deps.ts'

const cents = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
const FEATURE = 'commission_tracking'

export function createQuoteSellerCommissions(d: CrmDeps) {
  const { db, logger } = d

  /** The quote an invoice was sold on: its own, the one its deposit came from, else its project's first signed quote. */
  async function quoteOf(inv: any) {
    const id = inv.quoteId || inv.billedQuoteId
    if (id) return (await db.select().from(quote).where(and(eq(quote.id, id), eq(quote.companyId, inv.companyId))).limit(1))[0] || null
    if (!inv.projectId) return null
    return (await db.select().from(quote).where(and(eq(quote.companyId, inv.companyId), eq(quote.projectId, inv.projectId), eq(quote.status, 'approved'), isNotNull(quote.approvedAt)))
      .orderBy(asc(quote.approvedAt), asc(quote.id)).limit(1))[0] || null
  }

  async function earnForInvoice(invoiceId: string): Promise<{ earned: number }> {
    const out = { earned: 0 }
    const [inv] = await db.select().from(invoice).where(eq(invoice.id, invoiceId)).limit(1)
    if (!inv || inv.status !== 'paid' || !inv.paidAt) return out
    if (!(await d.features.isFeatureEnabled(inv.companyId, FEATURE).catch(() => false))) return out
    const paidAt = new Date(inv.paidAt)
    const everyPlan = await db.select().from(commissionPlan).where(and(eq(commissionPlan.companyId, inv.companyId), eq(commissionPlan.isActive, true)))
    const plans = everyPlan.filter((p: any) => p.autoEarn === QUOTE_SELLER && p.planType !== 'percent_of_margin'
      && p.autoSince && new Date(p.autoSince) <= paidAt
      && (!p.effectiveFrom || new Date(p.effectiveFrom) <= paidAt)
      && (!p.effectiveTo || new Date(p.effectiveTo) >= paidAt))
    if (!plans.length) return out
    const q = await quoteOf(inv)
    // No quote: a maintenance plan's bill is sold by the plan's Sold by (field service live test 11/09: "the plan's Sold by field is not
    // used by Commissions").
    const sold = !q && inv.serviceAgreementId
      ? (await db.select({ soldById: serviceAgreement.soldById, number: serviceAgreement.number }).from(serviceAgreement)
        .where(and(eq(serviceAgreement.id, inv.serviceAgreementId), eq(serviceAgreement.companyId, inv.companyId))).limit(1))[0] || null
      : null
    const sellerId = q?.salespersonId || q?.createdById || sold?.soldById
    if (!sellerId) return out
    const [person] = await db.select({ id: user.id }).from(user).where(and(eq(user.id, sellerId), eq(user.companyId, inv.companyId))).limit(1)
    if (!person) return out
    // Already paid by hand on this invoice (a hand-paid plan beside the automatic one — field service re-check 11/10): not twice. The
    // shared engine's rule (tenant-backend commissions.ts paidByHand).
    const [byHand] = await db.select({ id: commission.id }).from(commission).where(and(
      eq(commission.companyId, inv.companyId), eq(commission.userId, person.id), eq(commission.invoiceId, inv.id),
      sql`coalesce(${commission.source}, 'manual') NOT IN ('auto', 'reversal')`, sql`${commission.status} NOT IN ('void', 'cancelled')`,
    )).limit(1)
    if (byHand) return out
    const base = cents(Math.max(0, Number(inv.subtotal ?? inv.total ?? 0) - Number(inv.discount ?? 0)))
    for (const plan of plans) {
      if (!planPaysPerson(plan, person.id, everyPlan)) continue
      const result = commissionFor(plan, base)
      if ('error' in result) continue
      const rows = await db.insert(commission).values({
        companyId: inv.companyId, planId: plan.id, userId: person.id, jobId: q?.jobId ?? null, invoiceId: inv.id,
        baseAmount: String(base), rateApplied: result.rate !== null ? String(result.rate) : null,
        commissionAmount: String(result.amount), earnedAt: paidAt, source: 'auto',
        notes: `Earned automatically when ${inv.number || 'the invoice'} was paid in full (sold on ${q?.number || sold?.number || 'the quote'})`,
      } as any).onConflictDoNothing().returning({ id: commission.id })
      out.earned += rows.length
    }
    return out
  }

  /** The invoices paid in the last 30 days of each company with such a plan that have not earned on it yet — what makes it certain. */
  async function sweep({ batch = 500 } = {}) {
    const total = { invoices: 0, earned: 0 }
    const rows = await db.select({ companyId: commissionPlan.companyId, id: commissionPlan.id }).from(commissionPlan).where(and(eq(commissionPlan.isActive, true), eq(commissionPlan.autoEarn, QUOTE_SELLER)))
    const byCompany = new Map<string, string[]>()
    for (const r of rows as any[]) byCompany.set(r.companyId, [...(byCompany.get(r.companyId) || []), r.id])
    for (const [companyId, planIds] of byCompany) {
      if (!(await d.features.isFeatureEnabled(companyId, FEATURE).catch(() => false))) continue
      const floor = new Date(Date.now() - 30 * 86400_000)
      const paid = await db.select({ id: invoice.id }).from(invoice).where(and(
        eq(invoice.companyId, companyId), eq(invoice.status, 'paid'), gte(invoice.paidAt, floor),
        notExists(db.select({ id: commission.id }).from(commission).where(and(eq(commission.invoiceId, invoice.id), eq(commission.source, 'auto'), inArray(commission.planId, planIds)))),
      )).orderBy(desc(invoice.paidAt)).limit(batch)
      for (const r of paid as any[]) {
        try { const e = await earnForInvoice(r.id); total.invoices++; total.earned += e.earned } catch (err: any) { logger.warn('[commissions] quote seller earn failed', { invoiceId: r.id, error: err?.message || String(err) }) }
      }
    }
    return total
  }

  return { earnForInvoice, sweep }
}

