// Stylist commissions (salon gap #8; feature `salon_commissions`). The trades' commission engine (packages/tenant-backend
// commissions) pays the person assigned a JOB; a salon has appointments. This pays the STYLIST of a visit, by themselves, when
// the visit's bill is paid in full — on what the bill's lines are (services, or retail), at the rate of the plan that stylist is on:
//   · a plan is paid on services, on retail, or on both (commission_plan.sales_kind) — "40% of services, 10% of retail" is two plans;
//   · a tiered plan finds its bracket by the stylist's sales — or by how many services / items they sold (tierBasis) — over the plan's own
//     period: a week, a fortnight, a month or a quarter of the salon's own days (tierCadence), up to and including this bill — the rate is not
//     applied back to earlier bills;
//   · a plan can be paid on services, retail, prepaid packages, gift cards or memberships, and can be for one service or product, or one category
//     of them: the most specific plan that pays a stylist for a line is the one that pays (commissionPlans.ts winningPlan);
//   · a person with no login (a chair-only stylist) is paid like anyone else, under their team-member id;
//   · a bill partly refunded reduces an unpaid commission in proportion, and takes back the same share of a paid one with a new negative line;
//   · a visit with several services pays each stylist for their own service(s) (the bill's lines are the visit's services in order);
//   · tax is never commission, and a discount on the bill lowers every line in proportion;
//   · an invoice earns a plan's commission for a stylist once (commission_auto_once); refunded in full, it is cancelled or taken back.
// Rows are the trades' own `commission` rows, so approve, pay, void, reassign, the list and the statement are the shared ones.
import { and, asc, desc, eq, gte, inArray, isNotNull, lt, ne, sum } from 'drizzle-orm'
import { commissionFor } from '@twomiah/tenant-backend'
import { appointment, appointmentItem, commission, commissionPlan, invoice, invoiceLineItem, salonRetailProduct, salonRetailSale, salonSaleSeller, serviceMenu } from '../../db/schema/index.ts'
import type { CrmDeps } from '../deps.ts'
import { calendarDateIn, salonDayStart, createSalonClock } from './days.ts'
import { kindOfLine, payeeExists, periodStart, winningPlan, type SaleLine } from './commissionPlans.ts'

export const SALON_COMMISSIONS = 'salon_commissions'
const cents = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

const OPEN = ['pending', 'approved', 'disputed'] as const

export function createSalonCommissions(d: CrmDeps) {
  const { db, logger } = d
  const clock = createSalonClock(db)

  const plansFor = (companyId: string) => db.select().from(commissionPlan).where(and(eq(commissionPlan.companyId, companyId), eq(commissionPlan.isActive, true)))

  const isPayee = (companyId: string, id: string) => payeeExists(db, companyId, id)

  /** What each person sold on this bill, line by line, after the bill's discount and before tax. */
  async function salesOf(inv: typeof invoice.$inferSelect, appt: typeof appointment.$inferSelect | null): Promise<SaleLine[]> {
    const lines = await db.select().from(invoiceLineItem).where(eq(invoiceLineItem.invoiceId, inv.id)).orderBy(asc(invoiceLineItem.sortOrder))
    const items = appt ? await db.select().from(appointmentItem).where(and(eq(appointmentItem.appointmentId, appt.id), eq(appointmentItem.companyId, appt.companyId))).orderBy(asc(appointmentItem.position)) : []
    // A retail product sold naming a stylist (a walk-in, or on a visit) earns for THAT stylist (salon_retail_sale.stylist_id / stylist_member_id).
    const retailRows = await db.select({ lineId: salonRetailSale.lineItemId, stylistId: salonRetailSale.stylistId, stylistMemberId: salonRetailSale.stylistMemberId, productId: salonRetailSale.productId, category: salonRetailProduct.category })
      .from(salonRetailSale).leftJoin(salonRetailProduct, eq(salonRetailProduct.id, salonRetailSale.productId)).where(eq(salonRetailSale.invoiceId, inv.id))
    const retail = new Map<string, any>(retailRows.map((r: any) => [r.lineId, r]))
    const [sellerRow] = await db.select({ payeeId: salonSaleSeller.payeeId }).from(salonSaleSeller).where(eq(salonSaleSeller.invoiceId, inv.id)).limit(1)
    const serviceIds = [...new Set<string>([...items.map((i: any) => i.serviceId), appt?.serviceId].filter(Boolean) as string[])]
    const categories = new Map<string, string>(serviceIds.length ? (await db.select({ id: serviceMenu.id, category: serviceMenu.category }).from(serviceMenu).where(inArray(serviceMenu.id, serviceIds))).map((r: any) => [r.id, r.category]) : [])
    const gross = lines.reduce((t: number, l: any) => t + Number(l.total || 0), 0)
    const net = Math.max(0, Number(inv.subtotal ?? gross) - Number(inv.discount ?? 0))
    const factor = gross > 0 ? net / gross : 0
    const visitPayee = appt?.stylistId ?? appt?.stylistMemberId ?? null
    // The visit's services are the bill's service lines in order, when there are as many (a total typed over the parts is one line: the visit's stylist).
    const serviceLines = lines.filter((l: any) => kindOfLine(l.type) === 'services')
    const aligned = items.length > 0 && serviceLines.length === items.length
    const many = items.length > 1 && aligned
    const out: SaleLine[] = []
    let seen = 0
    for (const l of lines as any[]) {
      const kind = kindOfLine(l.type)
      const amount = Number(l.total || 0) * factor
      const units = Math.max(1, Math.round(Number(l.quantity) || 1))
      let payee: string | null = visitPayee, serviceId: string | null = null, productId: string | null = null, productCategory: string | null = null
      if (kind === 'services') {
        const it = aligned ? items[seen++] : undefined
        if (many && it) payee = it.stylistId ?? it.stylistMemberId ?? payee
        serviceId = it?.serviceId ?? (serviceLines.length === 1 ? appt?.serviceId ?? null : null)
      } else if (kind === 'retail') {
        const r = retail.get(l.id)
        if (r) { payee = r.stylistId ?? r.stylistMemberId ?? payee; productId = r.productId ?? null; productCategory = r.category ?? null }
      } else {
        payee = sellerRow?.payeeId ?? payee                       // a package, gift card or membership: who sold it, else the visit it was sold at
      }
      if (!payee || !(amount > 0)) continue
      out.push({ kind, payee, amount: cents(amount), units, serviceId, category: serviceId ? categories.get(serviceId) ?? null : null, productId, productCategory })
    }
    return out
  }

  /** What the person has sold under this plan in the plan's period (a week, fortnight, month or quarter of the salon's days) before this bill — money or items. */
  async function periodToDate(plan: any, companyId: string, payee: string, paidAt: Date): Promise<number> {
    const tz = await clock.salonTimezone(companyId)
    const start = salonDayStart(periodStart(calendarDateIn(paidAt, tz), plan.tierCadence), tz)
    const column = plan.tierBasis === 'count' ? commission.units : commission.baseAmount
    const [row] = await db.select({ total: sum(column) }).from(commission).where(and(
      eq(commission.companyId, companyId), eq(commission.planId, plan.id), eq(commission.userId, payee), eq(commission.source, 'auto'),
      ne(commission.status, 'cancelled'), ne(commission.status, 'void'), gte(commission.earnedAt, start), lt(commission.earnedAt, paidAt),
    ))
    return Number(row?.total || 0)
  }

  /** The share of a bill that has gone back to the client (0 to 1). */
  const refundedShare = (inv: typeof invoice.$inferSelect) => {
    const total = Number(inv.total || 0)
    return total > 0 ? Math.min(1, Math.max(0, Number(inv.amountRefunded || 0) / total)) : 0
  }

  /**
   * A bill partly refunded: an unpaid commission is reduced to the share of the sale that stayed sold (from its original figures, so a second refund works
   * from the same start), and a paid one is taken back by the share newly refunded with a new negative line, one for each share. Safe to call again.
   */
  async function reduceForRefund(inv: typeof invoice.$inferSelect): Promise<{ reduced: number; reversed: number }> {
    const out = { reduced: 0, reversed: 0 }
    const ratio = refundedShare(inv)
    if (!(ratio > 0) || ratio >= 1) return out
    const autos = await db.select().from(commission).where(and(eq(commission.companyId, inv.companyId), eq(commission.invoiceId, inv.id), eq(commission.source, 'auto')))
    for (const a of autos as any[]) {
      const originalBase = Number(a.originalBase ?? a.baseAmount), originalAmount = Number(a.originalAmount ?? a.commissionAmount)
      const words = `${Math.round(ratio * 1000) / 10}% of ${inv.number || 'the bill'} was refunded`
      if ((OPEN as readonly string[]).includes(a.status)) {
        if (ratio <= Number(a.refundedRatio || 0) + 1e-9) continue
        const rows = await db.update(commission).set({
          originalBase: String(originalBase), originalAmount: String(originalAmount), refundedRatio: String(ratio),
          baseAmount: String(cents(originalBase * (1 - ratio))), commissionAmount: String(cents(originalAmount * (1 - ratio))),
          notes: `${a.notes ? a.notes + ' · ' : ''}Reduced: ${words}`, updatedAt: new Date(),
        } as any).where(and(eq(commission.id, a.id), eq(commission.status, a.status), eq(commission.refundedRatio, a.refundedRatio))).returning({ id: commission.id })
        out.reduced += rows.length
      } else if (a.status === 'paid') {
        const prior = await db.select({ ratio: commission.refundedRatio }).from(commission).where(and(eq(commission.reversalOf, a.id), eq(commission.source, 'refund')))
        const taken = prior.reduce((m: number, r: any) => Math.max(m, Number(r.ratio)), 0)
        if (ratio <= taken + 1e-9) continue
        const share = ratio - taken
        const rows = await db.insert(commission).values({
          companyId: a.companyId, planId: a.planId, userId: a.userId, jobId: null, invoiceId: a.invoiceId,
          baseAmount: String(-cents(originalBase * share)), rateApplied: a.rateApplied, commissionAmount: String(-cents(originalAmount * share)),
          source: 'refund', reversalOf: a.id, refundedRatio: String(ratio), notes: `Taken back in part: ${words} after this commission was paid`,
        } as any).onConflictDoNothing().returning({ id: commission.id })
        out.reversed += rows.length
      }
    }
    return out
  }

  /** Earn — or take back — every commission one bill owes. Safe to call any number of times. */
  async function earnForInvoice(invoiceId: string): Promise<{ earned: number; cancelled: number; reversed: number; reduced?: number }> {
    const out = { earned: 0, cancelled: 0, reversed: 0, reduced: 0 }
    const [inv] = await db.select().from(invoice).where(eq(invoice.id, invoiceId)).limit(1)
    if (!inv || !(await d.features.isFeatureEnabled(inv.companyId, SALON_COMMISSIONS))) return out
    // A bill with no visit earns for retail that names a stylist, and for a package, gift card or membership that names who sold it.
    if (!inv.appointmentId) {
      const [named] = await db.select({ id: salonRetailSale.id }).from(salonRetailSale).where(and(eq(salonRetailSale.invoiceId, inv.id), isNotNull(salonRetailSale.stylistId))).limit(1)
      const [namedMember] = named ? [named] : await db.select({ id: salonRetailSale.id }).from(salonRetailSale).where(and(eq(salonRetailSale.invoiceId, inv.id), isNotNull(salonRetailSale.stylistMemberId))).limit(1)
      const [sold] = namedMember ? [namedMember] : await db.select({ id: salonSaleSeller.id }).from(salonSaleSeller).where(eq(salonSaleSeller.invoiceId, inv.id)).limit(1)
      if (!sold) return out
    }

    if (inv.status === 'paid' && inv.paidAt) {
      const paidAt = new Date(inv.paidAt)
      const everyPlan = await plansFor(inv.companyId)
      const plans = everyPlan.filter((p: any) => p.autoEarn === 'visit_stylist' && p.planType !== 'percent_of_margin'
        && p.autoSince && new Date(p.autoSince) <= paidAt
        && (!p.effectiveFrom || new Date(p.effectiveFrom) <= paidAt) && (!p.effectiveTo || new Date(p.effectiveTo) >= paidAt))
      if (!plans.length) return out
      const [appt] = inv.appointmentId ? await db.select().from(appointment).where(and(eq(appointment.id, inv.appointmentId), eq(appointment.companyId, inv.companyId))).limit(1) : [null]
      if (!appt && inv.appointmentId) return out
      // Each line goes to the one plan that wins it for its person; a person's lines under one plan are one commission.
      const groups = new Map<string, { payee: string; plan: any; base: number; units: number }>()
      const real = new Map<string, boolean>()
      for (const line of await salesOf(inv, appt)) {
        if (!real.has(line.payee)) real.set(line.payee, await isPayee(inv.companyId, line.payee))
        if (!real.get(line.payee)) continue
        const plan = winningPlan(plans as any[], line.payee, line)
        if (!plan) continue
        const key = `${line.payee}|${plan.id}`
        const g = groups.get(key) || { payee: line.payee, plan, base: 0, units: 0 }
        g.base = cents(g.base + line.amount); g.units += line.units
        groups.set(key, g)
      }
      for (const { payee, plan, base, units } of groups.values()) {
        if (!(base > 0)) continue
        const before = plan.planType === 'tiered' ? await periodToDate(plan, inv.companyId, payee, paidAt) : 0
        const bracketOn = plan.planType === 'tiered' ? cents(before + (plan.tierBasis === 'count' ? units : base)) : base
        const result = commissionFor(plan, bracketOn)
        if ('error' in result) continue
        const rows = await db.insert(commission).values({
          companyId: inv.companyId, planId: plan.id, userId: payee, jobId: null, invoiceId: inv.id,
          baseAmount: String(base), units, rateApplied: result.rate !== null ? String(result.rate) : null,
          // A tier's rate applies to this bill's sales; a flat rate is per visit, a percentage is of the base.
          commissionAmount: String(plan.planType === 'tiered' ? cents(base * Number(result.rate) / 100) : result.amount),
          earnedAt: paidAt, source: 'auto',
          notes: `Earned automatically when ${inv.number || 'the bill'} was paid in full${plan.salesKind && plan.salesKind !== 'all' ? ` (${plan.salesKind.replace('_', ' ')})` : ''}`,
        } as any).onConflictDoNothing().returning({ id: commission.id })
        out.earned += rows.length
      }
      const partly = await reduceForRefund(inv)
      out.reduced += partly.reduced; out.reversed += partly.reversed
      return out
    }

    if (inv.status === 'refunded') {
      const autos = await db.select().from(commission).where(and(eq(commission.companyId, inv.companyId), eq(commission.invoiceId, inv.id), eq(commission.source, 'auto')))
      for (const a of autos as any[]) {
        if ((OPEN as readonly string[]).includes(a.status)) {
          const rows = await db.update(commission).set({ status: 'cancelled', notes: `${a.notes ? a.notes + ' · ' : ''}Cancelled: ${inv.number || 'the bill'} was refunded in full`, updatedAt: new Date() } as any)
            .where(and(eq(commission.id, a.id), eq(commission.status, a.status))).returning({ id: commission.id })
          out.cancelled += rows.length
        } else if (a.status === 'paid') {
          // What is left to take back: all of it, less any part already taken back when the bill was refunded in part.
          const prior = await db.select({ base: commission.baseAmount, amount: commission.commissionAmount }).from(commission).where(and(eq(commission.reversalOf, a.id), eq(commission.source, 'refund')))
          const takenBase = prior.reduce((t: number, r: any) => t + Number(r.base), 0), takenAmount = prior.reduce((t: number, r: any) => t + Number(r.amount), 0)
          const rows = await db.insert(commission).values({
            companyId: a.companyId, planId: a.planId, userId: a.userId, jobId: null, invoiceId: a.invoiceId,
            baseAmount: String(-cents(Number(a.baseAmount || 0) + takenBase)), rateApplied: a.rateApplied, commissionAmount: String(-cents(Number(a.commissionAmount || 0) + takenAmount)),
            refundedRatio: '1', source: 'reversal', reversalOf: a.id, notes: `Taken back: ${inv.number || 'the bill'} was refunded in full after this commission was paid`,
          } as any).onConflictDoNothing().returning({ id: commission.id })
          out.reversed += rows.length
        }
      }
    }
    return out
  }

  /** The bills paid in the last 30 days that have earned nothing yet (a door that did not call earnForInvoice), and refunded ones carrying a commission. */
  async function sweep({ batch = 500 } = {}) {
    const total = { invoices: 0, earned: 0, cancelled: 0, reversed: 0 }
    const companies = await db.select({ id: commissionPlan.companyId }).from(commissionPlan).where(and(eq(commissionPlan.isActive, true), eq(commissionPlan.autoEarn, 'visit_stylist')))
    for (const companyId of [...new Set((companies as any[]).map((c) => c.id as string))]) {
      if (!(await d.features.isFeatureEnabled(companyId, SALON_COMMISSIONS))) continue
      const floor = new Date(Date.now() - 30 * 86400_000)
      // Bills with a visit, and bills that were sold by someone (a package, gift card or membership) or name a stylist on retail.
      const paid = await db.select({ id: invoice.id }).from(invoice).where(and(eq(invoice.companyId, companyId), eq(invoice.status, 'paid'), gte(invoice.paidAt, floor))).orderBy(desc(invoice.paidAt)).limit(batch)
      const refunded = await db.select({ id: commission.invoiceId }).from(commission).innerJoin(invoice, eq(invoice.id, commission.invoiceId))
        .where(and(eq(commission.companyId, companyId), eq(commission.source, 'auto'), eq(invoice.status, 'refunded'), inArray(commission.status, ['pending', 'approved', 'disputed', 'paid']))).limit(batch)
      const ids = new Set<string>([...(paid as any[]).map((r) => r.id), ...(refunded as any[]).map((r) => r.id).filter(Boolean)])
      for (const id of ids) {
        try { const r = await earnForInvoice(id); total.invoices++; total.earned += r.earned; total.cancelled += r.cancelled; total.reversed += r.reversed } catch (e: any) { logger.warn('[salon commissions] earn failed', { invoiceId: id, error: e?.message || String(e) }) }
      }
    }
    return total
  }

  return { earnForInvoice, sweep, reduceForRefund }
}
export type SalonCommissions = ReturnType<typeof createSalonCommissions>
