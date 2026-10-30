// The Web presence plan's Factory side: set a customer's site up on its own Netlify site, draw the page when the site asks, sign
// the owner in, take the site down when the plan ends, and move them up to the full plan. Everything outside is injected
// (database, Netlify, mail, clock) so the tests stand in for all of it and make no live call.
//
// What the Factory keeps: one row per site (web_presence_sites) — the Netlify site id, its address, its state. NOT the owner's
// content: that is the site's own Blobs. The Factory draws the page from what the site sends and forgets it.
import { randomBytes } from 'node:crypto'
import { Netlify, NetlifyError, type FetchLike } from './netlify.ts'
import { buildSpec, canonicalise, type SiteSpec } from './spec.ts'
import { composeOnePage } from './compose.ts'
import { buildSiteFiles } from './publish.ts'
import { requireWebPresence, WEB_PRESENCE_PLAN_ID } from './switch.ts'
import { renderOnePage, type OnePageModel } from '../../../unified/server/site/onePage.ts'
import { mintSignin, siteSecret, verifyRequest, signRequest } from './site/session.mjs'
import { effectiveForms } from './site/clean.mjs'
import { unifiedVerticalFor } from '../unified/factory.ts'

export type SiteStatus = 'creating' | 'live' | 'failed' | 'canceling' | 'upgrading' | 'removed'
export interface SiteRow {
  id: string; tenant_id: string; netlify_site_id: string | null; netlify_site_name: string | null; status: SiteStatus
  origin: string | null; custom_domain: string | null; ssl_ok: boolean; cancel_at: string | null; last_link_at: string | null
  upgrade_tenant_id?: string | null; previous_subscription_id?: string | null
  created_at?: string; updated_at?: string
}

export interface Deps {
  db: any
  netlify: () => Netlify
  env: Record<string, string | undefined>
  now: () => number
  /** Mail the owner their sign-in link. */
  sendLink: (to: string, businessName: string, link: string, why: 'welcome' | 'request') => Promise<void>
  /** Mail staff / raise the owner's alert. */
  alert: (key: string, what: string, detail: string, tenantId?: string) => Promise<void>
  fetch: FetchLike
  sleep: (ms: number) => Promise<void>
  /** The Stripe call that ends a subscription at the end of the paid period (returns that date). */
  endSubscriptionAtPeriodEnd?: (subscriptionId: string) => Promise<Date>
  /** Upgrade only: end the old $19 subscription now (the new plan is live), without a refund. */
  cancelSubscriptionNow?: (subscriptionId: string) => Promise<void>
}

const TENANT_COLUMNS = 'id, name, slug, email, admin_email, industry, city, state, phone, plan, preview_premium_pages, primary_color, intake_data, factory_sync_key, stripe_subscription_id, billing_status, status'

export function factoryUrl(env: Deps['env']): string {
  return String(env.TWOMIAH_FACTORY_URL || env.FACTORY_PUBLIC_URL || '').replace(/\/+$/, '')
}
const masterKey = (env: Deps['env']) => String(env.WEB_PRESENCE_SECRET_KEY || '')

async function loadTenant(d: Deps, tenantId: string): Promise<any> {
  const { data, error } = await d.db.from('tenants').select(TENANT_COLUMNS).eq('id', tenantId).single()
  if (error || !data) throw new Error('Customer not found')
  return data
}
export async function siteRowFor(d: Deps, by: { tenantId?: string; siteId?: string }): Promise<SiteRow | null> {
  const q = d.db.from('web_presence_sites').select('*')
  const { data } = await (by.siteId ? q.eq('id', by.siteId) : q.eq('tenant_id', by.tenantId)).maybeSingle()
  return (data as SiteRow) ?? null
}
async function patchRow(d: Deps, id: string, patch: Record<string, any>): Promise<void> {
  const { error } = await d.db.from('web_presence_sites').update({ ...patch, updated_at: new Date(d.now()).toISOString() }).eq('id', id)
  if (error) throw new Error('Could not save the site record: ' + error.message)
}

/** The trade as the unified renderer knows it (the plan draws with the unified vertical the full product would run as). */
export function unifiedVerticalOf(industry: string | null | undefined): string {
  return unifiedVerticalFor(industry) ?? 'basic'
}
const capsOf = (spec: SiteSpec) => Object.fromEntries(Object.entries(spec.caps).map(([k, v]) => [k, { anchor: v.anchor, ...(v.nav ? { nav: v.nav } : {}) }]))

/** The signup's saved composition (preview_premium_pages: { pages: { slug: { sections } } }) as { slug: sections[] }. */
function pagesOf(tenant: any): Record<string, any[]> {
  const stored = tenant?.preview_premium_pages?.pages
  if (!stored || typeof stored !== 'object') return {}
  return Object.fromEntries(Object.entries(stored).map(([slug, p]: [string, any]) => [slug, Array.isArray(p) ? p : Array.isArray(p?.sections) ? p.sections : []]))
}

// ─── set up ──────────────────────────────────────────────────────────────────────────────────

const slugName = (slug: string) => ('twomiah-' + String(slug).toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-')).slice(0, 56).replace(/-$/, '')

export interface Provisioned { row: SiteRow; existing: boolean }

/** Create (or resume) this customer's ONE Netlify site, put the first version of the page on it, and mail the owner their link. */
export async function provisionSite(d: Deps, tenantId: string): Promise<Provisioned> {
  requireWebPresence(d.env)
  const tenant = await loadTenant(d, tenantId)
  if (tenant.plan !== WEB_PRESENCE_PLAN_ID) throw new Error('This customer is not on the Web presence plan')
  // A paid customer whose site is not made is told to staff whatever stopped it — the set-up below alerts itself; this covers
  // everything before it (a missing setting, the site row refused: 42501 on the first live signup was only a log line, 10/29).
  try {
    return await setUp(d, tenantId, tenant)
  } catch (e: any) {
    await d.alert('web-presence-provision:' + tenantId, 'A Web presence site could not be set up', String(e?.message || e), tenantId)
    throw e
  }
}

async function setUp(d: Deps, tenantId: string, tenant: any): Promise<Provisioned> {
  if (!masterKey(d.env)) throw new Error('WEB_PRESENCE_SECRET_KEY is not set')
  if (!factoryUrl(d.env)) throw new Error('TWOMIAH_FACTORY_URL is not set')

  let row = await siteRowFor(d, { tenantId })
  // One site per customer: a live (or going) site is returned, never made again.
  if (row && ['live', 'canceling', 'upgrading'].includes(row.status)) return { row, existing: true }
  if (!row) {
    const ins = await d.db.from('web_presence_sites').insert({ tenant_id: tenantId, status: 'creating' }).select().single()
    if (ins.error) {
      row = await siteRowFor(d, { tenantId })           // a second request made it first (tenant_id is unique)
      if (!row) throw new Error('Could not record the site: ' + ins.error.message)
      if (row.status === 'live') return { row, existing: true }
    } else row = ins.data as SiteRow
  } else await patchRow(d, row.id, { status: 'creating' })

  const nl = d.netlify()
  try {
    if (!row!.netlify_site_id) {
      let name = slugName(tenant.slug)
      let site
      for (let i = 0; ; i++) {
        try { site = await nl.createSite(name); break } catch (e) {
          if (e instanceof NetlifyError && (e.status === 422 || e.status === 409) && i < 3) { name = slugName(tenant.slug).slice(0, 51) + '-' + randomBytes(2).toString('hex'); continue }
          throw e
        }
      }
      await patchRow(d, row!.id, { netlify_site_id: site.id, netlify_site_name: site.name, origin: 'https://' + site.name + '.netlify.app' })
      row = { ...row!, netlify_site_id: site.id, netlify_site_name: site.name, origin: 'https://' + site.name + '.netlify.app' }
    }
    const factoryKey = tenant.factory_sync_key || randomBytes(24).toString('hex')
    // The tenant row carries the site's address and its own key for the domain flows. It has NO render_backend_url: that field says "this tenant has a CRM", and the health monitor and inbound-email flows would probe a /health the site does not have.
    await d.db.from('tenants').update({ website_url: row!.origin, factory_sync_key: factoryKey, status: 'active' }).eq('id', tenantId)

    // The site's own settings, set BEFORE the deploy that first reads them. The team's token is never among them.
    await nl.setEnv(row!.netlify_site_id!, {
      WP_SITE_ID: { value: row!.id }, WP_SECRET: { value: await siteSecret(masterKey(d.env), row!.id) },
      WP_FACTORY_URL: { value: factoryUrl(d.env) }, WP_TENANT_ID: { value: tenantId }, WP_FACTORY_KEY: { value: factoryKey },
    })
    const first = await publish(d, row!, tenant)
    await reconcileForms(d, row!, first)
    await patchRow(d, row!.id, { status: 'live' })
    row = { ...row!, status: 'live' }
  } catch (e: any) {
    await patchRow(d, row!.id, { status: 'failed' }).catch(() => {})
    throw e                                              // provisionSite alerts
  }
  try {
    const link = await signinLinkFor(d, row!, { force: true })
    await d.sendLink(tenant.admin_email || tenant.email, tenant.name, link, 'welcome')
  } catch (e: any) {
    await d.alert('web-presence-link:' + tenantId, 'A Web presence site is live but the owner\'s sign-in email did not send', String(e?.message || e), tenantId)
  }
  return { row: row!, existing: false }
}

/** The whole file set (first version of the page included) onto the site: used at set up and when the trade or the code changes. */
export async function publish(d: Deps, row: SiteRow, tenant: any, model?: OnePageModel): Promise<OnePageModel> {
  const spec = buildSpec(tenant.industry)
  const origin = (row.custom_domain && row.ssl_ok ? 'https://' + row.custom_domain : row.origin) as string
  let useModel = model
  if (!useModel) {
    const ownerDesign = tenant.intake_data?.signup?.design
    const composed = composeOnePage(
      { businessName: tenant.name, businessType: tenant.industry || '', city: tenant.city || '', state: tenant.state || '', email: tenant.admin_email || tenant.email || '', phone: tenant.phone || '' } as any,
      { pages: pagesOf(tenant) } as any,
      { design: ownerDesign },
    )
    useModel = canonicalise(composed.model, spec, null).model
  }
  const rendered = await renderOnePage({ model: useModel!, vertical: unifiedVerticalOf(tenant.industry), caps: capsOf(spec), origin })
  const built = await buildSiteFiles(rendered, spec)
  const nl = d.netlify()
  await nl.enableForms(row.netlify_site_id!)                // forms are found while THIS deploy is processed
  await nl.deploy(row.netlify_site_id!, built.files, built.functions)
  return rendered.model
}

/** Email notification for each form = the owner's setting. A form Netlify has not registered yet is waited for (a moment after a deploy). */
export async function reconcileForms(d: Deps, row: SiteRow, model: { forms?: any; sections?: any[] } | null): Promise<void> {
  const f = model ? effectiveForms(model) : { lead: false, hiring: false }
  const wanted = {
    lead: { on: f.lead, inbox: model?.forms?.lead?.inbox || '' },
    apply: { on: f.hiring, inbox: model?.forms?.hiring?.inbox || '' },
  }
  const nl = d.netlify()
  for (let i = 0; i < 8; i++) {
    const { missing } = await nl.reconcileFormEmails(row.netlify_site_id!, wanted)
    if (!missing.length) return
    await d.sleep(3000)
  }
  throw new Error('Netlify has not registered the forms yet')
}

// ─── the site asks the Factory ───────────────────────────────────────────────────────────────

export class SignatureError extends Error { readonly status = 401; constructor() { super('Not found') } }

/** Verify a request signed with the site's own secret (x-wp-site / x-wp-ts / x-wp-sig). Returns the site row. */
export async function verifySiteRequest(d: Deps, h: { site?: string; ts?: string; sig?: string }, body: string): Promise<SiteRow> {
  requireWebPresence(d.env)
  if (!h.site || !h.ts || !h.sig) throw new SignatureError()
  const row = await siteRowFor(d, { siteId: h.site })
  if (!row || !masterKey(d.env)) throw new SignatureError()
  const ok = await verifyRequest(await siteSecret(masterKey(d.env), row.id), h.ts, body, h.sig, d.now())
  if (!ok) throw new SignatureError()
  return row
}

/**
 * A save from the site's editor: finish the cleaning, draw the page, and (when a form's switch or inbox changed) set Netlify's
 * email for it. Returns what the site stores. Nothing here is kept.
 */
export async function renderForSite(d: Deps, row: SiteRow, payload: { model: unknown; prev?: any }) {
  if (!['live', 'creating', 'canceling'].includes(row.status)) throw new Error('This site is not taking changes')
  const tenant = await loadTenant(d, row.tenant_id)
  const spec = buildSpec(tenant.industry)
  const { model, notes } = canonicalise(payload.model, spec, payload.prev ?? null)
  if ((model as any).tooBig) return { status: 400, body: { error: 'That is too much for one page. Remove something and try again.' } }
  const origin = (row.custom_domain && row.ssl_ok ? 'https://' + row.custom_domain : row.origin) as string
  const out = await renderOnePage({ model: model as OnePageModel, vertical: unifiedVerticalOf(tenant.industry), caps: capsOf(spec), origin })
  const before = effectiveForms(payload.prev || { sections: [], forms: {} }), after = out.forms
  const inboxChanged = (a: any, b: any) => (a?.forms?.lead?.inbox || '') !== (b?.forms?.lead?.inbox || '') || (a?.forms?.hiring?.inbox || '') !== (b?.forms?.hiring?.inbox || '')
  if (before.lead !== after.lead || before.hiring !== after.hiring || inboxChanged(payload.prev, out.model)) {
    try { await reconcileForms(d, row, out.model) } catch (e: any) { return { status: 502, body: { error: 'Could not update where messages are sent. Nothing was changed. Please try again in a minute.' } } }
  }
  return { status: 200, body: { ok: true, model: out.model, notes, files: { 'index.html': out.files['index.html'], 'privacy/index.html': out.files['privacy/index.html'] } } }
}

// ─── sign-in ─────────────────────────────────────────────────────────────────────────────────

/** A single-use link bound to this site: <site>/edit/#t=<token> (the token is after the #, so it is never sent to a server or logged). */
export async function signinLinkFor(d: Deps, row: SiteRow, o: { force?: boolean } = {}): Promise<string> {
  requireWebPresence(d.env)
  if (!o.force && row.last_link_at && d.now() - new Date(row.last_link_at).getTime() < 60_000) throw new Error('A link was just made. Please wait a minute.')
  const token = await mintSignin(await siteSecret(masterKey(d.env), row.id), row.id, d.now())
  await patchRow(d, row.id, { last_link_at: new Date(d.now()).toISOString() })
  const base = (row.custom_domain && row.ssl_ok ? 'https://' + row.custom_domain : row.origin) as string
  return base.replace(/\/+$/, '') + '/edit/#t=' + token
}

/** "Email me a new link", from the site: only ever to the address the Factory holds for the owner; the answer is the same whoever asks. */
export async function requestLink(d: Deps, row: SiteRow): Promise<void> {
  if (!['live', 'canceling'].includes(row.status)) return
  const tenant = await loadTenant(d, row.tenant_id)
  try {
    const link = await signinLinkFor(d, row)
    await d.sendLink(tenant.admin_email || tenant.email, tenant.name, link, 'request')
  } catch { /* the same answer either way */ }
}

/** Staff: a link for this customer's site, made through the Factory (the only way staff reach a site). */
export async function staffLink(d: Deps, tenantId: string): Promise<string> {
  requireWebPresence(d.env)
  const row = await siteRowFor(d, { tenantId })
  if (!row || row.status !== 'live') throw new Error('This customer has no live Web presence site')
  return signinLinkFor(d, row, { force: true })
}

// ─── the end of the plan ─────────────────────────────────────────────────────────────────────

/** The owner cancels: the subscription ends with the paid period and the Netlify site goes then — not before. */
export async function cancelAtPeriodEnd(d: Deps, tenantId: string): Promise<{ cancelAt: string }> {
  requireWebPresence(d.env)
  const tenant = await loadTenant(d, tenantId)
  const row = await siteRowFor(d, { tenantId })
  if (!row || !['live', 'canceling'].includes(row.status)) throw new Error('This customer has no live Web presence site')
  if (!tenant.stripe_subscription_id || !d.endSubscriptionAtPeriodEnd) throw new Error('No subscription to cancel')
  const end = await d.endSubscriptionAtPeriodEnd(tenant.stripe_subscription_id)
  await patchRow(d, row.id, { status: 'canceling', cancel_at: end.toISOString() })
  return { cancelAt: end.toISOString() }
}

/** Take the Netlify site down (the paid period is over, or the subscription ended). Idempotent. */
export async function removeSite(d: Deps, tenantId: string, why: string): Promise<boolean> {
  const row = await siteRowFor(d, { tenantId })
  if (!row || row.status === 'removed') return false
  if (row.netlify_site_id) await d.netlify().deleteSite(row.netlify_site_id)
  await patchRow(d, row.id, { status: 'removed' })
  console.log('[WebPresence] site removed for', tenantId, '-', why)
  return true
}

/** The scheduler's pass: sites whose paid period is over go; sites waiting on a certificate are asked again. */
export async function sweep(d: Deps): Promise<{ removed: string[]; secured: string[]; retried: string[] }> {
  const out = { removed: [] as string[], secured: [] as string[], retried: [] as string[] }
  if (!(d.env.WEB_PRESENCE_ON && ['1', 'true', 'on', 'yes'].includes(String(d.env.WEB_PRESENCE_ON).trim().toLowerCase()))) return out
  const nowIso = new Date(d.now()).toISOString()
  // A customer who has paid and has no live site is set up again, every hour until it works: the paid webhook tries once, and a
  // failure there (10/29: the site row refused) otherwise left a paying customer with nothing. Each failure alerts (provisionSite).
  const { data: paid } = await d.db.from('tenants').select('id').eq('plan', WEB_PRESENCE_PLAN_ID).eq('billing_status', 'active')
  for (const t of (paid as Array<{ id: string }>) || []) {
    const r = await siteRowFor(d, { tenantId: t.id })
    if (r && r.status !== 'failed' && r.status !== 'creating') continue
    try { await provisionSite(d, t.id); out.retried.push(t.id) } catch {}
  }
  const { data: due } = await d.db.from('web_presence_sites').select('*').eq('status', 'canceling').lt('cancel_at', nowIso)
  for (const r of (due as SiteRow[]) || []) { if (await removeSite(d, r.tenant_id, 'paid period ended')) out.removed.push(r.tenant_id) }
  // An upgraded customer's old site goes once the full plan's own business is live; the old $19 subscription ends then, and not before.
  const { data: moving } = await d.db.from('web_presence_sites').select('*').eq('status', 'upgrading')
  for (const r of (moving as SiteRow[]) || []) {
    if (!r.upgrade_tenant_id) continue
    const { data: t } = await d.db.from('tenants').select('id, plan, render_frontend_url, status, billing_status').eq('id', r.upgrade_tenant_id).maybeSingle()
    if (t && t.status === 'active' && t.billing_status === 'active' && t.render_frontend_url) {
      if (await removeSite(d, r.tenant_id, 'upgraded')) out.removed.push(r.tenant_id)
      if (r.previous_subscription_id && d.cancelSubscriptionNow) {
        try { await d.cancelSubscriptionNow(r.previous_subscription_id); await patchRow(d, r.id, { previous_subscription_id: null }) }
        catch (e: any) { await d.alert('web-presence:old-sub:' + r.tenant_id, 'An upgraded customer is still being billed the $19 plan', String(e?.message || e), r.tenant_id) }
      }
    }
  }
  const { data: waiting } = await d.db.from('web_presence_sites').select('*').eq('status', 'live').eq('ssl_ok', false)
  for (const r of (waiting as SiteRow[]) || []) {
    if (!r.custom_domain || !r.netlify_site_id) continue
    const c = await d.netlify().provisionCertificate(r.netlify_site_id, [r.custom_domain, 'www.' + r.custom_domain])
    if (c.ok) { await patchRow(d, r.id, { ssl_ok: true }); out.secured.push(r.tenant_id) }
  }
  return out
}
