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
for (const line of envContent.split('\n')) {
  const match = line.match(/^([^#=]+)=(.*)$/)
  if (match) envVars[match[1].trim()] = match[2].trim()
}

const STRIPE_KEY = envVars.STRIPE_SECRET_KEY
if (!STRIPE_KEY) {
  console.error('ERROR: STRIPE_SECRET_KEY not found in apps/api/.env')
  process.exit(1)
}

const stripe = new Stripe(STRIPE_KEY)

const results: Record<string, string> = {}

async function createProduct(name: string, description: string, metadata: Record<string, string> = {}): Promise<string> {
  // Search for existing product first
  const existing = await stripe.products.search({
    query: `name:"${name}" AND active:"true"`,
  })
  if (existing.data.length > 0) {
    console.log(`  Product exists: ${name} (${existing.data[0].id})`)
    return existing.data[0].id
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
  const tiers = [
    { id: 'starter', name: 'Starter', monthly: 4900, annual: 49000, desc: 'CRM only — 2 users included. Pair with any website tier.' },
    { id: 'pro', name: 'Pro', monthly: 14900, annual: 149000, desc: 'CRM + Showcase website included — 5 users, up to 10' },
    { id: 'business', name: 'Business', monthly: 29900, annual: 299000, desc: 'CRM + Book Jobs website included — 15 users, up to 25' },
    { id: 'construction', name: 'Construction', monthly: 59900, annual: 599000, desc: 'Full construction management + Book Jobs website — 20 users, up to 50' },
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
  // is a flat $71,640 with unlimited users + lifetime updates + lifetime support.
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
      `Self-hosted ${lic.name} — full source code, perpetual, ${lic.id === 'enterprise' ? 'unlimited users, lifetime updates' : '3 years of free updates'}`,
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
  ]

  for (const bundle of bundles) {
    const productId = await createProduct(`Twomiah ${bundle.name} Add-on`, bundle.desc, { twomiah_bundle: bundle.id })
    await createPrice(productId, `STRIPE_PRICE_BUNDLE_${bundle.id.toUpperCase()}`, bundle.price, { recurring: { interval: 'month' } })
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
