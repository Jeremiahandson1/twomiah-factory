/**
 * Targeted teardown of the "Northwind Test Goods" store test tenant ONLY.
 * Looks it up by slug, verifies the name, and only touches resources whose
 * name starts with that slug. Dry-run by default; pass --delete to execute.
 *
 *   cd apps/api && bun run scripts/teardown-northwind.ts           # dry-run
 *   cd apps/api && bun run scripts/teardown-northwind.ts --delete  # execute
 */
import { supabase } from '../src/middleware/auth.ts'

const SLUG = 'northwind-test-goods'
const EXPECTED_NAME = 'Northwind Test Goods'
const DO_DELETE = process.argv.includes('--delete')

const RENDER = 'https://api.render.com/v1'
const rh = () => ({ Authorization: 'Bearer ' + (process.env.RENDER_API_KEY || ''), 'Content-Type': 'application/json' })
const guard = (name: string) => typeof name === 'string' && name.startsWith(SLUG)
const log = (a: string, d: string) => console.log(`${DO_DELETE ? '🗑  ' : '•  '}${a}: ${d}`)

async function main() {
  const { data: rows, error } = await supabase.from('tenants').select('*').eq('slug', SLUG)
  if (error) { console.error('lookup failed:', error.message); process.exit(1) }
  const tenants = (rows || []).filter((t: any) => t.name === EXPECTED_NAME)
  if (!tenants.length) { console.log('No tenant with slug', SLUG, 'and name', EXPECTED_NAME, '— nothing to do.'); return }

  console.log(`Mode: ${DO_DELETE ? 'DELETE' : 'DRY-RUN'} — ${tenants.length} matching tenant(s)\n`)

  // Render services (slug prefix)
  console.log('— Render services —')
  let cursor = ''; const svc: { id: string; name: string }[] = []
  for (let p = 0; p < 10; p++) {
    const res = await fetch(`${RENDER}/services?type=web_service,static_site&limit=100${cursor ? '&cursor=' + cursor : ''}`, { headers: rh() })
    if (!res.ok) { console.error('render list HTTP', res.status); break }
    const list = await res.json() as any[]; if (!list.length) break
    for (const it of list) { const s = it.service || it; if (guard(s.name)) svc.push({ id: s.id, name: s.name }) }
    cursor = list[list.length - 1]?.cursor || ''; if (!cursor) break
  }
  for (const s of svc) {
    if (DO_DELETE) { const d = await fetch(`${RENDER}/services/${s.id}`, { method: 'DELETE', headers: rh() }); log('service', `${s.name} → HTTP ${d.status}`) }
    else log('service', `${s.name} (${s.id})`)
  }
  if (!svc.length) console.log('  (none)')

  // Render postgres (slug prefix)
  console.log('— Render Postgres —')
  const pg = (await (await fetch(`${RENDER}/postgres?limit=100`, { headers: rh() })).json() as any[]).map(i => i.postgres || i).filter(db => guard(db.name))
  for (const db of pg) {
    if (DO_DELETE) { const d = await fetch(`${RENDER}/postgres/${db.id}`, { method: 'DELETE', headers: rh() }); log('postgres', `${db.name} → HTTP ${d.status}`) }
    else log('postgres', `${db.name} (${db.id})`)
  }
  if (!pg.length) console.log('  (none)')

  // GitHub repo
  console.log('— GitHub repo —')
  const owner = 'Jeremiahandson1'
  const ghUrl = `https://api.github.com/repos/${owner}/${SLUG}`
  const gh = { Authorization: 'token ' + (process.env.GITHUB_TOKEN || ''), 'User-Agent': 'twomiah-teardown' }
  const exists = await fetch(ghUrl, { headers: gh })
  if (exists.status === 404) console.log(`  (no repo ${owner}/${SLUG})`)
  else if (DO_DELETE) { const d = await fetch(ghUrl, { method: 'DELETE', headers: gh }); log('repo', `${owner}/${SLUG} → HTTP ${d.status}`) }
  else log('repo', `${owner}/${SLUG} (HTTP ${exists.status})`)

  // Supabase rows (each matching tenant)
  console.log('— Supabase —')
  for (const t of tenants) {
    if (DO_DELETE) {
      const { count } = await supabase.from('factory_jobs').delete({ count: 'exact' }).eq('tenant_id', t.id)
      log('factory_jobs', `${count ?? 0} rows (tenant ${t.id})`)
      const { error: e } = await supabase.from('tenants').delete().eq('id', t.id)
      log('tenant row', e ? 'ERROR ' + e.message : `deleted (${t.id})`)
    } else log('tenant row', `would delete ${t.id}`)
  }
  console.log(`\n${DO_DELETE ? 'Teardown complete.' : 'Dry-run complete — re-run with --delete.'}`)
}
main()
