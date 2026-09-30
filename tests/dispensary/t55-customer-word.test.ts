// crm-dispensary — T55 M3 (still not fixed), S3 and S4.
//
// M3. I fixed the wrong end of it. The Customers screen now sends `type: 'customer'` and the API
// normalises that onto the stored `client` — so the screen was right and the finding stayed open,
// because the PRODUCT held two words for one idea:
//
//   contactSchema declares ['lead','client','patient','vendor'] and maps customer → client (T21 L3)
//   order-ahead and the external-POS import INSERT straight into the table, bypassing that schema,
//   and wrote the literal 'customer' — a value the enum does not allow
//   Marketing's segment filtered on whichever word the campaign was saved with
//
// The tenant held lead 44, client 45, customer 11, and Segment → Customer reached 11 of 56 — none of
// them added on the Customers screen. One word now: every writer stores `client`, the screen shows
// "Customer", and the filter matches either so campaigns already saved still mean what their author
// meant.
//
// S3. My N10 rule refused a budtender adding a FIRST date of birth — an order-ahead contact, a
// walk-in taken by name. There is no evidence to amend when the field is empty, and the refusal
// even said "recorded as having no date of birth". Intake is the budtender's job.
//
// S4. A refused attempt to move a date of birth was not written to the audit log, so an owner could
// not see that anyone had tried. The attempt is the thing worth seeing.
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { readFileSync } from 'node:fs'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { company, user, contact } from './db/schema.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 320)) }
}
const ROOT = (() => { const r = process.env.FACTORY_ROOT; if (!r) throw new Error('FACTORY_ROOT is not set'); return r.endsWith('/') ? r : r + '/' })()

await setupSchema()

const [co] = await db.insert(company).values({
  name: 'T55 Leaf', slug: 'leaf-t55', email: 't55@test.local', state: 'OH',
  enabledFeatures: ['contacts', 'orders', 'products', 'email_campaigns', 'marketing', 'order_ahead'],
} as any).returning()
const mkUser = async (role: string, tag: string) => (await db.insert(user).values({
  email: `${tag}@test.local`, passwordHash: 'x', firstName: tag, lastName: 'U', role, companyId: co.id,
} as any).returning())[0]
const owner = await mkUser('owner', 't55own')
const budtender = await mkUser('budtender', 't55bud')

const app = new Hono()
app.route('/api/contacts', (await import('./src/routes/contacts.ts')).default)
app.route('/api/marketing', (await import('./src/routes/marketing.ts')).default)
app.onError((await import('./src/utils/errors.ts')).errorHandler)
const as = (who: any) => async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, {
    method, headers: { 'content-type': 'application/json', 'x-test-user': who.id },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j }
}
const asOwner = as(owner), asBud = as(budtender)
const rows = async (q: any) => { const r: any = await db.execute(q); return (r.rows || r) as any[] }

// ══════════ M3 · one word for one idea ══════════════════════════════════════════════════════════
{
  // Every writer, checked at the source. The two that bypass contactSchema are the ones that drifted.
  for (const [file, label] of [
    ['templates/crm-dispensary/backend/src/routes/menu.ts', 'order-ahead'],
    ['templates/crm-dispensary/backend/src/routes/integrations.ts', 'the external-POS import'],
  ] as Array<[string, string]>) {
    const src = readFileSync(ROOT + file, 'utf8').replace(/\r\n/g, '\n')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
    check(`${label} no longer writes the literal 'customer'`, !/type: 'customer'/.test(src), null)
    check(`…it writes 'client', the value the schema declares`, /type: 'client'/.test(src), null)
  }

  // The screen's word still reaches the stored value through the schema.
  const made = await asOwner('POST', '/api/contacts', { type: 'customer', name: 'T55 Walk In', email: 't55walk@test.local' })
  const id = (made.json?.data || made.json)?.id
  const [row] = await rows(sql`SELECT type FROM contact WHERE id = ${id}`)
  check('the Customers screen\'s "customer" still stores as client', row?.type === 'client', row)
}
{
  // The audience. This is the finding: the segment has to reach the people the screen creates.
  await db.insert(contact).values([
    { type: 'client', name: 'T55 From Screen', email: 'screen@test.local', companyId: co.id },
    // A row written by the OLD order-ahead, before today — the tenant is full of these.
    { type: 'customer', name: 'T55 Legacy Order-ahead', email: 'legacy@test.local', companyId: co.id },
    { type: 'lead', name: 'T55 Enquiry', email: 'enquiry@test.local', companyId: co.id },
  ] as any).returning()

  const asCustomer = await asOwner('GET', `/api/marketing/audience-preview?audienceType=segment&filter=${encodeURIComponent(JSON.stringify({ type: 'client' }))}`)
  check('Segment → Customer reaches the person the screen created', Number(asCustomer.json?.total) >= 2, asCustomer.json)
  check('…and can actually email them — it read 0 reachable', Number(asCustomer.json?.reachable) >= 2, asCustomer.json)

  // …and a campaign SAVED with the old word still means what its author meant.
  const legacyWord = await asOwner('GET', `/api/marketing/audience-preview?audienceType=segment&filter=${encodeURIComponent(JSON.stringify({ type: 'customer' }))}`)
  check('a campaign saved with the OLD word reaches the same people', Number(legacyWord.json?.total) === Number(asCustomer.json?.total),
    { old: legacyWord.json?.total, now: asCustomer.json?.total })

  // …and a lead is still a lead. A filter that matched everyone would pass every check above.
  const leads = await asOwner('GET', `/api/marketing/audience-preview?audienceType=segment&filter=${encodeURIComponent(JSON.stringify({ type: 'lead' }))}`)
  check('the Lead segment is separate and does not include customers', Number(leads.json?.total) === 1, leads.json)
}
{
  // The screen offers the stored value under the word the product uses.
  const page = readFileSync(ROOT + 'templates/crm-dispensary/frontend/src/pages/MarketingPage.tsx', 'utf8').replace(/\r\n/g, '\n')
  check('the segment picker sends `client` and shows "Customer"',
    /\{ value: 'client', label: 'Customer' \}/.test(page), null)
  check('…and no longer sends the screen\'s word straight to the filter',
    !/const CONTACT_TYPES = \['customer'/.test(page), null)
}

// ══════════ S3 · first entry is intake, not amendment ═══════════════════════════════════════════
{
  const [noDob] = await db.insert(contact).values({
    type: 'client', name: 'T55 No DOB', companyId: co.id, phone: '555-8001',
  } as any).returning()

  const add = await asBud('PUT', `/api/contacts/${noDob.id}`, { dateOfBirth: '1985-04-02' })
  check('a budtender can add a FIRST date of birth — it used to be refused', add.status === 200,
    { status: add.status, body: add.json })
  const [after] = await rows(sql`SELECT date_of_birth FROM contact WHERE id = ${noDob.id}`)
  check('…and it is stored', String(after?.date_of_birth).slice(0, 10) === '1985-04-02', after)

  // …and the moment there IS one, changing it is a manager's decision again. This is the finding.
  const change = await asBud('PUT', `/api/contacts/${noDob.id}`, { dateOfBirth: '1990-01-01' })
  check('…but changing the one they just entered needs a manager', change.status === 403
    && String(change.json?.code) === 'dob_change_needs_manager', { status: change.status, body: change.json })
  const [unchanged] = await rows(sql`SELECT date_of_birth FROM contact WHERE id = ${noDob.id}`)
  check('…and the record is untouched', String(unchanged?.date_of_birth).slice(0, 10) === '1985-04-02', unchanged)
}

// ══════════ S4 · a refused attempt is worth seeing ══════════════════════════════════════════════
{
  const [c] = await db.insert(contact).values({
    type: 'client', name: 'T55 Audit Probe', dateOfBirth: '1980-01-01', companyId: co.id,
  } as any).returning()
  const refused = await asBud('PUT', `/api/contacts/${c.id}`, { dateOfBirth: '1990-01-01' })
  check('the attempt is refused', refused.status === 403, refused.status)

  const audits = await rows(sql`
    SELECT action, metadata FROM audit_log
    WHERE company_id = ${co.id} AND entity_id = ${c.id} ORDER BY created_at DESC LIMIT 5
  `)
  const logged = audits.find((a: any) => {
    const m = typeof a.metadata === 'string' ? (() => { try { return JSON.parse(a.metadata) } catch { return {} } })() : (a.metadata || {})
    return m?.refused === 'dob_change_needs_manager'
  })
  check('…and it IS written to the audit log — an owner could not see that anyone had tried',
    !!logged, audits.map((a: any) => a.metadata))
  const md = logged ? (typeof logged.metadata === 'string' ? JSON.parse(logged.metadata) : logged.metadata) : {}
  check('…with what was on file and what was attempted',
    md?.recorded === '1980-01-01' && String(md?.attempted).slice(0, 10) === '1990-01-01', md)
}

console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
