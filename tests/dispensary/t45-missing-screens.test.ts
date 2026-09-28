// crm-dispensary — the T45 findings where a complete API had no screen in front of it.
//
//   H4   Onboarding told owners to bring their customers and products across at "Settings > Import",
//        and there was no such screen anywhere. The API — template, preview, two importers — had
//        been there the whole time with nothing calling it.
//   H23  Email Campaigns and SMS Marketing were sellable features with no screen at all. The API
//        also had no way to ask who a campaign would reach, so the only way to find out a draft
//        reached nobody was to send it.
//
// These assertions cover the API surface the new screens call. The screens themselves are wired in
// App.tsx and the sidebar, which check-dispensary-api-gates and check-nav-permission-gates hold.
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { company, user, contact } from './db/schema.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) }
}

await setupSchema()

const [co] = await db.insert(company).values({
  name: 'Screens Dispensary', slug: 'screens', email: 'screens@test.local', state: 'OH',
  enabledFeatures: ['products', 'orders', 'email_campaigns', 'sms_marketing'],
} as any).returning()

const [off] = await db.insert(company).values({
  name: 'No Marketing Co', slug: 'nomkt', email: 'nomkt@test.local', state: 'OH',
  enabledFeatures: ['products', 'orders'],
} as any).returning()

const mkUser = async (companyId: string, role: string, tag: string) => (await db.insert(user).values({
  email: `${tag}-screens@test.local`, passwordHash: 'x', firstName: tag, lastName: 'U', role, companyId,
} as any).returning())[0]
const owner = await mkUser(co.id, 'owner', 'owner')
const manager = await mkUser(co.id, 'manager', 'manager')
const budtender = await mkUser(co.id, 'user', 'budtender')
const offOwner = await mkUser(off.id, 'owner', 'offowner')

// Three customers: two reachable by email, one by phone only.
await db.insert(contact).values([
  { type: 'customer', name: 'Ada Reachable', email: 'ada@test.local', phone: '555-0101', companyId: co.id },
  { type: 'customer', name: 'Bob Reachable', email: 'bob@test.local', companyId: co.id },
  { type: 'lead', name: 'Cal Phoneonly', phone: '555-0103', companyId: co.id },
] as any)

const app = new Hono()
for (const [mount, file] of [
  ['/api/marketing', 'marketing'],
  ['/api/import', 'import'],
] as const) {
  app.route(mount, (await import(`./src/routes/${file}.ts`)).default)
}

const as = (who: any) => async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, {
    method,
    headers: { 'content-type': 'application/json', 'x-test-user': who.id },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, text: t, json: j }
}
const asOwner = as(owner)
const asManager = as(manager)
const asBudtender = as(budtender)
const asOffOwner = as(offOwner)

const upload = async (who: any, path: string, csv: string, filename = 'upload.csv') => {
  const form = new FormData()
  form.append('file', new File([csv], filename, { type: 'text/csv' }))
  const res = await app.request(path, { method: 'POST', headers: { 'x-test-user': who.id }, body: form })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, text: t, json: j }
}

// ── H23: who would this campaign reach? ─────────────────────────────────────────────────────────
const audience = await asManager('GET', '/api/marketing/audience-preview?audienceType=all')
check('H23: the audience can be asked for before sending', audience.status === 200, { status: audience.status, body: audience.json })
check('H23: it counts the whole audience', audience.json?.total === 3, audience.json)
check('H23: ...and how many of them an email can actually reach', audience.json?.withEmail === 2, audience.json)
check('H23: ...and how many a text can reach', audience.json?.withPhone === 2, audience.json)

const segment = await asManager('GET', `/api/marketing/audience-preview?audienceType=segment&filter=${encodeURIComponent(JSON.stringify({ type: 'customer' }))}`)
check('H23: a segment narrows the audience', segment.json?.total === 2, segment.json)

const badFilter = await asManager('GET', '/api/marketing/audience-preview?audienceType=segment&filter=not-json')
check('H23: an unparseable filter is a plain refusal, not a 500', badFilter.status === 400, { status: badFilter.status, body: badFilter.json })

// ── H23: the campaign surfaces the screen drives ────────────────────────────────────────────────
const stats = await asManager('GET', '/api/marketing/stats')
check('H23: the marketing stats the screen shows are served', stats.status === 200 && stats.json?.totalContacts === 3, { status: stats.status, body: stats.json })

const campaign = await asOwner('POST', '/api/marketing/campaigns', {
  name: 'October flower promo', type: 'email', subject: '20% off flower', content: 'This weekend only.',
  audienceFilter: {},
})
check('H23: a campaign can be created', campaign.status === 201, { status: campaign.status, body: campaign.json })

const list = await asManager('GET', '/api/marketing/campaigns')
check('H23: ...and appears in the list the screen reads', (Array.isArray(list.json) ? list.json : list.json?.data || []).length === 1,
  { status: list.status, body: list.json })

const removed = await asOwner('DELETE', `/api/marketing/campaigns/${campaign.json?.id}`)
check('H23: a campaign can be deleted', removed.status === 200, { status: removed.status, body: removed.json })

// The module switch has to reach the data, not just the menu entry.
const gated = await asOffOwner('GET', '/api/marketing/campaigns')
check('H23: a shop without either marketing feature is refused the data too', gated.status === 403, { status: gated.status, body: gated.json })
check('H23: ...by name, so the screen can say why', gated.json?.code === 'FEATURE_NOT_ENABLED', gated.json)

// ── H4: the import the onboarding guide points at ───────────────────────────────────────────────
const template = await app.request('/api/import/template/contacts', { headers: { 'x-test-user': owner.id } })
check('H4: the customers template downloads', template.status === 200, { status: template.status })
const templateText = await template.text()
check('H4: ...as CSV, with a header row the importer understands',
  /name/i.test(templateText.split('\n')[0] || '') && /email/i.test(templateText.split('\n')[0] || ''),
  templateText.split('\n')[0])

const prodTemplate = await app.request('/api/import/template/products', { headers: { 'x-test-user': owner.id } })
check('H4: the products template downloads too', prodTemplate.status === 200, { status: prodTemplate.status })

const goodCsv = 'Name,Email,Phone\nDana Newcustomer,dana@test.local,555-0200\nEli Newcustomer,eli@test.local,555-0201'
const preview = await upload(owner, '/api/import/preview/contacts', goodCsv)
check('H4: a file can be checked before it is imported', preview.status === 200, { status: preview.status, body: preview.json })
check('H4: ...and says how many rows it holds', preview.json?.valid === true && preview.json?.rowCount === 2, preview.json)
check('H4: ...and shows a sample the screen can render', Array.isArray(preview.json?.sample) && preview.json.sample.length > 0, preview.json?.sample)

const wrongCsv = 'Colour,Size\nblue,large'
const badPreview = await upload(owner, '/api/import/preview/contacts', wrongCsv)
check('H4: a file with the wrong columns is named as such rather than imported',
  badPreview.status === 200 && badPreview.json?.valid === false, badPreview.json)

const imported = await upload(owner, '/api/import/contacts', goodCsv)
check('H4: the import runs', imported.status === 200, { status: imported.status, body: imported.json })
check('H4: ...and brings the customers in', imported.json?.imported === 2, imported.json)
const after = await db.execute(sql`SELECT COUNT(*)::int as n FROM contact WHERE company_id = ${co.id}`)
check('H4: ...into this company', Number(((after as any).rows || after)[0]?.n) === 5, ((after as any).rows || after)[0])

// Every refusal names its row and its reason, which is what the screen renders.
const mixedCsv = 'Name,Email,Date of Birth\nFay Adult,fay@test.local,1990-05-05\nGus Minor,gus@test.local,2012-01-01'
const mixed = await upload(owner, '/api/import/contacts', mixedCsv)
check('H4: a row that cannot be accepted is reported with its line and its reason',
  (mixed.json?.errors || []).length === 1 && mixed.json.errors[0].line > 0 && typeof mixed.json.errors[0].error === 'string',
  mixed.json?.errors)
check('H4: ...and the rows that are fine still come in', mixed.json?.imported === 1, mixed.json)

// The screen tells a manager this is an owner/admin job; the API has to agree.
const asBud = await upload(budtender, '/api/import/contacts', goodCsv)
check('H4: a budtender cannot import', asBud.status === 403, { status: asBud.status })

console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
