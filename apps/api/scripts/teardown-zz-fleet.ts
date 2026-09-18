/**
 * Teardown of the 10 "ZZ Fleet" test tenants ONLY (zz-fleet-* slugs, names
 * starting "ZZ Fleet"). Modeled on teardown-northwind.ts, plus Stripe cleanup
 * (the legacy auto-subscription code created real subs for the 3 deployed ones).
 * Only touches resources whose name starts with "zz-fleet-".
 * Dry-run by default; pass --delete to execute.
 *
 *   cd apps/api && bun run scripts/teardown-zz-fleet.ts           # dry-run
 *   cd apps/api && bun run scripts/teardown-zz-fleet.ts --delete  # execute
 */
import { supabase } from '../src/middleware/auth.ts'

const PREFIX = 'zz-fleet-'
const EXPECTED_NAME_PREFIX = 'ZZ Fleet'
const DO_DELETE = process.argv.includes('--delete')

const RENDER = 'https://api.render.com/v1'
const rh = () => ({ Authorization: 'Bearer ' + (process.env.RENDER_API_KEY || ''), 'Content-Type': 'application/json' })
const guard = (name: string) => typeof name === 'string' && name.startsWith(PREFIX)
const log = (a: string, d: string) => console.log(`${DO_DELETE ? '🗑  ' : '•  '}${a}: ${d}`)

async function main() {
  const { data: rows, error } = await supabase.from('tenants').select('*').like('slug', PREFIX + '%')
  if (error) { console.error('lookup failed:', error.message); process.exit(1) }
  const tenants = (rows || []).filter((t: any) => typeof t.name === 'string' && t.name.startsWith(EXPECTED_NAME_PREFIX))
  if (!tenants.length) { console.log('No tenants matching', PREFIX, '— nothing to do.'); return }

  console.log(`Mode: ${DO_DELETE ? 'DELETE' : 'DRY-RUN'} — ${tenants.length} matching tenant(s):`)
  for (const t of tenants) console.log('   ', t.slug, '|', t.name, '|', t.id)
  console.log()

  // Render services (all types, slug-prefix guarded)
  console.log('— Render services —')
  let cursor = ''; const svc: { id: string; name: string }[] = []
  for (let p = 0; p < 10; p++) {
    const res = await fetch(`${RENDER}/services?limit=100${cursor ? '&cursor=' + cursor : ''}`, { headers: rh() })
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
  const pgRes = await (await fetch(`${RENDER}/postgres?limit=100`, { headers: rh() })).json() as any[]
  const pg = (Array.isArray(pgRes) ? pgRes : []).map(i => i.postgres || i).filter(db => guard(db.name))
  for (const db of pg) {
    if (DO_DELETE) { const d = await fetch(`${RENDER}/postgres/${db.id}`, { method: 'DELETE', headers: rh() }); log('postgres', `${db.name} → HTTP ${d.status}`) }
    else log('postgres', `${db.name} (${db.id})`)
  }
  if (!pg.length) console.log('  (none)')

  // GitHub repos (one per tenant slug)
  console.log('— GitHub repos —')
  const owner = 'Jeremiahandson1'
  const gh = { Authorization: 'token ' + (process.env.GITHUB_TOKEN || ''), 'User-Agent': 'twomiah-teardown' }
  for (const t of tenants) {
    const ghUrl = `https://api.github.com/repos/${owner}/${t.slug}`
    const exists = await fetch(ghUrl, { headers: gh })
    if (exists.status === 404) console.log(`  (no repo ${owner}/${t.slug})`)
    else if (DO_DELETE) { const d = await fetch(ghUrl, { method: 'DELETE', headers: gh }); log('repo', `${owner}/${t.slug} → HTTP ${d.status}`) }
    else log('repo', `${owner}/${t.slug} (HTTP ${exists.status})`)
  }

  // Stripe — cancel subscription, then delete the customer (test tenants only).
  // Deleting the customer also cancels any remaining subs.
  console.log('— Stripe —')
  const sk = process.env.STRIPE_SECRET_KEY || ''
  const sh = { Authorization: 'Bearer ' + sk }
  let stripeAny = false
  for (const t of tenants) {
    if (t.stripe_subscription_id) {
      stripeAny = true
      if (DO_DELETE) { const d = await fetch(`https://api.stripe.com/v1/subscriptions/${t.stripe_subscription_id}`, { method: 'DELETE', headers: sh }); log('subscription', `${t.slug} ${t.stripe_subscription_id} → HTTP ${d.status}`) }
      else log('subscription', `${t.slug} ${t.stripe_subscription_id}`)
    }
    if (t.stripe_customer_id) {
      stripeAny = true
      if (DO_DELETE) { const d = await fetch(`https://api.stripe.com/v1/customers/${t.stripe_customer_id}`, { method: 'DELETE', headers: sh }); log('customer', `${t.slug} ${t.stripe_customer_id} → HTTP ${d.status}`) }
      else log('customer', `${t.slug} ${t.stripe_customer_id}`)
    }
  }
  if (!stripeAny) console.log('  (none)')

  // Supabase rows (factory_jobs then tenant)
  console.log('— Supabase —')
  for (const t of tenants) {
    if (DO_DELETE) {
      const { count } = await supabase.from('factory_jobs').delete({ count: 'exact' }).eq('tenant_id', t.id)
      log('factory_jobs', `${count ?? 0} rows (${t.slug})`)
      const { error: e } = await supabase.from('tenants').delete().eq('id', t.id)
      log('tenant row', e ? 'ERROR ' + e.message : `deleted ${t.slug} (${t.id})`)
    } else log('tenant row', `would delete ${t.slug} (${t.id})`)
  }
  console.log(`\n${DO_DELETE ? 'Teardown complete.' : 'Dry-run complete — re-run with --delete.'}`)
}
main()
