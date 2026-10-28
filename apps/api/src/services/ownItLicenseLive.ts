// The own-it licence, wired to the real Stripe, GitHub, tenant app, storage and email (services/ownItLicense.ts is the
// logic; tests/shared/own-it-license.test.ts runs it against fakes).
import { supabase } from '../middleware/auth'
import factoryStripe from './factoryStripe'
import { storeForDownload } from './dataExport'
import { notifyLicenseHandover, notifyStaff } from './email'
import { logTenantAudit } from '../routes/factory/shared'
import type { LicenseStore, LicenseRow, HandoverDeps, CheckoutDeps, LicenseTenant } from './ownItLicense'

export const LICENSE_TENANT_COLUMNS = 'id, slug, name, email, admin_email, plan, engine, billing_status, status, is_test_tenant, github_repo, render_backend_url, render_frontend_url, stripe_customer_id, factory_sync_key'

const GITHUB = 'https://api.github.com'
const gh = (p: string, init: RequestInit = {}) => fetch(GITHUB + p, {
  ...init, signal: AbortSignal.timeout(30_000),
  headers: { Authorization: 'token ' + (process.env.GITHUB_TOKEN || ''), Accept: 'application/vnd.github+json', 'Content-Type': 'application/json', 'X-GitHub-Api-Version': '2022-11-28', ...(init.headers || {}) },
})

export const licenseStore: LicenseStore = {
  async bySession(sessionId) {
    const { data, error } = await supabase.from('tenant_licenses').select('*').eq('stripe_session_id', sessionId).maybeSingle()
    if (error) throw new Error('licence lookup: ' + error.message)
    return (data as LicenseRow) || null
  },
  async byTenant(tenantId) {
    const { data, error } = await supabase.from('tenant_licenses').select('*').eq('tenant_id', tenantId).order('paid_at', { ascending: false }).limit(1).maybeSingle()
    if (error) throw new Error('licence lookup: ' + error.message)
    return (data as LicenseRow) || null
  },
  async insert(row) {
    const { data, error } = await supabase.from('tenant_licenses').insert(row).select('*').single()
    // 23505 = the session's row already exists: a second delivery of the same Stripe event.
    if (error) { if ((error as any).code === '23505') return null; throw new Error('licence insert: ' + error.message) }
    return data as LicenseRow
  },
  async update(id, patch) {
    const { error } = await supabase.from('tenant_licenses').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id)
    if (error) throw new Error('licence update: ' + error.message)
  },
}

export const checkoutDeps: CheckoutDeps = {
  createSession: (p) => factoryStripe.createOwnItLicenseCheckout({
    tenant: { id: p.tenant.id, email: p.tenant.admin_email || p.tenant.email, name: p.tenant.name, stripeCustomerId: p.tenant.stripe_customer_id },
    priceCents: p.priceCents, productName: p.productName, description: p.description, termsNote: p.termsNote,
    metadata: p.metadata, successUrl: p.successUrl, cancelUrl: p.cancelUrl,
  }),
  async githubUserExists(username) {
    if (!process.env.GITHUB_TOKEN) return null
    const res = await gh('/users/' + encodeURIComponent(username))
    return res.status === 200 ? true : res.status === 404 ? false : null
  },
}

export const handoverDeps: HandoverDeps = {
  store: licenseStore,
  async inviteCollaborator(repoFull, username) {
    // Read access ('pull'): enough to clone and run it, and the Factory keeps pushing the app's updates to this repo.
    const res = await gh('/repos/' + repoFull + '/collaborators/' + encodeURIComponent(username), { method: 'PUT', body: JSON.stringify({ permission: 'pull' }) })
    if (res.status === 201) return 'invited'
    if (res.status === 204) return 'already'
    throw new Error('GitHub ' + res.status + ' ' + (await res.text().catch(() => '')).slice(0, 200))
  },
  async makeExport(t: LicenseTenant) {
    if (!t.render_backend_url || !t.factory_sync_key) throw new Error('the business app has no address or key on file')
    const res = await fetch(t.render_backend_url.replace(/\/$/, '') + '/api/internal/handover-export', {
      method: 'POST', headers: { 'X-Factory-Key': t.factory_sync_key }, signal: AbortSignal.timeout(5 * 60_000),
    })
    if (!res.ok) throw new Error('the app answered ' + res.status)
    const zip = Buffer.from(await res.arrayBuffer())
    const stored = await storeForDownload(zip, `${t.slug || t.id}/${t.slug || t.id}-licence-export-${new Date().toISOString().slice(0, 10)}.zip`, 'application/zip')
    if (!stored) throw new Error('storage is not configured')
    return { url: stored.url, expiresAt: stored.expiresAt, files: Number(res.headers.get('x-export-files')) || 0, rows: Number(res.headers.get('x-export-rows')) || 0 }
  },
  sendEmail: (t, o) => notifyLicenseHandover({ id: t.id, name: t.name || t.slug || 'Your business', email: t.email || undefined, admin_email: t.admin_email }, o),
  alertStaff: (subject, detail, tenantId) => notifyStaff(subject, detail, tenantId),
  audit: (tenantId, changes, note) => logTenantAudit(tenantId, 'own_it_license', changes, 'stripe-webhook', note),
}
