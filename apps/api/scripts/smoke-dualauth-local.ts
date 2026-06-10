// Temporary: boots nothing itself — probes a locally running API instance
// (PORT 3199) for the tenant self-service auth fix. Read-only / no-op calls.
const sUrl = process.env.SUPABASE_URL!
const sKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const rows = await (await fetch(sUrl + '/rest/v1/tenants?slug=eq.buyflow-mq2v51hk-925f&select=id,factory_sync_key,offboard_started_at', {
  headers: { apikey: sKey, Authorization: 'Bearer ' + sKey },
})).json() as any[]
const ten = rows[0]
if (!ten) { console.error('tenant not found'); process.exit(1) }
if (ten.offboard_started_at) { console.error('SAFETY ABORT: tenant is mid-offboard'); process.exit(1) }

const base = 'http://localhost:3199/api/v1/factory'
let pass = 0, fail = 0
async function probe(name: string, expect: number, url: string, init: RequestInit = {}) {
  const r = await fetch(base + url, init)
  const body = (await r.text()).slice(0, 100)
  const ok = r.status === expect
  ok ? pass++ : fail++
  console.log((ok ? '  PASS' : '  FAIL'), name, '→', r.status, '(want', expect + ')', body)
}

const good = { 'X-Factory-Key': ten.factory_sync_key }
const bad = { 'X-Factory-Key': 'wrong-key-123' }

await probe('offboard/status correct key', 200, `/customers/${ten.id}/offboard/status`, { headers: good })
await probe('offboard/status wrong key', 401, `/customers/${ten.id}/offboard/status`, { headers: bad })
await probe('email-domain/status correct key', 200, `/customers/${ten.id}/email-domain/status`, { headers: good })
await probe('email-domain/status wrong key', 401, `/customers/${ten.id}/email-domain/status`, { headers: bad })
await probe('email-alias-sync wrong key', 401, `/customers/${ten.id}/email-alias-sync`, { method: 'POST', headers: { ...bad, 'Content-Type': 'application/json' }, body: '{}' })
// reactivate on a non-offboarding tenant: auth must PASS, handler returns 400.
// Proves factoryKeyOrRole admits a valid key without any state change.
await probe('reactivate correct key (no-op tenant) → 400 past auth', 400, `/customers/${ten.id}/reactivate`, { method: 'POST', headers: good })
await probe('reactivate wrong key', 401, `/customers/${ten.id}/reactivate`, { method: 'POST', headers: bad })
await probe('reactivate no auth at all', 401, `/customers/${ten.id}/reactivate`, { method: 'POST' })
await probe('offboard wrong key (no state change)', 401, `/customers/${ten.id}/offboard`, { method: 'POST', headers: { ...bad, 'Content-Type': 'application/json' }, body: '{"confirm":true}' })
await probe('offboard no auth', 401, `/customers/${ten.id}/offboard`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"confirm":true}' })
// JWT path on an exempted route: garbage Bearer must still 401 (authenticate runs at route level now)
await probe('reactivate garbage JWT', 401, `/customers/${ten.id}/reactivate`, { method: 'POST', headers: { Authorization: 'Bearer not-a-real-token' } })

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
