// Temporary: final prod verification of the tenant self-service auth fix.
// Read-only / no-op calls only. Prints statuses, never keys.
const sUrl = process.env.SUPABASE_URL!
const sKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const rows = await (await fetch(sUrl + '/rest/v1/tenants?slug=eq.buyflow-mq2v51hk-925f&select=id,factory_sync_key,offboard_started_at', {
  headers: { apikey: sKey, Authorization: 'Bearer ' + sKey },
})).json() as any[]
const ten = rows[0]
if (!ten) { console.error('tenant not found'); process.exit(1) }
if (ten.offboard_started_at) { console.error('SAFETY ABORT: tenant mid-offboard'); process.exit(1) }

const base = 'https://twomiah-factory-api.onrender.com/api/v1/factory'
let pass = 0, fail = 0
async function probe(name: string, expect: number, url: string, init: RequestInit = {}) {
  const r = await fetch(base + url, init)
  const ok = r.status === expect
  ok ? pass++ : fail++
  console.log((ok ? '  PASS' : '  FAIL'), name, '→', r.status, '(want', expect + ')')
}
const good = { 'X-Factory-Key': ten.factory_sync_key }
const bad = { 'X-Factory-Key': 'wrong-key-123' }

await probe('offboard/status correct key', 200, `/customers/${ten.id}/offboard/status`, { headers: good })
await probe('offboard/status wrong key', 401, `/customers/${ten.id}/offboard/status`, { headers: bad })
await probe('email-domain/status correct key', 200, `/customers/${ten.id}/email-domain/status`, { headers: good })
await probe('reactivate correct key (no-op tenant) → 400 past auth', 400, `/customers/${ten.id}/reactivate`, { method: 'POST', headers: good })
await probe('reactivate wrong key', 401, `/customers/${ten.id}/reactivate`, { method: 'POST', headers: bad })
await probe('offboard wrong key', 401, `/customers/${ten.id}/offboard`, { method: 'POST', headers: { ...bad, 'Content-Type': 'application/json' }, body: '{"confirm":true}' })
await probe('cron wrong secret', 401, '/internal/renewal-check', { method: 'POST', headers: { 'x-cron-secret': 'nope' } })
await probe('inbound-parse wrong secret', 401, '/inbound-parse/not-it', { method: 'POST' })
await probe('protected route no JWT', 401, '/analytics')
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
