// Default FactoryApiClient implementation — HTTP against the factory with
// X-Factory-Key auth. Reads FACTORY_URL + TENANT_ID + FACTORY_SYNC_KEY from
// env vars the factory sets on the tenant backend at deploy time.
//
// Tenant template glue typically does:
//
//   import { createFactoryApiClient } from '../shared/factoryClient'
//   const factoryClient = createFactoryApiClient()
//   const emailAliasesRoutes = createEmailAliasesRoutes({ db, emailAliasesTable, factoryApiClient: factoryClient })

import type { FactoryApiClient } from './types'
import type { TenantSubscription } from './plans'

interface FullFactoryApiClient extends FactoryApiClient {
  getOffboardStatus(): Promise<{ status: string; offboardStartedAt: string | null; offboardGraceEndsAt: string | null; domain?: string | null; domainRegistrar?: string | null }>
  startOffboard(confirm: true): Promise<{ success: boolean; offboardGraceEndsAt?: string; steps?: any[]; error?: string }>
  reactivate(): Promise<{ success: boolean; error?: string }>
  getSubscription(): Promise<TenantSubscription>
  getBillingPortalLink(): Promise<{ url: string | null; reason?: string }>
  startRestartCheckout(returnPath?: string): Promise<{ url: string }>
  // The own-it licence: the offer and price, then a checkout for it (Factory services/ownItLicense.ts).
  getLicenseOffer(): Promise<any>
  startLicenseCheckout(input: { githubUsername: string; acceptedTerms: boolean; termsVersion: string }): Promise<{ url: string }>
  registerAds(): Promise<{ apiKey: string; adsUrl?: string; created: boolean }>
  registerStripeAccount(accountId: string | null): Promise<{ success: boolean }>
  // Linking an EXISTING Stripe account through the Factory's one registered Stripe redirect (apps/api stripeOAuth.ts).
  stripeLinkAvailable(): Promise<{ available: boolean }>
  startStripeLink(p: { nonce: string; userId: string; returnUrl: string }): Promise<{ url: string }>
  deauthorizeStripeLink(accountId: string): Promise<{ deauthorized: boolean }>
  // The business's own web address — the same Factory routes the premium sites' Domain page uses (10/15).
  getDomainStatus(): Promise<{ status: 'unconfigured' | 'pending_nameservers' | 'active' | 'partial'; domain: string | null; nameservers: string[]; registrar?: string | null }>
  checkDomain(domain: string): Promise<any>
  startDomainCheckout(domain: string, returnPath: string): Promise<{ url: string; priceCents?: number; renewalCents?: number | null }>
  attachDomain(domain: string): Promise<any>
  // The business's own texting registration (A2P 10DLC): its own brand, campaign and number (Factory services/a2p.ts).
  getTextingRegistration(): Promise<any>
  submitTextingRegistration(details: Record<string, unknown>): Promise<any>
  refreshTextingRegistration(): Promise<any>
  resendTextingConfirmation(): Promise<any>
}

function env(name: string): string {
  const v = process.env[name]
  // A tenant with no link to the Factory is "not connected" (503), not a server fault: a route that lets this through
  // answered 500 for every call (Settings › Email domain on a tenant without TENANT_ID).
  if (!v) throw Object.assign(new Error(`This account is not connected to Twomiah yet (${name} is not configured)`), { status: 503 })
  return v
}

async function call(method: 'GET' | 'POST', path: string, body?: any): Promise<any> {
  const url = env('FACTORY_URL').replace(/\/$/, '') + path
  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Factory-Key': env('FACTORY_SYNC_KEY'),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  })
  const text = await res.text()
  let data: any = null
  try { data = text ? JSON.parse(text) : null } catch { data = { raw: text } }
  if (!res.ok) {
    const msg = (data && data.error) ? data.error : ('Factory HTTP ' + res.status)
    // Carry the upstream status so callers can map a factory 401/403/404 to a handled 4xx
    // instead of a blanket 500 (email-domain /status returned 500 "Unauthorized"). (QA F-10)
    const err: any = new Error(msg)
    err.status = res.status
    err.upstream = data
    throw err
  }
  return data
}

export function createFactoryApiClient(): FullFactoryApiClient {
  const tenantBase = () => '/api/v1/factory/customers/' + env('TENANT_ID')
  return {
    async syncEmailAlias(alias) {
      return call('POST', tenantBase() + '/email-alias-sync', alias)
    },
    async getEmailAliasStatus() {
      return call('GET', tenantBase() + '/email-alias-status')
    },
    async resendEmailAliasConfirmation(destination: string) {
      return call('POST', tenantBase() + '/email-alias-confirmation', { destination })
    },
    async getEmailDomainStatus() {
      return call('GET', tenantBase() + '/email-domain/status')
    },
    async verifyEmailDomain() {
      return call('POST', tenantBase() + '/email-domain/verify')
    },
    async getOffboardStatus() {
      return call('GET', tenantBase() + '/offboard/status')
    },
    async startOffboard(_confirm) {
      return call('POST', tenantBase() + '/offboard', { confirm: true })
    },
    async reactivate() {
      return call('POST', tenantBase() + '/reactivate')
    },
    // Billing is read-only in a tenant: the Factory owns the subscription and the Stripe portal.
    async getSubscription() {
      return call('GET', tenantBase() + '/subscription')
    },
    async getBillingPortalLink() {
      return call('POST', tenantBase() + '/billing-portal-link')
    },
    async getLicenseOffer() {
      return call('GET', tenantBase() + '/license')
    },
    async startLicenseCheckout(input) {
      return call('POST', tenantBase() + '/license-checkout', input)
    },
    // A subscription that ended: a Stripe checkout for this company's plan, to pay and come back (lock page).
    // returnPath: this CRM's lock page, which Stripe sends the customer back to (/crm/paywall unless named).
    async startRestartCheckout(returnPath) {
      return call('POST', tenantBase() + '/restart-checkout', returnPath ? { returnPath } : undefined)
    },
    // Twomiah Ads: register this tenant (or get the key its Render service already holds). No campaign is created.
    async registerAds() {
      return call('POST', tenantBase() + '/ads/register')
    },
    // Stripe Connect: which connected account this business collects on, so the Factory can forward
    // that account's webhooks to this tenant. Null after a disconnect.
    async registerStripeAccount(accountId) {
      return call('POST', tenantBase() + '/stripe-connect', { accountId })
    },
    // "I already have a Stripe account": whether the Factory offers it, the Stripe sign-in link for one admin's press
    // (the Factory signs the state; this app keeps the nonce's hash), and withdrawing the platform's access on Disconnect.
    async stripeLinkAvailable() {
      return call('GET', tenantBase() + '/stripe-oauth')
    },
    async startStripeLink(p) {
      return call('POST', tenantBase() + '/stripe-oauth/start', p)
    },
    async deauthorizeStripeLink(accountId) {
      return call('POST', tenantBase() + '/stripe-oauth/deauthorize', { accountId })
    },
    // Domain: status, availability with both prices, the purchase checkout (Stripe returns the customer to returnPath
    // on this app), and connecting a domain the business already owns. Same Factory routes as the premium sites.
    async getDomainStatus() {
      return call('GET', '/api/v1/factory/internal/domain/status/' + env('TENANT_ID'))
    },
    async checkDomain(domain) {
      return call('POST', '/api/v1/factory/public/domain/check', { domain })
    },
    async startDomainCheckout(domain, returnPath) {
      return call('POST', '/api/v1/factory/internal/domain/buy/' + env('TENANT_ID'), { domain, years: 1, returnTo: 'admin', returnPath })
    },
    async attachDomain(domain) {
      return call('POST', '/api/v1/factory/internal/domain/attach/' + env('TENANT_ID'), { domain, mode: 'byod' })
    },
    async getTextingRegistration() {
      return call('GET', '/api/v1/factory/internal/messaging/self/' + env('TENANT_ID') + '/registration')
    },
    async submitTextingRegistration(details) {
      return call('POST', '/api/v1/factory/internal/messaging/self/' + env('TENANT_ID') + '/registration', details)
    },
    async refreshTextingRegistration() {
      return call('POST', '/api/v1/factory/internal/messaging/self/' + env('TENANT_ID') + '/registration/refresh', {})
    },
    async resendTextingConfirmation() {
      return call('POST', '/api/v1/factory/internal/messaging/self/' + env('TENANT_ID') + '/registration/resend', {})
    },
  }
}
