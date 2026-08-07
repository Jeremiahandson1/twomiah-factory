// Contact Twomiah — the tenant's line to their software vendor.
//
// Distinct from routes/support.ts, which is this business's OWN helpdesk for
// THEIR customers. This one goes to the factory.
//
// Proxied server-to-server so the browser never holds a tenant id or a factory
// key; the factory authenticates us by the sync key, so a ticket cannot be
// filed in another tenant's name.
import { Hono } from 'hono'
import { authenticate } from '../middleware/auth.ts'

const app = new Hono()
app.use('*', authenticate)

function factoryConfig() {
  const url = (process.env.FACTORY_URL || '').replace(/\/+$/, '')
  const tenantId = process.env.TENANT_ID || ''
  const key = process.env.FACTORY_SYNC_KEY || ''
  if (!url || !tenantId || !key) return null
  return { endpoint: url + '/api/v1/factory/customers/' + tenantId + '/support-tickets', key }
}

app.get('/tickets', async (c) => {
  const cfg = factoryConfig()
  // Not configured is not an error the customer should see as a failure — the
  // page falls back to telling them where to email.
  if (!cfg) return c.json({ data: [], unavailable: true })
  try {
    const res = await fetch(cfg.endpoint, {
      headers: { 'X-Factory-Key': cfg.key },
      signal: AbortSignal.timeout(20000),
    })
    if (!res.ok) return c.json({ data: [], unavailable: true })
    const body = await res.json()
    return c.json({ data: Array.isArray(body?.data) ? body.data : [] })
  } catch {
    return c.json({ data: [], unavailable: true })
  }
})

app.post('/tickets', async (c) => {
  const cfg = factoryConfig()
  if (!cfg) return c.json({ error: 'Support messaging is not connected for this account yet' }, 503)

  let user: any = null
  try { user = c.get('user') } catch { /* older middleware shapes */ }

  const body = await c.req.json().catch(() => ({}))
  const subject = typeof body?.subject === 'string' ? body.subject.trim() : ''
  if (!subject) return c.json({ error: 'Tell us what is going on' }, 400)

  const name = [user?.firstName, user?.lastName].filter(Boolean).join(' ')

  try {
    const res = await fetch(cfg.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Factory-Key': cfg.key },
      body: JSON.stringify({
        subject,
        description: typeof body?.description === 'string' ? body.description : undefined,
        priority: body?.priority,
        category: 'in_app',
        submitter_email: user?.email || undefined,
        submitter_name: name || undefined,
      }),
      signal: AbortSignal.timeout(20000),
    })
    const created = await res.json().catch(() => null)
    if (!res.ok) return c.json({ error: created?.error || 'Could not send that to Twomiah support' }, 502)
    return c.json(created, 201)
  } catch (err: any) {
    return c.json({ error: err?.message || 'Could not reach Twomiah support' }, 502)
  }
})

export default app
