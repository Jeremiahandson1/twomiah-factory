// The store's orders group (docs/UNIFIED_STORE_PLAN.md step 3): the back office's orders, refunds and fulfilment
// (./orders.ts, with ./refunds.ts and ./rules.ts), the label carrier (./shipping.ts) and the dropship supplier
// (./suppliers.ts). Moved from templates/crm-store/backend/src (routes/orders.ts, routes/shipping.ts, suppliers/routes.ts).
//
// Mounts, each 'user' and ungated: the store has no feature switches (everything is core), and its menu gates none of
// these screens by feature — both sides the same. Each action keeps the template's permission.
//
// Timers (the template's index.ts and routes/orders.ts started them at import; here they are registered with
// d.services.addJob and started once at boot by services.startJobs — never in tests):
//   · resumePendingRefunds: 90 seconds after boot, then every 5 minutes (a refund interrupted between moving the order
//     and hearing from the provider is finished under the same idempotency key);
//   · core.sweepSupplierOrders: at boot, then hourly (retry un-forwarded paid orders, poll tracking for CJ);
//   · repairFulfilmentStamps: once at boot (the template ran it when routes/orders.ts loaded).
//
// createOrderHooks hands the checkout group's webhooks what they need of the orders (the lead wires it into
// ../index.ts): the status table, a refund made in the provider's own dashboard, and the provider's word on one refund.
import type { Mount } from '../../../http/registry.ts'
import type { CrmDeps } from '../../deps.ts'
import type { StoreCore } from '../core.ts'
import { createOrderRefunds } from './refunds.ts'
import { createOrderRoutes, repairFulfilmentStamps } from './orders.ts'
import { createShippingRoutes } from './shipping.ts'
import { createSupplierRoutes } from './suppliers.ts'
import { mayMove } from './rules.ts'

/** What the checkout group's webhooks need of the orders (checkout/index.ts OrderHooks, matched structurally). */
export interface OrderHooks {
  /** The template's NEXT_STATUS rule: may an order that is `from` be marked `to`? */
  mayMove(from: string, to: string): boolean
  /** A refund made in the provider's own dashboard: 'refunded' | 'partial' | 'ignored'. */
  applyProviderRefund(companyId: string, provider: string, providerPaymentId: string, refundedCents: number, chargeCents: number): Promise<string>
  /** The provider's word on one refund, by its id: 'settled' | 'released' | 'ours' | 'unknown'. */
  applyRefundUpdate(companyId: string, provider: string, refundId: string, outcome: 'completed' | 'failed', reason?: string): Promise<string>
}

export function createOrderHooks(d: CrmDeps, core: StoreCore): OrderHooks {
  const refunds = createOrderRefunds(d, core)
  return { mayMove, applyProviderRefund: refunds.applyProviderRefund, applyRefundUpdate: refunds.applyRefundUpdate }
}

export function ordersMounts(d: CrmDeps, core: StoreCore): Mount[] {
  const refunds = createOrderRefunds(d, core)
  d.services.addJob(() => {
    const resume = () => refunds.resumePendingRefunds().catch((err: any) => d.logger.error('[orders] refund resume failed', { error: err?.message }))
    setTimeout(resume, 90_000)
    setInterval(resume, 5 * 60 * 1000)
    const sweep = () => void core.sweepSupplierOrders()
    sweep()
    setInterval(sweep, 60 * 60 * 1000)
    void (async () => {
      const co = await core.shop()
      if (!co) return
      const n = await repairFulfilmentStamps(d.db, co.id)
      if (n) d.logger.info(`[orders] cleared the fulfilment stamp from ${n} order${n === 1 ? '' : 's'} that never went out`)
    })().catch((err: any) => d.logger.error('[orders] fulfilment-stamp repair failed', { error: err?.message }))
  })
  return [
    { path: '/api/admin/orders', access: 'user', router: createOrderRoutes(d, core, refunds) },
    { path: '/api/admin/shipping', access: 'user', router: createShippingRoutes(d, core) },
    { path: '/api/admin/suppliers', access: 'user', router: createSupplierRoutes(d, core) },
  ]
}
