// T63 — owner (2026-10-09): "anyone should be able to add a lead, but only managers should be able to add a source,
// like a dropdown … staff should be able to choose the lead source, and add an other for one offs, but not add actual
// lead source choices."
//
// GET /api/contacts/source-options — everyone who opens the form; PUT — leads:update (owners, admins, managers).
// The list lives in company.settings.leadSourceOptions beside the plan and the money defaults, which must survive the
// write. A one-off "Other" is saved on its contact and never joins the list.
import { Hono } from 'hono'
import { eq } from 'drizzle-orm'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) }
}

const { setupSchema } = await import('./setup.ts')
await setupSchema()
const { db } = await import('./db/index.ts')
const { company, user, contact } = await import('./db/schema.ts')

const [co] = await db.insert(company).values({ name: 'Source Builders', slug: 'src-t63', email: 'src-t63@test.local', settings: { plan: 'pro', defaultTaxRate: 7.5 }, enabledFeatures: ['contacts'] } as any).returning()
const mk = async (role: string, tag: string) => (await db.insert(user).values({ email: `${tag}@src-t63.local`, passwordHash: 'x', firstName: tag, lastName: 'U', role, companyId: co.id, isActive: true } as any).returning())[0]
const owner = await mk('owner', 'owner'), manager = await mk('manager', 'manager'), staff = await mk('field', 'staff'), viewer = await mk('viewer', 'viewer')

const app = new Hono()
app.route('/api/contacts', (await import('./src/routes/contacts.ts')).default)
app.onError((await import('./src/utils/errors.ts')).errorHandler)
const as = (who: any) => async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, { method, headers: { 'content-type': 'application/json', 'x-test-user': who.id }, body: body === undefined ? undefined : JSON.stringify(body) })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j }
}
const P = '/api/contacts/source-options'

const d = await as(staff)('GET', P)
check('staff read the choices — the defaults until a manager saves a list', d.status === 200 && d.json?.isDefault === true && d.json?.options?.includes('Referral'), d.json)
check('…and "Other" is not one of them (the form always offers it)', !d.json?.options?.some((o: string) => o.toLowerCase() === 'other'), d.json?.options)

for (const [who, label] of [[staff, 'staff'], [viewer, 'a viewer']] as const) {
  const r = await as(who)('PUT', P, { options: ['Referral', 'Billboard'] })
  check(`${label} cannot change the choices (403)`, r.status === 403, r)
}

const saved = await as(manager)('PUT', P, { options: ['  Yard sign ', 'Referral', 'referral', '', 'Other', 'Home   show', 'Google'] })
check('a manager saves the choices', saved.status === 200 && saved.json?.isDefault === false, saved)
check('…cleaned: trimmed, blanks and case-duplicates dropped, "Other" dropped, inner spaces squeezed', JSON.stringify(saved.json?.options) === JSON.stringify(['Yard sign', 'Referral', 'Home show', 'Google']), saved.json?.options)
const [after] = await db.select().from(company).where(eq(company.id, co.id))
check('…and the rest of the company settings are untouched (plan, tax rate)', (after.settings as any)?.plan === 'pro' && (after.settings as any)?.defaultTaxRate === 7.5 && Array.isArray((after.settings as any)?.leadSourceOptions), after.settings)

const read = await as(staff)('GET', P)
check('staff now read the saved list', read.status === 200 && read.json?.isDefault === false && read.json?.options?.[0] === 'Yard sign', read.json)

const long = await as(owner)('PUT', P, { options: ['x'.repeat(41)] })
check('a choice over 40 characters is refused, with the field named', long.status === 400 && long.json?.field === 'options', long)
const notList = await as(owner)('PUT', P, { options: 'Referral' })
check('a body that is not a list is refused', notList.status === 400, notList)

const one = await as(owner)('POST', '/api/contacts', { name: 'Pat Okoro', type: 'lead', source: 'Met at the county fair' })
check('a one-off "Other" source saves on the contact', one.status === 201 && one.json?.source === 'Met at the county fair', one)
const still = await as(staff)('GET', P)
check('…and does not join the list', !still.json?.options?.includes('Met at the county fair') && still.json?.options?.length === 4, still.json?.options)

console.log(`\nt63 source options: ${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
