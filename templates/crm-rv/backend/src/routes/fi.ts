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

// A credit application must make sense before it goes to a lender: an amount financed above $0, a term the F&I page
// offers, and only products from the menu. (RV T19 L2: -$5, a 0-month term and product "banana" were accepted)
const TERMS = [24, 36, 48, 60, 72, 84, 120, 144, 180, 240]
app.post('/submit', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  if (!body?.applicant?.name) return c.json({ error: 'Applicant name is required.' }, 400)
  const amount = Number(body.amountFinanced)
  if (typeof body.amountFinanced !== 'number' || !Number.isFinite(amount) || amount <= 0 || amount > 10_000_000) return c.json({ error: 'Amount financed must be more than $0.' }, 400)
  if (!TERMS.includes(Number(body.term))) return c.json({ error: `Term must be one of: ${TERMS.join(', ')} months.` }, 400)
  const products = body.products === undefined ? [] : body.products
  if (!Array.isArray(products) || products.some((p: unknown) => typeof p !== 'string' || !PRODUCTS.some((x) => x.id === p))) return c.json({ error: `Products must be from the F&I menu: ${PRODUCTS.map((p) => p.id).join(', ')}.` }, 400)
  let result: any
  try { result = await lender.submit(body) } catch (e: any) { return c.json({ error: 'Credit-app submit failed: ' + (e?.message || e) }, 502) }
  return c.json({ result, provider: lender.name, live: lender.live, submittedAt: new Date().toISOString() })
})

export default app
