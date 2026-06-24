import { Hono } from 'hono'
import { authenticate } from '../middleware/auth.ts'

// ── Rentals ─────────────────────────────────────────────────────────────────
// Reservations, contracts, fleet utilization. Pure-build module (own data) — many
// powersports/marine dealers run a rental fleet alongside sales.
const app = new Hono()
app.use('*', authenticate)

const RES: any[] = [
  { id: 'r1', unit: '2023 Polaris RANGER XP 1000', customer: 'Mike Anderson', start: '2026-06-20', end: '2026-06-23', rate: 189, days: 3, status: 'out' },
  { id: 'r2', unit: '2024 Sea-Doo GTI 130', customer: 'Sarah Lopez', start: '2026-06-25', end: '2026-06-27', rate: 249, days: 2, status: 'reserved' },
  { id: 'r3', unit: '2022 Bennington 22 SSBX', customer: 'Tom Reilly', start: '2026-06-18', end: '2026-06-19', rate: 399, days: 1, status: 'returned' },
]
let seq = 100

const summary = () => ({
  active: RES.filter((r) => r.status === 'out').length,
  reserved: RES.filter((r) => r.status === 'reserved').length,
  revenue: RES.reduce((s, r) => s + r.rate * r.days, 0),
})

app.get('/list', (c) => c.json({ rentals: RES, summary: summary() }))

app.post('/create', async (c) => {
  const b = await c.req.json().catch(() => ({}))
  if (!b.unit || !b.customer) return c.json({ error: 'Unit and customer are required.' }, 400)
  const days = Math.max(1, Number(b.days) || 1)
  const r = { id: 'r' + (++seq), unit: b.unit, customer: b.customer, start: b.start || '', end: b.end || '', rate: Number(b.rate) || 0, days, status: 'reserved' }
  RES.unshift(r)
  return c.json({ rental: r, summary: summary() })
})

export default app
