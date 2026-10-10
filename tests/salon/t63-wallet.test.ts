// T63 Low — "/messaging-billing/status still returns the wallet balance" to staff. The balance, ledger and monthly
// charges go to whoever settles the bill (company:update); every other seat gets configured / enabled / walletEmpty —
// what the Reminders send screen warns on. (No Factory is configured in the sandbox, so the status is the empty one;
// what is asserted is which KEYS each seat is handed.)
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

const [co] = await db.insert(company).values({ name: 'Wallet Salon', slug: 'wallet-t63', email: 'wallet-t63@test.local', settings: {}, enabledFeatures: [] } as any).returning()
const mk = async (role: string, tag: string) => (await db.insert(user).values({ email: `${tag}@wallet-t63.local`, passwordHash: 'x', firstName: tag, lastName: 'U', role, companyId: co.id, isActive: true } as any).returning())[0]
const owner = await mk('owner', 'owner'), manager = await mk('manager', 'manager'), stylist = await mk('field', 'stylist')

const app = new Hono()
app.route('/api/messaging-billing', (await import('./src/routes/messagingBilling.ts')).default)
app.onError((await import('./src/utils/errors.ts')).errorHandler)
const get = async (who: any) => {
  const res = await app.request('/api/messaging-billing/status', { headers: { 'x-test-user': who.id } })
  return { status: res.status, json: await res.json().catch(() => null) as any }
}

for (const [who, label] of [[stylist, 'a stylist'], [manager, 'a manager']] as const) {
  const r = await get(who)
  check(`${label} reads whether texting is on and whether the wallet is empty`, r.status === 200 && 'configured' in r.json && 'enabled' in r.json && typeof r.json.walletEmpty === 'boolean', r.json)
  check(`…and is not handed the balance, the ledger or the monthly charges`, !('walletCents' in r.json) && !('ledger' in r.json) && !('enableMonthlyCents' in r.json) && !('aiEnableMonthlyCents' in r.json), Object.keys(r.json || {}))
}
const o = await get(owner)
check('the owner gets the full status, balance included', o.status === 200 && 'walletCents' in o.json && 'ledger' in o.json && typeof o.json.walletEmpty === 'boolean', Object.keys(o.json || {}))

console.log(`\nt63 wallet: ${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
