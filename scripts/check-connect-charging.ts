// CI guard: a business that clicked "Connect Stripe" is charged on ITS connected account, and its
// connected-account webhooks reach its CRM.
//  Before #154 the onboarding stored company.integrations.stripeAccountId and nothing read it: every
//  PaymentIntent/customer/refund went to the platform (Twomiah) account and no webhook ever reached the
//  tenant. This asserts: every Stripe call about a business's money carries requestOpts(stripeAccount);
//  Stripe.js init responses carry stripeAccount; the tenant accepts forwarded events on
//  /factory-event with X-Factory-Key; the Factory verifies + forwards Connect events, the tenant
//  registers its account, the schema has the column, and the auth exemptions exist.
//   bun scripts/check-connect-charging.ts
import { readFileSync } from 'node:fs'
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
const read = (p: string) => strip(readFileSync(new URL(`../${p}`, import.meta.url), 'utf8'))

let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

// (1) every money call on the Stripe SDK is scoped. Match each call start and check its closing `)` is
// preceded by `requestOpts(...)` — the options argument is always last.
const svc = read('packages/tenant-backend/src/payments/stripe.ts')
const callRe = /stripe!?\.(paymentIntents|customers|setupIntents|paymentMethods|refunds|checkout\.sessions|products|prices|paymentLinks)\.(create|retrieve|update|list)\(/g
let m: RegExpExecArray | null
let calls = 0
while ((m = callRe.exec(svc))) {
  calls++
  // walk to the matching close paren
  let depth = 1, i = m.index + m[0].length
  for (; i < svc.length && depth > 0; i++) { if (svc[i] === '(') depth++; else if (svc[i] === ')') depth-- }
  const callText = svc.slice(m.index, i)
  if (!/requestOpts\(\s*stripeAccount\s*\)\s*\)$/.test(callText)) fail(`unscoped Stripe call: ${callText.split('\n')[0].trim()}… must end with requestOpts(stripeAccount)`)
}
if (calls < 12) fail(`expected to find the Stripe money calls (found ${calls})`)
if (!/async function connectedAccountFor\(/.test(svc) || !/integrations as any\)\?\.stripeAccountId/.test(svc)) fail('connectedAccountFor must read company.integrations.stripeAccountId (the field the shared integrations module stores)')
if (!/const requestOpts = \(stripeAccount: string \| null \| undefined\) => \(stripeAccount \? \{ stripeAccount \} : undefined\)/.test(svc)) fail('requestOpts must pass { stripeAccount } only when set (own-key businesses stay byte-identical)')
for (const fn of ['createPaymentIntent', 'createPartialPaymentIntent', 'createSetupIntent', 'createBookingDepositIntent']) {
  const i = svc.indexOf(`async function ${fn}(`); const body = i < 0 ? '' : svc.slice(i, svc.indexOf('\n  }\n', i))
  if (!/\n\s+stripeAccount,\n\s+\}/.test(body)) fail(`${fn} must return stripeAccount (Stripe.js is initialised with it)`)
}
if (!/saved\.stripeCustomerId && savedAccount === \(stripeAccount \|\| null\)/.test(svc)) fail('getOrCreateCustomer must reuse customFields.stripeCustomerId only for the same account')
if (!/fields\.stripeCustomerAccount = stripeAccount \|\| null/.test(svc)) fail('getOrCreateCustomer must record which account the customer was created on')
if (!/const stripeAccount = \(\(event as any\)\.account as string \| undefined\) \|\| null/.test(svc)) fail('handleWebhook must take the connected account from event.account')
// (2) forwarded-event route, before auth, factory-key gated.
const routeIdx = svc.indexOf("app.post('/factory-event'"), authIdx = svc.indexOf("app.use('*', async (c, next) => (c.req.path.includes('/portal/')")
if (routeIdx < 0) fail('routes must expose POST /factory-event')
else {
  if (authIdx > 0 && routeIdx > authIdx) fail('/factory-event must be registered before the auth middleware (the Factory has no user session)')
  const body = svc.slice(routeIdx, svc.indexOf('\n  })\n', routeIdx))
  if (!/X-Factory-Key/.test(body) || !/FACTORY_SYNC_KEY/.test(body)) fail('/factory-event must check X-Factory-Key against FACTORY_SYNC_KEY')
  if (!/stripeService\.handleWebhook\(event\)/.test(body)) fail('/factory-event must hand the event to handleWebhook')
}
// (3) tenant registers its account with the Factory.
const integ = read('packages/tenant-backend/src/integrations/integrations.ts')
if (!/factoryApiClient\?: \{ registerStripeAccount\(accountId: string \| null\)/.test(integ)) fail('integrations deps must accept factoryApiClient.registerStripeAccount')
if (!/registerStripeAccount\(accountId, true\)/.test(integ) || !/registerStripeAccount\(null, true\)/.test(integ)) fail('connect-url must register the account and disconnect must clear it')
if (!/registerStripeAccount\(integrations\.stripeAccountId\)/.test(integ)) fail('/status must (re)register an already-connected account')
if (!/registerStripeAccount\(accountId\)/.test(read('packages/tenant-backend/src/factoryClient.ts'))) fail('factoryClient must expose registerStripeAccount')
for (const t of ['crm', 'crm-fieldservice', 'crm-landscaping', 'crm-restaurant', 'crm-rv', 'crm-salon', 'crm-vet']) {
  if (!/factoryApiClient: createFactoryApiClient\(\)/.test(read(`templates/${t}/backend/src/routes/integrations.ts`))) fail(`${t}/routes/integrations.ts must pass factoryApiClient`)
}
// (4) Factory side.
const lifecycle = read('apps/api/src/routes/factory/lifecycle.ts')
if (!/factory\.post\('\/customers\/:id\/stripe-connect'/.test(lifecycle) || !/checkFactoryKey\(c, tenant\)/.test(lifecycle.slice(lifecycle.indexOf("'/customers/:id/stripe-connect'")))) fail('Factory must expose POST /customers/:id/stripe-connect with tenant-key auth')
if (!/stripe_connect_account_id: accountId/.test(lifecycle)) fail('stripe-connect route must store tenants.stripe_connect_account_id')
const billing = read('apps/api/src/routes/factory/billing.ts')
if (!/factory\.post\('\/stripe\/connect-webhook'/.test(billing) || !/verifyConnectWebhookSignature/.test(billing) || !/forwardConnectEvent\(/.test(billing)) fail('Factory must expose POST /stripe/connect-webhook that verifies with the Connect secret and forwards')
if (!/eq\('stripe_connect_account_id', accountId\)/.test(billing)) fail('connect-webhook must look the tenant up by stripe_connect_account_id')
if (!/STRIPE_CONNECT_WEBHOOK_SECRET/.test(read('apps/api/src/services/factoryStripe.ts'))) fail('factoryStripe must verify Connect events with STRIPE_CONNECT_WEBHOOK_SECRET')
const fwd = read('apps/api/src/services/connectWebhook.ts')
if (!/\/api\/stripe\/factory-event/.test(fwd) || !/'X-Factory-Key': tenant\.factory_sync_key/.test(fwd)) fail('forwarder must POST /api/stripe/factory-event with the tenant factory key')
const auth = read('apps/api/src/routes/factory.ts')
if (!/stripe\/connect-webhook/.test(auth) || !/stripe-connect\$/.test(auth)) fail('factory.ts must exempt /stripe/connect-webhook and /customers/:id/stripe-connect from JWT auth')
if (!/stripe_connect_account_id text/.test(read('apps/api/schema.sql'))) fail('schema.sql must carry tenants.stripe_connect_account_id')
if (!/connect.*true/.test(read('apps/api/scripts/register-connect-webhook.ts'))) fail('register-connect-webhook.ts must create the endpoint with connect=true')

if (failed) { console.error(`\nconnect charging: ${failed} check(s) FAILED`); process.exit(1) }
console.log(`connect charging: ${calls} Stripe money calls scoped to the connected account; forwarded-event route, registration, Factory receiver + schema in place`)
