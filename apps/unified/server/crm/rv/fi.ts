// F&I (finance and insurance): the product menu and lender submission. No credit rail is connected, so a submission
// says so honestly — never a made-up approval. The menu's dealer cost is margin:read's (T41, T42). Moved from
// templates/crm-rv/backend/src/routes/fi.ts.
import { Hono } from 'hono'
import type { AppEnv } from '../../http/env.ts'
import { fail, one } from '../../http/reply.ts'
import type { CrmDeps } from '../deps.ts'

// The F&I product menu (static for now; dealer-configurable later).
const PRODUCTS = [
  { id: 'vsc', name: 'Vehicle Service Contract', desc: 'Extended mechanical coverage', price: 1895, cost: 1100 },
  { id: 'gap', name: 'GAP Coverage', desc: 'Covers the loan gap if the unit is totaled', price: 695, cost: 350 },
  { id: 'tw', name: 'Tire & Wheel Protection', desc: 'Road-hazard repair / replace', price: 499, cost: 220 },
  { id: 'ppm', name: 'Prepaid Maintenance', desc: 'Scheduled service plan', price: 599, cost: 300 },
  { id: 'app', name: 'Appearance Protection', desc: 'Paint / upholstery / corrosion', price: 449, cost: 180 },
]

interface LenderProvider { name: string; live: boolean; submit(app: any): Promise<any> }
// Until RouteOne / DealerTrack is wired, a submission records the attempt and returns an honest not-submitted result.
const notConfiguredLender: LenderProvider = {
  name: 'not_configured', live: false,
  async submit() {
    return {
      decision: 'not_submitted',
      lender: null,
      reason: 'Lender integration not connected. Connect RouteOne or DealerTrack to submit credit applications.',
      stipulations: [],
    }
  },
}
const lender: LenderProvider = notConfiguredLender

// A credit application must make sense before it goes to a lender (RV T19 L2).
const TERMS = [24, 36, 48, 60, 72, 84, 120, 144, 180, 240]

export function createFiRoutes(d: CrmDeps) {
  const { requirePermission, hasPermission, getExtraPermissions } = d.permissions
  const app = new Hono<AppEnv>()

  // GET /products — the menu goes to every seat (menu selling is the job); the dealer cost only to margin:read.
  // No permission was asked here in the template beyond signing in.
  app.get('/products', async (c) => {
    const u = c.get('user')
    const maySeeCost = hasPermission(u?.role, 'margin:read', await getExtraPermissions(u?.userId))
    if (maySeeCost) return one(c, { products: PRODUCTS })
    return one(c, { products: PRODUCTS.map(({ cost: _cost, ...rest }) => rest) })
  })

  app.post('/submit', requirePermission('financing:create'), async (c) => {
    const body = await c.req.json().catch(() => ({} as any))
    if (!body?.applicant?.name) return fail(c, 400, 'Applicant name is required.')
    const amount = Number(body.amountFinanced)
    if (typeof body.amountFinanced !== 'number' || !Number.isFinite(amount) || amount <= 0 || amount > 10_000_000) return fail(c, 400, 'Amount financed must be more than $0.')
    if (!TERMS.includes(Number(body.term))) return fail(c, 400, `Term must be one of: ${TERMS.join(', ')} months.`)
    const products = body.products === undefined ? [] : body.products
    if (!Array.isArray(products) || products.some((p: unknown) => typeof p !== 'string' || !PRODUCTS.some((x) => x.id === p))) return fail(c, 400, `Products must be from the F&I menu: ${PRODUCTS.map((p) => p.id).join(', ')}.`)
    let result: any
    try { result = await lender.submit(body) } catch (e: any) { return fail(c, 502, 'Credit-app submit failed: ' + (e?.message || e)) }
    return one(c, { result, provider: lender.name, live: lender.live, submittedAt: new Date().toISOString() })
  })

  return app
}
