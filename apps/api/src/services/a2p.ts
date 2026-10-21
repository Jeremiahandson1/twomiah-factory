// ============================================================================
// Per-business A2P 10DLC registration (Twilio ISV / Trust Hub)
// ============================================================================
//
// Twomiah is the Twilio ISV. Each business it serves texts from ITS OWN number, registered with the carriers under
// ITS OWN brand and campaign — the way Jobber, Housecall Pro and Podium do it — so a customer's reply reaches that
// business, and one business's sending never touches another's reputation. (Every business used to text from one
// shared Twomiah number: replies went to Twilio's demo auto-reply, and Android filed the texts as unknown. 2026-10-21.)
//
// Written to Twilio's ISV guide, checked 2026-10-21:
//   https://www.twilio.com/docs/messaging/compliance/a2p-10dlc/onboarding-isv-api
//   https://www.twilio.com/docs/messaging/compliance/a2p-10dlc/collect-business-info          (the enums below)
//   https://www.twilio.com/docs/messaging/compliance/a2p-10dlc/onboarding-isv-api-sole-prop-new
//   https://www.twilio.com/docs/messaging/api/usapptoperson-resource                          (campaign fields)
//   https://www.twilio.com/docs/messaging/api/service-resource                                (inbound routing)
//
// Two kinds of business:
//   standard         — has an EIN. A Low-Volume Standard brand (BrandType STANDARD + SkipAutomaticSecVet: under
//                      6,000 segments a day, the cheaper fee), campaign use case LOW_VOLUME ("Low Volume Mixed":
//                      confirmations, reminders, replies, review requests).
//   sole_proprietor  — no EIN. A Starter profile, a Sole Proprietor trust bundle, a brand the owner confirms by
//                      replying YES to a text Twilio sends their own mobile, use case SOLE_PROPRIETOR, ONE number.
//
// The steps WAIT on Twilio between them — "Do not complete this section until the BrandRegistration's status is
// APPROVED" (the campaign) — so registration is a state machine driven by the hourly poll and Twilio's callbacks:
//
//   submit:   profile → trust bundle → brand                      a2p_status 'pending', no campaign yet
//   brand APPROVED (and, for a sole proprietor, its YES confirmed):
//             Messaging Service (replies → the business's own CRM) → its number → campaign
//                                                                 a2p_status 'pending', campaign submitted
//   campaign VERIFIED: the number and service written into the business's CRM            a2p_status 'approved'
//   FAILED anywhere: a2p_status 'rejected' with Twilio's reasons; the business fixes and resubmits.
//
// Every step is idempotent: it records its SID on the tenant row and is skipped once recorded, so a failure
// mid-way (a2p_status 'error') is re-driven by submitting again. TWILIO_A2P_MOCK=true registers Twilio's MOCK
// brands (no carrier review, no fees) to exercise the real API end to end.

import { supabase } from '../middleware/auth'
import { decryptJSON } from '../lib/crypto'
import { debit } from './messagingWallet'
import { TWILIO_COSTS } from '../config/messagingCosts'

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

/** Twilio's published policy SIDs (the ISV guide). */
export const POLICY = {
  secondaryCustomerProfile: process.env.TWILIO_POLICY_SECONDARY_CP || 'RNdfbf3fae0e1107f8aded0e7cead80bf5',
  a2pMessaging: process.env.TWILIO_POLICY_A2P || 'RNb0d4771c2c98518d916a3d4cd70a8f8b',
  starterCustomerProfile: process.env.TWILIO_POLICY_STARTER_CP || 'RN806dd6cd175f314e1f96a9727ee271f4',
  soleProprietorA2p: process.env.TWILIO_POLICY_SP_A2P || 'RN670d5d2e282a6130ae063b234b6019c8',
}

function primaryProfileSid(): string {
  const sid = process.env.TWILIO_PRIMARY_PROFILE_SID || ''
  if (!sid) throw new Error('TWILIO_PRIMARY_PROFILE_SID not set (Twomiah ISV primary customer profile)')
  return sid
}

/** Trust Hub wants an address the ISV owns, never the customer's: Twilio writes to it about the review. */
const isvEmail = () => process.env.TWILIO_A2P_NOTIFY_EMAIL || 'twomiah14@gmail.com'
const mock = () => process.env.TWILIO_A2P_MOCK === 'true'
const factoryUrl = () => (process.env.TWOMIAH_FACTORY_URL || 'https://twomiah-factory-api.onrender.com').replace(/\/+$/, '')
/** Twilio's status callback for the Trust Hub bundles: it only nudges a poll. */
const VETTING_CALLBACK = () => factoryUrl() + '/api/v1/factory/internal/a2p/twilio-callback'

// ─── The allowed values (collect-business-info) ─────────────────────────────

export const BUSINESS_TYPES = ['Co-operative', 'Corporation', 'Limited Liability Corporation', 'Non-profit Corporation', 'Partnership'] as const
export const JOB_POSITIONS = ['Director', 'GM', 'VP', 'CEO', 'CFO', 'General Counsel', 'Other'] as const
export const INDUSTRIES = ['AGRICULTURE', 'AUTOMOTIVE', 'BANKING', 'CONSTRUCTION', 'CONSUMER', 'EDUCATION', 'ELECTRONICS', 'ENGINEERING', 'ENERGY',
  'FAST_MOVING_CONSUMER_GOODS', 'FINANCIAL', 'FINTECH', 'FOOD_AND_BEVERAGE', 'GOVERNMENT', 'HEALTHCARE', 'HOSPITALITY', 'INSURANCE', 'JEWELRY',
  'LEGAL', 'MANUFACTURING', 'MEDIA', 'NOT_FOR_PROFIT', 'OIL_AND_GAS', 'ONLINE', 'PROFESSIONAL_SERVICES', 'RAW_MATERIALS', 'REAL_ESTATE',
  'RELIGION', 'RETAIL', 'TECHNOLOGY', 'TELECOMMUNICATIONS', 'TRANSPORTATION', 'TRAVEL'] as const

// ─── Types ──────────────────────────────────────────────────────────────────

/** Decrypted tenants.a2p_data: what the business told us about itself. */
export interface A2pData {
  kind: 'standard' | 'sole_proprietor'
  // standard (has an EIN)
  legalName?: string
  businessType?: typeof BUSINESS_TYPES[number]
  ein?: string
  industry?: typeof INDUSTRIES[number]
  // sole proprietor (no EIN): the name customers know, and the owner's own mobile for the YES text
  brandName?: string
  mobilePhone?: string
  // both
  street: string
  city: string
  region: string
  postalCode: string
  repFirstName: string
  repLastName: string
  repEmail: string
  repPhone: string
  repTitle?: string
  repJobPosition?: typeof JOB_POSITIONS[number]
  /** An area code to prefer for the business's number (else the business phone's). */
  areaCode?: string
}

/** E.164 for a US/Canada number, or null. */
export function e164(phone?: string | null): string | null {
  const d = String(phone || '').replace(/\D/g, '')
  if (d.length === 10) return '+1' + d
  if (d.length === 11 && d.startsWith('1')) return '+' + d
  return null
}

/** What is wrong with what a business sent, or null. The registration's own check — every door uses it. */
export function a2pDataProblem(b: any): string | null {
  if (!b || typeof b !== 'object') return 'Send the registration details.'
  const str = (k: string) => typeof b[k] === 'string' && b[k].trim().length > 0
  if (b.kind !== 'standard' && b.kind !== 'sole_proprietor') return 'Choose whether the business has an EIN.'
  for (const k of ['street', 'city', 'region', 'postalCode', 'repFirstName', 'repLastName', 'repEmail', 'repPhone']) if (!str(k)) return `Missing: ${k}`
  if (!/^\S+@\S+\.\S+$/.test(b.repEmail)) return 'The contact email is not an email address.'
  if (!e164(b.repPhone)) return 'The contact phone must be a 10-digit US number.'
  if (!/^[A-Z]{2}$/.test(String(b.region).trim().toUpperCase())) return 'State must be the two-letter abbreviation (e.g. WI).'
  if (!/^\d{5}(-\d{4})?$/.test(String(b.postalCode).trim())) return 'ZIP must be 5 digits.'
  if (b.kind === 'standard') {
    for (const k of ['legalName', 'ein']) if (!str(k)) return `Missing: ${k}`
    if (!/^\d{2}-?\d{7}$/.test(String(b.ein).trim())) return 'The EIN must be 9 digits (12-3456789).'
    if (!BUSINESS_TYPES.includes(b.businessType)) return 'Choose the business type.'
    if (!INDUSTRIES.includes(b.industry)) return 'Choose the industry.'
    if (b.repJobPosition && !JOB_POSITIONS.includes(b.repJobPosition)) return 'Choose the contact\'s position.'
  } else {
    if (!str('brandName')) return 'Missing: the name customers know the business by.'
    if (!e164(b.mobilePhone)) return 'The owner\'s mobile must be a 10-digit US number — Twilio texts it to confirm.'
  }
  return null
}

type TenantRow = Record<string, any> & { id: string }

export interface A2pStepResult { step: string; status: 'ok' | 'skipped' | 'error' | 'waiting'; sid?: string; detail?: string }

// ─── Twilio REST helper ─────────────────────────────────────────────────────

async function twilio(base: string, path: string, method: 'GET' | 'POST' | 'DELETE', form?: Record<string, any>, headers: Record<string, string> = {}): Promise<any> {
  const { sid, token } = isvCreds()
  const init: RequestInit = { method, headers: { Authorization: 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64'), ...headers } }
  if (form) {
    const body = new URLSearchParams()
    for (const [k, v] of Object.entries(form)) {
      if (v === undefined || v === null) continue
      if (Array.isArray(v)) for (const item of v) body.append(k, String(item))
      else if (typeof v === 'object') body.append(k, JSON.stringify(v))
      else body.append(k, String(v))
    }
    ;(init.headers as any)['Content-Type'] = 'application/x-www-form-urlencoded'
    init.body = body.toString()
  }
  const res = await fetch(base + path, init)
  const text = await res.text()
  let json: any = null
  try { json = text ? JSON.parse(text) : null } catch { /* not JSON */ }
  if (!res.ok) {
    const err = new Error(`Twilio ${method} ${path} → ${res.status}: ${json?.message || text || 'error'}`) as any
    err.status = res.status
    err.code = json?.code
    throw err
  }
  return json
}

async function patchTenant(tenantId: string, patch: Record<string, any>): Promise<void> {
  const { error } = await supabase.from('tenants').update(patch).eq('id', tenantId)
  if (error) throw new Error('Failed to save registration progress: ' + error.message)
}

/** Evaluate a bundle against its policy; refuse to submit one Twilio says is incomplete (and say what). */
async function evaluateAndSubmit(kind: 'CustomerProfiles' | 'TrustProducts', sid: string, policy: string): Promise<void> {
  const ev = await twilio(TRUSTHUB, `/${kind}/${sid}/Evaluations`, 'POST', { PolicySid: policy })
  if (ev?.status && ev.status !== 'compliant') {
    const why = (ev.results || []).flatMap((r: any) => (r.fields || []).filter((f: any) => !f.passed).map((f: any) => `${r.friendly_name || r.object_type}: ${f.friendly_name || f.object_field}`))
    throw new Error(`Twilio found the ${kind === 'CustomerProfiles' ? 'business profile' : 'messaging profile'} incomplete: ${why.join('; ') || ev.status}`)
  }
  await twilio(TRUSTHUB, `/${kind}/${sid}`, 'POST', { Status: 'pending-review' })
}

// ─── Where the business lives on the web ────────────────────────────────────

/** The business's own website (TCR screenshots it: live, on-brand, not behind a login). */
export function siteOf(t: TenantRow): string {
  if (t.domain) return 'https://' + String(t.domain).replace(/^https?:\/\//, '').replace(/\/+$/, '')
  return String(t.website_url || t.render_backend_url || '').replace(/\/+$/, '')
}
/** The business's CRM (its inbound text webhook lives there). */
const crmOf = (t: TenantRow) => String(t.render_backend_url || '').replace(/\/+$/, '')

// ─── What the business texts, for the campaign ──────────────────────────────

/**
 * The campaign Twilio and the carriers review: what the business sends, how customers agree to it, and real
 * samples. It says only what the system does — the booking and contact forms carry the unticked "Text me" box
 * (site), the texts are the booking engine's own (booking/texts.ts), and the privacy and terms pages are the site's.
 */
/** The words beside the booking form's "Text me" box — the unified app's site/smsConsent.ts consentWording('booking'),
 *  word for word (tests/unified/factory/a2p.test.ts holds them together): the campaign quotes what the reviewer will see. */
export const CONSENT_BOX_WORDING = 'Text me about my booking. Message frequency varies. Message and data rates may apply. Reply STOP to stop receiving texts, or HELP for help.'

export function campaignContent(t: TenantRow, businessName: string) {
  const site = siteOf(t)
  const name = businessName.trim()
  return {
    Description: `${name} texts its own customers about the appointments and bookings they make: a confirmation when they book, a reminder the day before, updates about their visit, replies to the questions they text in, and — after a completed visit — a request for a review. Customers can reply to any text to reach ${name}.`,
    MessageFlow: `Customers give their mobile number to ${name} when they book online or send an enquiry on ${site}. Each form has an unticked, optional checkbox: "${CONSENT_BOX_WORDING}" with links to ${site}/privacy and ${site}/terms. Customers who text ${name} first are answered in that conversation. Consent is not a condition of purchase.`,
    MessageSamples: [
      `${name}: your appointment is booked for Thursday, October 22 at 8:00 AM. Change or cancel: ${site}/booking/abc123 Reply STOP to opt out.`,
      `${name}: a reminder of your appointment tomorrow at 8:00 AM. Change or cancel: ${site}/booking/abc123`,
      `Hi Pat, thanks for choosing ${name}! If we did good work, a quick review would mean a lot: ${site}/review`,
    ],
    HasEmbeddedLinks: true,
    HasEmbeddedPhone: false,
    PrivacyPolicyUrl: `${site}/privacy`,
    TermsAndConditionsUrl: `${site}/terms`,
  }
}

// ─── Steps: the brand ───────────────────────────────────────────────────────

async function ensureCustomerProfile(t: TenantRow, d: A2pData): Promise<string> {
  if (t.a2p_profile_sid) return t.a2p_profile_sid
  const sp = d.kind === 'sole_proprietor'
  const name = sp ? d.brandName! : d.legalName!
  const bundle = await twilio(TRUSTHUB, '/CustomerProfiles', 'POST', {
    FriendlyName: `${name} — ${sp ? 'Starter' : 'Secondary'} Customer Profile`,
    Email: isvEmail(),
    PolicySid: sp ? POLICY.starterCustomerProfile : POLICY.secondaryCustomerProfile,
    StatusCallback: VETTING_CALLBACK(),
  })
  const entities: string[] = []
  if (sp) {
    const info = await twilio(TRUSTHUB, '/EndUsers', 'POST', {
      FriendlyName: `${name} owner`, Type: 'starter_customer_profile_information',
      Attributes: { first_name: d.repFirstName, last_name: d.repLastName, email: d.repEmail, phone_number: e164(d.repPhone) },
    })
    entities.push(info.sid)
  } else {
    const info = await twilio(TRUSTHUB, '/EndUsers', 'POST', {
      FriendlyName: `${name} business information`, Type: 'customer_profile_business_information',
      Attributes: {
        business_name: d.legalName, business_type: d.businessType, business_industry: d.industry,
        business_registration_identifier: 'EIN', business_registration_number: String(d.ein).replace(/\D/g, ''),
        business_identity: 'direct_customer', business_regions_of_operation: 'USA_AND_CANADA',
        website_url: siteOf(t), social_media_profile_urls: '',
      },
    })
    const rep = await twilio(TRUSTHUB, '/EndUsers', 'POST', {
      FriendlyName: `${d.repFirstName} ${d.repLastName}`, Type: 'authorized_representative_1',
      Attributes: {
        first_name: d.repFirstName, last_name: d.repLastName, email: d.repEmail, phone_number: e164(d.repPhone),
        business_title: d.repTitle || 'Owner', job_position: d.repJobPosition || 'Other',
      },
    })
    entities.push(info.sid, rep.sid)
  }
  const address = await twilio(`${API2010}/Accounts/${isvCreds().sid}`, '/Addresses.json', 'POST', {
    FriendlyName: `${name} address`, CustomerName: name, Street: d.street, City: d.city, Region: d.region.toUpperCase(), PostalCode: d.postalCode, IsoCountry: 'US',
  })
  const doc = await twilio(TRUSTHUB, '/SupportingDocuments', 'POST', { FriendlyName: `${name} address`, Type: 'customer_profile_address', Attributes: { address_sids: address.sid } })
  for (const objectSid of [...entities, doc.sid, primaryProfileSid()]) {
    await twilio(TRUSTHUB, `/CustomerProfiles/${bundle.sid}/EntityAssignments`, 'POST', { ObjectSid: objectSid })
  }
  await evaluateAndSubmit('CustomerProfiles', bundle.sid, sp ? POLICY.starterCustomerProfile : POLICY.secondaryCustomerProfile)
  await patchTenant(t.id, { a2p_profile_sid: bundle.sid })
  t.a2p_profile_sid = bundle.sid
  return bundle.sid
}

async function ensureTrustBundle(t: TenantRow, d: A2pData): Promise<string> {
  if (t.a2p_trust_bundle_sid) return t.a2p_trust_bundle_sid
  const sp = d.kind === 'sole_proprietor'
  const name = sp ? d.brandName! : d.legalName!
  const policy = sp ? POLICY.soleProprietorA2p : POLICY.a2pMessaging
  const tp = await twilio(TRUSTHUB, '/TrustProducts', 'POST', { FriendlyName: `${name} — A2P messaging`, Email: isvEmail(), PolicySid: policy, StatusCallback: VETTING_CALLBACK() })
  const profile = sp
    ? await twilio(TRUSTHUB, '/EndUsers', 'POST', { FriendlyName: `${name} sole proprietor`, Type: 'sole_proprietor_information', Attributes: { brand_name: d.brandName, mobile_phone_number: e164(d.mobilePhone) } })
    : await twilio(TRUSTHUB, '/EndUsers', 'POST', { FriendlyName: `${name} A2P profile`, Type: 'us_a2p_messaging_profile_information', Attributes: { company_type: d.businessType === 'Non-profit Corporation' ? 'non-profit' : 'private' } })
  for (const objectSid of [profile.sid, t.a2p_profile_sid]) {
    await twilio(TRUSTHUB, `/TrustProducts/${tp.sid}/EntityAssignments`, 'POST', { ObjectSid: objectSid })
  }
  await evaluateAndSubmit('TrustProducts', tp.sid, policy)
  await patchTenant(t.id, { a2p_trust_bundle_sid: tp.sid })
  t.a2p_trust_bundle_sid = tp.sid
  return tp.sid
}

async function ensureBrand(t: TenantRow, d: A2pData): Promise<string> {
  if (t.a2p_brand_sid) return t.a2p_brand_sid
  const sp = d.kind === 'sole_proprietor'
  const brand = await twilio(MESSAGING, '/a2p/BrandRegistrations', 'POST', {
    CustomerProfileBundleSid: t.a2p_profile_sid,
    A2PProfileBundleSid: t.a2p_trust_bundle_sid,
    BrandType: sp ? 'SOLE_PROPRIETOR' : 'STANDARD',
    // Low-Volume Standard: skip the automatic secondary vetting (and its fee). Under 6,000 segments a day.
    ...(sp ? {} : { SkipAutomaticSecVet: true }),
    ...(mock() ? { Mock: true } : {}),
  })
  await patchTenant(t.id, { a2p_brand_sid: brand.sid })
  t.a2p_brand_sid = brand.sid
  return brand.sid
}

// ─── Steps: once the brand is approved ──────────────────────────────────────

async function ensureMessagingService(t: TenantRow, name: string): Promise<string> {
  const crm = crmOf(t)
  if (!crm) throw new Error('This business has no CRM address yet — deploy it first.')
  // Replies go to the business's own CRM (its Messages inbox), never the number's own webhook; delivery receipts too.
  const settings = { InboundRequestUrl: crm + '/api/sms/webhook/incoming', InboundMethod: 'POST', UseInboundWebhookOnNumber: false, StatusCallback: crm + '/api/sms/webhook/status' }
  if (t.a2p_messaging_service_sid) {
    await twilio(MESSAGING, `/Services/${t.a2p_messaging_service_sid}`, 'POST', settings)
    return t.a2p_messaging_service_sid
  }
  const svc = await twilio(MESSAGING, '/Services', 'POST', { FriendlyName: `${name} texting`.slice(0, 64), ...settings })
  await patchTenant(t.id, { a2p_messaging_service_sid: svc.sid })
  t.a2p_messaging_service_sid = svc.sid
  return svc.sid
}

async function numberPriceCents(): Promise<number | null> {
  try {
    const p = await twilio('https://pricing.twilio.com/v1', '/PhoneNumbers/Countries/US', 'GET')
    const local = (p?.phone_number_prices || []).find((x: any) => String(x.number_type).toLowerCase() === 'local')
    const n = local ? Math.round(parseFloat(local.current_price) * 100) : NaN
    return Number.isFinite(n) ? n : null
  } catch { return null }
}

/** The business's own local number, in its Messaging Service. Bought in its area code where Twilio has one. */
async function ensurePhoneNumber(t: TenantRow, d: A2pData): Promise<string> {
  if (t.a2p_phone_number) return t.a2p_phone_number
  const acct = `${API2010}/Accounts/${isvCreds().sid}`
  const area = String(d.areaCode || '').replace(/\D/g, '') || (e164(t.phone)?.slice(2, 5)) || (e164(d.repPhone)?.slice(2, 5)) || ''
  const tries = [area ? `AreaCode=${area}` : '', `InRegion=${encodeURIComponent(d.region.toUpperCase())}`, ''].filter((x, i, a) => a.indexOf(x) === i)
  let bought: any = null
  for (const f of tries) {
    const found = await twilio(acct, `/AvailablePhoneNumbers/US/Local.json?SmsEnabled=true&Limit=1${f ? '&' + f : ''}`, 'GET').catch(() => null)
    const candidate = found?.available_phone_numbers?.[0]?.phone_number
    if (!candidate) continue
    bought = await twilio(acct, '/IncomingPhoneNumbers.json', 'POST', { PhoneNumber: candidate, FriendlyName: (d.brandName || d.legalName || '').slice(0, 64) })
    break
  }
  if (!bought?.sid) throw new Error('Twilio had no number to buy right now — it will be tried again.')
  await twilio(MESSAGING, `/Services/${t.a2p_messaging_service_sid}/PhoneNumbers`, 'POST', { PhoneNumberSid: bought.sid })
  await patchTenant(t.id, { a2p_phone_number: bought.sid, a2p_number_monthly_cents: await numberPriceCents() })
  t.a2p_phone_number = bought.sid
  return bought.sid
}

async function ensureCampaign(t: TenantRow, d: A2pData, name: string): Promise<string> {
  if (t.a2p_campaign_sid) return t.a2p_campaign_sid
  const c = campaignContent(t, name)
  const campaign = await twilio(MESSAGING, `/Services/${t.a2p_messaging_service_sid}/Compliance/Usa2p`, 'POST', {
    BrandRegistrationSid: t.a2p_brand_sid,
    UsAppToPersonUsecase: d.kind === 'sole_proprietor' ? 'SOLE_PROPRIETOR' : 'LOW_VOLUME',
    ...c,
  }, { 'X-Twilio-Api-Version': 'v1.2' })
  await patchTenant(t.id, { a2p_campaign_sid: campaign.sid })
  t.a2p_campaign_sid = campaign.sid
  return campaign.sid
}

// ─── Telling the business's CRM ─────────────────────────────────────────────

/** The approved sender, written into the business's own CRM (company.integrations) — no redeploy. */
export async function pushSenderToCrm(t: TenantRow): Promise<{ ok: boolean; error?: string; phone?: string }> {
  const crm = crmOf(t)
  if (!crm || !t.factory_sync_key) return { ok: false, error: 'no CRM address or key' }
  const num = await twilio(`${API2010}/Accounts/${isvCreds().sid}`, `/IncomingPhoneNumbers/${t.a2p_phone_number}.json`, 'GET')
  const r = await fetch(crm + '/api/internal/texting', {
    method: 'POST', headers: { 'content-type': 'application/json', 'X-Factory-Key': t.factory_sync_key },
    body: JSON.stringify({ messagingServiceSid: t.a2p_messaging_service_sid, phoneNumber: num.phone_number }),
  })
  if (!r.ok) return { ok: false, error: `CRM answered ${r.status}`, phone: num.phone_number }
  return { ok: true, phone: num.phone_number }
}

// ─── Driving it ─────────────────────────────────────────────────────────────

async function load(tenantId: string): Promise<{ t: TenantRow; d: A2pData; name: string }> {
  const { data: t, error } = await supabase.from('tenants').select('*').eq('id', tenantId).single()
  if (error || !t) throw new Error(error?.message || 'Tenant not found')
  if (!t.a2p_data) throw new Error('No registration details collected yet')
  const d = decryptJSON<A2pData>(t.a2p_data as string)
  return { t, d, name: (d.kind === 'sole_proprietor' ? d.brandName : d.legalName) || t.name || 'Business' }
}

async function step(results: A2pStepResult[], name: string, already: boolean, fn: () => Promise<string>): Promise<string> {
  const sid = await fn()
  results.push({ step: name, status: already ? 'skipped' : 'ok', sid })
  return sid
}

/**
 * Submit (or re-drive) a business's registration: the business profile, trust bundle and brand, then — if the
 * brand is already approved — everything after it. Stops at the first error with a2p_status 'error' and the
 * reason; submitting again resumes where it stopped.
 */
export async function provisionA2p(tenantId: string): Promise<A2pStepResult[]> {
  const { t, d } = await load(tenantId)
  const results: A2pStepResult[] = []
  await patchTenant(tenantId, { a2p_status: 'provisioning', a2p_rejection_reason: null })
  try {
    await step(results, 'customer_profile', !!t.a2p_profile_sid, () => ensureCustomerProfile(t, d))
    await step(results, 'trust_bundle', !!t.a2p_trust_bundle_sid, () => ensureTrustBundle(t, d))
    await step(results, 'brand', !!t.a2p_brand_sid, () => ensureBrand(t, d))
  } catch (e: any) {
    await patchTenant(tenantId, { a2p_status: 'error', a2p_rejection_reason: `${results.length ? 'after ' + results[results.length - 1].step + ': ' : ''}${e.message}`.slice(0, 1000) })
    results.push({ step: 'error', status: 'error', detail: e.message })
    return results
  }
  await patchTenant(tenantId, { a2p_status: 'pending', a2p_submitted_at: new Date().toISOString() })
  results.push({ step: 'brand_review', status: 'waiting', detail: d.kind === 'sole_proprietor' ? 'Twilio texts the owner\'s mobile; they reply YES' : 'carrier review of the brand' })
  const later = await advance(tenantId)
  return [...results, ...later.steps]
}

/** Twilio's reasons, from the current `errors` array (failure_reason is deprecated). */
const reasons = (x: any, fallback: string) => {
  const list = (x?.errors || []).map((e: any) => e.description || e.message || e.code).filter(Boolean)
  return (list.length ? list.join('; ') : x?.failure_reason || fallback).slice(0, 1000)
}

/**
 * Move one business forward as far as Twilio lets it: brand approved → service, number, campaign; campaign
 * verified → the number into its CRM. Returns where it now stands.
 */
export async function advance(tenantId: string): Promise<{ status: string; stage: string; steps: A2pStepResult[]; detail?: string }> {
  const { t, d, name } = await load(tenantId)
  const steps: A2pStepResult[] = []
  if (t.a2p_status === 'approved') return { status: 'approved', stage: 'live', steps }
  if (!t.a2p_brand_sid) return { status: t.a2p_status || 'not_started', stage: 'not_submitted', steps }

  const brand = await twilio(MESSAGING, `/a2p/BrandRegistrations/${t.a2p_brand_sid}`, 'GET')
  if (brand.status === 'FAILED' || brand.status === 'SUSPENDED') {
    const why = reasons(brand, 'The carriers did not approve the business.')
    await patchTenant(tenantId, { a2p_status: 'rejected', a2p_rejection_reason: why })
    return { status: 'rejected', stage: 'brand', steps, detail: why }
  }
  const sp = d.kind === 'sole_proprietor'
  if (brand.status !== 'APPROVED' || (sp && brand.identity_status !== 'VERIFIED')) {
    return { status: 'pending', stage: sp && brand.status === 'APPROVED' ? 'owner_confirmation' : 'brand', steps, detail: brand.status }
  }

  if (!t.a2p_campaign_sid) {
    try {
      await step(steps, 'messaging_service', !!t.a2p_messaging_service_sid, () => ensureMessagingService(t, name))
      await step(steps, 'phone_number', !!t.a2p_phone_number, () => ensurePhoneNumber(t, d))
      const campaignSid = await step(steps, 'campaign', false, () => ensureCampaign(t, d, name))
      // Twilio's campaign vetting fee, at cost, once — the campaign exists now.
      await debit(tenantId, TWILIO_COSTS.campaignVettingCents, 'a2p_campaign_vetting', { twilioRef: campaignSid })
        .catch((e: any) => console.error('[A2P] campaign vetting debit failed for', tenantId, e?.message || e))
    } catch (e: any) {
      await patchTenant(tenantId, { a2p_status: 'error', a2p_rejection_reason: `${e.message}`.slice(0, 1000) })
      steps.push({ step: 'error', status: 'error', detail: e.message })
      return { status: 'error', stage: 'campaign', steps, detail: e.message }
    }
    return { status: 'pending', stage: 'campaign', steps }
  }

  const camp = await twilio(MESSAGING, `/Services/${t.a2p_messaging_service_sid}/Compliance/Usa2p/${t.a2p_campaign_sid}`, 'GET', undefined, { 'X-Twilio-Api-Version': 'v1.2' })
  if (camp.campaign_status === 'FAILED' || camp.campaign_status === 'SUSPENDED') {
    const why = reasons(camp, 'The carriers did not approve what the business texts.')
    await patchTenant(tenantId, { a2p_status: 'rejected', a2p_rejection_reason: why })
    return { status: 'rejected', stage: 'campaign', steps, detail: why }
  }
  if (camp.campaign_status !== 'VERIFIED') return { status: 'pending', stage: 'campaign', steps, detail: camp.campaign_status }

  const pushed = await pushSenderToCrm(t)
  if (!pushed.ok) {
    // Approved at the carriers; the CRM did not take it yet — the next poll tries again.
    return { status: 'pending', stage: 'handover', steps, detail: pushed.error }
  }
  await patchTenant(tenantId, { a2p_status: 'approved', a2p_approved_at: new Date().toISOString(), a2p_rejection_reason: null })
  steps.push({ step: 'handover', status: 'ok', detail: pushed.phone })
  return { status: 'approved', stage: 'live', steps }
}

/** Kept for the staff panel's "refresh": where it stands, after moving it on. */
export async function pollA2pStatus(tenantId: string) {
  const r = await advance(tenantId)
  return { status: r.status, stage: r.stage, detail: r.detail }
}

/** Every business mid-registration, moved on. The hourly cleanup and Twilio's callbacks call this. */
export async function pollAllPendingA2p(): Promise<{ checked: number; advanced: number }> {
  const { data: rows, error } = await supabase.from('tenants').select('id, a2p_status').in('a2p_status', ['pending'])
  if (error) throw new Error(error.message)
  let advanced = 0
  for (const r of rows || []) {
    try {
      const res = await advance(r.id)
      if (res.status !== 'pending' || res.steps.length) advanced++
    } catch (e: any) {
      console.error('[A2P] advance failed for tenant', r.id, e.message)
    }
  }
  return { checked: (rows || []).length, advanced }
}

/** A sole proprietor's confirmation text again (Twilio sends only the first one by itself; it lasts 24 hours). */
export async function resendOwnerConfirmation(tenantId: string): Promise<void> {
  const { t, d } = await load(tenantId)
  if (d.kind !== 'sole_proprietor' || !t.a2p_brand_sid) throw new Error('Only a sole proprietor\'s registration is confirmed by text.')
  await twilio(MESSAGING, `/a2p/BrandRegistrations/${t.a2p_brand_sid}/SmsOtp`, 'POST', {})
}
