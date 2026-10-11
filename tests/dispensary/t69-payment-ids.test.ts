// T69 — contact records handed out the Stripe customer id (and its connected account, acct_…) kept in
// contact.customFields. Dispensary forks its contacts route and stripped the portal token with its own copy of the
// rule, which knew nothing else; it now uses the shared withoutPortalCredential. Through the real router, every seat
// that reads customers: list, detail, a save's answer. And the save keeps the ids in the database — the strip is on
// the way out, and nothing that saves a customer accepts customFields.
import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { company, user, contact } from './db/schema.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 320)) }
}

await setupSchema()
const [co] = await db.insert(company).values({ name: 'Green Mile', slug: 'green-t69', email: 'green-t69@test.local', state: 'OH', settings: {}, enabledFeatures: [] } as any).returning()
const mk = async (role: string, tag: string) => (await db.insert(user).values({
  email: `${tag}@green-t69.local`, passwordHash: 'x', firstName: tag, lastName: 'U', role, companyId: co.id,
} as any).returning())[0]
const seats = [[await mk('owner', 'owner'), 'owner'], [await mk('manager', 'manager'), 'manager'], [await mk('budtender', 'budtender'), 'budtender'], [await mk('viewer', 'viewer'), 'viewer']] as const

const CUS = 'cus_T69dispQx7', ACCT = 'acct_T69dispZq4'
const [cust] = await db.insert(contact).values({
  companyId: co.id, name: 'Rowan Hale', email: 'rowan-t69@test.local', type: 'customer', portalToken: 'tok-t69-disp',
  customFields: { stripeCustomerId: CUS, stripeCustomerAccount: ACCT, emailOptOut: false },
} as any).returning()

const app = new Hono()
app.route('/api/contacts', (await import('./src/routes/contacts.ts')).default)
const call = async (who: any, method: string, path: string, body?: unknown) => {
  const res = await app.request(path, { method, headers: { 'x-test-user': who.id, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j, text: t }
}
const LEAK = /cus_T69disp|acct_T69disp|stripeCustomer|tok-t69-disp/

for (const [who, label] of seats) {
  for (const [door, path] of [['customers list', '/api/contacts'], ['customer detail', `/api/contacts/${cust.id}`]] as const) {
    const r = await call(who, 'GET', path)
    check(`${label}: ${door} answers 200`, r.status === 200, { s: r.status, t: r.text.slice(0, 160) })
    check(`${label}: ${door} carries no Stripe customer id, no connected account, no portal token`, !LEAK.test(r.text), r.text.match(/.{60}(?:cus_T69|acct_T69|stripeCustomer|tok-t69).{30}/)?.[0])
  }
  const d = await call(who, 'GET', `/api/contacts/${cust.id}`)
  check(`${label}: the shop's own custom field still reaches the screen`, d.json?.customFields?.emailOptOut === false, d.json?.customFields)
}

const [owner] = seats[0]
const saved = await call(owner, 'PUT', `/api/contacts/${cust.id}`, { name: 'Rowan Hale-Ames' })
check('the owner saves the customer (200) and the answer carries no ids', saved.status === 200 && saved.json?.name === 'Rowan Hale-Ames' && !LEAK.test(saved.text), { s: saved.status, t: saved.text.slice(0, 200) })
const [row] = await db.select({ customFields: contact.customFields }).from(contact).where(eq(contact.id, cust.id))
check('…and the database still holds both ids for services/stripe.ts', (row as any).customFields?.stripeCustomerId === CUS && (row as any).customFields?.stripeCustomerAccount === ACCT, row)

// T69 cosmetic: My Account showed the viewer a "Till PIN" heading with no card under it. The whole section is gated now.
const { readFileSync } = await import('node:fs')
const ROOT = (() => { const r = process.env.FACTORY_ROOT; if (!r) throw new Error('FACTORY_ROOT is not set'); return r.endsWith('/') ? r : r + '/' })()
const acct = readFileSync(ROOT + 'templates/crm-dispensary/frontend/src/pages/MyAccountPage.tsx', 'utf8').replace(/\r\n/g, '\n')
const pinAt = acct.indexOf('<section aria-labelledby="acct-pin">')
check('My Account: the Till PIN section (heading and card) sits inside the viewer gate',
  pinAt > 0 && /\{user\?\.role !== 'viewer' && \(\s*<section aria-labelledby="acct-pin">/.test(acct), acct.slice(Math.max(0, pinAt - 160), pinAt + 40))
check('…and nothing else names the PIN outside it', (acct.match(/acct-pin/g) || []).length === 2)

console.log(`\nt69 payment ids (dispensary): ${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
