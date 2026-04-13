/**
 * Read the latest factory_jobs row + corresponding tenant row so we can see
 * exactly what step of runDeploy failed and which error bubbled up.
 *
 *   bun scripts/diagnose-last-deploy.ts [slugPattern]
 *
 * Defaults to pulling the 5 most recent rows.
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

async function main() {
  const slugPattern = process.argv[2]

  let jobsQuery = supabase
    .from('factory_jobs')
    .select('*, tenants(slug, name, status, plan, products, render_frontend_url, render_backend_url, deployment_model)')
    .order('created_at', { ascending: false })
    .limit(10)

  const { data: jobs, error } = await jobsQuery
  if (error) { console.error(error.message); process.exit(1) }

  const filtered = slugPattern
    ? jobs.filter((j: any) => j.tenants?.slug?.includes(slugPattern))
    : jobs

  for (const j of filtered.slice(0, 5)) {
    const t: any = j.tenants
    console.log('\n════════════════════════════════════════')
    console.log('Job:', j.id)
    console.log('Tenant:', t?.slug, '/', t?.name)
    console.log('Template:', j.template)
    console.log('Plan:', t?.plan, '/ deployment_model:', t?.deployment_model)
    console.log('Tenant status:', t?.status)
    console.log('Job status:', j.status)
    console.log('Render frontend URL:', t?.render_frontend_url || '(not set)')
    console.log('Render backend URL:', t?.render_backend_url || '(not set)')
    console.log('GitHub repo:', j.github_repo || '(not set)')
    console.log('Created:', j.created_at)
    if (j.errors) console.log('Errors:', JSON.stringify(j.errors, null, 2))
    if (j.result) console.log('Result:', JSON.stringify(j.result, null, 2).substring(0, 2000))
  }
}

main().catch(err => { console.error(err); process.exit(1) })
