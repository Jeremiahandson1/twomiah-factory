import { Hono } from 'hono'
import { authenticate } from '../middleware/auth.ts'
import { findCatalogPart } from './oemParts.ts'

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

// An order is priced by the server from the catalog, never from the browser: each item names a catalog part (and a
// whole-number quantity 1–999); its name and price come from the dealer's catalog. (RV T19 L3: $0.01 and
// -$5 × -2 = $10 were accepted as sent)
app.post('/create', async (c) => {
  const user = c.get('user') as any
  const body = await c.req.json().catch(() => ({}))
  const requested = Array.isArray(body.items) ? body.items : (body.item ? [body.item] : [])
  if (!requested.length) return c.json({ error: 'No items to order.' }, 400)
  if (requested.length > 100) return c.json({ error: 'An order can have at most 100 lines.' }, 400)
  const items: any[] = []
  for (const it of requested) {
    const partNumber = typeof it?.partNumber === 'string' ? it.partNumber.trim() : ''
    if (!partNumber) return c.json({ error: 'Each item needs a part number.' }, 400)
    const qty = it?.qty === undefined ? 1 : it.qty
    if (typeof qty !== 'number' || !Number.isInteger(qty) || qty < 1 || qty > 999) return c.json({ error: `Quantity for ${partNumber} must be a whole number from 1 to 999.` }, 400)
    const part = await findCatalogPart(user.companyId, partNumber, typeof it?.oem === 'string' && it.oem ? it.oem : undefined)
    if (!part) return c.json({ error: `Part ${partNumber} is not in your parts catalog.` }, 400)
    items.push({ partNumber: part.partNumber, oem: part.oem, name: part.name, price: part.price, qty })
  }
  let order: any
  try { order = await provider.place(items) } catch (e: any) { return c.json({ error: 'Order failed: ' + (e?.message || e) }, 502) }
  ORDERS.unshift({ ...order, companyId: user.companyId })
  return c.json({ order, provider: provider.name, live: provider.live })
})

app.get('/list', (c) => {
  const user = c.get('user') as any
  return c.json({ orders: ORDERS.filter((o) => o.companyId === user.companyId).slice(0, 50), provider: provider.name, live: provider.live })
})

export default app
