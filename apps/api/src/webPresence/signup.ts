// Signing up for the $19 Web presence plan (the twomiah.com signup, behind the switch). Pay-then-deploy like every plan: the account is made
// pending, the owner pays, and the paid webhook sets the Netlify site up (triggerAutoDeploy → provisionSite). Nothing is built before payment,
// and there is no CRM or Render build at all. Everything outside is injected so a test makes no live call.
import { requireWebPresence, WEB_PRESENCE_PLAN_ID, WEB_PRESENCE_PRICE_USD } from './switch.ts'
import { verticalFor } from '../config/industryRouting'

export interface SignupDeps {
  db: any
  env: Record<string, string | undefined>
  /** The free name for this account (the same slug rule as every signup), or null. */
  allocateSlug: (base: string) => Promise<string | null>
  /** The page the owner sees in the preview, composed from the signup's answers (services/signupSite.signupComposition). */
  compose: (body: any) => Record<string, any>
  /** Start Stripe checkout for the plan. */
  checkout: (tenant: any, urls: { successUrl: string; cancelUrl: string }) => Promise<{ url: string | null; stripeCustomerId?: string }>
  /** After the insert, in the background: the AI-written version of the same page. Never awaited. */
  composeAi?: (tenantId: string) => void
  /** The look the owner chose in the preview, already checked (config/siteLooks requestedLook). */
  design?: string | null
}

export interface SignupResult { status: number; body: Record<string, unknown> }

const clean = (v: unknown, max: number): string => (typeof v === 'string' ? v.replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '')

export async function webPresenceSignup(body: any, d: SignupDeps): Promise<SignupResult> {
  requireWebPresence(d.env)
  const name = clean(body?.name, 80)
  const email = clean(body?.email, 200)
  if (name.length < 2) return { status: 400, body: { error: 'Company name is required (min 2 characters)' } }
  if (!email.includes('@')) return { status: 400, body: { error: 'Valid email is required' } }

  const base = clean(body?.slug, 60) || name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
  if (!base) return { status: 400, body: { error: 'Company name is required (min 2 characters)' } }
  const slug = await d.allocateSlug(base)
  if (!slug) return { status: 503, body: { error: 'We could not reserve a name for your account just now. Please try again in a few minutes.' } }

  const industry = clean(body?.industry, 80) || null
  const pages = d.compose(body)
  const record: Record<string, unknown> = {
    name, slug, email,
    admin_email: clean(body?.admin_email, 200) || email,
    phone: clean(body?.phone, 40) || null,
    industry,
    city: clean(body?.city, 120) || null,
    state: clean(body?.state, 80) || null,
    zip: clean(body?.zip, 20) || null,
    primary_color: '#FF3D00',
    plan: WEB_PRESENCE_PLAN_ID,
    deployment_model: 'saas',
    billing_type: 'subscription',
    billing_status: 'pending',
    monthly_amount: WEB_PRESENCE_PRICE_USD,
    status: 'pending',
    products: ['website'],
    features: [],
    preview_premium_pages: pages,
    intake_data: { signup: { ...(d.design ? { design: d.design } : {}), plan: WEB_PRESENCE_PLAN_ID, trade: verticalFor(industry), at: new Date().toISOString() } },
  }
  const { data: tenant, error } = await d.db.from('tenants').insert(record).select().single()
  if (error || !tenant) return { status: 500, body: { error: 'Failed to create account. Please try again.' } }

  if (d.composeAi) { try { d.composeAi(tenant.id) } catch { /* the template page is already stored */ } }

  const siteUrl = String(d.env.PUBLIC_SITE_URL || 'https://twomiah.com').replace(/\/$/, '')
  try {
    const out = await d.checkout(tenant, { successUrl: siteUrl + '/welcome?tenant=' + tenant.id, cancelUrl: siteUrl + '/signup?canceled=1' })
    if (!out.url) throw new Error('no checkout url')
    if (out.stripeCustomerId && !tenant.stripe_customer_id) await d.db.from('tenants').update({ stripe_customer_id: out.stripeCustomerId }).eq('id', tenant.id)
    return { status: 200, body: { success: true, tenantId: tenant.id, slug: tenant.slug, checkoutUrl: out.url, message: 'Account created — complete checkout to launch your page.' } }
  } catch {
    return { status: 502, body: { error: 'Account created, but we could not start checkout. Please try again or contact support.', tenantId: tenant.id } }
  }
}
