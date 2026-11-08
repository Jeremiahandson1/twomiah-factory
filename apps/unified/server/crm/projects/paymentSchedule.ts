// A project's payment schedule (contractor parity row 10b; docs/parity/contractor-portal.md item 5; Buildertrend draws / owner
// invoices, JobTread's payment schedule; client_portal_plus, not ready).
//
//   GET    /api/client-portal/:projectId/payments         the schedule with the contract it is worked from and what is paid   projects:read
//   POST   /api/client-portal/:projectId/payments         { name, amountType, amount, dueDate?, milestoneTaskId? }             invoices:create
//   PUT    /api/client-portal/payments/:id                the same fields, while it is not released                            invoices:create
//   DELETE /api/client-portal/payments/:id                while it is not released                                             invoices:create
//   POST   /api/client-portal/payments/:id/release        raise its invoice (sent), and tell the client where asked            invoices:create
//
// THE CONTRACT a share is a percent of: the project's approved quotes plus its approved change orders, else its estimated value.
// RELEASING raises a real invoice through insertInvoice (the same path deposits use): one line, the payment's name, its amount
// worked out then. Where the project has exactly one approved quote, the invoice is billed toward it (bill_kind 'progress',
// billed_quote_id), so converting that quote to its final invoice credits it and nothing is billed twice. Releases can never come
// to more than the contract. PAID is the invoice's own state (its balance), never kept a second time.
import { Hono } from 'hono'
import { z } from 'zod'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { insertInvoice, invoiceBalance, round2, businessToday, companyTimeZone } from '@twomiah/tenant-backend'
import { changeOrder, invoice, invoiceLineItem, project, projectPayment, projectTask, quote } from '../../db/schema/index.ts'
import type { AppEnv } from '../../http/env.ts'
import { fail, one } from '../../http/reply.ts'
import type { CrmDeps } from '../deps.ts'

const DEFAULT_NUMBERING = { prefix: 'INV', pad: 5, seed: 0 }
const EPS = 0.005
const body = z.object({
  name: z.string().trim().min(1, 'Name the payment').max(200),
  amountType: z.enum(['fixed', 'percent']).default('fixed'),
  amount: z.coerce.number({ error: 'The amount must be a number' }).gt(0, 'The amount must be more than zero').max(100_000_000),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-12-01').nullable().optional(),
  milestoneTaskId: z.string().min(1).nullable().optional(),
}).refine((b) => b.amountType !== 'percent' || b.amount <= 100, { message: 'A share of the contract is 100% or less', path: ['amount'] })

export function createPaymentSchedule(d: CrmDeps, tellClient: (companyId: string, projectId: string, what: any, words: string) => Promise<string>) {
  const { db } = d
  const numbering = d.settings?.invoices?.numbering || DEFAULT_NUMBERING

  /** What the project is sold for, and the one approved quote its invoices bill toward (if there is exactly one). */
  async function contractOf(companyId: string, projectId: string) {
    const [p] = await db.select().from(project).where(and(eq(project.id, projectId), eq(project.companyId, companyId))).limit(1) as any[]
    if (!p) return null
    const quotes = await db.select({ id: quote.id, total: quote.total }).from(quote).where(and(eq(quote.companyId, companyId), eq(quote.projectId, projectId), eq(quote.status, 'approved'))) as any[]
    const cos = await db.select({ amount: changeOrder.amount }).from(changeOrder).where(and(eq(changeOrder.companyId, companyId), eq(changeOrder.projectId, projectId), eq(changeOrder.status, 'approved'))) as any[]
    const quoted = round2(quotes.reduce((s, q) => s + (Number(q.total) || 0), 0))
    const changes = round2(cos.reduce((s, o) => s + (Number(o.amount) || 0), 0))
    // A typed estimate already carries the change orders agreed since (their approval adds them to it), so they are added to quotes only.
    const value = round2(quoted > 0 ? quoted + changes : Number(p.estimatedValue) || 0)
    return { project: p, value, source: quoted > 0 ? 'quotes' : Number(p.estimatedValue) > 0 ? 'estimate' : 'none', quoteId: quotes.length === 1 ? quotes[0].id : null }
  }
  const amountOf = (row: any, contract: number) => round2(row.amountType === 'percent' ? (contract * Number(row.amount)) / 100 : Number(row.amount))

  /** The schedule as the office and the client read it: each payment's amount now, its state, and its invoice. */
  async function scheduleFor(companyId: string, projectId: string) {
    const c = await contractOf(companyId, projectId)
    if (!c) return null
    const rows = await db.select().from(projectPayment).where(and(eq(projectPayment.companyId, companyId), eq(projectPayment.projectId, projectId))).orderBy(asc(projectPayment.sortOrder), asc(projectPayment.createdAt), asc(projectPayment.id)) as any[]
    const invIds = rows.map((r) => r.invoiceId).filter(Boolean)
    const invs = invIds.length ? await db.select().from(invoice).where(and(eq(invoice.companyId, companyId), inArray(invoice.id, invIds))) as any[] : []
    const byId = new Map(invs.map((i) => [i.id, i]))
    const tasks = rows.some((r) => r.milestoneTaskId) ? await db.select({ id: projectTask.id, name: projectTask.name, progress: projectTask.progress, status: projectTask.status }).from(projectTask).where(eq(projectTask.projectId, projectId)) as any[] : []
    const taskById = new Map(tasks.map((t) => [t.id, t]))
    const payments = rows.map((r) => {
      const inv = r.invoiceId ? byId.get(r.invoiceId) : null
      const balance = inv ? invoiceBalance(inv) : null
      const state = !inv ? 'scheduled' : inv.status === 'void' ? 'void' : (balance ?? 0) <= EPS ? 'paid' : 'due'
      const m = r.milestoneTaskId ? taskById.get(r.milestoneTaskId) : null
      return {
        id: r.id, name: r.name, amountType: r.amountType, share: r.amountType === 'percent' ? Number(r.amount) : null,
        amount: inv ? Number(inv.total) : amountOf(r, c.value), dueDate: r.dueDate ? new Date(r.dueDate).toISOString() : null,
        milestone: m ? { id: m.id, name: m.name, done: m.status === 'done' || Number(m.progress) >= 100 } : null,
        state, invoiceId: inv && inv.status !== 'void' ? inv.id : null, invoiceNumber: inv?.number ?? null, balance,
      }
    })
    const live = payments.filter((p) => p.state !== 'void')
    return {
      contract: { value: c.value, source: c.source }, payments,
      scheduled: round2(live.reduce((s, p) => s + p.amount, 0)),
      paid: round2(live.filter((p) => p.state === 'paid').reduce((s, p) => s + p.amount, 0)),
    }
  }

  function routes(app: Hono<AppEnv>) {
    const { requirePermission } = d.permissions
    const mine = async (companyId: string, id: string) => (await db.select().from(projectPayment).where(and(eq(projectPayment.id, id), eq(projectPayment.companyId, companyId))).limit(1))[0] as any
    const milestoneOk = async (companyId: string, projectId: string, taskId: string | null | undefined) => !taskId || !!(await db.select({ id: projectTask.id }).from(projectTask).where(and(eq(projectTask.id, taskId), eq(projectTask.projectId, projectId), eq(projectTask.companyId, companyId))).limit(1))[0]
    const values = (v: z.infer<typeof body>) => ({ name: v.name, amountType: v.amountType, amount: String(round2(v.amount)), dueDate: v.dueDate ? new Date(`${v.dueDate}T00:00:00Z`) : null, milestoneTaskId: v.milestoneTaskId || null })

    app.get('/:projectId/payments', requirePermission('projects:read'), async (c) => {
      const s = await scheduleFor((c.get('user') as any).companyId, c.req.param('projectId'))
      return s ? one(c, s) : fail(c, 404, 'Project not found')
    })
    app.post('/:projectId/payments', requirePermission('invoices:create'), async (c) => {
      const me = c.get('user') as any
      const projectId = c.req.param('projectId')
      if (!(await contractOf(me.companyId, projectId))) return fail(c, 404, 'Project not found')
      const parsed = body.safeParse(await c.req.json().catch(() => ({})))
      if (!parsed.success) return fail(c, 400, parsed.error.issues[0]?.message || 'Check the payment')
      if (!(await milestoneOk(me.companyId, projectId, parsed.data.milestoneTaskId))) return fail(c, 400, 'That milestone is not on this project’s schedule')
      const n = (await db.select({ id: projectPayment.id }).from(projectPayment).where(eq(projectPayment.projectId, projectId))).length
      await db.insert(projectPayment).values({ companyId: me.companyId, projectId, ...values(parsed.data), sortOrder: n })
      return one(c, (await scheduleFor(me.companyId, projectId)) ?? {}, 201)
    })
    app.put('/payments/:id', requirePermission('invoices:create'), async (c) => {
      const me = c.get('user') as any
      const row = await mine(me.companyId, c.req.param('id'))
      if (!row) return fail(c, 404, 'Payment not found')
      if (row.invoiceId) return fail(c, 400, 'This payment is released and has its invoice. Void that invoice to change it.')
      const parsed = body.safeParse(await c.req.json().catch(() => ({})))
      if (!parsed.success) return fail(c, 400, parsed.error.issues[0]?.message || 'Check the payment')
      if (!(await milestoneOk(me.companyId, row.projectId, parsed.data.milestoneTaskId))) return fail(c, 400, 'That milestone is not on this project’s schedule')
      await db.update(projectPayment).set(values(parsed.data)).where(eq(projectPayment.id, row.id))
      return one(c, (await scheduleFor(me.companyId, row.projectId)) ?? {})
    })
    app.delete('/payments/:id', requirePermission('invoices:create'), async (c) => {
      const me = c.get('user') as any
      const row = await mine(me.companyId, c.req.param('id'))
      if (!row) return fail(c, 404, 'Payment not found')
      if (row.invoiceId) return fail(c, 400, 'This payment is released and has its invoice. Void that invoice first.')
      await db.delete(projectPayment).where(eq(projectPayment.id, row.id))
      return one(c, (await scheduleFor(me.companyId, row.projectId)) ?? {})
    })
    app.post('/payments/:id/release', requirePermission('invoices:create'), async (c) => {
      const me = c.get('user') as any
      const row = await mine(me.companyId, c.req.param('id'))
      if (!row) return fail(c, 404, 'Payment not found')
      const ctr = await contractOf(me.companyId, row.projectId)
      if (!ctr) return fail(c, 404, 'Project not found')
      if (!ctr.project.contactId) return fail(c, 400, 'The project has no client to bill. Choose one on the project first.')
      const s = await scheduleFor(me.companyId, row.projectId)
      const mineNow = s!.payments.find((p) => p.id === row.id)!
      if (mineNow.invoiceId) return fail(c, 409, `Already released as invoice ${mineNow.invoiceNumber}.`)
      const amount = amountOf(row, ctr.value)
      if (amount <= 0) return fail(c, 400, 'A share of a contract worth nothing is nothing: approve the quote, or give the project its value, first.')
      // Never more than the contract: what has been released (and not voided) plus this one.
      const released = round2(s!.payments.filter((p) => p.invoiceId).reduce((t, p) => t + p.amount, 0))
      if (ctr.value > 0 && released + amount > ctr.value + EPS) return fail(c, 400, `Releasing ${amount.toFixed(2)} would bill ${round2(released + amount).toFixed(2)} on a contract of ${ctr.value.toFixed(2)}.`)
      const today = businessToday(await companyTimeZone(db, me.companyId))
      const due = row.dueDate && new Date(row.dueDate) > today ? new Date(row.dueDate) : today
      const created = await db.transaction(async (tx: any) => {
        const inv = await insertInvoice(tx, { invoice, invoiceLineItem } as any, numbering, {
          companyId: me.companyId, contactId: ctr.project.contactId, projectId: row.projectId, dueDate: due, issueDate: today, taxRate: 0, status: 'sent',
          notes: `${row.name} — payment schedule for ${ctr.project.name}.`,
          ...(ctr.quoteId ? { extra: { billKind: 'progress', billedQuoteId: ctr.quoteId } } : {}),
        }, [{ description: `${row.name} — ${ctr.project.name}`, quantity: 1, unitPrice: amount }])
        await tx.update(projectPayment).set({ invoiceId: inv.id, releasedAt: new Date() }).where(eq(projectPayment.id, row.id))
        return inv
      })
      d.realtime.emitToCompany(me.companyId, d.realtime.EVENTS.INVOICE_CREATED, { id: created.id, number: created.number })
      const told = await tellClient(me.companyId, row.projectId, 'payments', `A payment is due: ${row.name}`)
      return one(c, { invoice: { id: created.id, number: created.number, total: Number(created.total) }, told, schedule: await scheduleFor(me.companyId, row.projectId) }, 201)
    })
  }

  return { scheduleFor, routes }
}
