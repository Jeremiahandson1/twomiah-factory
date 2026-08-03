/**
 * Create all Twomiah Factory Stripe products and prices.
 *
 * Run: cd apps/api && bun scripts/create-stripe-products.ts
 *
 * Requires STRIPE_SECRET_KEY in .env
 */

import Stripe from 'stripe'
import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Load .env
const envPath = path.join(__dirname, '..', '.env')
const envContent = fs.readFileSync(envPath, 'utf8')
const envVars: Record<string, string> = {}
for (const rawLine of envContent.split('\n')) {
  const line = rawLine.replace(/\r$/, '')  // strip CRLF carriage return
  const match = line.match(/^([^#=]+)=(.*)$/)
  if (match) envVars[match[1].trim()] = match[2].trim()
}

// process.env wins over .env so callers like flip-stripe-to-live.ts can
// override the key when spawning this script. Without this, the override
// is silently ignored and prices get minted in whichever mode .env says.
const STRIPE_KEY = process.env.STRIPE_SECRET_KEY || envVars.STRIPE_SECRET_KEY
if (!STRIPE_KEY) {
  console.error('ERROR: STRIPE_SECRET_KEY not found in process.env or apps/api/.env')
  process.exit(1)
}
console.log('Stripe mode:', STRIPE_KEY.startsWith('sk_live_') ? 'LIVE' : 'TEST')

const stripe = new Stripe(STRIPE_KEY)

const results: Record<string, string> = {}

async function createProduct(name: string, description: string, metadata: Record<string, string> = {}): Promise<string> {
  // Search for existing product first
  const existing = await stripe.products.search({
    query: `name:"${name}" AND active:"true"`,
  })
  // EXACT name match only — Stripe's name search is token-based, so
  // "Twomiah Website" would otherwise match "Twomiah Website — Book Jobs"
  // and attach a new price to the wrong (mislabeled) product.
  const exact = existing.data.find(p => p.name === name)
  if (exact) {
    console.log(`  Product exists: ${name} (${exact.id})`)
    return exact.id
  }
  const product = await stripe.products.create({ name, description, metadata })
  console.log(`  Created product: ${name} (${product.id})`)
  return product.id
}

async function createPrice(
  productId: string,
  key: string,
  unitAmount: number,
  opts: { recurring?: { interval: 'month' | 'year' }; nickname?: string } = {}
): Promise<string> {
  // Idempotent: reuse an existing active price with the same twomiah_key +
  // product + amount, so re-runs (and the test→live flip) never mint duplicates.
  try {
    const found = await stripe.prices.search({ query: `metadata["twomiah_key"]:"${key}" AND active:"true"` })
    const match = found.data.find(p => p.product === productId && p.unit_amount === unitAmount)
    if (match) {
      results[key] = match.id
      console.log(`    ${key}: ${match.id} (exists, reused)`)
      return match.id
    }
  } catch { /* prices.search unavailable on a brand-new account — fall through to create */ }

  const params: Stripe.PriceCreateParams = {
    product: productId,
    unit_amount: unitAmount,
    currency: 'usd',
    nickname: opts.nickname || key,
    metadata: { twomiah_key: key },
  }
  if (opts.recurring) {
    params.recurring = opts.recurring
  }
  const price = await stripe.prices.create(params)
  results[key] = price.id
  console.log(`    ${key}: ${price.id} ($${unitAmount / 100}${opts.recurring ? '/' + opts.recurring.interval : ' one-time'})`)
  return price.id
}

async function main() {
  console.log('Creating Stripe products and prices...\n')
  console.log(`Using key: ${STRIPE_KEY.substring(0, 12)}...${STRIPE_KEY.substring(STRIPE_KEY.length - 4)}`)
  console.log('')

  // ═══════════════════════════════════════════════════
  // 1. SAAS SUBSCRIPTION TIERS
  // ═══════════════════════════════════════════════════
  console.log('═══ SaaS Subscription Tiers ═══')

  // Annual = exactly 2 months free (monthly × 10)
  // Each vertical has its own top-tier SKU so receipts/analytics are clean,
  // even though they're all priced the same $599/mo:
  //   Build      → construction
  //   Wrench     → fleet
  //   Roof       → storm
  //   Care       → agency
  const tiers = [
    { id: 'starter', name: 'Starter', monthly: 4900, annual: 49000, desc: 'CRM only — 2 users included. Pair with any website tier.' },
    { id: 'pro', name: 'Pro', monthly: 14900, annual: 149000, desc: 'CRM + Showcase website included — 5 users, up to 10' },
    { id: 'business', name: 'Business', monthly: 29900, annual: 299000, desc: 'CRM + Book Jobs website included — 15 users, up to 25' },
    { id: 'construction', name: 'Construction', monthly: 59900, annual: 599000, desc: 'Build top tier — full construction management + Book Jobs website — 20 users, up to 50' },
    { id: 'fleet', name: 'Fleet', monthly: 59900, annual: 599000, desc: 'Wrench top tier — multi-location dispatch, call recording, commission tracking — 20 users, up to 50' },
    { id: 'storm', name: 'Storm', monthly: 59900, annual: 599000, desc: 'Roof top tier — unlimited measurement reports, canvassing, full insurance workflow with supplements — 20 users, up to 50' },
    { id: 'agency', name: 'Agency', monthly: 59900, annual: 599000, desc: 'Care top tier — full claims processing, HIPAA audit, caregiver portal website — 20 users, up to 50' },
    { id: 'enterprise', name: 'Enterprise', monthly: 19900, annual: 199000, desc: 'Unlimited scale, white-label — per user, min 10 users' },
  ]

  for (const tier of tiers) {
    const productId = await createProduct(
      `Twomiah ${tier.name}`,
      tier.desc,
      { twomiah_tier: tier.id }
    )
    await createPrice(productId, `STRIPE_PRICE_${tier.id.toUpperCase()}`, tier.monthly, { recurring: { interval: 'month' } })
    await createPrice(productId, `STRIPE_PRICE_${tier.id.toUpperCase()}_ANNUAL`, tier.annual, { recurring: { interval: 'year' } })
  }

  // ═══════════════════════════════════════════════════
  // 1b. WEBSITE SUBSCRIPTION TIERS (standalone)
  // ═══════════════════════════════════════════════════
  // Outcome-named ladder for customers who want a site but not a full CRM.
  // These are ALSO bundled into the CRM tiers above (Pro=Showcase, Business=Book Jobs).
  // Annual = exactly 2 months free (monthly × 10).
  console.log('\n═══ Website Subscription Tiers ═══')

  const websiteTiers = [
    { id: 'presence', name: 'Presence', monthly: 1900, annual: 19000, desc: 'One-page lead capture site + CMS — get found, capture leads' },
    { id: 'showcase', name: 'Showcase', monthly: 4900, annual: 49000, desc: 'Full multi-page site + CMS + blog + SEO basics — show off your work' },
    { id: 'book_jobs', name: 'Book Jobs', monthly: 9900, annual: 99000, desc: 'Full site + online booking + quote/estimator forms — turn visitors into booked jobs' },
  ]

  for (const tier of websiteTiers) {
    const productId = await createProduct(
      `Twomiah Website — ${tier.name}`,
      tier.desc,
      { twomiah_website_tier: tier.id }
    )
    await createPrice(productId, `STRIPE_PRICE_WEBSITE_${tier.id.toUpperCase()}`, tier.monthly, { recurring: { interval: 'month' } })
    await createPrice(productId, `STRIPE_PRICE_WEBSITE_${tier.id.toUpperCase()}_ANNUAL`, tier.annual, { recurring: { interval: 'year' } })
  }

  // Additional user prices
  console.log('\n═══ Additional User Prices ═══')
  const extraUserProduct = await createProduct('Twomiah Additional User', 'Additional user seat')
  await createPrice(extraUserProduct, 'STRIPE_PRICE_EXTRA_USER', 2900, { recurring: { interval: 'month' }, nickname: 'Extra user ($29/mo)' })

  // ═══════════════════════════════════════════════════
  // 2. SELF-HOSTED LICENSE PACKAGES (one-time)
  // ═══════════════════════════════════════════════════
  console.log('\n═══ Self-Hosted Licenses ═══')

  // One-time license = monthly SaaS × 36 (3 years equivalent), uniform across tiers.
  // Every license includes 3 years of free updates (since it's "3 years of SaaS
  // paid once" — updates during those 3 years are part of the deal). Enterprise
  // is a flat $71,640 with unlimited users + 3 years of updates + 3 years of
  // email/phone support. All terms are bounded at 3 years so we're not making
  // open-ended commitments we can't guarantee a decade from now.
  const licenses = [
    { id: 'starter', name: 'Starter License', price: 176400 }, // $1,764 = $49 × 36
    { id: 'pro', name: 'Pro License', price: 536400 }, // $5,364 = $149 × 36
    { id: 'business', name: 'Business License', price: 1076400 }, // $10,764 = $299 × 36
    { id: 'construction', name: 'Construction License', price: 2156400 }, // $21,564 = $599 × 36 (top vertical tier — Fleet/Agency/Storm all map here)
    { id: 'enterprise', name: 'Enterprise License', price: 7164000 }, // $71,640 flat (= $199 × 36 × 10 users anchor, no cap) — unlimited users + lifetime updates
  ]

  for (const lic of licenses) {
    const productId = await createProduct(
      `Twomiah ${lic.name}`,
      `Self-hosted ${lic.name} — full source code, perpetual, 3 years of free updates${lic.id === 'enterprise' ? ', unlimited users, 3 years of email + phone support' : ''}`,
      { twomiah_license: lic.id }
    )
    await createPrice(productId, `STRIPE_PRICE_LICENSE_${lic.id.toUpperCase()}`, lic.price)
  }

  // ═══════════════════════════════════════════════════
  // 3. SELF-HOSTED ADD-ONS
  // ═══════════════════════════════════════════════════
  console.log('\n═══ Self-Hosted Add-ons ═══')

  // Installation (one-time)
  const installProd = await createProduct('Twomiah Installation Service', 'We deploy it for you on your server')
  await createPrice(installProd, 'STRIPE_PRICE_ADDON_INSTALLATION', 50000)

  // Update subscription (yearly)
  const updateProd = await createProduct('Twomiah Update Subscription', 'All new features and bug fixes for 1 year')
  await createPrice(updateProd, 'STRIPE_PRICE_ADDON_UPDATES', 99900, { recurring: { interval: 'year' } })

  // Support contract (monthly)
  const supportProd = await createProduct('Twomiah Support Contract', 'Email and phone support')
  await createPrice(supportProd, 'STRIPE_PRICE_ADDON_SUPPORT', 19900, { recurring: { interval: 'month' } })

  // White-label setup (one-time)
  const wlProd = await createProduct('Twomiah White-Label Setup', 'Remove branding, add yours')
  await createPrice(wlProd, 'STRIPE_PRICE_ADDON_WHITELABEL', 50000)

  // Custom dev (one-time per hour)
  const devProd = await createProduct('Twomiah Custom Development', 'Custom feature development — per hour')
  await createPrice(devProd, 'STRIPE_PRICE_ADDON_CUSTOMDEV', 15000)

  // ═══════════════════════════════════════════════════
  // 4. DEPLOY SERVICES (one-time setup fees)
  // ═══════════════════════════════════════════════════
  console.log('\n═══ Deploy Services ═══')

  const deployServices = [
    { id: 'basic', name: 'Basic Deploy', price: 29900, desc: 'CRM + website setup, login credentials, live URL' },
    { id: 'full', name: 'Full Setup Deploy', price: 49900, desc: 'Basic + data import, integrations, 30-min walkthrough' },
    { id: 'white_glove', name: 'White Glove Deploy', price: 69900, desc: 'Full concierge: website content, data migration, team training, 30-day support' },
  ]

  for (const svc of deployServices) {
    const productId = await createProduct(`Twomiah ${svc.name}`, svc.desc, { twomiah_deploy: svc.id })
    await createPrice(productId, `STRIPE_PRICE_DEPLOY_${svc.id.toUpperCase()}`, svc.price)
  }

  // ═══════════════════════════════════════════════════
  // 5. À LA CARTE FEATURE BUNDLES (monthly recurring)
  // ═══════════════════════════════════════════════════
  console.log('\n═══ Feature Add-on Bundles ═══')

  const bundles = [
    { id: 'sms', name: 'SMS Communication', price: 3900, desc: 'Two-way texting, templates, scheduling' },
    { id: 'gps', name: 'GPS & Field', price: 4900, desc: 'Tracking, geofencing, route optimization' },
    { id: 'inventory', name: 'Inventory Management', price: 4900, desc: 'Items, locations, transfers, POs' },
    { id: 'fleet', name: 'Fleet Management', price: 3900, desc: 'Vehicles, maintenance, fuel logs' },
    { id: 'equipment', name: 'Equipment Tracking', price: 2900, desc: 'Customer equipment & maintenance records' },
    { id: 'marketing', name: 'Marketing Suite', price: 5900, desc: 'Reviews, campaigns, call tracking, automations' },
    { id: 'construction', name: 'Construction PM', price: 14900, desc: 'Projects, COs, RFIs, punch lists, inspections' },
    { id: 'compliance', name: 'Compliance & Draws', price: 7900, desc: 'Lien waivers, draw schedules, AIA forms' },
    { id: 'selections', name: 'Selections & Takeoffs', price: 4900, desc: 'Client selections, material takeoffs' },
    { id: 'service', name: 'Service Contracts', price: 3900, desc: 'Agreements, warranties, warranty claims' },
    { id: 'forms', name: 'Custom Forms', price: 2900, desc: 'Form builder, submissions, e-signatures' },
    { id: 'integrations', name: 'Integrations', price: 4900, desc: 'QuickBooks sync, Wisetack financing' },
    { id: 'twomiah_ads', name: 'Twomiah Ads', price: 9900, desc: 'Cross-vertical Google + Meta ads automation — available on every vertical' },
  ]

  for (const bundle of bundles) {
    const productId = await createProduct(`Twomiah ${bundle.name} Add-on`, bundle.desc, { twomiah_bundle: bundle.id })
    await createPrice(productId, `STRIPE_PRICE_BUNDLE_${bundle.id.toUpperCase()}`, bundle.price, { recurring: { interval: 'month' } })
  }

  // ═══════════════════════════════════════════════════
  // 6. PREMIUM WEBSITE (standalone $75/mo + $1k build)
  // ═══════════════════════════════════════════════════
  // Section-composition AI-composed sites under templates/website-premium-*.
  // The Factory's /public/intake/:id/checkout-premium endpoint references
  // these price IDs by env-var name; the launch coupon auto-applies if set.
  console.log('\n═══ Premium Website ═══')

  const premiumMonthlyProd = await createProduct(
    'Twomiah Premium Website — Monthly',
    'Standalone premium website with AI-composed sections, per-vertical template family, full CMS admin. Monthly billing.',
    { twomiah_tier: 'premium_website_monthly' }
  )
  await createPrice(premiumMonthlyProd, 'STRIPE_PRICE_PREMIUM_WEBSITE_MONTHLY', 7500, { recurring: { interval: 'month' }, nickname: 'Premium Website ($75/mo)' })

  const premiumAnnualProd = await createProduct(
    'Twomiah Premium Website — Annual',
    'Annual billing of Premium Website. 15% off vs monthly ($765/yr).',
    { twomiah_tier: 'premium_website_annual' }
  )
  await createPrice(premiumAnnualProd, 'STRIPE_PRICE_PREMIUM_WEBSITE_ANNUAL', 76500, { recurring: { interval: 'year' }, nickname: 'Premium Website ($765/yr)' })

  const premiumBuildProd = await createProduct(
    'Twomiah Premium Website — Build Fee',
    'One-time build fee for Premium Website. Charged on the first invoice of the subscription.',
    { twomiah_tier: 'premium_website_build' }
  )
  await createPrice(premiumBuildProd, 'STRIPE_PRICE_PREMIUM_WEBSITE_BUILD', 100000, { nickname: 'Premium build fee ($1,000 one-time)' })

  // CRM add-on for existing Premium customers. Attached as a separate
  // subscription line item on the existing premium subscription so a
  // customer can cancel CRM without losing their website. Provisioning
  // is gated by Jeremiah's manual run of scripts/provision-crm-for-tenant.ts
  // in V1; webhook-driven auto-provision will land once the manual flow
  // has run cleanly a few times.
  const premiumCrmAddonProd = await createProduct(
    'Twomiah CRM Add-on (Premium Website customers)',
    'Adds the full CRM to an existing Premium Website tenant. Same login, leads auto-flow to contacts, one billing relationship.',
    { twomiah_tier: 'premium_crm_addon' }
  )
  await createPrice(premiumCrmAddonProd, 'STRIPE_PRICE_PREMIUM_CRM_ADDON', 4900, { recurring: { interval: 'month' }, nickname: 'CRM add-on ($49/mo)' })

  // Launch coupon — $499 off the build fee. Once-only. Valid 90 days from
  // creation. The Factory passes the coupon ID via STRIPE_COUPON_PREMIUM_
  // WEBSITE_LAUNCH; Stripe enforces its own expiry — if it's expired, the
  // checkout call silently drops it rather than failing.
  console.log('\n═══ Premium Website Launch Coupon ═══')
  const couponName = 'Premium Website Launch'
  const existingCoupons = await stripe.coupons.list({ limit: 100 })
  const existingCoupon = existingCoupons.data.find(c => c.name === couponName)
  let couponId: string
  if (existingCoupon) {
    couponId = existingCoupon.id
    console.log(`  Coupon exists: ${couponName} (${couponId})`)
  } else {
    const ninetyDaysOut = Math.floor(Date.now() / 1000) + 90 * 24 * 60 * 60
    const coupon = await stripe.coupons.create({
      name: couponName,
      amount_off: 49900,
      currency: 'usd',
      duration: 'once',
      redeem_by: ninetyDaysOut,
      metadata: { twomiah_key: 'STRIPE_COUPON_PREMIUM_WEBSITE_LAUNCH' },
    })
    couponId = coupon.id
    console.log(`  Created coupon: ${couponName} (${couponId}) — $499 off, valid 90 days`)
  }
  results.STRIPE_COUPON_PREMIUM_WEBSITE_LAUNCH = couponId

  // ═══════════════════════════════════════════════════
  // 7. NEW PRICING MODEL v2 (2026-07) — flat website + seat-tiered CRM
  // ═══════════════════════════════════════════════════
  // Replaces the tiered SaaS + à-la-carte-bundle model. Features are FREE to
  // toggle; team size sets the tier (and the infra). See PRICING_MODEL_V2_PLAN.md.
  // Added alongside the old keys so existing code keeps working until the
  // checkout wiring is repointed at these V2 keys.
  console.log('\n═══ New Pricing Model v2 ═══')

  // Standalone website — $49/mo. No forced build fee (the $499 below is optional).
  const v2Website = await createProduct('Twomiah Website', 'Done-for-you website + hosting + self-serve CMS. See it built first, keep it for $49/mo.', { twomiah_v2: 'website' })
  await createPrice(v2Website, 'STRIPE_PRICE_V2_WEBSITE', 4900, { recurring: { interval: 'month' }, nickname: 'Website ($49/mo)' })

  // Seat-tiered CRM (website included). Team size sets price + infra tier.
  const v2CrmTiers = [
    { id: 'starter10', name: 'CRM — Starter', price: 9900, desc: 'Website + industry CRM + hosting. Up to 10 users. Every feature free to toggle.' },
    { id: 'team25', name: 'CRM — Team', price: 13900, desc: 'Up to 25 users. Bigger box, same everything.' },
    { id: 'business50', name: 'CRM — Business', price: 19900, desc: 'Up to 50 users. Bigger box, same everything.' },
  ]
  for (const t of v2CrmTiers) {
    const p = await createProduct(`Twomiah ${t.name}`, t.desc, { twomiah_v2: t.id })
    await createPrice(p, `STRIPE_PRICE_V2_${t.id.toUpperCase()}`, t.price, { recurring: { interval: 'month' }, nickname: `${t.name} ($${t.price / 100}/mo)` })
  }

  // Optional one-time "true customization" — the only hand-labor charge for sites.
  const v2Custom = await createProduct('Twomiah — True Customization', 'One-time hand-customization of your site beyond the auto-build + CMS.', { twomiah_v2: 'true_customization' })
  await createPrice(v2Custom, 'STRIPE_PRICE_V2_TRUE_CUSTOMIZATION', 49900, { nickname: 'True Customization ($499 one-time)' })

  // Own-it / self-host (one-time = 36× monthly)
  const v2Licenses = [
    { id: 'website', name: 'Website — Own It', price: 176400 },      // $49 × 36
    { id: 'starter10', name: 'CRM Starter — Own It', price: 356400 }, // $99 × 36
    { id: 'team25', name: 'CRM Team — Own It', price: 500400 },       // $139 × 36
    { id: 'business50', name: 'CRM Business — Own It', price: 716400 },// $199 × 36
  ]
  for (const l of v2Licenses) {
    const p = await createProduct(`Twomiah ${l.name}`, 'Buy it outright — full source, self-host (= 36× monthly).', { twomiah_v2_license: l.id })
    await createPrice(p, `STRIPE_PRICE_V2_LICENSE_${l.id.toUpperCase()}`, l.price, { nickname: `${l.name} ($${l.price / 100} one-time)` })
  }

  // ═══════════════════════════════════════════════════
  // DONE — Write config
  // ═══════════════════════════════════════════════════
  console.log('\n\n════════════════════════════════════════')
  console.log(`Created ${Object.keys(results).length} prices total`)
  console.log('════════════════════════════════════════\n')

  // Write to factory config
  const configPath = path.join(__dirname, '..', 'src', 'config', 'stripe-prices.ts')
  const configDir = path.dirname(configPath)
  if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true })

  const configContent = `/**
 * Stripe Price IDs — Auto-generated by scripts/create-stripe-products.ts
 * Generated: ${new Date().toISOString()}
 *
 * DO NOT EDIT MANUALLY — re-run the script to regenerate.
 */

export const STRIPE_PRICES = ${JSON.stringify(results, null, 2)} as const

export type StripePriceKey = keyof typeof STRIPE_PRICES

export default STRIPE_PRICES
`
  fs.writeFileSync(configPath, configContent)
  console.log(`Config written to: ${configPath}`)

  // Also append to .env as comments for reference
  const envLines = [
    '',
    '# ── Stripe Price IDs (auto-generated) ──',
    ...Object.entries(results).map(([k, v]) => `${k}=${v}`),
  ]
  fs.appendFileSync(envPath, envLines.join('\n') + '\n')
  console.log(`Price IDs appended to: ${envPath}`)

  // Also write a JSON file for easy reference
  const jsonPath = path.join(__dirname, '..', 'src', 'config', 'stripe-prices.json')
  fs.writeFileSync(jsonPath, JSON.stringify(results, null, 2))
  console.log(`JSON written to: ${jsonPath}`)

  console.log('\nDone!')
}

main().catch((e) => {
  console.error('Failed:', e.message)
  process.exit(1)
})
