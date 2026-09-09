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

// Lender submission — provider-agnostic. NO real credit rail is connected, and we
// must NOT fabricate an approval/APR (a fake "Approved 7.99% via Octane" is a
// liability). Until routeOneProvider / dealerTrackProvider is wired, submit records
// the attempt and returns an honest not-submitted result. The deal-jacket workflow
// is unchanged — only the fake decision is removed.
interface LenderProvider { name: string; live: boolean; submit(app: any): Promise<any> }
const notConfiguredLender: LenderProvider = {
  name: 'not_configured', live: false,
  async submit(_a) {
    return {
      decision: 'not_submitted',
      lender: null,
      reason: 'Lender integration not connected. Connect RouteOne or DealerTrack to submit credit applications.',
      stipulations: [],
    }
  },
}
// ↓ swap when the credit-app integration is live:
//   const lender = routeOneProvider   // RouteOne On-Demand
//   const lender = dealerTrackProvider // DealerTrack credit
const lender: LenderProvider = notConfiguredLender

app.post('/submit', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  if (!body?.applicant?.name) return c.json({ error: 'Applicant name is required.' }, 400)
  let result: any
  try { result = await lender.submit(body) } catch (e: any) { return c.json({ error: 'Credit-app submit failed: ' + (e?.message || e) }, 502) }
  return c.json({ result, provider: lender.name, live: lender.live, submittedAt: new Date().toISOString() })
})

export default app
