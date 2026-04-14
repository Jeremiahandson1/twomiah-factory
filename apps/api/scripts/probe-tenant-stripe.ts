/**
 * Read a tenant's Stripe billing fields to determine whether the
 * checkout.session.completed webhook ever landed.
 *
 *   bun scripts/probe-tenant-stripe.ts <slug-pattern>
 */
import { createClient } from '@supabase/supabase-js'
import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const envPath = path.join(__dirname, '..', '.env')
const envVars: Record<string, string> = {}
for (const rawLine of fs.readFileSync(envPath, 'utf8').split('\n')) {
  const line = rawLine.replace(/\r$/, '')
  const m = line.match(/^([^#=]+)=(.*)$/)
  if (m) envVars[m[1].trim()] = m[2].trim()
}

const supabase = createClient(
  envVars.SUPABASE_URL!,
  envVars.SUPABASE_SERVICE_ROLE_KEY!
)
const Stripe = (await import('stripe')).default
const stripe = new Stripe(envVars.STRIPE_SECRET_KEY!)

const slug = process.argv[2]
if (!slug) { console.error('usage: <slug>'); process.exit(1) }

const { data: tenant } = await supabase
  .from('tenants')
  .select('*')
  .ilike('slug', `%${slug}%`)
  .order('created_at', { ascending: false })
  .limit(1)
  .maybeSingle()

if (!tenant) { console.error('tenant not found'); process.exit(1) }

console.log('── Tenant from Supabase ──')
console.log('id:', tenant.id)
console.log('slug:', tenant.slug)
console.log('status:', tenant.status)
console.log('plan:', tenant.plan)
console.log('stripe_customer_id:', tenant.stripe_customer_id || '(null)')
console.log('stripe_subscription_id:', tenant.stripe_subscription_id || '(null)')
console.log('billing_status:', tenant.billing_status || '(null)')
console.log('billing_type:', tenant.billing_type || '(null)')
console.log('monthly_amount:', tenant.monthly_amount)

// If we have a Stripe customer, query Stripe directly to see what's there
if (tenant.stripe_customer_id) {
  console.log('\n── Stripe customer + subscriptions ──')
  try {
    const customer = await stripe.customers.retrieve(tenant.stripe_customer_id)
    console.log('customer.email:', (customer as any).email)
    const subs = await stripe.subscriptions.list({ customer: tenant.stripe_customer_id, limit: 5 })
    console.log('subscriptions:', subs.data.length)
    for (const s of subs.data) {
      console.log('  -', s.id, 'status=' + s.status, 'items=' + s.items.data.map(i => i.price.nickname || i.price.id).join(','))
    }
  } catch (e: any) {
    console.log('stripe error:', e.message)
  }
}

// Query Stripe for recent checkout sessions with this tenant as client_reference
console.log('\n── Recent Stripe checkout sessions (all, filtered) ──')
const sessions = await stripe.checkout.sessions.list({ limit: 20 })
const matching = sessions.data.filter(s =>
  s.metadata?.factory_customer_id === tenant.id ||
  s.customer_email?.includes('e2e-care-pay')
)
console.log('Matching sessions for this tenant:', matching.length)
for (const s of matching) {
  console.log('  -', s.id, 'status=' + s.status, 'payment_status=' + s.payment_status, 'created=' + new Date(s.created * 1000).toISOString())
}
