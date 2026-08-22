/**
 * Weekly live proof of the booking + deposit money path.
 *
 * Provisions ONE throwaway salon tenant through the REAL pipeline (GitHub +
 * Render + Postgres), then proves against the live service:
 *   - online booking lands as an appointment and blocks its slot
 *   - a deposit booking is held pending with a real Stripe PaymentIntent
 *   - the test card charges and the AUTO-REGISTERED webhook flips the booking
 *     to confirmed/paid (this is the leg that silently dies when webhook
 *     verification or endpoint registration regresses)
 * Tears everything down in a finally — including the Stripe webhook endpoint.
 *
 * Needs: SUPABASE_*, RENDER_API_KEY, GITHUB_TOKEN, STRIPE_SECRET_KEY (test),
 * STRIPE_PUBLISHABLE_KEY (test). Exits non-zero on any failure and prints
 * "Pass: n/n" + ❌ lines in the shape src/cron/regression.ts scrapes.
 *
 * Run: cd apps/api && bun run scripts/test-booking-deposit-e2e.ts
 */
import crypto from 'crypto'
import { generate } from '../src/services/generator.ts'
import { deployCustomer } from '../src/services/deploy.ts'
import { getFeaturesForTemplate } from '../src/config/featureRegistry.ts'
import { hardDeleteTestTenant } from '../src/services/testCleanup.ts'
import { createClient } from '@supabase/supabase-js'

const SK = process.env.STRIPE_SECRET_KEY || ''
if (!SK.startsWith('sk_test_')) {
  // A weekly cron must never charge live money by accident.
  console.error('❌ STRIPE_SECRET_KEY is missing or not a TEST key — refusing to run')
  process.exit(1)
}

let passed = 0
const failures: string[] = []
const check = (label: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log('  ✅ ' + label) }
  else { failures.push(label); console.log('  ❌ ' + label + ' → ' + JSON.stringify(detail ?? null)?.slice(0, 200)) }
}

const KNOWN_PASSWORD = 'Bkdep-test-pw-' + crypto.randomBytes(3).toString('hex') + '!'
const ADMIN_EMAIL = 'twomiah14@gmail.com'
const NAME = 'Booking Deposit Weekly (test)'

async function stripeApi(method: string, path: string, form?: Record<string, string>) {
  const res = await fetch('https://api.stripe.com/v1' + path, {
    method,
    headers: { Authorization: 'Basic ' + btoa(SK + ':'), ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
    ...(form ? { body: new URLSearchParams(form).toString() } : {}),
    signal: AbortSignal.timeout(60_000),
  })
  return { status: res.status, json: await res.json() as any }
}

async function main() {
  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const slug = 'bkdep-' + Date.now().toString(36) + '-' + crypto.randomBytes(2).toString('hex')
  const tenantId = crypto.randomUUID()
  const products = ['crm']
  const salonFeatures = getFeaturesForTemplate('crm-salon').map(f => f.id)

  const config: any = {
    tenant_id: tenantId, tenant_name: NAME, tenant_slug: slug, products,
    company: {
      name: NAME, email: ADMIN_EMAIL, phone: '+1-608-555-0177',
      address: '18 W Mifflin St', city: 'Madison', state: 'WI', stateFull: 'Wisconsin', zip: '53703',
      domain: '', domainMode: 'skip', ownerName: 'Owner', industry: 'hair_salon',
      defaultPassword: KNOWN_PASSWORD,
    },
    branding: { primaryColor: '#0D9488', secondaryColor: '#0F766E', logo: null, logoFilename: null, favicon: null, faviconFilename: null, heroPhoto: null, heroPhotoFilename: null },
    // features.website MUST stay [] (stripWebsiteFeatures wipes site content otherwise)
    features: { crm: salonFeatures, website: [], paid_ads: false },
    integrations: { twilio: { accountSid: '', authToken: '', phoneNumber: '' }, sendgrid: { apiKey: '' }, stripe: { secretKey: SK, publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || '', webhookSecret: '' }, googleMaps: { apiKey: '' }, sentry: { dsn: '' }, nearmap: { apiKey: '' }, replicate: { apiToken: '' } },
    content: { services: [], customServices: [], heroTagline: '', aboutText: '', ctaText: '', description: '' },
  }

  await supabase.from('tenants').insert({
    id: tenantId, name: NAME, slug, email: ADMIN_EMAIL, admin_email: ADMIN_EMAIL,
    industry: 'hair_salon', city: 'Madison', state: 'WI', status: 'pending', products,
    plan: 'starter', is_test_tenant: true, domain: null,
  })

  let crmUrl = ''
  try {
    console.log('[bkdep] Generating + deploying a salon tenant…')
    const zip = await generate({ id: tenantId, ...config } as any)
    const deploy: any = await deployCustomer(
      { id: tenantId, slug, name: NAME, industry: 'hair_salon', products, config } as any,
      zip.zipPath, { products } as any,
    )
    crmUrl = deploy.apiUrl || deploy.deployedUrl || ''
    check('Pipeline deployed a live CRM URL', !!crmUrl, deploy.errors)
    if (!crmUrl) throw new Error('deploy failed')

    console.log('[bkdep] Waiting for first boot…')
    let awake = false
    for (let i = 0; i < 120 && !awake; i++) {
      try { awake = (await fetch(crmUrl + '/health', { signal: AbortSignal.timeout(20_000) })).ok } catch {}
      if (!awake) await new Promise(r => setTimeout(r, 10_000))
    }
    check('Service booted (/health 200)', awake)
    if (!awake) throw new Error('never booted')

    const lb = await (await fetch(crmUrl + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: ADMIN_EMAIL, password: KNOWN_PASSWORD }) })).json() as any
    check('Owner login works', !!lb?.accessToken)
    const H = { Authorization: 'Bearer ' + lb.accessToken, 'Content-Type': 'application/json' }
    const me = await (await fetch(crmUrl + '/api/auth/me', { headers: H })).json() as any
    const coSlug = me?.company?.slug

    const st = await fetch(crmUrl + '/api/booking/settings', { method: 'PUT', headers: H, body: JSON.stringify({
      enabled: true, slotDurationMinutes: 60, leadTimeHours: 0, maxDaysOut: 30,
      workingHours: Object.fromEntries(['monday','tuesday','wednesday','thursday','friday','saturday','sunday'].map(d => [d, { enabled: true, start: '08:00', end: '18:00' }])),
    }) })
    check('Booking settings save', st.status === 200, st.status)

    const plain = await (await fetch(crmUrl + '/api/booking/services', { method: 'POST', headers: H, body: JSON.stringify({ name: 'Plain Cut', durationMinutes: 60, price: 40, active: true }) })).json() as any
    const dep = await (await fetch(crmUrl + '/api/booking/services', { method: 'POST', headers: H, body: JSON.stringify({ name: 'Deposit Cut', durationMinutes: 60, price: 80, depositRequired: true, depositAmount: 20, active: true }) })).json() as any
    check('Bookable services created', !!plain?.id && !!dep?.id)

    const pub = async (method: string, path: string, body?: unknown) => {
      const res = await fetch(crmUrl + path, { method, headers: body !== undefined ? { 'Content-Type': 'application/json' } : {}, ...(body !== undefined ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(60_000) })
      let json: any = null; try { json = await res.json() } catch {}
      return { status: res.status, json }
    }
    const dates = await pub('GET', `/api/booking/public/${coSlug}/dates`)
    const day = (dates.json || [])[1]?.date || (dates.json || [])[0]?.date
    const slots = await pub('GET', `/api/booking/public/${coSlug}/slots?date=${day}&serviceId=${plain.id}`)
    const t1 = (slots.json || [])[0]?.time, t2 = (slots.json || [])[1]?.time
    check('Public dates + slots offered', !!day && !!t1 && !!t2, { day, n: slots.json?.length })

    // plain booking → appointment + slot blocked
    const b1 = await pub('POST', `/api/booking/public/${coSlug}`, { serviceId: plain.id, date: day, time: t1, firstName: 'Weekly', lastName: 'Plain', email: ADMIN_EMAIL, phone: '+1-608-555-0001' })
    check('Plain booking confirmed immediately (no deposit)', b1.status === 201 && !!b1.json?.confirmationCode, b1.status)
    const slots2 = await pub('GET', `/api/booking/public/${coSlug}/slots?date=${day}&serviceId=${plain.id}`)
    check('Its slot is blocked', !(slots2.json || []).some((s: any) => s.time === t1))

    // deposit booking → pending + intent → charge → webhook flips it
    const b2 = await pub('POST', `/api/booking/public/${coSlug}`, { serviceId: dep.id, date: day, time: t2, firstName: 'Weekly', lastName: 'Deposit', email: ADMIN_EMAIL, phone: '+1-608-555-0002' })
    const cs = b2.json?.deposit?.clientSecret || ''
    check('Deposit booking pending with a PaymentIntent', b2.status === 201 && /^pi_/.test(cs), b2.json?.deposit)
    const piId = cs.split('_secret_')[0]
    const conf = await stripeApi('POST', `/payment_intents/${piId}/confirm`, { payment_method: 'pm_card_visa', return_url: 'https://example.com/return' })
    check('Test card charge succeeded', conf.json?.status === 'succeeded', conf.json?.error?.message)

    let row: any = null
    for (let i = 0; i < 30 && row?.deposit_status !== 'paid'; i++) {
      await new Promise(r => setTimeout(r, 2000))
      const l = await (await fetch(crmUrl + '/api/booking', { headers: H })).json() as any
      row = (l?.data || []).find((b: any) => b.confirmation_code === b2.json?.confirmationCode)
    }
    check('AUTO-REGISTERED webhook flipped it to confirmed/paid', row?.status === 'confirmed' && row?.deposit_status === 'paid', { s: row?.status, d: row?.deposit_status })
  } finally {
    console.log('[bkdep] Teardown…')
    try {
      const result = await hardDeleteTestTenant(tenantId)
      console.log('[bkdep] hardDelete success:', (result as any)?.success)
    } catch (e: any) { console.log('❌ teardown failed: ' + (e?.message || e)) }
    // the deploy auto-registered a webhook endpoint in the test Stripe account — remove it
    try {
      const eps = await stripeApi('GET', '/webhook_endpoints?limit=100')
      for (const ep of eps.json?.data || []) {
        if (crmUrl && ep.url.startsWith(crmUrl)) {
          await stripeApi('DELETE', '/webhook_endpoints/' + ep.id)
          console.log('[bkdep] deleted stripe webhook endpoint ' + ep.id)
        }
      }
    } catch (e: any) { console.log('❌ stripe endpoint cleanup failed: ' + (e?.message || e)) }
  }

  const total = passed + failures.length
  console.log(`\nPass: ${passed}/${total}`)
  for (const f of failures) console.log('❌ ' + f)
  process.exit(failures.length ? 1 : 0)
}

main().catch(e => { console.error('❌ booking-deposit e2e crashed: ' + (e?.message || e)); process.exit(1) })
