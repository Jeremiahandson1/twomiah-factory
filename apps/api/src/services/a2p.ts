// ============================================================================
// Per-tenant A2P 10DLC provisioning (Twilio ISV / Trust Hub)
// ============================================================================
//
// Twomiah is the Twilio ISV. For each tenant we register THEIR business identity
// (Secondary Customer Profile), an A2P messaging trust bundle, an A2P Brand, a
// Messaging Service, and a Campaign — so the tenant's SMS is compliant 10DLC
// traffic under their own brand and Twomiah can bill it.
//
// Design mirrors the R2-bucket step in deploy.ts: each step is idempotent and
// RESUMABLE. We persist every Twilio SID to the tenant row as we go and skip any
// step whose SID already exists, so a mid-flight failure (or the multi-day
// vetting wait) can be re-driven safely by calling provisionA2p() again.
//
// ⚠️ LIVE-VALIDATION REQUIRED. This is written to Twilio's documented ISV REST
// flow, but it cannot be end-to-end tested without: (a) Twomiah's master account
// approved as an ISV, (b) a real tenant EIN, and (c) TCR vetting (hours–days).
// The POLICY SIDs below are Twilio's published defaults; confirm them against the
// live account during ISV onboarding and override via env if Twilio rotates them.
// Same "built, not sandbox-tested" status as the Square/PayPal payment adapters.

import { supabase } from '../middleware/auth'
import { decryptJSON } from '../lib/crypto'

// ─── Config ─────────────────────────────────────────────────────────────────

const TRUSTHUB = 'https://trusthub.twilio.com/v1'
const MESSAGING = 'https://messaging.twilio.com/v1'
const API2010 = 'https://api.twilio.com/2010-04-01'

function isvCreds(): { sid: string; token: string } {
  const sid = process.env.TWOMIAH_TWILIO_ACCOUNT_SID || ''
  const token = process.env.TWOMIAH_TWILIO_AUTH_TOKEN || ''
  if (!sid || !token) throw new Error('Twilio ISV credentials not set (TWOMIAH_TWILIO_ACCOUNT_SID / TWOMIAH_TWILIO_AUTH_TOKEN)')
  return { sid, token }
}

// Twilio-published policy SIDs. Overridable via env if they change.
const POLICY = {
  // Secondary Customer Profile (business identity of the tenant)
  secondaryCustomerProfile: process.env.TWILIO_POLICY_SECONDARY_CP || 'RNdfbf3fae0e1107f8aded0e7cead80bf5',
  // US A2P Messaging trust product
  a2pMessaging: process.env.TWILIO_POLICY_A2P || 'RNb0d4771c2c98518d916a3d4cd70a8f8b',
}
// The ISV's OWN (primary) customer profile bundle SID — created once for Twomiah
// during ISV onboarding and assigned into every secondary profile.
function primaryProfileSid(): string {
  const sid = process.env.TWILIO_PRIMARY_PROFILE_SID || ''
  if (!sid) throw new Error('TWILIO_PRIMARY_PROFILE_SID not set (Twomiah ISV primary customer profile)')
  return sid
}

// Optional status-callback so Twilio can push vetting results back to the poller.
const STATUS_CALLBACK = process.env.TWILIO_A2P_STATUS_CALLBACK
  || (process.env.TWOMIAH_FACTORY_URL ? process.env.TWOMIAH_FACTORY_URL + '/api/v1/factory/internal/a2p/twilio-callback' : undefined)

// ─── Types ──────────────────────────────────────────────────────────────────

// Decrypted shape of tenants.a2p_data (see routes/factory/a2p.ts intake).
export interface A2pData {
  // Business identity
  legalName: string
  businessType: string          // e.g. 'Limited Liability Company', 'Corporation', 'Sole Proprietorship'
  ein: string                   // EIN / business registration number
  einIssuingCountry?: string    // default 'US'
  industry: string              // e.g. 'CONSTRUCTION', 'PROFESSIONAL_SERVICES'
  website: string
  // Address
  street: string
  city: string
  region: string                // state
  postalCode: string
  isoCountry?: string           // default 'US'
  // Authorized representative
  repFirstName: string
  repLastName: string
  repEmail: string
  repPhone: string
  repTitle: string              // e.g. 'Owner', 'Director'
  repJobPosition?: string       // e.g. 'CEO', 'Owner', 'Manager'
  // Campaign
  usecase?: string              // default 'MIXED' (Low Volume Mixed = 'LOW_VOLUME')
  campaignDescription: string
  messageSamples: string[]      // 2–5 sample messages
  optInMessage?: string
  optInKeywords?: string[]
  hasEmbeddedLinks?: boolean
  hasEmbeddedPhone?: boolean
  // The tenant's Twilio phone number SID (PN...) to add to the messaging service.
  phoneNumberSid?: string
  soleProprietor?: boolean
}

type TenantRow = {
  id: string
  name?: string | null
  email?: string | null
  a2p_status?: string | null
  a2p_data?: any
  a2p_profile_sid?: string | null
  a2p_trust_bundle_sid?: string | null
  a2p_brand_sid?: string | null
  a2p_messaging_service_sid?: string | null
  a2p_campaign_sid?: string | null
  a2p_phone_number?: string | null
}

export interface A2pStepResult {
  step: string
  status: 'ok' | 'skipped' | 'error'
  sid?: string
  detail?: string
}

// ─── Twilio REST helper ───────────────────────────────────────────────────────

async function twilioFetch(base: string, path: string, method: 'GET' | 'POST', form?: Record<string, any>): Promise<any> {
  const { sid, token } = isvCreds()
  const auth = 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64')
  const init: RequestInit = { method, headers: { Authorization: auth } }
  if (form) {
    const body = new URLSearchParams()
    for (const [k, v] of Object.entries(form)) {
      if (v === undefined || v === null) continue
      // Twilio takes JSON-in-form for Attributes and repeated keys for lists.
      if (Array.isArray(v)) { for (const item of v) body.append(k, String(item)) }
      else if (typeof v === 'object') body.append(k, JSON.stringify(v))
      else body.append(k, String(v))
    }
    ;(init.headers as any)['Content-Type'] = 'application/x-www-form-urlencoded'
    init.body = body.toString()
  }
  const res = await fetch(base + path, init)
  const text = await res.text()
  let json: any = null
  try { json = text ? JSON.parse(text) : null } catch { /* non-JSON error body */ }
  if (!res.ok) {
    const msg = json?.message || text || `HTTP ${res.status}`
    const err = new Error(`Twilio ${method} ${path} -> ${res.status}: ${msg}`) as any
    err.status = res.status
    err.code = json?.code
    throw err
  }
  return json
}

// ─── Persistence helper ───────────────────────────────────────────────────────

async function patchTenant(tenantId: string, patch: Record<string, any>): Promise<void> {
  const { error } = await supabase.from('tenants').update(patch).eq('id', tenantId)
  if (error) throw new Error('Failed to persist A2P progress: ' + error.message)
}

// ─── Individual provisioning steps ─────────────────────────────────────────────
//
// Each returns the SID it created (or the existing one) so the orchestrator can
// persist + skip. Kept small and single-purpose for readability + resumability.

// 1) Secondary Customer Profile bundle = the tenant's verified business identity.
async function ensureCustomerProfile(tenant: TenantRow, d: A2pData): Promise<string> {
  if (tenant.a2p_profile_sid) return tenant.a2p_profile_sid

  // Bundle shell
  const bundle = await twilioFetch(TRUSTHUB, '/CustomerProfiles', 'POST', {
    FriendlyName: `${d.legalName} — A2P`,
    Email: d.repEmail,
    PolicySid: POLICY.secondaryCustomerProfile,
    StatusCallback: STATUS_CALLBACK,
  })
  const bundleSid: string = bundle.sid

  // Business information end-user
  const bizInfo = await twilioFetch(TRUSTHUB, '/EndUsers', 'POST', {
    FriendlyName: `${d.legalName} business info`,
    Type: 'customer_profile_business_information',
    Attributes: {
      business_name: d.legalName,
      social_media_profile_urls: '',
      website_url: d.website,
      business_regions_of_operation: 'USA_AND_CANADA',
      business_type: d.businessType,
      business_registration_identifier: 'EIN',
      business_identity: d.soleProprietor ? 'sole_proprietor' : 'direct_customer',
      business_industry: d.industry,
      business_registration_number: d.ein,
      business_registration_country: d.einIssuingCountry || 'US',
    },
  })

  // Authorized representative end-user
  const rep = await twilioFetch(TRUSTHUB, '/EndUsers', 'POST', {
    FriendlyName: `${d.repFirstName} ${d.repLastName}`,
    Type: 'authorized_representative_1',
    Attributes: {
      job_position: d.repJobPosition || 'Owner',
      last_name: d.repLastName,
      phone_number: d.repPhone,
      first_name: d.repFirstName,
      email: d.repEmail,
      business_title: d.repTitle,
    },
  })

  // Business address → supporting document
  const address = await twilioFetch(`${API2010}/Accounts/${isvCreds().sid}`, '/Addresses.json', 'POST', {
    FriendlyName: `${d.legalName} address`,
    CustomerName: d.legalName,
    Street: d.street,
    City: d.city,
    Region: d.region,
    PostalCode: d.postalCode,
    IsoCountry: d.isoCountry || 'US',
  })
  const supportingDoc = await twilioFetch(TRUSTHUB, '/SupportingDocuments', 'POST', {
    FriendlyName: `${d.legalName} address doc`,
    Type: 'customer_profile_address',
    Attributes: { address_sids: address.sid },
  })

  // Assign every entity (plus Twomiah's primary profile) into the bundle.
  for (const objectSid of [bizInfo.sid, rep.sid, supportingDoc.sid, primaryProfileSid()]) {
    await twilioFetch(TRUSTHUB, `/CustomerProfiles/${bundleSid}/EntityAssignments`, 'POST', { ObjectSid: objectSid })
  }

  // Evaluate then submit for review.
  await twilioFetch(TRUSTHUB, `/CustomerProfiles/${bundleSid}/Evaluations`, 'POST', { PolicySid: POLICY.secondaryCustomerProfile })
  await twilioFetch(TRUSTHUB, `/CustomerProfiles/${bundleSid}`, 'POST', { Status: 'pending-review' })

  await patchTenant(tenant.id, { a2p_profile_sid: bundleSid })
  tenant.a2p_profile_sid = bundleSid
  return bundleSid
}

// 2) A2P Messaging trust bundle — references the customer profile above.
async function ensureTrustBundle(tenant: TenantRow, d: A2pData): Promise<string> {
  if (tenant.a2p_trust_bundle_sid) return tenant.a2p_trust_bundle_sid

  const tp = await twilioFetch(TRUSTHUB, '/TrustProducts', 'POST', {
    FriendlyName: `${d.legalName} — A2P messaging`,
    Email: d.repEmail,
    PolicySid: POLICY.a2pMessaging,
    StatusCallback: STATUS_CALLBACK,
  })
  const tpSid: string = tp.sid

  const msgProfile = await twilioFetch(TRUSTHUB, '/EndUsers', 'POST', {
    FriendlyName: `${d.legalName} A2P profile`,
    Type: 'us_a2p_messaging_profile_information',
    Attributes: { company_type: d.soleProprietor ? 'sole_proprietor' : 'private' },
  })

  // Assign the (approved) customer profile bundle + the messaging end-user.
  for (const objectSid of [tenant.a2p_profile_sid!, msgProfile.sid]) {
    await twilioFetch(TRUSTHUB, `/TrustProducts/${tpSid}/EntityAssignments`, 'POST', { ObjectSid: objectSid })
  }
  await twilioFetch(TRUSTHUB, `/TrustProducts/${tpSid}/Evaluations`, 'POST', { PolicySid: POLICY.a2pMessaging })
  await twilioFetch(TRUSTHUB, `/TrustProducts/${tpSid}`, 'POST', { Status: 'pending-review' })

  await patchTenant(tenant.id, { a2p_trust_bundle_sid: tpSid })
  tenant.a2p_trust_bundle_sid = tpSid
  return tpSid
}

// 3) A2P Brand registration.
async function ensureBrand(tenant: TenantRow, d: A2pData): Promise<string> {
  if (tenant.a2p_brand_sid) return tenant.a2p_brand_sid
  const brand = await twilioFetch(MESSAGING, '/a2p/BrandRegistrations', 'POST', {
    CustomerProfileBundleSid: tenant.a2p_profile_sid,
    A2PProfileBundleSid: tenant.a2p_trust_bundle_sid,
    BrandType: d.soleProprietor ? 'SOLE_PROPRIETOR' : 'STANDARD',
  })
  await patchTenant(tenant.id, { a2p_brand_sid: brand.sid })
  tenant.a2p_brand_sid = brand.sid
  return brand.sid
}

// 4) Messaging Service (sender pool the campaign attaches to).
async function ensureMessagingService(tenant: TenantRow, d: A2pData): Promise<string> {
  if (tenant.a2p_messaging_service_sid) return tenant.a2p_messaging_service_sid
  const svc = await twilioFetch(MESSAGING, '/Services', 'POST', {
    FriendlyName: `${d.legalName} messaging`,
    StatusCallback: STATUS_CALLBACK,
  })
  await patchTenant(tenant.id, { a2p_messaging_service_sid: svc.sid })
  tenant.a2p_messaging_service_sid = svc.sid
  return svc.sid
}

// 5) Campaign (us_app_to_person) under the messaging service.
async function ensureCampaign(tenant: TenantRow, d: A2pData): Promise<string> {
  if (tenant.a2p_campaign_sid) return tenant.a2p_campaign_sid
  const mgSid = tenant.a2p_messaging_service_sid!
  const campaign = await twilioFetch(MESSAGING, `/Services/${mgSid}/Compliance/Usa2p`, 'POST', {
    BrandRegistrationSid: tenant.a2p_brand_sid,
    Description: d.campaignDescription,
    MessageSamples: d.messageSamples,
    UsAppToPersonUsecase: d.usecase || 'MIXED',
    HasEmbeddedLinks: d.hasEmbeddedLinks ?? true,
    HasEmbeddedPhone: d.hasEmbeddedPhone ?? true,
    MessageFlow: 'End users opt in via a consent checkbox on the business website contact/quote form, by texting the business, or verbally. Opt-in is confirmed by an auto-reply. Consent is not a condition of purchase.',
    OptInMessage: d.optInMessage,
    OptInKeywords: d.optInKeywords,
  })
  await patchTenant(tenant.id, { a2p_campaign_sid: campaign.sid })
  tenant.a2p_campaign_sid = campaign.sid
  return campaign.sid
}

// 6) Attach the tenant's Twilio number to the messaging service.
async function ensurePhoneNumber(tenant: TenantRow, d: A2pData): Promise<string | null> {
  if (tenant.a2p_phone_number) return tenant.a2p_phone_number
  if (!d.phoneNumberSid) return null // number can be added later once purchased
  await twilioFetch(MESSAGING, `/Services/${tenant.a2p_messaging_service_sid}/PhoneNumbers`, 'POST', {
    PhoneNumberSid: d.phoneNumberSid,
  })
  await patchTenant(tenant.id, { a2p_phone_number: d.phoneNumberSid })
  tenant.a2p_phone_number = d.phoneNumberSid
  return d.phoneNumberSid
}

// ─── Orchestrator ─────────────────────────────────────────────────────────────

// Drives all steps in order. Resumable: skips any step already recorded on the
// tenant. Persists a2p_status='provisioning' on entry and 'pending' once every
// resource is created (brand/campaign then sit in TCR vetting — advance via poll).
export async function provisionA2p(tenantId: string): Promise<A2pStepResult[]> {
  const { data: tenant, error } = await supabase.from('tenants').select('*').eq('id', tenantId).single()
  if (error || !tenant) throw new Error(error?.message || 'Tenant not found')
  if (!tenant.a2p_data) throw new Error('No A2P data collected for this tenant (run intake first)')

  const d: A2pData = decryptJSON<A2pData>(tenant.a2p_data as string)
  const results: A2pStepResult[] = []
  await patchTenant(tenantId, { a2p_status: 'provisioning' })

  const steps: Array<[string, () => Promise<string | null>]> = [
    ['customer_profile', () => ensureCustomerProfile(tenant, d)],
    ['trust_bundle', () => ensureTrustBundle(tenant, d)],
    ['brand', () => ensureBrand(tenant, d)],
    ['messaging_service', () => ensureMessagingService(tenant, d)],
    ['campaign', () => ensureCampaign(tenant, d)],
    ['phone_number', () => ensurePhoneNumber(tenant, d)],
  ]

  for (const [name, fn] of steps) {
    const already = existingSidFor(name, tenant)
    try {
      const sid = await fn()
      results.push({ step: name, status: already ? 'skipped' : 'ok', sid: sid || undefined })
    } catch (e: any) {
      await patchTenant(tenantId, { a2p_status: 'error', a2p_rejection_reason: `${name}: ${e.message}`.slice(0, 500) })
      results.push({ step: name, status: 'error', detail: e.message })
      return results // stop; caller can fix + re-drive (resumable)
    }
  }

  await patchTenant(tenantId, { a2p_status: 'pending', a2p_submitted_at: new Date().toISOString(), a2p_rejection_reason: null })
  return results
}

function existingSidFor(step: string, t: TenantRow): boolean {
  switch (step) {
    case 'customer_profile': return !!t.a2p_profile_sid
    case 'trust_bundle': return !!t.a2p_trust_bundle_sid
    case 'brand': return !!t.a2p_brand_sid
    case 'messaging_service': return !!t.a2p_messaging_service_sid
    case 'campaign': return !!t.a2p_campaign_sid
    case 'phone_number': return !!t.a2p_phone_number
    default: return false
  }
}

// ─── Status polling ─────────────────────────────────────────────────────────
//
// Brand + campaign vetting is async (hours–days). Poll advances the tenant to
// 'approved' when both clear, or 'rejected' with the failure reason.

export async function pollA2pStatus(tenantId: string): Promise<{ status: string; brand?: string; campaign?: string }> {
  const { data: tenant, error } = await supabase.from('tenants').select('*').eq('id', tenantId).single()
  if (error || !tenant) throw new Error(error?.message || 'Tenant not found')
  if (!tenant.a2p_brand_sid) return { status: tenant.a2p_status || 'not_started' }

  const brand = await twilioFetch(MESSAGING, `/a2p/BrandRegistrations/${tenant.a2p_brand_sid}`, 'GET')
  const brandStatus: string = brand.status // PENDING | APPROVED | FAILED
  let campaignStatus: string | undefined
  if (tenant.a2p_messaging_service_sid && tenant.a2p_campaign_sid) {
    const camp = await twilioFetch(MESSAGING, `/Services/${tenant.a2p_messaging_service_sid}/Compliance/Usa2p/${tenant.a2p_campaign_sid}`, 'GET')
    campaignStatus = camp.campaign_status // PENDING | VERIFIED | FAILED
  }

  let next = tenant.a2p_status
  if (brandStatus === 'FAILED') {
    next = 'rejected'
    await patchTenant(tenantId, { a2p_status: 'rejected', a2p_rejection_reason: brand.failure_reason || 'Brand registration failed' })
  } else if (brandStatus === 'APPROVED' && (!campaignStatus || campaignStatus === 'VERIFIED')) {
    next = 'approved'
    await patchTenant(tenantId, { a2p_status: 'approved', a2p_approved_at: new Date().toISOString(), a2p_rejection_reason: null })
  } else if (campaignStatus === 'FAILED') {
    next = 'rejected'
    await patchTenant(tenantId, { a2p_status: 'rejected', a2p_rejection_reason: 'Campaign vetting failed' })
  } else {
    next = 'pending'
  }
  return { status: next, brand: brandStatus, campaign: campaignStatus }
}

// Poll every tenant currently mid-vetting. Called by the cron route.
export async function pollAllPendingA2p(): Promise<{ checked: number; advanced: number }> {
  const { data: rows, error } = await supabase.from('tenants').select('id, a2p_status')
    .in('a2p_status', ['provisioning', 'pending'])
  if (error) throw new Error(error.message)
  let advanced = 0
  for (const r of rows || []) {
    try {
      const res = await pollA2pStatus(r.id)
      if (res.status === 'approved' || res.status === 'rejected') advanced++
    } catch (e: any) {
      console.error('[A2P] poll failed for tenant', r.id, e.message)
    }
  }
  return { checked: (rows || []).length, advanced }
}
