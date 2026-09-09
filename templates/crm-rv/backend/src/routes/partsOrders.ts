import { Hono } from 'hono'
import { authenticate } from '../middleware/auth.ts'

// ── Parts Ordering ──────────────────────────────────────────────────────────
// Provider-agnostic ordering rail. Mock today (so the order workflow is built +
// demoable); swap to partsTechProvider / dealerSpikeProvider / OEM-direct when the
// ordering integration closes — the UI and workflow don't change. Same pattern as
// the catalog: own the ordering UX, the supplier rail is swappable.
const app = new Hono()
app.use('*', authenticate)

interface OrderProvider { name: string; live: boolean; place(items: any[]): Promise<any> }
// No supplier ordering rail is connected, so we do NOT fabricate a "submitted" order
// (fake PO number / "PartsTech network" / ETA). Return an honest not_submitted result;
// swap in partsTechProvider / dealerSpikeProvider when the integration closes.
const notConfiguredProvider: OrderProvider = {
  name: 'not_configured', live: false,
  async place(items) {
    const total = items.reduce((s, i) => s + (Number(i.price) || 0) * (Number(i.qty) || 1), 0)
    return {
      status: 'not_submitted', poNumber: null, supplier: null, total, items,
      reason: 'Parts ordering is not connected. Connect a supplier rail (PartsTech / DealerSpike / OEM-direct) to place orders.',
    }
  },
}
const provider: OrderProvider = notConfiguredProvider

const ORDERS: any[] = []

app.post('/create', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const items = Array.isArray(body.items) ? body.items : (body.item ? [body.item] : [])
  if (!items.length) return c.json({ error: 'No items to order.' }, 400)
  let order: any
  try { order = await provider.place(items) } catch (e: any) { return c.json({ error: 'Order failed: ' + (e?.message || e) }, 502) }
  ORDERS.unshift(order)
  return c.json({ order, provider: provider.name, live: provider.live })
})

app.get('/list', (c) => c.json({ orders: ORDERS.slice(0, 50), provider: provider.name, live: provider.live }))

export default app
