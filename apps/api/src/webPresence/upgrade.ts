// "Upgrade to the full plan": a full-plan business (unified tenant) is built from the one-page site's content, the owner pays for it, and
// only when it is live does the Netlify site go and the old $19 subscription end (service.sweep). Nothing is lost if they stop part-way:
// the one-page site stays up and paid until the new business is live.
import { requireWebPresence, WEB_PRESENCE_PLAN_ID } from './switch.ts'
import { signRequest, siteSecret } from './site/session.mjs'
import { WEB_PRESENCE_SECTIONS } from '../../../unified/server/site/webPresenceSections.ts'
import { engineForSignup } from '../unified/factory'
import { siteRowFor, type Deps } from './service.ts'

export interface UpgradeDeps extends Deps {
  allocateSlug: (base: string) => Promise<string | null>
  checkout: (tenant: any, o: { planId: string; successUrl: string; cancelUrl: string }) => Promise<{ url: string | null; stripeCustomerId?: string }>
}

export const FULL_PLAN_ID = 'website'

/** The one-page model as the full product's home page: visible sections only, minus what only this plan has (the hiring form, today's spot…). */
export function homeCompositionFrom(model: any): Record<string, any> {
  const sections = (Array.isArray(model?.sections) ? model.sections : [])
    .filter((s: any) => s && s.hidden !== true && s.type !== 'hiring' && !WEB_PRESENCE_SECTIONS.has(s.type + '/' + s.variant) && typeof s.type === 'string')
    .map((s: any) => ({ type: s.type, variant: s.variant, data: s.data ?? {} }))
  return { pages: { home: { sections } }, composer: 'web-presence', composedAt: new Date().toISOString() }
}

export async function exportOf(d: UpgradeDeps, row: { id: string; origin: string | null }): Promise<any> {
  const master = String(d.env.WEB_PRESENCE_SECRET_KEY || '')
  if (!master || !row.origin) throw new Error('This site cannot be reached to carry its content over')
  const ts = String(Math.floor(d.now() / 1000))
  const sig = await signRequest(await siteSecret(master, row.id), ts, 'export')
  const res = await d.fetch(row.origin.replace(/\/+$/, '') + '/api/export', { method: 'GET', headers: { 'x-wp-ts': ts, 'x-wp-sig': sig } })
  if (!res.ok) throw new Error('The site did not hand over its content')
  const out: any = await res.json()
  if (!out?.model) throw new Error('The site did not hand over its content')
  return out.model
}

export async function startUpgrade(d: UpgradeDeps, tenantId: string): Promise<{ checkoutUrl: string; tenantId: string }> {
  requireWebPresence(d.env)
  const row = await siteRowFor(d, { tenantId })
  if (!row || !['live', 'upgrading'].includes(row.status)) throw new Error('This customer has no live Web presence site')
  const { data: old } = await d.db.from('tenants').select('id, name, slug, email, admin_email, phone, industry, city, state, zip, stripe_subscription_id, stripe_customer_id, intake_data').eq('id', tenantId).single()
  if (!old) throw new Error('Customer not found')
  if (engineForSignup({ industry: old.industry, email: old.email, admin_email: old.admin_email }) !== 'unified') throw new Error('The full plan is not open for this kind of business yet')

  const urls = { planId: FULL_PLAN_ID, successUrl: String(d.env.PUBLIC_SITE_URL || 'https://twomiah.com').replace(/\/$/, '') + '/welcome', cancelUrl: String(d.env.PUBLIC_SITE_URL || 'https://twomiah.com').replace(/\/$/, '') + '/signup?canceled=1' }
  let next: any = null
  if (row.status === 'upgrading' && row.upgrade_tenant_id) {
    const r = await d.db.from('tenants').select('*').eq('id', row.upgrade_tenant_id).maybeSingle()
    next = r.data
  }
  if (!next) {
    const model = await exportOf(d, row)
    const slug = await d.allocateSlug(String(old.slug || old.name))
    if (!slug) throw new Error('Could not reserve a name for the new account')
    const palette = model?.look?.palette || {}
    const record = {
      name: old.name, slug, email: old.email, admin_email: old.admin_email, phone: old.phone, industry: old.industry, city: old.city, state: old.state, zip: old.zip,
      primary_color: /^#[0-9a-f]{6}$/i.test(String(palette.brand || '')) ? palette.brand : '#FF3D00',
      plan: FULL_PLAN_ID, deployment_model: 'saas', billing_type: 'subscription', billing_status: 'pending', status: 'pending',
      products: ['website'], features: [], engine: 'unified',
      preview_premium_pages: homeCompositionFrom(model),
      intake_data: { signup: { ...(model?.look?.design ? { design: model.look.design } : {}), upgradedFrom: tenantId, at: new Date(d.now()).toISOString() } },
    }
    const ins = await d.db.from('tenants').insert(record).select().single()
    if (ins.error || !ins.data) throw new Error('Could not start the upgrade')
    next = ins.data
    await d.db.from('factory_jobs').insert({
      tenant_id: next.id, template: 'unified', deployment_model: 'saas', status: 'pending', features: [], branding: { primaryColor: record.primary_color },
      config: { tenant_id: next.id, tenant_slug: slug, products: ['website'], company: { name: old.name, email: old.email, adminEmail: old.admin_email, phone: old.phone || undefined, city: old.city || undefined, state: old.state || undefined, industry: old.industry || undefined, plan: FULL_PLAN_ID }, branding: { primaryColor: record.primary_color }, features: { crm: [] } },
    })
    await d.db.from('web_presence_sites').update({ status: 'upgrading', upgrade_tenant_id: next.id, previous_subscription_id: old.stripe_subscription_id || null, updated_at: new Date(d.now()).toISOString() }).eq('id', row.id)
  }
  const co = await d.checkout(next, urls)
  if (!co.url) throw new Error('Could not start checkout')
  if (co.stripeCustomerId && !next.stripe_customer_id) await d.db.from('tenants').update({ stripe_customer_id: co.stripeCustomerId }).eq('id', next.id)
  return { checkoutUrl: co.url, tenantId: next.id }
}
export { WEB_PRESENCE_PLAN_ID }

/**
 * A change of trade: what can be added changes, nothing already on the page is removed. The Factory re-deploys the function with the new
 * trade's editor (the owner's saved content in the site's Blobs is untouched by a deploy), then hands the site the page drawn again.
 */
export async function changeTrade(d: UpgradeDeps, tenantId: string, industry: string): Promise<{ added: string[] }> {
  requireWebPresence(d.env)
  const { buildSpec, canonicalise } = await import('./spec.ts')
  const { renderOnePage } = await import('../../../unified/server/site/onePage.ts')
  const { unifiedVerticalOf } = await import('./service.ts')
  const { publish } = await import('./service.ts')
  const row = await siteRowFor(d, { tenantId })
  if (!row || row.status !== 'live') throw new Error('This customer has no live Web presence site')
  const { data: tenant } = await d.db.from('tenants').select('id, name, slug, email, admin_email, industry, city, state, phone, plan, preview_premium_pages, intake_data').eq('id', tenantId).single()
  if (!tenant) throw new Error('Customer not found')
  const before = buildSpec(tenant.industry), after = buildSpec(industry)
  const current = await exportOf(d, row)
  const { model } = canonicalise(current, after, current)   // the sections already there are kept: the new spec only widens what can be added
  await d.db.from('tenants').update({ industry }).eq('id', tenantId)
  const next = { ...tenant, industry }
  await publish(d, row, next, model as any)
  const caps = Object.fromEntries(Object.entries(after.caps).map(([k, v]: [string, any]) => [k, { anchor: v.anchor, ...(v.nav ? { nav: v.nav } : {}) }]))
  const origin = (row.custom_domain && row.ssl_ok ? 'https://' + row.custom_domain : row.origin) as string
  const out = await renderOnePage({ model: model as any, vertical: unifiedVerticalOf(industry), caps, origin })
  const body = JSON.stringify({ model: out.model, page: out.files['index.html'], privacy: out.files['privacy/index.html'] })
  const master = String(d.env.WEB_PRESENCE_SECRET_KEY || '')
  const ts = String(Math.floor(d.now() / 1000))
  const res = await d.fetch((row.origin as string).replace(/\/+$/, '') + '/api/adopt', { method: 'POST', headers: { 'content-type': 'application/json', 'x-wp-ts': ts, 'x-wp-sig': await signRequest(await siteSecret(master, row.id), ts, body) }, body })
  if (!res.ok) throw new Error('The site did not take the new page')
  return { added: Object.keys(after.caps).filter((k) => !(k in before.caps)) }
}
