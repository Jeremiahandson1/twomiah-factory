/**
 * Run the tenant health checks against every live tenant and print the result.
 * Read-only — no alerts, no database writes.
 *
 *   cd apps/api && bun run scripts/probe-tenant-health.ts
 */
import { createClient } from '@supabase/supabase-js'
import { checkTenant } from '../src/services/healthMonitor'

const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

const { data, error } = await sb
  .from('tenants')
  .select('id, slug, name, domain, website_url, render_frontend_url, render_backend_url, cloudflare_zone_id')
  .eq('status', 'active')

if (error) {
  console.error('tenant query failed:', error.message)
  process.exit(1)
}

let down = 0
let degraded = 0
for (const t of data || []) {
  const h = await checkTenant(t as any)
  if (h.status === 'down') down++
  if (h.status === 'degraded') degraded++
  console.log('')
  console.log(h.slug.padEnd(32) + ' => ' + h.status.toUpperCase())
  for (const c of h.checks) {
    console.log('    ' + c.name.padEnd(16) + c.status.padEnd(9) + c.detail)
  }
}
console.log('')
console.log(`checked ${(data || []).length} tenants — ${down} down, ${degraded} degraded`)
