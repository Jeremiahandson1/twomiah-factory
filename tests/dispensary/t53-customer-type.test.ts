// crm-dispensary — T49/T53 M3: the Customers page saved everyone as a Lead.
//
// "Add Customer" sent no type, so POST /api/contacts fell through to its schema default of 'lead'.
// Marketing's Customer segment read 9 contacts and 0 with an email while Lead held 14 reachable
// ones, so an owner choosing Segment → Customer to email their customers reached NOBODY — and had
// no way to work out why, because the screen they added those people on is called Customers.
//
// It also blocked H3: the tester could not build a one-person audience to test the address check
// with, because the only screen that can add a person makes leads, and Lead already held 14 real
// contacts they were not willing to email.
//
// The other four creators all say what they make — order-ahead and the external-POS import write
// 'customer', the leads route writes a lead, the CSV importer maps the column. The Customers screen
// was the one door that stayed silent.
//
// This asserts the SEGMENT, not just the column. "type is now client" would pass on a build where
// marketing still could not find them, and reaching the customer is the whole finding.
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { readFileSync } from 'node:fs'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { company, user } from './db/schema.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 320)) }
}

await setupSchema()

const [co] = await db.insert(company).values({
  name: 'M3 Leaf', slug: 'leaf-m3', email: 'm3@test.local', state: 'OH',
  enabledFeatures: ['contacts', 'orders', 'email_marketing', 'marketing'],
} as any).returning()
const [owner] = await db.insert(user).values({
  email: 'owner-m3@test.local', passwordHash: 'x', firstName: 'O', lastName: 'U', role: 'owner', companyId: co.id,
} as any).returning()

const app = new Hono()
app.route('/api/contacts', (await import('./src/routes/contacts.ts')).default)
app.onError((await import('./src/utils/errors.ts')).errorHandler)
const api = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, {
    method, headers: { 'content-type': 'application/json', 'x-test-user': owner.id },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j }
}
const rows = async (q: any) => { const r: any = await db.execute(q); return (r.rows || r) as any[] }

// ══════════ the screen's own payload, taken from the screen ═════════════════════════════════════
//
// Read out of CustomersPage.tsx rather than retyped: the finding was that the screen's payload and
// the API's default disagreed, so a test that invents its own payload cannot see it.
const PAGE = (() => {
  const r = process.env.FACTORY_ROOT
  if (!r) throw new Error('FACTORY_ROOT is not set — run this through tests/dispensary/harness/run.ts')
  return readFileSync(`${r.endsWith('/') ? r : r + '/'}templates/crm-dispensary/frontend/src/pages/CustomersPage.tsx`, 'utf8').replace(/\r\n/g, '\n')
})()

{
  const initial = PAGE.match(/const initialFormData = \{[\s\S]*?\n\}/)?.[0] || ''
  check('the Add Customer form declares a type at all — it used to send none', /\btype:/.test(initial), initial.slice(0, 200))
  check('…and that type is customer', /type: 'customer'/.test(initial), initial.slice(0, 200))

  const edit = PAGE.match(/const openEditModal = \(customer: any\) => \{[\s\S]*?\n  \};/)?.[0] || ''
  check('…while EDIT carries the record\'s own type, so editing a lead does not promote them',
    /type: customer\.type \|\| 'customer'/.test(edit), edit.slice(0, 200))
}

// ══════════ what the API does with that payload ═════════════════════════════════════════════════
{
  // Exactly what the screen sends on Add.
  const added = await api('POST', '/api/contacts', {
    type: 'customer', name: 'M3 Walk In', email: 'm3walkin@test.local', phone: '555-3001', dateOfBirth: '1988-02-02',
  })
  const id = (added.json?.data || added.json)?.id
  check('the screen\'s payload is accepted', (added.status === 200 || added.status === 201) && !!id, { status: added.status, body: added.json })

  const [row] = await rows(sql`SELECT type FROM contact WHERE id = ${id}`)
  check('…and stores them as a customer, not a lead — the finding',
    row?.type === 'client', { stored: row?.type })

  // The vocabulary round-trip: the product says "customer", the column says "client".
  const back = await api('GET', `/api/contacts/${id}`)
  check('…and reads back as the stored value the rest of the product uses',
    String((back.json?.data || back.json)?.type) === 'client', (back.json?.data || back.json)?.type)
}

// ══════════ the segment — which is what the finding was actually about ══════════════════════════
{
  // A lead as well, so "the filter returns everyone" cannot pass for a fix.
  await api('POST', '/api/contacts', { type: 'lead', name: 'M3 Enquiry', email: 'm3lead@test.local', phone: '555-3002' })

  const customers = await api('GET', '/api/contacts?type=client')
  const clist = (customers.json?.data || customers.json || []) as any[]
  check('filtering by customer finds the person the screen added', clist.some((x: any) => x.name === 'M3 Walk In'), clist.map((x: any) => x.name))
  check('…and does NOT include the lead', !clist.some((x: any) => x.name === 'M3 Enquiry'), clist.map((x: any) => x.name))

  const leads = await api('GET', '/api/contacts?type=lead')
  const llist = (leads.json?.data || leads.json || []) as any[]
  check('the lead is still a lead', llist.some((x: any) => x.name === 'M3 Enquiry'), llist.map((x: any) => x.name))
  check('…and the customer is not in it — which is where they ALL used to land',
    !llist.some((x: any) => x.name === 'M3 Walk In'), llist.map((x: any) => x.name))

  // The shape marketing asks for: customers who can actually be emailed.
  const reachable = await rows(sql`
    SELECT COUNT(*)::int AS n FROM contact
    WHERE company_id = ${co.id} AND type = 'client' AND email IS NOT NULL AND email <> ''
  `)
  check('…so a Customer segment has someone reachable in it — it read 0 of 9 before',
    Number(reachable[0]?.n) >= 1, reachable[0])
}

// ══════════ editing does not reclassify anyone ══════════════════════════════════════════════════
{
  const made = await api('POST', '/api/contacts', { type: 'lead', name: 'M3 Still A Lead', phone: '555-3003' })
  const id = (made.json?.data || made.json)?.id

  // The screen PUTs the whole form back, carrying the record's own type.
  const edited = await api('PUT', `/api/contacts/${id}`, { type: 'lead', name: 'M3 Still A Lead', phone: '555-3999' })
  check('editing a lead from the Customers screen keeps them a lead', edited.status === 200, { status: edited.status, body: edited.json })
  const [after] = await rows(sql`SELECT type, phone FROM contact WHERE id = ${id}`)
  check('…the type is untouched', after?.type === 'lead', after)
  check('…and the edit still applied', String(after?.phone) === '555-3999', after)
}

console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
