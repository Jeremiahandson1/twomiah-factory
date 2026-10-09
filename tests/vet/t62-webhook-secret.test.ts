// T62 High — "Staff can read the lead-source webhook secret … Anyone with the secret can post fake leads into
// the CRM from outside." Owner's decision (2026-10-09): owners and admins only.
//
// Vet staff hold contacts:create, so they may add a source and read the list — and still must never be
// handed its key. Asserted through the real leads route: the list, a create and an edit, per role.
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

const made = await as(staff)('POST', '/api/leads/sources', { platform: 'google_business' })
check('vet staff may connect a source (they hold contacts:create)', made.status === 201, made)
check('…and are NOT handed its webhook secret', made.status === 201 && !('webhookSecret' in (made.json || {})), made.json)
const id = made.json?.id

for (const [who, label] of [[staff, 'staff'], [manager, 'a manager']] as const) {
  const list = await as(who)('GET', '/api/leads/sources')
  const row = (list.json?.data || []).find((s: any) => s.id === id)
  check(`${label} reads the list`, list.status === 200 && !!row, { status: list.status })
  check(`…without the secret`, !!row && !('webhookSecret' in row), row)
  check(`…but with the inbound email address, which is not a secret`, !!row?.inboundEmail, row)
}
const edit = await as(staff)('PUT', `/api/leads/sources/${id}`, { label: 'Google' })
check('an edit by staff does not return the secret either', edit.status === 200 && !('webhookSecret' in (edit.json || {})), edit.json)

for (const [who, label] of [[owner, 'the owner'], [admin, 'an admin']] as const) {
  const row = ((await as(who)('GET', '/api/leads/sources')).json?.data || []).find((s: any) => s.id === id)
  check(`${label} is handed the secret, to set up the integration`, typeof row?.webhookSecret === 'string' && row.webhookSecret.length > 10, row)
}

console.log(`\nt62 webhook secret: ${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
