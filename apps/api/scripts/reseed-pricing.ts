/**
 * Re-seed factory_pricing for products whose tier IDs drifted from the
 * CRM template feature gates. Without this, the signup wizard keeps
 * showing whatever was first seeded into the DB even after the defaults
 * in src/config/pricing.ts are updated.
 *
 * Usage (one-shot, safe to run multiple times — upsert):
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... bun scripts/reseed-pricing.ts
 *
 * Pass a single product id to reseed just one:
 *   bun scripts/reseed-pricing.ts crm-fieldservice
 *
 * Pass --all to reseed every product listed in PRODUCTS.
 */
import { createClient } from '@supabase/supabase-js'
import { PRODUCTS, getProductDefaults } from '../src/config/pricing'

const SUPABASE_URL = process.env.SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY)

// Products whose tier IDs changed in the Factory API defaults on 2026-04-13.
// These drifted from the CRM template tier IDs, which meant Fleet (Wrench)
// and Storm (Roof) tiers were built but unpurchasable.
const DRIFTED = ['crm-fieldservice', 'crm-roof'] as const

async function reseedOne(product: string) {
  const defaults = getProductDefaults(product)
  console.log(`\n── ${product} ──`)
  console.log('  tiers:', defaults.saas_tiers.map((t: any) => `${t.id}($${t.monthlyPrice})`).join(', '))

  const { error } = await supabase.from('factory_pricing').upsert({
    product,
    updated_at: new Date().toISOString(),
    updated_by: 'reseed-pricing-script',
    saas_tiers: defaults.saas_tiers,
    self_hosted: defaults.self_hosted,
    self_hosted_addons: defaults.self_hosted_addons,
    deploy_services: defaults.deploy_services,
    feature_bundles: defaults.feature_bundles,
  })
  if (error) {
    console.error(`  ✗ ${error.message}`)
    return false
  }
  console.log('  ✓ upserted')
  return true
}

async function main() {
  const arg = process.argv[2]
  let targets: string[]

  if (arg === '--all') {
    targets = PRODUCTS.map(p => p.id)
  } else if (arg) {
    if (!PRODUCTS.some(p => p.id === arg)) {
      console.error(`Unknown product: ${arg}`)
      console.error(`Known: ${PRODUCTS.map(p => p.id).join(', ')}`)
      process.exit(1)
    }
    targets = [arg]
  } else {
    targets = [...DRIFTED]
    console.log('Reseeding drifted products only (pass --all to reseed every product):')
  }

  let ok = 0
  let fail = 0
  for (const product of targets) {
    if (await reseedOne(product)) ok++
    else fail++
  }

  console.log(`\nDone. ${ok} upserted, ${fail} failed.`)
  if (fail > 0) process.exit(1)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
