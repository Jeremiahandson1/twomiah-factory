/**
 * Tears down EVERY is_test_tenant=true tenant (hardDeleteTestTenant: Render
 * services + Postgres + GitHub repo + R2 + Supabase row). Safety-gated.
 *   cd apps/api && bun run scripts/teardown-all-test.ts
 */
import { createClient } from '@supabase/supabase-js'
import { hardDeleteTestTenant } from '../src/services/testCleanup.ts'

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
const { data } = await supabase.from('tenants').select('id,slug').eq('is_test_tenant', true).order('created_at', { ascending: false })
const ids = (data || []).map((t: any) => ({ id: t.id, slug: t.slug }))
console.log('tearing down', ids.length, 'test tenants')

let ok = 0, fail = 0
for (const { id, slug } of ids) {
  try {
    const r: any = await hardDeleteTestTenant(id)
    const good = r?.success !== false
    if (good) ok++; else fail++
    console.log((good ? 'OK  ' : 'FAIL') + ' ' + slug + ' ' + JSON.stringify(r?.steps || r).slice(0, 200))
  } catch (e: any) { fail++; console.log('ERR  ' + slug + ' ' + (e?.message || e)) }
}
console.log(`\nTEARDOWN DONE: ok=${ok} fail=${fail} / ${ids.length}`)
