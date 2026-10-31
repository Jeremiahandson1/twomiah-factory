// Stylist commissions (salon gap #8; feature `salon_commissions`). The trades' commission engine (packages/tenant-backend
// commissions) pays the person assigned a JOB; a salon has appointments. This pays the STYLIST of a visit, by themselves, when
// the visit's bill is paid in full — on what the bill's lines are (services, or retail), at the rate of the plan that stylist is on:
//   · a plan is paid on services, on retail, or on both (commission_plan.sales_kind) — "40% of services, 10% of retail" is two plans;
//   · a tiered plan finds its bracket by the stylist's sales that calendar month (the salon's own month) up to and including this
//     bill — the rate is not applied back to earlier bills;
//   · a visit with several services pays each stylist for their own service(s) (the bill's lines are the visit's services in order);
//   · tax is never commission, and a discount on the bill lowers every line in proportion;
//   · an invoice earns a plan's commission for a stylist once (commission_auto_once); refunded in full, it is cancelled or taken back.
// Rows are the trades' own `commission` rows, so approve, pay, void, reassign, the list and the statement are the shared ones.
import { and, asc, desc, eq, gte, inArray, isNotNull, lt, ne, sum } from 'drizzle-orm'
import { commissionFor, planPeople } from '@twomiah/tenant-backend'
import { appointment, appointmentItem, commission, commissionPlan, invoice, invoiceLineItem, salonRetailSale, user } from '../../db/schema/index.ts'
import type { CrmDeps } from '../deps.ts'
import { calendarDateIn, salonDayStart, createSalonClock } from './days.ts'

export const SALON_COMMISSIONS = 'salon_commissions'
const cents = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
type Kind = 'services' | 'retail'
const kindOfLine = (type: string | null | undefined): Kind => (type === 'retail' ? 'retail' : 'services')
const covers = (salesKind: string | null | undefined, kind: Kind) => !salesKind || salesKind === 'all' || salesKind === kind
const overlap = (a: string | null | undefined, b: string | null | undefined) => !a || !b || a === 'all' || b === 'all' || a === b

/**
 * Who a salon plan pays. A plan that names people pays them. A plan that names nobody pays any stylist not named on another
 * current plan FOR THE SAME KIND OF SALE — so a stylist named on "services 40%" still gets the general "retail 10%".
 */
export function planPaysStylist(plan: { id: string; userIds?: unknown; salesKind?: string | null }, userId: string, current: Array<{ id: string; userIds?: unknown; isActive?: boolean | null; salesKind?: string | null }>): boolean {
  const named = planPeople(plan)
  if (named.length) return named.includes(userId)
  return !current.some((p) => p.id !== plan.id && p.isActive !== false && overlap(p.salesKind, plan.salesKind) && planPeople(p).includes(userId))
}

export function createSalonCommissions(d: CrmDeps) {
  const { db, logger } = d
  const clock = createSalonClock(db)

  const plansFor = (companyId: string) => db.select().from(commissionPlan).where(and(eq(commissionPlan.companyId, companyId), eq(commissionPlan.isActive, true)))

  /** What each stylist sold on this bill, by kind, after the bill's discount, before tax. */
  async function salesOf(inv: typeof invoice.$inferSelect, appt: typeof appointment.$inferSelect | null) {
    const lines = await db.select().from(invoiceLineItem).where(eq(invoiceLineItem.invoiceId, inv.id)).orderBy(asc(invoiceLineItem.sortOrder))
    const items = appt ? await db.select().from(appointmentItem).where(and(eq(appointmentItem.appointmentId, appt.id), eq(appointmentItem.companyId, appt.companyId))).orderBy(asc(appointmentItem.position)) : []
    // A retail product sold naming a stylist (a walk-in, or on a visit) earns for THAT stylist (salon_retail_sale.stylist_id).
    const named = new Map<string, string>((await db.select({ lineId: salonRetailSale.lineItemId, stylistId: salonRetailSale.stylistId }).from(salonRetailSale).where(eq(salonRetailSale.invoiceId, inv.id)))
      .filter((r: any) => r.stylistId).map((r: any) => [r.lineId, r.stylistId]))
    const gross = lines.reduce((t: number, l: any) => t + Number(l.total || 0), 0)
    const net = Math.max(0, Number(inv.subtotal ?? gross) - Number(inv.discount ?? 0))
    const factor = gross > 0 ? net / gross : 0
    // The visit's services are the bill's service lines in order, when there are as many (a total typed over the parts is one line: the visit's stylist).
    const serviceLines = lines.filter((l: any) => kindOfLine(l.type) === 'services')
    const byItem = items.length > 1 && serviceLines.length === items.length
    const out = new Map<string, { services: number; retail: number }>()
    const add = (stylist: string | null, kind: Kind, amount: number) => {
      if (!stylist || !(amount > 0)) return
      const row = out.get(stylist) || { services: 0, retail: 0 }
      row[kind] = cents(row[kind] + amount)
      out.set(stylist, row)
    }
    let seen = 0
    for (const l of lines as any[]) {
      const kind = kindOfLine(l.type)
      let stylist: string | null = appt?.stylistId ?? null
      if (kind === 'services' && byItem) stylist = items[seen++]?.stylistId || stylist
      if (kind === 'retail' && named.has(l.id)) stylist = named.get(l.id)!
      add(stylist, kind, Number(l.total || 0) * factor)
    }
    return out
  }

  /** The bracket for a tiered plan is the stylist's sales this calendar month, this bill included. */
  async function monthToDate(plan: any, companyId: string, userId: string, paidAt: Date, base: number): Promise<number> {
    const tz = await clock.salonTimezone(companyId)
    const [y, m] = calendarDateIn(paidAt, tz).split('-')
    const start = salonDayStart(`${y}-${m}-01`, tz)
    const [row] = await db.select({ total: sum(commission.baseAmount) }).from(commission).where(and(
      eq(commission.companyId, companyId), eq(commission.planId, plan.id), eq(commission.userId, userId), eq(commission.source, 'auto'),
      ne(commission.status, 'cancelled'), ne(commission.status, 'void'), gte(commission.earnedAt, start), lt(commission.earnedAt, paidAt),
    ))
    return cents(Number(row?.total || 0) + base)
  }

  /** Earn — or take back — every commission one bill owes. Safe to call any number of times. */
  async function earnForInvoice(invoiceId: string): Promise<{ earned: number; cancelled: number; reversed: number }> {
    const out = { earned: 0, cancelled: 0, reversed: 0 }
    const [inv] = await db.select().from(invoice).where(eq(invoice.id, invoiceId)).limit(1)
    if (!inv || !(await d.features.isFeatureEnabled(inv.companyId, SALON_COMMISSIONS))) return out
    // A bill with no visit earns only for retail that names a stylist.
    if (!inv.appointmentId) {
      const [named] = await db.select({ id: salonRetailSale.id }).from(salonRetailSale).where(and(eq(salonRetailSale.invoiceId, inv.id), isNotNull(salonRetailSale.stylistId))).limit(1)
      if (!named) return out
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
      const sales = await salesOf(inv, appt)
      for (const [stylistId, sold] of sales) {
        const [person] = await db.select({ id: user.id }).from(user).where(and(eq(user.id, stylistId), eq(user.companyId, inv.companyId))).limit(1)
        if (!person) continue                                  // a chair-only stylist has no login to pay through the CRM
        for (const plan of plans as any[]) {
          if (!planPaysStylist(plan, person.id, everyPlan)) continue
          const base = cents((covers(plan.salesKind, 'services') ? sold.services : 0) + (covers(plan.salesKind, 'retail') ? sold.retail : 0))
          if (!(base > 0)) continue
          const bracketOn = plan.planType === 'tiered' ? await monthToDate(plan, inv.companyId, person.id, paidAt, base) : base
          const result = commissionFor(plan, bracketOn)
          if ('error' in result) continue
          const rows = await db.insert(commission).values({
            companyId: inv.companyId, planId: plan.id, userId: person.id, jobId: null, invoiceId: inv.id,
            baseAmount: String(base), rateApplied: result.rate !== null ? String(result.rate) : null,
            // A tier's rate applies to this bill's sales; a flat rate is per visit, a percentage is of the base.
            commissionAmount: String(plan.planType === 'tiered' ? cents(base * Number(result.rate) / 100) : result.amount),
            earnedAt: paidAt, source: 'auto',
            notes: `Earned automatically when ${inv.number || 'the bill'} was paid in full${plan.salesKind && plan.salesKind !== 'all' ? ` (${plan.salesKind})` : ''}`,
          } as any).onConflictDoNothing().returning({ id: commission.id })
          out.earned += rows.length
        }
      }
      return out
    }

    if (inv.status === 'refunded') {
      const autos = await db.select().from(commission).where(and(eq(commission.companyId, inv.companyId), eq(commission.invoiceId, inv.id), eq(commission.source, 'auto')))
      for (const a of autos as any[]) {
        if (['pending', 'approved', 'disputed'].includes(a.status)) {
          const rows = await db.update(commission).set({ status: 'cancelled', notes: `${a.notes ? a.notes + ' · ' : ''}Cancelled: ${inv.number || 'the bill'} was refunded in full`, updatedAt: new Date() } as any)
            .where(and(eq(commission.id, a.id), eq(commission.status, a.status))).returning({ id: commission.id })
          out.cancelled += rows.length
        } else if (a.status === 'paid') {
          const rows = await db.insert(commission).values({
            companyId: a.companyId, planId: a.planId, userId: a.userId, jobId: null, invoiceId: a.invoiceId,
            baseAmount: String(-Number(a.baseAmount || 0)), rateApplied: a.rateApplied, commissionAmount: String(-Number(a.commissionAmount || 0)),
            source: 'reversal', reversalOf: a.id, notes: `Taken back: ${inv.number || 'the bill'} was refunded in full after this commission was paid`,
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
      const paid = await db.select({ id: invoice.id }).from(invoice).where(and(eq(invoice.companyId, companyId), eq(invoice.status, 'paid'), isNotNull(invoice.appointmentId), gte(invoice.paidAt, floor))).orderBy(desc(invoice.paidAt)).limit(batch)
      const refunded = await db.select({ id: commission.invoiceId }).from(commission).innerJoin(invoice, eq(invoice.id, commission.invoiceId))
        .where(and(eq(commission.companyId, companyId), eq(commission.source, 'auto'), eq(invoice.status, 'refunded'), inArray(commission.status, ['pending', 'approved', 'disputed', 'paid']))).limit(batch)
      const ids = new Set<string>([...(paid as any[]).map((r) => r.id), ...(refunded as any[]).map((r) => r.id).filter(Boolean)])
      for (const id of ids) {
        try { const r = await earnForInvoice(id); total.invoices++; total.earned += r.earned; total.cancelled += r.cancelled; total.reversed += r.reversed } catch (e: any) { logger.warn('[salon commissions] earn failed', { invoiceId: id, error: e?.message || String(e) }) }
      }
    }
    return total
  }

  return { earnForInvoice, sweep }
}
export type SalonCommissions = ReturnType<typeof createSalonCommissions>
