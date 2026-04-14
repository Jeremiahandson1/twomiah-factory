/**
 * Poll factory_jobs + tenants for a specific slug and print a one-line
 * status update every N seconds. Stops when the job is complete or failed.
 *
 *   bun scripts/watch-deploy.ts <slug-pattern>
 */
import { createClient } from '@supabase/supabase-js'
import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const envPath = path.join(__dirname, '..', '.env')
const envVars: Record<string, string> = {}
for (const rawLine of fs.readFileSync(envPath, 'utf8').split('\n')) {
  const line = rawLine.replace(/\r$/, '')
  const match = line.match(/^([^#=]+)=(.*)$/)
  if (match) envVars[match[1].trim()] = match[2].trim()
}

const SUPABASE_URL = envVars.SUPABASE_URL || process.env.SUPABASE_URL
const SERVICE_KEY = envVars.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SERVICE_KEY) { console.error('SUPABASE creds missing'); process.exit(1) }

const supabase = createClient(SUPABASE_URL, SERVICE_KEY)
const slug = process.argv[2]
if (!slug) { console.error('Usage: watch-deploy.ts <slug-pattern>'); process.exit(1) }

const INTERVAL = 15_000
const MAX_ITERATIONS = 40 // 10 min max

async function tick(i: number) {
  const { data: tenant } = await supabase
    .from('tenants')
    .select('id, slug, name, status, render_frontend_url, render_backend_url, website_url')
    .ilike('slug', `%${slug}%`)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!tenant) { console.log(`[${i}] no tenant found`); return false }

  const { data: job } = await supabase
    .from('factory_jobs')
    .select('id, status, github_repo, render_url, created_at, errors')
    .eq('tenant_id', tenant.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const ts = new Date().toISOString().substring(11, 19)
  const t = tenant as any
  const j = job as any
  console.log(
    `[${ts}] #${i}`,
    't.status=' + t.status,
    'j.status=' + (j?.status || '-'),
    'gh=' + (j?.github_repo ? '✓' : '-'),
    'fe=' + (t.render_frontend_url ? '✓' : '-'),
    'be=' + (t.render_backend_url ? '✓' : '-'),
    'site=' + (t.website_url ? '✓' : '-'),
  )

  if (j?.status === 'complete' || t.status === 'active') {
    console.log('\n✓ DEPLOY COMPLETE')
    console.log('  Frontend:', t.render_frontend_url || '(none)')
    console.log('  Backend: ', t.render_backend_url || '(none)')
    console.log('  Site:    ', t.website_url || '(none)')
    console.log('  Repo:    ', j?.github_repo || '(none)')
    return true
  }
  if (j?.status === 'failed' || t.status === 'deploy_failed') {
    console.log('\n✗ DEPLOY FAILED')
    if (j?.errors) console.log('Errors:', JSON.stringify(j.errors, null, 2))
    console.log('  Frontend:', t.render_frontend_url || '(none)')
    console.log('  Repo:    ', j?.github_repo || '(none)')
    return true
  }
  return false
}

let i = 0
async function loop() {
  while (i < MAX_ITERATIONS) {
    const done = await tick(++i)
    if (done) process.exit(0)
    await new Promise(r => setTimeout(r, INTERVAL))
  }
  console.log('\nTimed out after', (MAX_ITERATIONS * INTERVAL) / 1000, 's')
  process.exit(1)
}
loop()
