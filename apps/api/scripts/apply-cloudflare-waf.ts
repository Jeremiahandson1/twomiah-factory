/**
 * Push the standard Twomiah WAF ruleset to every tenant Cloudflare zone.
 *
 * Idempotent — re-running has no effect if rules are already current.
 * Reads zone IDs from the tenants table (cloudflare_zone_id column).
 *
 * Usage:
 *   bun run scripts/apply-cloudflare-waf.ts                # all live tenants
 *   bun run scripts/apply-cloudflare-waf.ts --slug=foo     # one tenant
 *   bun run scripts/apply-cloudflare-waf.ts --dry-run      # log what we'd do
 */
// Bun auto-loads .env, no dotenv import needed
import { createClient } from '@supabase/supabase-js'
import { applyTenantWafRules, isCloudflareConfigured } from '../src/services/cloudflare'

interface TenantRow {
  id: string
  slug: string
  domain: string | null
  cloudflare_zone_id: string | null
  status: string
}

function parseArgs() {
  const args = process.argv.slice(2)
  const slug = args.find(a => a.startsWith('--slug='))?.split('=')[1] || null
  const dryRun = args.includes('--dry-run')
  return { slug, dryRun }
}

async function main() {
  const { slug, dryRun } = parseArgs()

  if (!isCloudflareConfigured()) {
    console.error('CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID must be set in env')
    process.exit(1)
  }

  const supabase = createClient(
    process.env.SUPABASE_URL || '',
    process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  )

  let q = supabase.from('tenants').select('id, slug, domain, cloudflare_zone_id, status').eq('status', 'live')
  if (slug) q = q.eq('slug', slug)
  const { data, error } = await q
  if (error) { console.error('Supabase query failed:', error.message); process.exit(1) }

  const tenants = (data || []) as TenantRow[]
  console.log('Found ' + tenants.length + ' tenant(s)' + (slug ? ' matching slug=' + slug : ''))

  let ok = 0, skipped = 0, failed = 0
  for (const t of tenants) {
    if (!t.cloudflare_zone_id) {
      console.log('[skip] ' + t.slug + ' — no cloudflare_zone_id')
      skipped++
      continue
    }
    if (dryRun) {
      console.log('[dry-run] would apply WAF rules to ' + t.slug + ' (zone ' + t.cloudflare_zone_id + ')')
      ok++
      continue
    }
    try {
      const res = await applyTenantWafRules(t.cloudflare_zone_id)
      console.log('[ok] ' + t.slug + ' — applied ' + res.applied + ' rules (ruleset ' + res.rulesetId + ')')
      ok++
    } catch (e: any) {
      console.error('[fail] ' + t.slug + ' — ' + (e?.message || e))
      failed++
    }
  }

  console.log('\nSummary: ' + ok + ' ok, ' + skipped + ' skipped, ' + failed + ' failed')
  process.exit(failed > 0 ? 2 : 0)
}

main().catch(e => { console.error(e); process.exit(1) })
