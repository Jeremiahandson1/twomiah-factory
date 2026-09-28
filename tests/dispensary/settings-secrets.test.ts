// crm-dispensary — what the company settings blob is allowed to tell a browser. (T45 M27)
//
// The tester asked, in as many words, for confirmation that a Stripe secret is never returned. It
// was returned. The Merch tab writes settings.merch.stripeSecretKey into the free-form settings
// blob; the row's secret COLUMNS were stripped on the way out and nothing ever looked inside the
// blob; and /api/auth/me hands that blob to every signed-in role. So any budtender could read the
// shop's payment secret the moment an owner filled that field in — filed as a Medium, and only
// because the tester would not type a fake key to prove it.
//
// The same read also gave the floor the shop's commercial terms: plan, monthlyAmount, billingStatus,
// seatLimit. Nobody reported that; it came out of reading the payload while checking the first one.
//
// Two rules, and the difference matters:
//   · a SECRET goes to nobody, owner included — a value you can read back lives in every browser
//     session, screenshot and support ticket
//   · the shop's TERMS go to whoever settles the bill, not to the floor
//
// And the trap that comes with the fix: once a secret is never read back, the Settings form loads an
// empty box, and saving any other field on that tab would write the empty box over a good key. So an
// empty incoming secret has to mean "leave it alone".
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { company, user } from './db/schema.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) }
}

await setupSchema()

const SECRET = 'sk_test_THIS_MUST_NEVER_LEAVE_THE_SERVER'

const [co] = await db.insert(company).values({
  name: 'Secret Dispensary', slug: 'secrets', email: 'secrets@test.local', state: 'OH',
  settings: {
    merch: { enabled: true, stripePublishableKey: 'pk_test_fine_to_show', stripeSecretKey: SECRET },
    plan: 'pro', monthlyAmount: 299, billingStatus: 'active', seatLimit: 10,
    defaultTaxRate: 10, keepMe: 'yes',
  },
  enabledFeatures: ['orders', 'products'],
} as any).returning()

const mkUser = async (role: string, tag: string) => (await db.insert(user).values({
  email: `${tag}-secrets@test.local`, passwordHash: 'x', firstName: tag, lastName: 'U', role, companyId: co.id,
} as any).returning())[0]

const owner = await mkUser('owner', 'owner')
const budtender = await mkUser('user', 'budtender')   // stored `user`, normalised to budtender

const app = new Hono()
app.route('/api/company', (await import('./src/routes/company.ts')).default)

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
const asBudtender = as(budtender)

// ── the secret reaches nobody ──────────────────────────────────────────────────────────────────
for (const [label, who] of [['a budtender', asBudtender], ['the owner', asOwner]] as const) {
  const r = await who('GET', '/api/company')
  check(`GET /api/company: the Stripe secret does not reach ${label}`, !r.text.includes(SECRET),
    { leaked: r.text.includes(SECRET) })
  check(`GET /api/company: ...and ${label} still sees the PUBLISHABLE key, which is public by design`,
    r.json?.settings?.merch?.stripePublishableKey === 'pk_test_fine_to_show', r.json?.settings?.merch)
  check(`GET /api/company: ...and is told one IS configured, so nobody overwrites it with a blank`,
    r.json?.settings?.merch?.stripeSecretKeyConfigured === true, r.json?.settings?.merch)
}

// ── the shop's commercial terms are the owner's ────────────────────────────────────────────────
const staffView = await asBudtender('GET', '/api/company')
const ownerView = await asOwner('GET', '/api/company')
for (const k of ['plan', 'monthlyAmount', 'billingStatus', 'seatLimit']) {
  check(`the floor is not told the shop's ${k}`, (staffView.json?.settings || {})[k] === undefined,
    { key: k, value: (staffView.json?.settings || {})[k] })
  check(`...and the owner still is`, (ownerView.json?.settings || {})[k] !== undefined, k)
}
check('ordinary settings still reach the floor — this is a redaction, not a blackout',
  staffView.json?.settings?.defaultTaxRate === 10 && staffView.json?.settings?.keepMe === 'yes',
  staffView.json?.settings)

// ── the trap: saving the tab must not wipe the key it can no longer see ────────────────────────
const stored = async () => {
  const r: any = await db.execute(sql`SELECT settings FROM company WHERE id = ${co.id}`)
  return ((r as any).rows || r)?.[0]?.settings || {}
}
check('setup: the key really is in the database', (await stored())?.merch?.stripeSecretKey === SECRET)

// This is what the Merch tab sends after loading from a redacted read: publishable filled in from
// what it could see, secret an empty box.
const blanked = await asOwner('PUT', '/api/company', {
  settings: { merch: { enabled: true, stripePublishableKey: 'pk_test_fine_to_show', stripeSecretKey: '' } },
})
check('a save with an empty secret box succeeds', blanked.status === 200, { status: blanked.status, body: blanked.json })
check('…and the stored key survived it', (await stored())?.merch?.stripeSecretKey === SECRET,
  { stored: (await stored())?.merch?.stripeSecretKey })

// An owner typing a new key still replaces it.
const replaced = await asOwner('PUT', '/api/company', {
  settings: { merch: { enabled: true, stripeSecretKey: 'sk_test_A_NEW_ONE' } },
})
check('a real new key replaces the old one', replaced.status === 200 && (await stored())?.merch?.stripeSecretKey === 'sk_test_A_NEW_ONE',
  (await stored())?.merch?.stripeSecretKey)
check('…and the new one is not read back either', !replaced.text.includes('sk_test_A_NEW_ONE'))

// And an explicit null still clears the whole merch block, which is how a shop disconnects.
const cleared = await asOwner('PUT', '/api/company', { settings: { merch: null } })
check('an explicit null still removes it — a shop can disconnect', cleared.status === 200 && (await stored())?.merch === undefined,
  (await stored())?.merch)

console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
