// Status page routes (item 17).
//
// One public read that anyone can hit without an account — including a
// customer whose own CRM is the thing that is down — and staff-only incident
// management behind the usual role check.

import { supabase, requireRole } from '../../middleware/auth'
import { buildStatus } from '../../services/statusPage'
import { type FactoryApp, parseJsonBody, UUID_RE, rateLimit } from './shared'

const VALID_COMPONENTS = ['api', 'database', 'tenants', 'provisioning', 'email', 'payments', 'other']
const VALID_IMPACTS = ['degraded', 'down', 'maintenance']

export function registerStatusRoutes(factory: FactoryApp) {

// Public: the status payload behind the page. Rate limited because it runs
// real dependency checks and is reachable by anyone.
factory.get('/public/status', rateLimit(60_000, 60), async (c) => {
  const status = await buildStatus()
  // Never let a CDN or browser serve a stale "all green" during an outage.
  c.header('Cache-Control', 'no-store')
  return c.json(status)
})

// ─── Staff incident management ──────────────────────────────────────────────

factory.get('/status/incidents', requireRole('owner', 'admin', 'editor'), async (c) => {
  const { data, error } = await supabase
    .from('status_incidents')
    .select('*')
    .order('started_at', { ascending: false })
    .limit(100)
  if (error) {
    if (/status_incidents/.test(error.message || '')) {
      return c.json({ data: [], error: 'status_incidents table missing — run apps/api/migrations/2026-08-07_status_incidents.sql' })
    }
    return c.json({ error: error.message }, 500)
  }
  return c.json({ data: data || [] })
})

factory.post('/status/incidents', requireRole('owner', 'admin'), async (c) => {
  const parsed = await parseJsonBody(c)
  if (parsed.error) return parsed.error
  const body = parsed.data

  const title = typeof body?.title === 'string' ? body.title.trim() : ''
  if (!title) return c.json({ error: 'A title is required' }, 400)

  const component = VALID_COMPONENTS.includes(body?.component) ? body.component : 'other'
  const impact = VALID_IMPACTS.includes(body?.impact) ? body.impact : 'degraded'
  const user = c.get('user') as any

  const { data, error } = await supabase.from('status_incidents').insert({
    component,
    impact,
    title: title.slice(0, 200),
    body: typeof body?.body === 'string' ? body.body.slice(0, 4000) : null,
    started_at: body?.started_at || new Date().toISOString(),
    created_by: user?.email || null,
  }).select().single()

  if (error) return c.json({ error: error.message }, 500)
  return c.json(data, 201)
})

factory.patch('/status/incidents/:id', requireRole('owner', 'admin'), async (c) => {
  const id = c.req.param('id')
  if (!UUID_RE.test(id)) return c.json({ error: 'Invalid incident ID' }, 400)

  const parsed = await parseJsonBody(c)
  if (parsed.error) return parsed.error
  const body = parsed.data

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (typeof body?.title === 'string' && body.title.trim()) updates.title = body.title.trim().slice(0, 200)
  if (typeof body?.body === 'string') updates.body = body.body.slice(0, 4000)
  if (VALID_IMPACTS.includes(body?.impact)) updates.impact = body.impact
  if (VALID_COMPONENTS.includes(body?.component)) updates.component = body.component
  // resolve / reopen
  if (body?.resolved === true) updates.resolved_at = new Date().toISOString()
  if (body?.resolved === false) updates.resolved_at = null

  const { data, error } = await supabase
    .from('status_incidents')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) return c.json({ error: error.message }, 500)
  return c.json(data)
})

}
