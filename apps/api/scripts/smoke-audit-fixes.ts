/**
 * Temporary smoke test for the audit-fix changes. Run from apps/api:
 *   bun run scripts/smoke-audit-fixes.ts
 * No network calls except mocked fetch — safe to run anywhere.
 */
let pass = 0
let fail = 0
function check(name: string, cond: boolean) {
  if (cond) { pass++; console.log('  PASS', name) }
  else { fail++; console.error('  FAIL', name) }
}
const ctx = (headers: Record<string, string>) => ({
  req: { header: (n: string) => headers[n.toLowerCase()] },
})

// ── 1. shared helpers ────────────────────────────────────────────────────────
console.log('[1] shared.ts helpers')
const { secureEquals, checkFactoryKey, checkCronSecret, UUID_RE } = await import('../src/routes/factory/shared')

check('secureEquals equal strings', secureEquals('abc123', 'abc123') === true)
check('secureEquals unequal same length', secureEquals('abc123', 'abc124') === false)
check('secureEquals different length', secureEquals('abc', 'abcd') === false)
check('secureEquals empty supplied', secureEquals('', 'abc') === false)
check('secureEquals both empty fails closed', secureEquals('', '') === false)

const tenant = { factory_sync_key: 'sk-real-key-001' }
check('checkFactoryKey correct key', checkFactoryKey(ctx({ 'x-factory-key': 'sk-real-key-001' }) as any, tenant) === true)
check('checkFactoryKey wrong key', checkFactoryKey(ctx({ 'x-factory-key': 'sk-wrong' }) as any, tenant) === false)
check('checkFactoryKey missing header', checkFactoryKey(ctx({}) as any, tenant) === false)
check('checkFactoryKey null tenant', checkFactoryKey(ctx({ 'x-factory-key': 'sk-real-key-001' }) as any, null) === false)
check('checkFactoryKey tenant without key fails closed', checkFactoryKey(ctx({ 'x-factory-key': '' }) as any, { factory_sync_key: null }) === false)

const savedCron = process.env.CRON_SECRET
process.env.CRON_SECRET = 'cron-test-secret'
check('checkCronSecret via x-cron-secret', checkCronSecret(ctx({ 'x-cron-secret': 'cron-test-secret' }) as any) === true)
check('checkCronSecret via Bearer', checkCronSecret(ctx({ 'authorization': 'Bearer cron-test-secret' }) as any) === true)
check('checkCronSecret wrong secret', checkCronSecret(ctx({ 'x-cron-secret': 'nope' }) as any) === false)
check('checkCronSecret missing header', checkCronSecret(ctx({}) as any) === false)
process.env.CRON_SECRET = ''
check('checkCronSecret fails closed when CRON_SECRET unset', checkCronSecret(ctx({ 'x-cron-secret': '' }) as any) === false)
process.env.CRON_SECRET = savedCron

// ── 2. Stripe webhook branching ──────────────────────────────────────────────
console.log('[2] factoryStripe.handleFactoryWebhook')
const { handleFactoryWebhook } = await import('../src/services/factoryStripe')

const crmAddonEvent = {
  type: 'checkout.session.completed',
  data: { object: { metadata: { tenant_id: '11111111-2222-3333-4444-555555555555', addon: 'crm' }, customer: 'cus_x' } },
} as any
const r1 = await handleFactoryWebhook(crmAddonEvent)
check('crm addon checkout → handled', r1.handled === true)
check('crm addon checkout → crmAddonTenantId set', r1.crmAddonTenantId === '11111111-2222-3333-4444-555555555555')
check('crm addon checkout → no tenant updates (provision path owns them)', !r1.updates)

const subEvent = {
  type: 'checkout.session.completed',
  data: { object: { metadata: { factory_customer_id: 'cust-1', billing_type: 'subscription', plan_id: 'starter' }, customer: 'cus_y', subscription: 'sub_1' } },
} as any
const r2 = await handleFactoryWebhook(subEvent)
check('normal subscription checkout still handled', r2.handled === true && r2.factoryCustomerId === 'cust-1')
check('normal subscription updates intact', r2.updates?.billing_type === 'subscription' && r2.updates?.status === 'active')

const r3 = await handleFactoryWebhook({ type: 'checkout.session.completed', data: { object: { metadata: {} } } } as any)
check('non-factory checkout unhandled', r3.handled === false)

// ── 3. crmAddonProvision module + in-flight guard ────────────────────────────
console.log('[3] crmAddonProvision imports cleanly')
const addonMod = await import('../src/services/crmAddonProvision')
check('provisionCrmAddonForTenant exported', typeof addonMod.provisionCrmAddonForTenant === 'function')

// ── 4. email retry (mocked fetch) ────────────────────────────────────────────
console.log('[4] sendEmail retry behavior')
process.env.RESEND_API_KEY = 'test-key-not-real'
const realFetch = globalThis.fetch
const { sendEmail } = await import('../src/services/email')

let calls = 0
globalThis.fetch = (async () => {
  calls++
  if (calls < 3) return new Response('boom', { status: 500 })
  return new Response('{"id":"ok"}', { status: 200 })
}) as any
const okAfterRetry = await sendEmail('test@example.com', 'retry test', '<p>hi</p>')
check('retries transient 500s and succeeds on attempt 3', okAfterRetry === true && calls === 3)

calls = 0
globalThis.fetch = (async () => {
  calls++
  return new Response('unauthorized', { status: 401 })
}) as any
const failNoRetry = await sendEmail('test@example.com', 'no-retry test', '<p>hi</p>')
check('hard 4xx fails without retrying', failNoRetry === false && calls === 1)

calls = 0
globalThis.fetch = (async () => {
  calls++
  throw new Error('network down')
}) as any
const failNetwork = await sendEmail('test@example.com', 'network test', '<p>hi</p>')
check('network errors retried 3x then false', failNetwork === false && calls === 3)

globalThis.fetch = realFetch

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
