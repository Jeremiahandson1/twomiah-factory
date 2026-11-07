// /api/card-payments — the card surcharge setting and the payments view (roofing parity row 18; Roofr's surcharge and funding
// dashboard, Leap's reporting). data/cardSurcharge.ts has the state rules; the charge runs through tenant-backend payments/stripe.ts.
//
//   GET /surcharge     the setting, the business's state and what it allows        invoices:read   (card_surcharge)
//   PUT /surcharge     { on, pct, actualFeePct, noticeGiven }                         company:update  (card_surcharge)
//   GET /payouts       what is on its way and the recent payouts, from the business's own Stripe account
//                                                                                    invoices:read   (payments_overview)
import { Hono } from 'hono'
import type { CrmDeps } from '../deps.ts'
import type { AppEnv } from '../../http/env.ts'
import { fail, one } from '../../http/reply.ts'
import { SURCHARGE_FEATURE, getSurcharge, saveSurcharge, surchargeProblem, type SurchargeSetting } from '../../data/cardSurcharge.ts'

export const PAYMENTS_OVERVIEW = 'payments_overview'

export function createCardPaymentRoutes(d: CrmDeps) {
  const { db, audit } = d
  const { requirePermission } = d.permissions
  const app = new Hono<AppEnv>()
  const on = (c: any, f: string) => d.features.isFeatureEnabled(c.get('user').companyId, f).catch(() => false)

  app.get('/surcharge', requirePermission('invoices:read'), async (c) => {
    if (!(await on(c, SURCHARGE_FEATURE))) return fail(c, 404, 'Not found')
    return one(c, await getSurcharge(db, c.get('user').companyId))
  })

  app.put('/surcharge', requirePermission('company:update'), async (c) => {
    if (!(await on(c, SURCHARGE_FEATURE))) return fail(c, 404, 'Not found')
    const u = c.get('user')
    const b: any = await c.req.json().catch(() => ({}))
    const { setting: had, rule } = await getSurcharge(db, u.companyId)
    const num = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v))
    const pct = num(b?.pct), actual = num(b?.actualFeePct)
    if (pct !== null && !Number.isFinite(pct)) return fail(c, 400, 'Enter the surcharge as a percent, like 2.5.', undefined, { pct: 'A percent' })
    if (actual !== null && !(Number.isFinite(actual) && actual >= 0 && actual <= 10)) return fail(c, 400, 'Enter your card rate as a percent, like 2.9.', undefined, { actualFeePct: 'A percent' })
    const next: SurchargeSetting = {
      on: b?.on === true,
      pct: pct === null ? had.pct : Math.round(pct * 100) / 100,
      actualFeePct: b?.actualFeePct === undefined ? had.actualFeePct : actual,
      // Visa's rule: the processor and the brands are told 30 days ahead. The owner confirms it; we keep when.
      noticeGivenAt: b?.noticeGiven === true ? (had.noticeGivenAt || new Date().toISOString()) : b?.noticeGiven === false ? null : had.noticeGivenAt,
    }
    const problem = surchargeProblem(next, rule)
    if (problem) return fail(c, 400, problem.problem, undefined, { [problem.field]: problem.problem })
    const out = await saveSurcharge(db, u.companyId, next)
    audit.log({ action: audit.ACTIONS.UPDATE, entity: 'company', entityId: u.companyId, metadata: { cardSurcharge: { before: had, after: next } }, req: c })
    return one(c, out)
  })

  app.get('/payouts', requirePermission('invoices:read'), async (c) => {
    if (!(await on(c, PAYMENTS_OVERVIEW))) return fail(c, 404, 'Not found')
    try {
      const out = await (d.services as any).stripeService.payoutsFor(c.get('user').companyId)
      if (!out) return fail(c, 409, 'Connect your Stripe account first (Settings › Online payments).', 'NOT_CONNECTED')
      return one(c, out)
    } catch (err: any) {
      return fail(c, 502, `Stripe did not answer: ${String(err?.message || 'try again shortly')}`)
    }
  })

  return app
}
