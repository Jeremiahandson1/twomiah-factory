// /api/platform-support — "Contact Twomiah": the tenant's line to its software vendor. Moved from
// templates/crm/backend/src/routes/platformSupport.ts. (This business's own help desk is /api/support.)
//
// Proxied server-to-server so the browser never holds a tenant id or a factory key; the Factory knows this tenant by
// its sync key, so a ticket cannot be filed in another tenant's name.
import { Hono } from 'hono'
import type { AppEnv } from '../../http/env.ts'
import { fail, one } from '../../http/reply.ts'
import type { CrmDeps } from '../deps.ts'

function factoryConfig() {
  const url = (process.env.FACTORY_URL || '').replace(/\/+$/, '')
  const tenantId = process.env.TENANT_ID || ''
  const key = process.env.FACTORY_SYNC_KEY || ''
  if (!url || !tenantId || !key) return null
  return { endpoint: url + '/api/v1/factory/customers/' + tenantId + '/support-tickets', statusUrl: url + '/status', key }
}

export function createPlatformSupportRoutes(_d: CrmDeps) {
  const app = new Hono<AppEnv>()

  // This tenant's tickets with Twomiah. Not connected (or the Factory unreachable) is not a failure the customer
  // should see: `unavailable` tells the screen to show where to email instead, and `statusUrl` links the status page.
  app.get('/tickets', async (c) => {
    const cfg = factoryConfig()
    if (!cfg) return one(c, { data: [], unavailable: true, statusUrl: null })
    try {
      const res = await fetch(cfg.endpoint, { headers: { 'X-Factory-Key': cfg.key }, signal: AbortSignal.timeout(20000) })
      if (!res.ok) return one(c, { data: [], unavailable: true })
      const body: any = await res.json()
      return one(c, { data: Array.isArray(body?.data) ? body.data : [], statusUrl: cfg.statusUrl })
    } catch {
      return one(c, { data: [], unavailable: true })
    }
  })

  app.post('/tickets', async (c) => {
    const cfg = factoryConfig()
    if (!cfg) return fail(c, 503, 'Support messaging is not connected for this account yet')

    const user: any = c.get('user')
    const body = (await c.req.json().catch(() => ({}))) as any
    const subject = typeof body?.subject === 'string' ? body.subject.trim() : ''
    if (!subject) return fail(c, 400, 'Tell us what is going on')

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
      const created: any = await res.json().catch(() => null)
      if (!res.ok) return fail(c, 502, created?.error || 'Could not send that to Twomiah support')
      return one(c, created && typeof created === 'object' ? created : {}, 201)
    } catch (err: any) {
      return fail(c, 502, err?.message || 'Could not reach Twomiah support')
    }
  })

  return app
}
