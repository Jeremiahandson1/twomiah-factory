import { tenantBySyncKey } from '../../lib/tenantSecrets'
import { authenticate, supabase } from '../../middleware/auth'
import { type FactoryApp, checkFactoryKey } from './shared'

export function registerRoofReviewRoutes(factory: FactoryApp) {
// ─── Roof Report Review Queue ─────────────────────────────────────────────────

// Store pending reports in-memory (backed by Supabase for persistence)
// Each entry: { reportId, address, companyId, backendUrl, createdAt }

factory.post('/roof-review/notify', async (c) => {
  // Called by tenant CRM when a new auto-detect report needs review
  // Accept from any tenant with a valid factory sync key — the key must
  // belong to a real tenant or anyone could flood the review queue.
  const suppliedKey = c.req.header('X-Factory-Key') || ''
  if (!suppliedKey) return c.json({ error: 'Unauthorized' }, 401)
  // Found by reading and comparing: a sealed key cannot be looked up by its value (lib/tenantSecrets.ts).
  const callerTenant = await tenantBySyncKey(supabase, suppliedKey)
  if (!checkFactoryKey(c, callerTenant)) return c.json({ error: 'Unauthorized' }, 401)

  const body = await c.req.json().catch(() => ({}))
  const reportId = typeof body?.reportId === 'string' ? body.reportId.trim() : ''
  const address = typeof body?.address === 'string' ? body.address.trim().slice(0, 300) : ''
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(reportId)) return c.json({ error: 'Missing fields' }, 400)

  // WHOSE report it is, and WHERE its app lives, are the Factory's own record of the caller — never what the caller says.
  // The body's companyId and backendUrl used to be stored as sent: any business's key could queue a report under ANOTHER
  // business with an address of its own choosing, and the review page then called that address with the other business's
  // Factory key (and showed staff the address as a link). (Security review S5-11)
  const { data: caller } = await supabase.from('tenants').select('id, render_backend_url').eq('id', callerTenant!.id).maybeSingle()
  if (!caller) return c.json({ error: 'Unauthorized' }, 401)
  const { data: held } = await supabase.from('roof_review_queue').select('company_id').eq('report_id', reportId).maybeSingle()
  if (held && held.company_id !== caller.id) return c.json({ error: 'Missing fields' }, 400)

  // Store in Supabase
  await supabase.from('roof_review_queue').upsert({
    report_id: reportId,
    address,
    company_id: caller.id,
    backend_url: String(caller.render_backend_url || '').replace(/\/+$/, ''),
    status: 'pending',
    created_at: new Date().toISOString(),
  }, { onConflict: 'report_id' })

  console.log(`[RoofReview] New report queued: ${reportId} at ${address}`)
  return c.json({ success: true })
})

// List pending reports
factory.get('/roof-review/pending', authenticate, async (c) => {
  const { data } = await supabase
    .from('roof_review_queue')
    .select('*')
    .eq('status', 'pending')
    .order('created_at', { ascending: false })

  // Enrich with tenant info
  const companyIds = [...new Set((data || []).map(r => r.company_id))]
  const { data: tenants } = await supabase
    .from('tenants')
    .select('id, name, slug, render_backend_url')
    .in('id', companyIds)

  const tenantMap = Object.fromEntries((tenants || []).map(t => [t.id, t]))

  const enriched = (data || []).map(r => ({
    ...r,
    tenant: tenantMap[r.company_id] || null,
  }))

  return c.json(enriched)
})

// Proxy: fetch report data from tenant CRM for editing
factory.get('/roof-review/:reportId/data', authenticate, async (c) => {
  const reportId = c.req.param('reportId')

  const { data: queueItem } = await supabase
    .from('roof_review_queue')
    .select('*, tenants!roof_review_queue_company_id_fkey(render_backend_url, factory_sync_key)')
    .eq('report_id', reportId)
    .single()

  if (!queueItem) return c.json({ error: 'Not found' }, 404)

  // Only the address the Factory itself recorded for this business: the key never travels to an address a caller supplied.
  const backendUrl = String(queueItem.tenants?.render_backend_url || '').replace(/\/+$/, '')
  const syncKey = queueItem.tenants?.factory_sync_key

  if (!backendUrl || !syncKey) return c.json({ error: 'Tenant backend not configured' }, 400)

  // Fetch report data from tenant CRM
  const res = await fetch(`${backendUrl}/api/internal/roof-reports/${encodeURIComponent(reportId)}`, {
    headers: { 'X-Factory-Key': syncKey },
  })
  if (!res.ok) return c.json({ error: 'Failed to fetch from tenant' }, res.status as any)
  const report = await res.json()
  // The business's Factory key stays on the server: the review page needs the report, not the key.
  return c.json({ report, backendUrl })
})

// Proxy: approve report on tenant CRM
factory.post('/roof-review/:reportId/approve', authenticate, async (c) => {
  const reportId = c.req.param('reportId')
  const { edges, measurements } = await c.req.json()

  const { data: queueItem } = await supabase
    .from('roof_review_queue')
    .select('*, tenants!roof_review_queue_company_id_fkey(render_backend_url, factory_sync_key)')
    .eq('report_id', reportId)
    .single()

  if (!queueItem) return c.json({ error: 'Not found' }, 404)

  // Only the address the Factory itself recorded for this business: the key never travels to an address a caller supplied.
  const backendUrl = String(queueItem.tenants?.render_backend_url || '').replace(/\/+$/, '')
  const syncKey = queueItem.tenants?.factory_sync_key

  if (!backendUrl || !syncKey) return c.json({ error: 'Tenant backend not configured' }, 400)

  // Send approval to tenant CRM
  const res = await fetch(`${backendUrl}/api/internal/roof-reports/${encodeURIComponent(reportId)}/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Factory-Key': syncKey },
    body: JSON.stringify({ edges, measurements }),
  })
  if (!res.ok) return c.json({ error: 'Failed to approve on tenant' }, res.status as any)

  // Update queue status
  await supabase.from('roof_review_queue').update({ status: 'approved', approved_at: new Date().toISOString() }).eq('report_id', reportId)

  return c.json({ success: true })
})

// Count pending (for badge)
factory.get('/roof-review/count', authenticate, async (c) => {
  const { count } = await supabase
    .from('roof_review_queue')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'pending')

  return c.json({ pending: count || 0 })
})

}
