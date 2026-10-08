// New leads, for a tenant WITHOUT the Lead Inbox. (T59 — twin of t59-new-leads-inbox-on.test.ts)
//
// Sending website enquiries to the inbox is only right where there is an inbox to read them in. A
// tenant without the module would otherwise lose every enquiry from view, so here the form keeps the
// Contact it always wrote, and the dashboard sends no `newLeads` — the key is absent, so the tile drops
// out rather than printing a zero for a page the owner cannot open.
process.env.WEBHOOK_SECRET = 'whsec-t59-off'
import { Hono } from 'hono'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { company, user, contact, lead } from './db/schema.ts'
import { eq } from 'drizzle-orm'
import { errorHandler } from './src/utils/errors.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 360)) }
}

await setupSchema()

const [co] = await db.insert(company).values({
  name: 'Leads Off Co', slug: 'leads-off-t59', email: 'off59@test.local', settings: {},
  enabledFeatures: ['online_booking', 'jobs', 'contacts'],
} as any).returning()
const [owner] = await db.insert(user).values({
  email: 'owner-off59@test.local', passwordHash: 'x', firstName: 'O', lastName: 'F',
  role: 'owner', companyId: co.id,
} as any).returning()

const app = new Hono()
app.route('/api/webhooks', (await import('./src/routes/webhooks.ts')).default)
app.route('/api/dashboard', (await import('./src/routes/dashboard.ts')).default)
app.onError(errorHandler)

const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
  const res = await app.request(path, {
    method, headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j, text: t }
}
const api = (method: string, path: string, body?: unknown) =>
  call(method, path, body, { 'x-test-user': owner.id, 'x-test-company': co.id, 'x-test-role': owner.role })

console.log('\n══════════ no inbox: the enquiry stays a contact ══════════')
{
  const res = await call('POST', '/api/webhooks/leads',
    { name: 'Otto Form', email: 'otto-t59@test.local', phone: '555-0177', service: 'Quote', message: 'Call me', source: 'website', address: '1 Pine Ave' },
    { 'x-webhook-secret': 'whsec-t59-off' })
  check('the enquiry is accepted', res.status === 201 && res.json?.success === true, { status: res.status, body: res.text?.slice(0, 300) })
  const [otto]: any[] = await db.select().from(contact).where(eq(contact.email, 'otto-t59@test.local'))
  check('…as a contact, exactly as before', !!otto && otto.id === res.json?.id, { otto, id: res.json?.id })
  check('…of type lead', otto?.type === 'lead', { type: otto?.type })
  check('…from the website', otto?.source === 'website', { source: otto?.source })
  check('…with the service and message in its notes', /Service: Quote/.test(otto?.notes || '') && /Message: Call me/.test(otto?.notes || ''), { notes: otto?.notes })
  const rows: any[] = await db.select().from(lead).where(eq(lead.companyId, co.id))
  check('…and nothing in an inbox this tenant cannot open', rows.length === 0, { leads: rows.length })
}

console.log('\n══════════ no inbox: no New leads figure ══════════')
{
  const s = await api('GET', '/api/dashboard/stats')
  check('the dashboard answers', s.status === 200, { status: s.status, body: s.text?.slice(0, 200) })
  check('newLeads is ABSENT, not zero', s.json && !('newLeads' in s.json), { keys: Object.keys(s.json || {}) })
  check('contacts is still sent (the mobile app reads it)', s.json?.contacts === 1, { contacts: s.json?.contacts })
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
