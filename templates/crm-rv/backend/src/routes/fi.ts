import { Hono } from 'hono'
import { authenticate } from '../middleware/auth.ts'

// ── F&I (Finance & Insurance) ───────────────────────────────────────────────
// Two pieces a DMS needs: (1) the F&I product MENU (menu selling), and (2) LENDER
// SUBMISSION. The lender submission is provider-agnostic — mock today so the whole
// deal-jacket workflow is built + demoable, and when the credit-app integration
// closes you implement routeOneProvider / dealerTrackProvider and point `lender`
// at it. The UI and workflow don't change.
const app = new Hono()
app.use('*', authenticate)

// F&I product menu (dealer-configurable later; static for now)
const PRODUCTS = [
  { id: 'vsc', name: 'Vehicle Service Contract', desc: 'Extended mechanical coverage', price: 1895, cost: 1100 },
  { id: 'gap', name: 'GAP Coverage', desc: 'Covers the loan gap if the unit is totaled', price: 695, cost: 350 },
  { id: 'tw', name: 'Tire & Wheel Protection', desc: 'Road-hazard repair / replace', price: 499, cost: 220 },
  { id: 'ppm', name: 'Prepaid Maintenance', desc: 'Scheduled service plan', price: 599, cost: 300 },
  { id: 'app', name: 'Appearance Protection', desc: 'Paint / upholstery / corrosion', price: 449, cost: 180 },
]
app.get('/products', (c) => c.json({ products: PRODUCTS }))

// Lender submission — provider-agnostic. Mock now; swap to RouteOne / DealerTrack.
interface LenderProvider { name: string; live: boolean; submit(app: any): Promise<any> }
const mockLender: LenderProvider = {
  name: 'mock', live: false,
  async submit(a) {
    const amt = Number(a.amountFinanced) || 0
    const strong = amt < 45000
    const ok = amt < 85000
    if (!ok) return { decision: 'declined', lender: 'RouteOne network', reason: 'Amount exceeds program limits for this profile', stipulations: [] }
    return {
      decision: strong ? 'approved' : 'conditional',
      lender: strong ? 'Octane (via RouteOne)' : 'Synchrony (via RouteOne)',
      apr: strong ? 7.99 : 12.49,
      termMonths: strong ? 60 : 48,
      approvedAmount: strong ? amt : Math.round(amt * 0.9),
      stipulations: strong ? ['Proof of income', 'Proof of insurance'] : ['Larger down payment', 'Proof of income', 'Proof of residence'],
    }
  },
}
// ↓ swap when the credit-app integration is live:
//   const lender = routeOneProvider   // RouteOne On-Demand
//   const lender = dealerTrackProvider // DealerTrack credit
const lender: LenderProvider = mockLender

app.post('/submit', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  if (!body?.applicant?.name) return c.json({ error: 'Applicant name is required.' }, 400)
  let result: any
  try { result = await lender.submit(body) } catch (e: any) { return c.json({ error: 'Credit-app submit failed: ' + (e?.message || e) }, 502) }
  return c.json({ result, provider: lender.name, live: lender.live, submittedAt: new Date().toISOString() })
})

export default app
