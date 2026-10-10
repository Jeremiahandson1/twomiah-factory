// T62 High — "Staff can read the lead-source webhook secret … Anyone with the secret can post fake leads into
// the CRM from outside." Owner's decision (2026-10-09): owners and admins only.
//
// T63 — owner's decision (2026-10-09): ADDING and PAUSING a source is managers and up as well ("staff can create
// a lead source they can't delete. Is that acceptable?" — no: managers set up where leads come from). Staff keep
// reading the list. Asserted through the real leads route, per role.
import { Hono } from 'hono'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) }
}

const { setupSchema } = await import('./setup.ts')
await setupSchema()
const { db } = await import('./db/index.ts')
const { company, user } = await import('./db/schema.ts')

const [co] = await db.insert(company).values({ name: 'Secret Vet', slug: 'secret-vet-t62', email: 'sv62@test.local', state: 'OH', settings: {}, enabledFeatures: ['lead_inbox'] } as any).returning()
const mk = async (role: string, tag: string) => (await db.insert(user).values({ email: `${tag}@sv62.local`, passwordHash: 'x', firstName: tag, lastName: 'U', role, companyId: co.id, isActive: true } as any).returning())[0]
const owner = await mk('owner', 'owner'), admin = await mk('admin', 'admin'), manager = await mk('manager', 'manager'), staff = await mk('field', 'staff')

const app = new Hono()
app.route('/api/leads', (await import('./src/routes/leads.ts')).default)
app.onError((await import('./src/utils/errors.ts')).errorHandler)
const as = (who: any) => async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, { method, headers: { 'content-type': 'application/json', 'x-test-user': who.id }, body: body === undefined ? undefined : JSON.stringify(body) })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j }
}

// ── T63: staff do not set up sources ──
const refused = await as(staff)('POST', '/api/leads/sources', { platform: 'yelp' })
check('vet staff cannot connect a source (403) — managers and up', refused.status === 403, refused)

const made = await as(manager)('POST', '/api/leads/sources', { platform: 'google_business' })
check('a manager connects a source', made.status === 201, made)
check('…and is NOT handed its webhook secret (owners and admins only)', made.status === 201 && !('webhookSecret' in (made.json || {})), made.json)
const id = made.json?.id

for (const [who, label] of [[staff, 'staff'], [manager, 'a manager']] as const) {
  const list = await as(who)('GET', '/api/leads/sources')
  const row = (list.json?.data || []).find((s: any) => s.id === id)
  check(`${label} reads the list`, list.status === 200 && !!row, { status: list.status })
  check(`…without the secret`, !!row && !('webhookSecret' in row), row)
  check(`…but with the inbound email address, which is not a secret`, !!row?.inboundEmail, row)
}
const pause = await as(staff)('PUT', `/api/leads/sources/${id}`, { enabled: false })
check('staff cannot pause a source (403)', pause.status === 403, pause)
const edit = await as(manager)('PUT', `/api/leads/sources/${id}`, { label: 'Google' })
check('a manager edits it, and the reply carries no secret', edit.status === 200 && !('webhookSecret' in (edit.json || {})), edit.json)

for (const [who, label] of [[owner, 'the owner'], [admin, 'an admin']] as const) {
  const row = ((await as(who)('GET', '/api/leads/sources')).json?.data || []).find((s: any) => s.id === id)
  check(`${label} is handed the secret, to set up the integration`, typeof row?.webhookSecret === 'string' && row.webhookSecret.length > 10, row)
}

console.log(`\nt62 webhook secret: ${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
