import { Hono } from 'hono'
import { authenticate } from '../middleware/auth.ts'

// ── Title & Registration ────────────────────────────────────────────────────
// Provider-agnostic DMV title/registration. Mock today (workflow built + demoable);
// swap to vituProvider (Vitu National API, 50-state) when the integration closes —
// UI/workflow unchanged. You never build 50 state DMVs; you integrate one rail.
const app = new Hono()
app.use('*', authenticate)

interface TitleProvider { name: string; live: boolean; submit(deal: any): Promise<any> }
let seq = 7700
const mockProvider: TitleProvider = {
  name: 'mock', live: false,
  async submit(d) {
    const state = String(d.state || 'WI').toUpperCase()
    const fees = { title: 164.5, registration: 85, plate: 30 }
    return {
      refNumber: 'TR-' + (++seq), state, status: 'submitted',
      fees: { ...fees, total: fees.title + fees.registration + fees.plate },
      checklist: ['Signed title / MSO', 'Bill of sale', 'Proof of insurance', 'Odometer / HIN disclosure', 'Buyer ID'],
      eta: '5–10 business days',
      submittedAt: new Date().toISOString(),
    }
  },
}
// ↓ swap when live: const provider = vituProvider
const provider: TitleProvider = mockProvider

const SUBMISSIONS: any[] = []
app.post('/submit', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  if (!body?.buyer?.name) return c.json({ error: 'Buyer name is required.' }, 400)
  let result: any
  try { result = await provider.submit(body) } catch (e: any) { return c.json({ error: 'DMV submit failed: ' + (e?.message || e) }, 502) }
  SUBMISSIONS.unshift(result)
  return c.json({ result, provider: provider.name, live: provider.live })
})
app.get('/list', (c) => c.json({ submissions: SUBMISSIONS.slice(0, 50) }))

export default app
