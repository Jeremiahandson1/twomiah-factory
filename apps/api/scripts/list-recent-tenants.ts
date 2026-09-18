/**
 * Read-only: list the most recent tenants so we can identify a test store to
 * tear down. Prints no secrets. Run: cd apps/api && bun run scripts/list-recent-tenants.ts
 */
import { supabase } from '../src/middleware/auth.ts'

const { data, error } = await supabase
  .from('tenants')
  .select('id, name, slug, industry, products, is_test_tenant, website_url, created_at, status')
  .order('created_at', { ascending: false })
  .limit(15)

if (error) { console.error('query failed:', error.message); process.exit(1) }

for (const t of data || []) {
  console.log([
    t.created_at,
    t.is_test_tenant ? '[TEST]' : '[live]',
    t.industry || '—',
    JSON.stringify(t.products || []),
    t.slug,
    '| ' + (t.name || ''),
    t.website_url || '',
    'id=' + t.id,
  ].join('  '))
}
console.log(`\n${(data || []).length} tenants shown`)
