// The Factory hears a plan subscription's lifecycle whether or not the subscription carries the tenant id.
// (10/14) subscription_data.metadata was set only for a trial; signup offers none, so every subscription arrived
// without factory_customer_id and customer.subscription.updated / .deleted answered "Not a factory subscription" —
// Settings › Billing never had a next billing date, and a subscription canceled in Stripe never suspended the tenant.
delete process.env.STRIPE_SECRET_KEY // no Stripe client: nothing here may reach Stripe
const SRC = new URL('../../apps/api/src/services/factoryStripe.ts', import.meta.url)
const { handleFactoryWebhook } = await import(SRC.href)
const { readFileSync } = await import('node:fs')

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) }
}
const ev = (type: string, object: any) => ({ type, data: { object } }) as any
const END = 1_800_000_000 // 2027-01-15

{
  // a subscription from before 10/14: no metadata at all
  const r = await handleFactoryWebhook(ev('customer.subscription.updated', { id: 'sub_old', status: 'active', metadata: {}, current_period_end: END, items: { data: [] } }))
  check('an update to a subscription with no tenant id is found by its own id', r.handled && r.lookupField === 'stripe_subscription_id' && r.lookupValue === 'sub_old', r)
  check('…and records the next billing date', r.updates?.next_billing_date === new Date(END * 1000).toISOString(), r.updates)
  const d = await handleFactoryWebhook(ev('customer.subscription.deleted', { id: 'sub_old', status: 'canceled', metadata: {} }))
  check('a canceled subscription with no tenant id still suspends its tenant', d.handled && d.lookupValue === 'sub_old' && d.updates?.status === 'suspended' && d.updates?.billing_status === 'canceled', d)
}
{
  const r = await handleFactoryWebhook(ev('customer.subscription.updated', { id: 'sub_new', status: 'past_due', metadata: { factory_customer_id: 'tenant-1' }, current_period_end: END, items: { data: [] } }))
  check('a subscription with the tenant id goes to that tenant', r.handled && r.factoryCustomerId === 'tenant-1' && r.updates?.billing_status === 'past_due', r)
}
{
  // an add-on's own subscription is the webhook route's business, never the plan's
  for (const type of ['customer.subscription.updated', 'customer.subscription.deleted']) {
    const r = await handleFactoryWebhook(ev(type, { id: 'sub_msg', status: 'canceled', metadata: { addon: 'messaging_enable', tenant_id: 'tenant-1' }, items: { data: [] } }))
    check(`${type} for a messaging add-on is not treated as the plan`, !r.handled, r)
  }
}
{
  const r = await handleFactoryWebhook(ev('invoice.paid', { subscription: 'sub_new', lines: { data: [{ type: 'subscription', period: { start: END - 2_592_000, end: END } }] } }))
  check('a paid invoice moves the next billing date to the end of the period it paid for', r.handled && r.updates?.next_billing_date === new Date(END * 1000).toISOString() && r.updates?.billing_status === 'active', r)
}
{
  // The Factory endpoint is on 2026-02-25.clover: since 2025-03-31.basil the invoice names its subscription under
  // parent, its lines say what they are under parent.type, and the period end is on the subscription's items.
  const paid = await handleFactoryWebhook(ev('invoice.paid', {
    parent: { type: 'subscription_details', subscription_details: { subscription: 'sub_clover', metadata: {} } },
    lines: { data: [{ parent: { type: 'subscription_item_details', subscription_item_details: { subscription: 'sub_clover' } }, period: { start: END - 2_592_000, end: END } }] },
  }))
  check('clover: a paid invoice finds its tenant by the subscription under parent', paid.handled && paid.lookupField === 'stripe_subscription_id' && paid.lookupValue === 'sub_clover', paid)
  check('clover: …and records the next billing date from the line\'s period', paid.updates?.next_billing_date === new Date(END * 1000).toISOString(), paid.updates)
  const failedPay = await handleFactoryWebhook(ev('invoice.payment_failed', { parent: { type: 'subscription_details', subscription_details: { subscription: 'sub_clover' } } }))
  check('clover: a failed payment marks that tenant past due', failedPay.handled && failedPay.lookupValue === 'sub_clover' && failedPay.updates?.billing_status === 'past_due', failedPay)
  const upd = await handleFactoryWebhook(ev('customer.subscription.updated', { id: 'sub_clover', status: 'active', metadata: {}, items: { data: [{ current_period_end: END, price: {} }] } }))
  check('clover: a subscription update reads the period end from its item', upd.handled && upd.updates?.next_billing_date === new Date(END * 1000).toISOString(), upd.updates)
  const oneOff = await handleFactoryWebhook(ev('invoice.paid', { parent: { type: 'quote_details' }, lines: { data: [] } }))
  check('an invoice with no subscription is not a plan renewal', !oneOff.handled, oneOff)
}
{
  // every checkout tags its subscription, trial or not
  const src = readFileSync(SRC, 'utf8')
  const block = src.slice(src.indexOf('export async function createSubscriptionCheckout'), src.indexOf('const session = await stripe.checkout.sessions.create(sessionParams)'))
  check('createSubscriptionCheckout sets subscription_data.metadata outside any trial condition',
    /\n  sessionParams\.subscription_data = \{[\s\S]*?metadata: \{ factory_customer_id: factoryCustomer\.id/.test(block) && !/if \(trialDays > 0\) \{\s*sessionParams\.subscription_data/.test(block))
}

console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
