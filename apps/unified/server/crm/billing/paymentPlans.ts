// Payment plans and the way an invoice is paid (contractor parity row 12; docs/parity/contractor-payments.md).
//
//   GET    /api/invoice-payments/:invoiceId/plan       the installments and where each stands                   invoices:read
//   PUT    /api/invoice-payments/:invoiceId/plan       { installments: [{ dueDate, amount }] }                   invoices:update  (payment_plans)
//   DELETE /api/invoice-payments/:invoiceId/plan                                                                invoices:update  (payment_plans)
//   PUT    /api/invoice-payments/:invoiceId/methods    { paymentMethods: 'card' | 'bank' | 'both' }              invoices:update  (payment_method_choice)
//
// A PLAN splits the invoice's total into installments, due on their days; they add up to the total exactly. What has been paid
// (paid less refunded) fills them in order, so the first may be "the deposit, paid". The invoice's due date is kept on the first
// installment not paid in full: the automatic reminders (invoiceReminders.ts — a moved due date earns its own steps) then remind
// for each installment in turn, and the portal offers that installment as the amount to pay. Nothing here moves money.
import { Hono } from 'hono'
import { z } from 'zod'
import { and, asc, eq } from 'drizzle-orm'
import { round2, companyTimeZone, storeDateString } from '@twomiah/tenant-backend'
import { invoice, invoiceInstallment } from '../../db/schema/index.ts'
import type { AppEnv } from '../../http/env.ts'
import { fail, one } from '../../http/reply.ts'
import type { CrmDeps } from '../deps.ts'

export const PAYMENT_PLANS = 'payment_plans'
export const METHOD_CHOICE = 'payment_method_choice'
export const INVOICE_TIPS = 'invoice_tips'
const EPS = 0.005
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-12-01')
const planBody = z.object({
  installments: z.array(z.object({ dueDate: day, amount: z.coerce.number().gt(0, 'Each installment is more than zero').max(100_000_000) })).min(2, 'A plan has at least two installments').max(36, 'A plan has 36 installments or fewer'),
})

export function createPaymentPlans(d: CrmDeps) {
  const { db } = d
  const on = (companyId: string, f: string) => d.features.isFeatureEnabled(companyId, f).catch(() => false)

  /** The plan with where each installment stands, worked from what the invoice has been paid; null when it has none. */
  async function planFor(companyId: string, invoiceId: string) {
    const [inv] = await db.select().from(invoice).where(and(eq(invoice.id, invoiceId), eq(invoice.companyId, companyId))).limit(1) as any[]
    if (!inv) return null
    const rows = await db.select().from(invoiceInstallment).where(and(eq(invoiceInstallment.companyId, companyId), eq(invoiceInstallment.invoiceId, invoiceId))).orderBy(asc(invoiceInstallment.sortOrder), asc(invoiceInstallment.dueDate)) as any[]
    if (!rows.length) return null
    let left = round2(Number(inv.amountPaid || 0) - Number(inv.amountRefunded || 0))
    // Overdue on the company's own calendar day, as the reminders read it.
    const today = storeDateString(new Date(), await companyTimeZone(db, companyId))
    const installments = rows.map((r) => {
      const amount = Number(r.amount)
      const paid = round2(Math.max(0, Math.min(amount, left)))
      left = round2(left - paid)
      const due = new Date(r.dueDate).toISOString().slice(0, 10)
      const owed = round2(amount - paid)
      return { id: r.id, dueDate: due, amount, paid, owed, state: owed <= EPS ? 'paid' : due < today ? 'overdue' : paid > EPS ? 'part paid' : 'due' }
    })
    const next = installments.find((i) => i.owed > EPS) || null
    return { installments, next: next ? { dueDate: next.dueDate, owed: next.owed } : null }
  }

  /** Keep the invoice's due date on the first installment not paid in full (the reminders follow it). */
  async function syncDueDate(invoiceId: string) {
    const [inv] = await db.select({ companyId: invoice.companyId, dueDate: invoice.dueDate }).from(invoice).where(eq(invoice.id, invoiceId)).limit(1) as any[]
    if (!inv || !(await on(inv.companyId, PAYMENT_PLANS))) return
    const plan = await planFor(inv.companyId, invoiceId)
    if (!plan?.next) return
    const want = new Date(`${plan.next.dueDate}T00:00:00Z`)
    if (!inv.dueDate || new Date(inv.dueDate).getTime() !== want.getTime()) await db.update(invoice).set({ dueDate: want, updatedAt: new Date() }).where(eq(invoice.id, invoiceId))
  }

  function routes() {
    const { requirePermission } = d.permissions
    const app = new Hono<AppEnv>()
    const own = async (c: any) => (await db.select().from(invoice).where(and(eq(invoice.id, c.req.param('invoiceId')), eq(invoice.companyId, (c.get('user') as any).companyId))).limit(1))[0] as any

    app.get('/:invoiceId/plan', requirePermission('invoices:read'), async (c) => {
      const me = c.get('user') as any
      if (!(await on(me.companyId, PAYMENT_PLANS))) return fail(c, 404, 'Not found')
      if (!(await own(c))) return fail(c, 404, 'Invoice not found')
      return one(c, (await planFor(me.companyId, c.req.param('invoiceId'))) || { installments: [], next: null })
    })
    app.put('/:invoiceId/plan', requirePermission('invoices:update'), async (c) => {
      const me = c.get('user') as any
      if (!(await on(me.companyId, PAYMENT_PLANS))) return fail(c, 404, 'Not found')
      const inv = await own(c)
      if (!inv) return fail(c, 404, 'Invoice not found')
      if (['draft', 'void', 'paid', 'refunded'].includes(inv.status)) return fail(c, 400, `A ${inv.status} invoice takes no payment plan.`)
      const parsed = planBody.safeParse(await c.req.json().catch(() => ({})))
      if (!parsed.success) return fail(c, 400, parsed.error.issues[0]?.message || 'Check the installments')
      const list = [...parsed.data.installments].sort((a, b) => a.dueDate.localeCompare(b.dueDate))
      const sum = round2(list.reduce((s, i) => s + i.amount, 0))
      const total = round2(Number(inv.total))
      if (Math.abs(sum - total) > EPS) return fail(c, 400, `The installments come to ${sum.toFixed(2)}; the invoice is ${total.toFixed(2)}. They must add up to it exactly.`)
      await db.transaction(async (tx: any) => {
        await tx.delete(invoiceInstallment).where(and(eq(invoiceInstallment.companyId, me.companyId), eq(invoiceInstallment.invoiceId, inv.id)))
        await tx.insert(invoiceInstallment).values(list.map((i, n) => ({ companyId: me.companyId, invoiceId: inv.id, dueDate: new Date(`${i.dueDate}T00:00:00Z`), amount: String(round2(i.amount)), sortOrder: n })))
      })
      await syncDueDate(inv.id)
      return one(c, (await planFor(me.companyId, inv.id)) || { installments: [], next: null })
    })
    app.delete('/:invoiceId/plan', requirePermission('invoices:update'), async (c) => {
      const me = c.get('user') as any
      if (!(await on(me.companyId, PAYMENT_PLANS))) return fail(c, 404, 'Not found')
      const inv = await own(c)
      if (!inv) return fail(c, 404, 'Invoice not found')
      await db.delete(invoiceInstallment).where(and(eq(invoiceInstallment.companyId, me.companyId), eq(invoiceInstallment.invoiceId, inv.id)))
      return one(c, { installments: [], next: null })
    })
    app.put('/:invoiceId/methods', requirePermission('invoices:update'), async (c) => {
      const me = c.get('user') as any
      if (!(await on(me.companyId, METHOD_CHOICE))) return fail(c, 404, 'Not found')
      const inv = await own(c)
      if (!inv) return fail(c, 404, 'Invoice not found')
      const v = String((await c.req.json().catch(() => ({})))?.paymentMethods || '')
      if (!['card', 'bank', 'both'].includes(v)) return fail(c, 400, 'Choose card, bank or both')
      const [row] = await db.update(invoice).set({ paymentMethods: v === 'both' ? null : v, updatedAt: new Date() } as any).where(eq(invoice.id, inv.id)).returning()
      return one(c, { paymentMethods: row.paymentMethods ?? 'both' })
    })
    return app
  }

  return { planFor, syncDueDate, routes }
}
