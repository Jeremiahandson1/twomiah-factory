// What happened in the store, told to the outside (store_webhooks, parity row 8). The store's own code says WHAT happened with ids —
// `core.events.order(companyId, 'order.paid', orderId)` — and this loads the shapes the outside sees (payloads.ts) and queues them
// for every address that wants them (webhooks.ts). Every call is safe to make anywhere: it never throws, never waits on the
// receiver, and does nothing when the feature is off, no address wants the event, or no hub was built (a unit test's bare core).
import type { CrmDeps } from '../../deps.ts'
import { loadOrderView, loadProductView, loadStockViews } from './payloads.ts'
import { createStoreWebhooks, type StoreEvent, type StoreWebhooks } from './webhooks.ts'

export interface StoreEventHub {
  webhooks: StoreWebhooks
  order(companyId: string, event: 'order.created' | 'order.paid' | 'order.fulfilled' | 'order.refunded', orderId: string): Promise<void>
  product(companyId: string, productId: string, opts?: { deleted?: boolean }): Promise<void>
  /** The options' counts as they stand now (read after the write), one event each. */
  stock(companyId: string, variantIds: Array<string | null | undefined>): Promise<void>
}

export function createStoreEvents(d: Pick<CrmDeps, 'db' | 'logger' | 'features'>, over: Partial<Parameters<typeof createStoreWebhooks>[0]> = {}): StoreEventHub {
  const { db } = d
  const webhooks = createStoreWebhooks({ db, logger: d.logger, isEnabled: (companyId) => d.features.isFeatureEnabled(companyId, 'store_webhooks').catch(() => false), ...over })
  return {
    webhooks,
    order: (companyId, event, orderId) => webhooks.emit(companyId, event, async () => {
      const o = await loadOrderView(db, companyId, orderId)
      return o ? { order: o } : null
    }),
    product: (companyId, productId, opts = {}) => webhooks.emit(companyId, 'product.changed', async () => {
      if (opts.deleted) return { deleted: true, product: { id: productId } }
      const p = await loadProductView(db, companyId, productId)
      return p ? { deleted: false, product: p } : null
    }),
    stock: async (companyId, variantIds) => {
      const ids = [...new Set(variantIds.filter((v): v is string => !!v))]
      if (!ids.length) return
      // One read for all of them, one event each: a receiver keeping a count wants one line per option.
      let views: Awaited<ReturnType<typeof loadStockViews>> = []
      let loaded = false
      const load = async () => { if (!loaded) { views = await loadStockViews(db, companyId, ids); loaded = true } return views }
      for (const id of ids) {
        await webhooks.emit(companyId, 'stock.changed', async () => {
          const v = (await load()).find((x: any) => x.variantId === id)
          return v ? { stock: v } : null
        })
      }
    },
  }
}

/** The hub built for each app (keyed by its CRM services, as the store core is), so the core can find it without being handed it. */
const hubs = new WeakMap<object, StoreEventHub>()
export const registerStoreEvents = (services: object, hub: StoreEventHub) => { hubs.set(services, hub) }
export const storeEventsFor = (services: object): StoreEventHub | null => hubs.get(services) ?? null

/** The hub's calls, found at call time and silent without one — what the core hands to the code that makes things happen. */
export function lazyEvents(services: object) {
  const run = (f: (h: StoreEventHub) => Promise<void>): Promise<void> => { const h = storeEventsFor(services); return h ? f(h).catch(() => {}) : Promise.resolve() }
  return {
    order: (companyId: string, event: Parameters<StoreEventHub['order']>[1], orderId: string) => run((h) => h.order(companyId, event, orderId)),
    product: (companyId: string, productId: string, opts?: { deleted?: boolean }) => run((h) => h.product(companyId, productId, opts)),
    stock: (companyId: string, variantIds: Array<string | null | undefined>) => run((h) => h.stock(companyId, variantIds)),
  }
}
export type { StoreEvent }
