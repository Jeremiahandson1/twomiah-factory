// A business's own texting registration (apps/api/src/services/a2p.ts) against a fake Twilio that records every call,
// checked against Twilio's ISV guide: the allowed values, the order (the campaign only once the brand is APPROVED),
// Low-Volume Standard, the sole proprietor's YES, replies routed to the business's own CRM, and the approved number
// handed to that CRM. The Factory DB is a stand-in; the wallet is a recorder; nothing reaches Twilio.
import { test, expect, mock, beforeEach, describe } from 'bun:test'
import path from 'node:path'
import { fakeStore } from './fakeStore.ts'

process.env.TWOMIAH_TWILIO_ACCOUNT_SID = 'AC-isv'
process.env.TWOMIAH_TWILIO_AUTH_TOKEN = 'isv-token'
process.env.TWILIO_PRIMARY_PROFILE_SID = 'BU-primary'
process.env.A2P_ENC_KEY = 'test-key'
process.env.TWOMIAH_FACTORY_URL = 'https://factory.test'
delete process.env.TWILIO_A2P_MOCK

const supabase = fakeStore()
const debits: Array<{ tenantId: string; cents: number; reason: string }> = []
mock.module(path.resolve(import.meta.dir, '../../../apps/api/src/middleware/auth.ts'), () => ({ supabase, authenticate: async () => {}, requireRole: () => async () => {} }))
mock.module(path.resolve(import.meta.dir, '../../../apps/api/src/services/messagingWallet.ts'), () => ({
  debit: async (tenantId: string, cents: number, reason: string) => { debits.push({ tenantId, cents, reason }); return 0 },
  credit: async () => 0,
}))
const { provisionA2p, advance, a2pDataProblem, campaignContent } = await import('../../../apps/api/src/services/a2p.ts')
const { encryptJSON } = await import('../../../apps/api/src/lib/crypto.ts')

// ─── a fake Twilio (and the business's CRM) ─────────────────────────────────
type Call = { method: string; url: string; form: URLSearchParams; headers: Record<string, string>; body: string }
let calls: Call[] = []
let brand = { status: 'PENDING', identity_status: 'UNVERIFIED' } as Record<string, any>
let campaignStatus = 'PENDING'
let evaluation = 'compliant'
let seq = 0
const sid = (p: string) => p + String(++seq).padStart(32 - p.length + 2, '0')
const realFetch = globalThis.fetch
beforeEach(() => {
  calls = []; seq = 0; debits.length = 0
  brand = { status: 'PENDING', identity_status: 'UNVERIFIED' }; campaignStatus = 'PENDING'; evaluation = 'compliant'
  globalThis.fetch = (async (input: any, init: any = {}) => {
    const url = String(input), method = init.method || 'GET'
    const form = new URLSearchParams(typeof init.body === 'string' && !String(init.headers?.['content-type'] || '').includes('json') ? init.body : '')
    calls.push({ method, url, form, headers: init.headers || {}, body: typeof init.body === 'string' ? init.body : '' })
    const ok = (j: any) => new Response(JSON.stringify(j), { status: 200, headers: { 'content-type': 'application/json' } })
    if (url.startsWith('https://acme-app.test/api/internal/texting')) return ok({ data: JSON.parse(init.body) })
    if (url.endsWith('/Evaluations')) return ok({ status: evaluation, results: evaluation === 'compliant' ? [] : [{ friendly_name: 'Business information', fields: [{ friendly_name: 'Website URL', passed: false }] }] })
    if (method === 'POST' && url.endsWith('/CustomerProfiles')) return ok({ sid: sid('BU') })
    if (method === 'POST' && url.endsWith('/TrustProducts')) return ok({ sid: sid('BU') })
    if (method === 'POST' && url.endsWith('/EndUsers')) return ok({ sid: sid('IT') })
    if (method === 'POST' && url.endsWith('/Addresses.json')) return ok({ sid: sid('AD') })
    if (method === 'POST' && url.endsWith('/SupportingDocuments')) return ok({ sid: sid('RD') })
    if (url.includes('/EntityAssignments')) return ok({ sid: sid('BV') })
    if (method === 'POST' && /\/(CustomerProfiles|TrustProducts)\/BU\w+$/.test(url)) return ok({ status: 'pending-review' })
    if (method === 'POST' && url.endsWith('/a2p/BrandRegistrations')) return ok({ sid: 'BN' + 'b'.repeat(32), status: 'PENDING' })
    if (method === 'GET' && url.includes('/a2p/BrandRegistrations/')) return ok({ sid: 'BN' + 'b'.repeat(32), ...brand })
    if (method === 'POST' && url.endsWith('messaging.twilio.com/v1/Services')) return ok({ sid: 'MG' + 'm'.repeat(32) })
    if (method === 'POST' && /\/Services\/MG\w+$/.test(url)) return ok({ sid: 'MG' + 'm'.repeat(32) })
    if (url.includes('/AvailablePhoneNumbers/US/Local.json')) return ok({ available_phone_numbers: [{ phone_number: '+17155550199' }] })
    if (method === 'POST' && url.endsWith('/IncomingPhoneNumbers.json')) return ok({ sid: 'PN' + 'p'.repeat(32) })
    if (method === 'GET' && url.includes('/IncomingPhoneNumbers/PN')) return ok({ sid: 'PN' + 'p'.repeat(32), phone_number: '+17155550199' })
    if (url.includes('pricing.twilio.com')) return ok({ phone_number_prices: [{ number_type: 'local', current_price: '1.15' }] })
    if (method === 'POST' && /\/Services\/MG\w+\/PhoneNumbers$/.test(url)) return ok({ sid: 'PN' + 'p'.repeat(32) })
    if (method === 'POST' && url.endsWith('/Compliance/Usa2p')) return ok({ sid: 'QE' + 'c'.repeat(32), campaign_status: 'PENDING' })
    if (method === 'GET' && url.includes('/Compliance/Usa2p/QE')) return ok({ campaign_status: campaignStatus, errors: campaignStatus === 'FAILED' ? [{ description: 'Opt-in not shown on the website' }] : [] })
    return new Response(JSON.stringify({ message: 'unexpected ' + method + ' ' + url }), { status: 404 })
  }) as any
})

const STANDARD = {
  kind: 'standard', legalName: 'Acme Remodeling LLC', businessType: 'Limited Liability Corporation', ein: '12-3456789', industry: 'CONSTRUCTION',
  street: '1 Main St', city: 'Eau Claire', region: 'WI', postalCode: '54701',
  repFirstName: 'Pat', repLastName: 'Jones', repEmail: 'pat@acme.example', repPhone: '+17155550100', repTitle: 'Owner', repJobPosition: 'CEO',
}
const SOLE = {
  kind: 'sole_proprietor', brandName: 'Pat\'s Lawn Care', mobilePhone: '+17155550111',
  street: '1 Main St', city: 'Eau Claire', region: 'WI', postalCode: '54701',
  repFirstName: 'Pat', repLastName: 'Jones', repEmail: 'pat@lawn.example', repPhone: '+17155550100',
}
const seed = (data: any) => {
  // one store for the whole file (the module under test holds it): reseeded, never replaced
  supabase.tables.tenants = [{
    id: 't-1', name: 'Acme Remodeling', phone: '715-555-0100', domain: 'acme.example', render_backend_url: 'https://acme-app.test',
    factory_sync_key: 'acme-key', messaging_enabled: true, messaging_wallet_cents: 5000, a2p_status: 'collected', a2p_data: encryptJSON(data),
  }]
}
const tenant = () => supabase.tables.tenants[0]
const posted = (frag: string) => calls.filter((c) => c.method === 'POST' && c.url.includes(frag))
const attrs = (c: Call) => JSON.parse(c.form.get('Attributes') || '{}')

describe('what a business sends is checked against Twilio\'s own lists', () => {
  test('a good registration passes; Twilio\'s values only', () => {
    expect(a2pDataProblem(STANDARD)).toBeNull()
    expect(a2pDataProblem(SOLE)).toBeNull()
    // the old form's values, which Twilio refuses
    expect(a2pDataProblem({ ...STANDARD, businessType: 'Limited Liability Company' })).toBe('Choose the business type.')
    expect(a2pDataProblem({ ...STANDARD, businessType: 'Sole Proprietorship' })).toBe('Choose the business type.')
    expect(a2pDataProblem({ ...STANDARD, repJobPosition: 'Owner' })).toBe('Choose the contact\'s position.')
    expect(a2pDataProblem({ ...STANDARD, industry: 'HOME_SERVICES' })).toBe('Choose the industry.')
    expect(a2pDataProblem({ ...STANDARD, ein: '123' })).toContain('EIN')
    expect(a2pDataProblem({ ...SOLE, mobilePhone: '' })).toContain('mobile')
  })
})

describe('a business with an EIN: Low-Volume Standard', () => {
  test('submit: the profile, the trust bundle and the brand — and nothing after it until the brand is approved', async () => {
    seed(STANDARD)
    const steps = await provisionA2p('t-1')
    expect(steps.filter((s) => s.status === 'ok').map((s) => s.step)).toEqual(['customer_profile', 'trust_bundle', 'brand'])
    expect(tenant().a2p_status).toBe('pending')
    // the profile: Twilio's values, the ISV's email (never the customer's)
    const profile = posted('/CustomerProfiles').find((c) => c.url.endsWith('/CustomerProfiles'))!
    expect(profile.form.get('PolicySid')).toBe('RNdfbf3fae0e1107f8aded0e7cead80bf5')
    expect(profile.form.get('Email')).not.toBe('pat@acme.example')
    const [info, rep] = posted('/EndUsers').map(attrs)
    expect(info).toMatchObject({ business_type: 'Limited Liability Corporation', business_identity: 'direct_customer', business_industry: 'CONSTRUCTION', business_registration_identifier: 'EIN', business_registration_number: '123456789', business_regions_of_operation: 'USA_AND_CANADA', website_url: 'https://acme.example' })
    expect(rep).toMatchObject({ job_position: 'CEO', business_title: 'Owner', phone_number: '+17155550100' })
    expect(posted('/EntityAssignments').map((c) => c.form.get('ObjectSid'))).toContain('BU-primary')
    // the A2P trust bundle: a private company
    expect(posted('/EndUsers').map(attrs)[2]).toEqual({ company_type: 'private' })
    // the brand: STANDARD, skipping secondary vetting (Low-Volume Standard)
    const b = posted('/a2p/BrandRegistrations')[0]
    expect([b.form.get('BrandType'), b.form.get('SkipAutomaticSecVet'), b.form.get('Mock')]).toEqual(['STANDARD', 'true', null])
    // nothing past the brand while it is in review
    expect(posted('messaging.twilio.com/v1/Services')).toHaveLength(0)
    expect(posted('/Compliance/Usa2p')).toHaveLength(0)
    expect(posted('/IncomingPhoneNumbers.json')).toHaveLength(0)
  })

  test('brand approved: its own Messaging Service (replies to its own CRM), its own number, then the campaign', async () => {
    seed(STANDARD)
    await provisionA2p('t-1')
    calls = []
    brand = { status: 'APPROVED', identity_status: 'VERIFIED' }
    const r = await advance('t-1')
    expect(r).toMatchObject({ status: 'pending', stage: 'campaign' })
    const svc = posted('messaging.twilio.com/v1/Services').find((c) => c.url.endsWith('/Services'))!
    expect(svc.form.get('InboundRequestUrl')).toBe('https://acme-app.test/api/sms/webhook/incoming')
    expect(svc.form.get('UseInboundWebhookOnNumber')).toBe('false')
    expect(svc.form.get('StatusCallback')).toBe('https://acme-app.test/api/sms/webhook/status')
    // a number in the business's own area code
    expect(calls.find((c) => c.url.includes('AvailablePhoneNumbers'))!.url).toContain('AreaCode=715')
    expect(posted('/PhoneNumbers')[0].form.get('PhoneNumberSid')).toMatch(/^PN/)
    // the campaign: Low Volume Mixed, with the business's privacy and terms, on API v1.2
    const camp = posted('/Compliance/Usa2p')[0]
    expect(camp.form.get('UsAppToPersonUsecase')).toBe('LOW_VOLUME')
    expect(camp.form.get('PrivacyPolicyUrl')).toBe('https://acme.example/privacy')
    expect(camp.form.get('TermsAndConditionsUrl')).toBe('https://acme.example/terms')
    expect(camp.headers['X-Twilio-Api-Version']).toBe('v1.2')
    const samples = camp.form.getAll('MessageSamples')
    expect(samples.length).toBeGreaterThanOrEqual(2)
    expect(samples.length).toBeLessThanOrEqual(5)
    for (const s of samples) { expect(s.length).toBeGreaterThanOrEqual(20); expect(s.length).toBeLessThanOrEqual(1024) }
    expect(camp.form.get('Description')!.length).toBeGreaterThanOrEqual(40)
    expect(camp.form.get('MessageFlow')!.length).toBeGreaterThanOrEqual(40)
    expect(camp.form.get('MessageFlow')).toContain('Consent is not a condition of purchase')
    // the vetting fee, once, when the campaign exists
    expect(debits).toEqual([{ tenantId: 't-1', cents: 1500, reason: 'a2p_campaign_vetting' }])
    // asked again while the campaign is in review: nothing new is made, nothing charged again
    calls = []
    expect((await advance('t-1')).stage).toBe('campaign')
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0)
    expect(debits).toHaveLength(1)
  })

  test('campaign verified: the number is handed to the business\'s CRM, with its key, and it is live', async () => {
    seed(STANDARD)
    await provisionA2p('t-1')
    brand = { status: 'APPROVED', identity_status: 'VERIFIED' }
    await advance('t-1')
    campaignStatus = 'VERIFIED'
    calls = []
    expect(await advance('t-1')).toMatchObject({ status: 'approved', stage: 'live' })
    const handover = calls.find((c) => c.url === 'https://acme-app.test/api/internal/texting')!
    expect(handover.headers['X-Factory-Key']).toBe('acme-key')
    expect(JSON.parse(handover.body)).toEqual({ messagingServiceSid: 'MG' + 'm'.repeat(32), phoneNumber: '+17155550199' })
    expect(tenant().a2p_status).toBe('approved')
  })

  test('the carriers turn the campaign down: rejected, in Twilio\'s words', async () => {
    seed(STANDARD)
    await provisionA2p('t-1')
    brand = { status: 'APPROVED', identity_status: 'VERIFIED' }
    await advance('t-1')
    campaignStatus = 'FAILED'
    expect(await advance('t-1')).toMatchObject({ status: 'rejected', stage: 'campaign' })
    expect(tenant().a2p_rejection_reason).toBe('Opt-in not shown on the website')
  })

  test('Twilio finds the profile incomplete: stopped before submitting it, saying what is missing', async () => {
    seed(STANDARD)
    evaluation = 'noncompliant'
    const steps = await provisionA2p('t-1')
    expect(steps.some((s) => s.status === 'error')).toBe(true)
    expect(tenant().a2p_status).toBe('error')
    expect(tenant().a2p_rejection_reason).toContain('Website URL')
    expect(posted('/a2p/BrandRegistrations')).toHaveLength(0)
  })
})

describe('a sole proprietor (no EIN)', () => {
  test('a Starter profile and a sole-proprietor bundle; the campaign waits for the owner\'s YES', async () => {
    seed(SOLE)
    await provisionA2p('t-1')
    expect(posted('/CustomerProfiles').find((c) => c.url.endsWith('/CustomerProfiles'))!.form.get('PolicySid')).toBe('RN806dd6cd175f314e1f96a9727ee271f4')
    expect(posted('/TrustProducts').find((c) => c.url.endsWith('/TrustProducts'))!.form.get('PolicySid')).toBe('RN670d5d2e282a6130ae063b234b6019c8')
    const types = posted('/EndUsers').map((c) => c.form.get('Type'))
    expect(types).toEqual(['starter_customer_profile_information', 'sole_proprietor_information'])
    expect(posted('/EndUsers').map(attrs)[1]).toEqual({ brand_name: 'Pat\'s Lawn Care', mobile_phone_number: '+17155550111' })
    const b = posted('/a2p/BrandRegistrations')[0]
    expect([b.form.get('BrandType'), b.form.get('SkipAutomaticSecVet')]).toEqual(['SOLE_PROPRIETOR', null])
    // approved but the owner has not replied YES
    brand = { status: 'APPROVED', identity_status: 'UNVERIFIED' }
    expect(await advance('t-1')).toMatchObject({ status: 'pending', stage: 'owner_confirmation' })
    expect(posted('/Compliance/Usa2p')).toHaveLength(0)
    // they did
    brand = { status: 'APPROVED', identity_status: 'VERIFIED' }
    await advance('t-1')
    expect(posted('/Compliance/Usa2p')[0].form.get('UsAppToPersonUsecase')).toBe('SOLE_PROPRIETOR')
    expect(posted('/IncomingPhoneNumbers.json')).toHaveLength(1)
  })
})

test('the campaign says what the business really sends, with its own pages', () => {
  const c = campaignContent({ id: 't', domain: 'acme.example' } as any, 'Acme')
  expect(c.MessageSamples[0]).toContain('Reply STOP to opt out')
  expect(c.MessageFlow).toContain('https://acme.example/privacy')
  expect(c.HasEmbeddedLinks).toBe(true)
})

test('the campaign quotes the "Text me" box word for word, as the reviewer will see it on the site', async () => {
  const { consentWording } = await import('../../../apps/unified/server/site/smsConsent.ts')
  const { CONSENT_BOX_WORDING } = await import('../../../apps/api/src/services/a2p.ts')
  expect(CONSENT_BOX_WORDING).toBe(consentWording('booking'))
  expect(campaignContent({ id: 't', domain: 'acme.example' } as any, 'Acme').MessageFlow).toContain(consentWording('booking'))
})

test('restores fetch', () => { globalThis.fetch = realFetch })
