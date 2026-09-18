import { createClient } from '@supabase/supabase-js'
import * as fs from 'fs'; import * as path from 'path'; import { fileURLToPath } from 'url'
const __dirname=path.dirname(fileURLToPath(import.meta.url))
for(const l of fs.readFileSync(path.join(__dirname,'..','.env'),'utf8').split('\n')){const m=l.replace(/\r$/,'').match(/^([^#=]+)=(.*)$/);if(m)process.env[m[1].trim()]=m[2].trim()}
const sb=createClient(process.env.SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!)
const {data}=await sb.from('tenants').select('id,slug,status,is_test_tenant,github_repo,render_frontend_url,created_at').eq('is_test_tenant',true).order('created_at',{ascending:true})
const KEEP=new Set(['zacho-demo'])
const stale=(data||[]).filter(t=>t.status==='intake' && !KEEP.has(t.slug))
const skipped=(data||[]).filter(t=>!(t.status==='intake') || KEEP.has(t.slug))
console.log('=== WOULD PURGE (is_test_tenant + status=intake, excl zacho-demo): '+stale.length+' ===')
for(const t of stale) console.log('  PURGE', t.slug, '|', t.status, '| repo:', t.github_repo||'none', '| url:', t.render_frontend_url||'none', '|', t.id)
console.log('\n=== WOULD KEEP: '+skipped.length+' ===')
for(const t of skipped) console.log('  KEEP ', t.slug, '|', t.status, '|', t.id)
process.exit(0)
