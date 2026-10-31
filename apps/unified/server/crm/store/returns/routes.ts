// The back office's returns at /api/admin/store-returns (access 'user', behind the hidden feature store_returns). Reading
// them is orders:read; every action that decides, receives or sends money is orders:refund — the manager's and the
// owner's, the same line as a refund — and the return rule is settings:update. Both sides ask the same question: the
// menu row and these routes.
//   GET    /                  the returns (?status=, ?order=)      → { data, pagination }
//   GET    /settings          the return rule                       → the rule
//   PUT    /settings          change it (settings:update)           → the rule
//   POST   /                  start one for an order (staff)        → the return (begins approved)
//   GET    /:id               one return, with its lines and money  → the return
//   POST   /:id/approve | /decline | /cancel | /receive | /refund | /exchange | /label
import { Hono } from 'hono'
import { z } from 'zod'
import type { Context } from 'hono'
import type { AppEnv } from '../../../http/env.ts'
import { fail, one, listAll } from '../../../http/reply.ts'
import type { CrmDeps } from '../../deps.ts'
import { REASONS, type StoreReturns, type Refusal } from './returns.ts'
import type { OrderRefunds } from '../orders/refunds.ts'

const lines = z.array(z.object({ orderItemId: z.string().min(1), quantity: z.number().int().min(1) })).min(1).max(200)
const startSchema = z.object({
  orderId: z.string().min(1), items: lines, reason: z.enum(REASONS).default('other'), note: z.string().max(1000).nullish(), wanted: z.string().max(500).nullish(),
  resolution: z.enum(['refund', 'exchange']).default('refund'), preferCredit: z.boolean().default(false), allowLate: z.boolean().default(false),
})
const ruleSchema = z.object({
  windowDays: z.number().int().min(0).max(3650), restockingFeePercent: z.number().min(0).max(100), returnShippingFeeCents: z.number().int().min(0).max(100_000),
  labels: z.boolean(), shopperReturns: z.boolean(),
})

const bad = (c: Context, sentence: string, error: z.ZodError) => {
  const fields: Record<string, string> = {}
  for (const i of error.issues) { const k = i.path.join('.'); if (k && !fields[k]) fields[k] = i.message }
  return fail(c, 400, sentence, 'validation_failed', fields)
}
export const refuse = (c: Context, r: Refusal) => fail(c, r.status, r.error, r.code)

export function createReturnRoutes(d: CrmDeps, returns: StoreReturns, refunds: OrderRefunds) {
  const { requirePermission } = d.permissions
  const app = new Hono<AppEnv>()
  const own = (c: Context) => (c as any).get('user').companyId as string
  const readable = requirePermission('orders:read')
  const decides = requirePermission('orders:refund')

  const ruleOut = (p: Awaited<ReturnType<StoreReturns['policy']>>) => ({ windowDays: p.windowDays, restockingFeePercent: p.restockingFeeBps / 100, returnShippingFeeCents: p.returnShippingFeeCents, labels: p.labels, shopperReturns: p.shopperReturns })

  app.get('/settings', readable, async (c) => one(c, ruleOut(await returns.policy(own(c)))))
  app.put('/settings', requirePermission('settings:update'), async (c) => {
    const body = ruleSchema.safeParse(await c.req.json().catch(() => null))
    if (!body.success) return bad(c, 'Check the return rule: the days, the percent and the amount must be numbers.', body.error)
    const b = body.data
    const saved = await returns.savePolicy(own(c), { windowDays: b.windowDays, restockingFeeBps: Math.round(b.restockingFeePercent * 100), returnShippingFeeCents: b.returnShippingFeeCents, labels: b.labels, shopperReturns: b.shopperReturns })
    await d.audit.log({
      action: 'update', entity: 'settings', entityName: 'Return rule', companyId: own(c), req: c,
      metadata: { description: `Return rule: ${saved.windowDays} days, restocking ${saved.restockingFeeBps / 100}%, return postage ${saved.returnShippingFeeCents / 100}, labels ${saved.labels ? 'on' : 'off'}, shoppers ${saved.shopperReturns ? 'may' : 'may not'} start returns` },
    })
    return one(c, ruleOut(saved))
  })

  app.get('/', readable, async (c) => {
    const rows = await returns.list(own(c), { status: c.req.query('status') || undefined, orderId: c.req.query('order') || undefined })
    return listAll(c, await Promise.all(rows.map((r) => returns.detail(own(c), r))))
  })

  /** What can be returned from an order (the units left, the window, the rule) — the Start a return dialog asks. */
  app.get('/options/:orderId', readable, async (c) => {
    const order = await refunds.orderOf(c.req.param('orderId'), own(c))
    if (!order) return fail(c, 404, 'Not found')
    const pol = await returns.policy(own(c))
    const can = await returns.returnable(order, await refunds.itemsOf(order.id), pol)
    return one(c, { ...can, rule: ruleOut(pol) })
  })

  app.post('/', decides, async (c) => {
    const body = startSchema.safeParse(await c.req.json().catch(() => null))
    if (!body.success) return bad(c, 'Choose the order, the items and why they are coming back.', body.error)
    const order = await refunds.orderOf(body.data.orderId, own(c))
    if (!order) return fail(c, 404, 'Not found')
    const by = await refunds.whoIs(c)
    const made = await returns.start({
      companyId: own(c), order, lines: body.data.items, reason: body.data.reason, note: body.data.note, wanted: body.data.wanted, resolution: body.data.resolution,
      preferCredit: body.data.preferCredit, startedBy: 'staff', byName: by.name, allowLate: body.data.allowLate,
    }, c)
    return made.ok ? one(c, await returns.detail(own(c), made.ret), 201) : refuse(c, made)
  })

  app.get('/:id', readable, async (c) => {
    const ret = await returns.reconcile(own(c), null, c.req.param('id'))
    return ret ? one(c, await returns.detail(own(c), ret)) : fail(c, 404, 'Not found')
  })

  app.post('/:id/approve', decides, async (c) => {
    const body = z.object({ waiveFees: z.boolean().default(false), staffNote: z.string().max(1000).nullish() }).safeParse(await c.req.json().catch(() => ({})))
    if (!body.success) return bad(c, 'Check the form.', body.error)
    const r = await returns.approve(own(c), c.req.param('id'), body.data, await refunds.whoIs(c), c)
    return r.ok ? one(c, { ...(await returns.detail(own(c), r.ret)), labelProblem: r.label }) : refuse(c, r)
  })
  app.post('/:id/decline', decides, async (c) => {
    const body = z.object({ reason: z.string().min(1).max(500) }).safeParse(await c.req.json().catch(() => null))
    if (!body.success) return bad(c, 'Say why, so the customer is told.', body.error)
    const r = await returns.decline(own(c), c.req.param('id'), body.data.reason, await refunds.whoIs(c), c)
    return r.ok ? one(c, await returns.detail(own(c), r.ret)) : refuse(c, r)
  })
  app.post('/:id/cancel', decides, async (c) => {
    const r = await returns.cancel(own(c), c.req.param('id'), await refunds.whoIs(c), c)
    return r.ok ? one(c, await returns.detail(own(c), r.ret)) : refuse(c, r)
  })
  app.post('/:id/label', decides, async (c) => {
    const r = await returns.buyLabel(own(c), c.req.param('id'))
    if (!r.ok) return refuse(c, r)
    const ret = await returns.returnOf(c.req.param('id'), own(c))
    return one(c, await returns.detail(own(c), ret!))
  })
  app.post('/:id/receive', decides, async (c) => {
    const body = z.object({ restock: z.boolean().default(true), staffNote: z.string().max(1000).nullish() }).safeParse(await c.req.json().catch(() => ({})))
    if (!body.success) return bad(c, 'Check the form.', body.error)
    const r = await returns.receive(own(c), c.req.param('id'), body.data, await refunds.whoIs(c), c)
    return r.ok ? one(c, { ...(await returns.detail(own(c), r.ret)), restocked: r.restocked }) : refuse(c, r)
  })
  app.post('/:id/refund', decides, async (c) => {
    const body = z.object({ amountCents: z.number().int().min(0).optional(), creditCents: z.number().int().min(0).optional() }).safeParse(await c.req.json().catch(() => ({})))
    if (!body.success) return bad(c, 'Enter the amounts as whole cents.', body.error)
    const r = await returns.refund(own(c), c.req.param('id'), body.data, await refunds.whoIs(c), c)
    return r.ok ? one(c, { ...(await returns.detail(own(c), r.ret)), pending: r.pending }) : refuse(c, r)
  })
  app.post('/:id/exchange', decides, async (c) => {
    const body = z.object({ items: z.array(z.object({ sku: z.string().min(1), quantity: z.number().int().min(1) })).min(1).max(50), creditCents: z.number().int().min(0).optional() }).safeParse(await c.req.json().catch(() => null))
    if (!body.success) return bad(c, 'Choose what to send instead, and how many.', body.error)
    const r = await returns.exchange(own(c), c.req.param('id'), body.data, await refunds.whoIs(c), c)
    return r.ok ? one(c, { ...(await returns.detail(own(c), r.ret)), exchangeOrderNumber: r.order.orderNumber, differencePending: r.pending }) : refuse(c, r)
  })

  return app
}
