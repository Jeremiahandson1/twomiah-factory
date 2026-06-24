import { Hono } from 'hono'
import { authenticate } from '../middleware/auth.ts'

// ── Accounting sync ─────────────────────────────────────────────────────────
// Post deals / invoices to the GL. Provider-agnostic: QuickBooks Online stub today
// (the bridge — connected:false until OAuth), native GL later. Same swappable-rail
// pattern. connected=false surfaces the "Connect" CTA.
const app = new Hono()
app.use('*', authenticate)

interface AcctProvider { name: string; connected: boolean; post(entries: any[]): Promise<any> }
let seq = 9000
const qboStub: AcctProvider = {
  name: 'QuickBooks Online', connected: false,
  async post(entries) { return { batch: 'SYNC-' + (++seq), posted: entries.length, total: entries.reduce((s, e) => s + (Number(e.amount) || 0), 0), provider: 'QuickBooks Online' } },
}
// ↓ swap when live: live QuickBooks OAuth provider, or nativeGlProvider
const provider: AcctProvider = qboStub

const PENDING: any[] = [
  { id: 'e1', type: 'Vehicle sale', ref: 'DEAL-2041', customer: 'Mike Anderson', amount: 28950, date: '2026-06-22', posted: false },
  { id: 'e2', type: 'F&I products', ref: 'DEAL-2041', customer: 'Mike Anderson', amount: 2590, date: '2026-06-22', posted: false },
  { id: 'e3', type: 'Service invoice', ref: 'INV-7782', customer: 'Sarah Lopez', amount: 642, date: '2026-06-23', posted: false },
  { id: 'e4', type: 'Parts invoice', ref: 'INV-7783', customer: 'Tom Reilly', amount: 189, date: '2026-06-23', posted: false },
]

app.get('/status', (c) => c.json({
  provider: provider.name, connected: provider.connected,
  pending: PENDING.filter((e) => !e.posted), postedCount: PENDING.filter((e) => e.posted).length,
}))

app.post('/sync', async (c) => {
  const pend = PENDING.filter((e) => !e.posted)
  if (!pend.length) return c.json({ error: 'Nothing to sync.' }, 400)
  const result = await provider.post(pend)
  pend.forEach((e) => { e.posted = true })
  return c.json({ result, provider: provider.name, connected: provider.connected })
})

export default app
