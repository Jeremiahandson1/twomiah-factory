import { Hono } from 'hono'
import { authenticate } from '../middleware/auth.ts'

// ── Title & Registration ────────────────────────────────────────────────────
// Provider-agnostic DMV title/registration. Mock today (workflow built + demoable);
// swap to vituProvider (Vitu National API, 50-state) when the integration closes —
// UI/workflow unchanged. You never build 50 state DMVs; you integrate one rail.
const app = new Hono()
app.use('*', authenticate)

interface TitleProvider { name: string; live: boolean; submit(deal: any): Promise<any> }
// No DMV title/registration rail is connected, so we do NOT fabricate a "submitted"
// filing (fake ref number / made-up fees / ETA). Return honest not_submitted with the
// real required-document checklist; swap in vituProvider (Vitu National, 50-state) when live.
const notConfiguredProvider: TitleProvider = {
  name: 'not_configured', live: false,
  async submit(d) {
    const state = String(d.state || 'WI').toUpperCase()
    return {
      status: 'not_submitted', refNumber: null, state,
      checklist: ['Signed title / MSO', 'Bill of sale', 'Proof of insurance', 'Odometer / HIN disclosure', 'Buyer ID'],
      reason: 'Title & registration is not connected. Connect a DMV rail (e.g. Vitu) to submit.',
    }
  },
}
const provider: TitleProvider = notConfiguredProvider

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
