import { db } from '../index'
import { estimatorProduct, estimatorMaterialTier, estimatorAddon, pitchMultiplier } from '../schema-estimator'

export async function seedEstimatorDemo(companyId: string, territoryId: string) {
  console.log('Seeding estimator demo data...')

  // ─── Pitch Multipliers ──────────────────────────────────────────────

  const pitchData = [
    { pitch: '4/12', multiplier: '1.06' },
    { pitch: '5/12', multiplier: '1.08' },
    { pitch: '6/12', multiplier: '1.12' },
    { pitch: '7/12', multiplier: '1.16' },
    { pitch: '8/12', multiplier: '1.20' },
    { pitch: '9/12', multiplier: '1.25' },
    { pitch: '10/12', multiplier: '1.30' },
    { pitch: '11/12', multiplier: '1.35' },
    { pitch: '12/12', multiplier: '1.41' },
  ]

  await db.insert(pitchMultiplier).values(
    pitchData.map((p) => ({ tenantId: companyId, pitch: p.pitch, multiplier: p.multiplier }))
  )

  console.log(`  Created ${pitchData.length} pitch multipliers`)

  // ─── Roofing - Remove & Replace Shingles ────────────────────────────

  const [roofingProduct] = await db.insert(estimatorProduct).values({
    tenantId: companyId,
    name: 'Remove & Replace Shingles',
    description: 'Complete tear-off and replacement of asphalt shingles including underlayment and cleanup.',
    measurementUnit: 'squares',
    pitchAdjustable: true,
    defaultWasteFactor: '1.15',
    laborRate: '125.00',
    laborUnit: 'squares',
    setupFee: '350.00',
    minimumCharge: '2500.00',
    retailMarkupPct: '100.00',
    yr1MarkupPct: '20.00',
    day30MarkupPct: '10.00',
    todayDiscountPct: '10.00',
    sortOrder: 0,
    active: true,
  }).returning()

  await db.insert(estimatorMaterialTier).values([
    {
      productId: roofingProduct.id,
      tier: 'good',
      materialName: '3-Tab Shingles',
      materialCostPerUnit: '85.00',
      manufacturer: 'CertainTeed',
      productLine: 'XT 25',
      warrantyYears: 25,
      features: ['Standard', 'Wind resistant to 60mph'],
    },
    {
      productId: roofingProduct.id,
      tier: 'better',
      materialName: 'Architectural Shingles',
      materialCostPerUnit: '120.00',
      manufacturer: 'GAF',
      productLine: 'Timberline HDZ',
      warrantyYears: 30,
      features: ['Dimensional look', 'Wind resistant to 130mph', 'Algae resistant'],
    },
    {
      productId: roofingProduct.id,
      tier: 'best',
      materialName: 'Impact-Resistant Architectural',
      materialCostPerUnit: '185.00',
      manufacturer: 'Owens Corning',
      productLine: 'Duration FLEX',
      warrantyYears: 100, // Lifetime
      features: ['Class 4 impact rated', 'Wind resistant to 130mph', 'Algae resistant', 'Solar reflective'],
    },
  ])

  await db.insert(estimatorAddon).values([
    {
      productId: roofingProduct.id,
      name: 'Ice & Water Shield',
      description: 'Self-adhering membrane for eaves and valleys',
      pricingType: 'per_sq_ft',
      price: '1.50',
      unit: 'sq_ft',
      defaultSelected: false,
      sortOrder: 0,
    },
    {
      productId: roofingProduct.id,
      name: 'Ridge Vent',
      description: 'Continuous ridge ventilation',
      pricingType: 'per_unit',
      price: '8.00',
      unit: 'lin_ft',
      defaultSelected: false,
      sortOrder: 1,
    },
    {
      productId: roofingProduct.id,
      name: 'Drip Edge',
      description: 'Metal flashing for roof edges',
      pricingType: 'per_unit',
      price: '4.00',
      unit: 'lin_ft',
      defaultSelected: false,
      sortOrder: 2,
    },
    {
      productId: roofingProduct.id,
      name: 'Pipe Boots',
      description: 'Replacement pipe boot flashings',
      pricingType: 'flat',
      price: '45.00',
      unit: 'each',
      defaultSelected: false,
      sortOrder: 3,
    },
  ])

  console.log('  Created roofing product with 3 tiers and 4 addons')

  // ─── Siding - Vinyl Siding Install ──────────────────────────────────

  const [sidingProduct] = await db.insert(estimatorProduct).values({
    tenantId: companyId,
    name: 'Vinyl Siding Install',
    description: 'Professional siding installation including removal of existing siding and proper preparation.',
    measurementUnit: 'sq_ft',
    pitchAdjustable: false,
    defaultWasteFactor: '1.10',
    laborRate: '1.80',
    laborUnit: 'sq_ft',
    setupFee: '200.00',
    minimumCharge: '1500.00',
    retailMarkupPct: '100.00',
    yr1MarkupPct: '20.00',
    day30MarkupPct: '10.00',
    todayDiscountPct: '10.00',
    sortOrder: 1,
    active: true,
  }).returning()

  await db.insert(estimatorMaterialTier).values([
    {
      productId: sidingProduct.id,
      tier: 'good',
      materialName: 'Builder Grade Vinyl',
      materialCostPerUnit: '2.10',
      manufacturer: 'Norandex',
      productLine: 'Sagebrush',
      warrantyYears: 20,
      features: ['Standard colors', 'Low maintenance'],
    },
    {
      productId: sidingProduct.id,
      tier: 'better',
      materialName: 'Premium Vinyl',
      materialCostPerUnit: '3.40',
      manufacturer: 'CertainTeed',
      productLine: 'Monogram',
      warrantyYears: 30,
      features: ['Premium colors', 'Thick gauge', 'Insulated'],
    },
    {
      productId: sidingProduct.id,
      tier: 'best',
      materialName: 'James Hardie Fiber Cement',
      materialCostPerUnit: '5.20',
      manufacturer: 'James Hardie',
      productLine: 'HardiePlank',
      warrantyYears: 50,
      features: ['Paintable', 'Fire resistant', 'Insect proof', 'Rot proof'],
    },
  ])

  await db.insert(estimatorAddon).values([
    {
      productId: sidingProduct.id,
      name: 'Housewrap',
      description: 'Weather-resistant barrier',
      pricingType: 'per_sq_ft',
      price: '0.45',
      unit: 'sq_ft',
      defaultSelected: false,
      sortOrder: 0,
    },
    {
      productId: sidingProduct.id,
      name: 'Corner Posts',
      description: 'Vinyl corner trim pieces',
      pricingType: 'flat',
      price: '35.00',
      unit: 'each',
      defaultSelected: false,
      sortOrder: 1,
    },
    {
      productId: sidingProduct.id,
      name: 'J-Channel',
      description: 'Trim channel for window and door openings',
      pricingType: 'per_unit',
      price: '2.50',
      unit: 'lin_ft',
      defaultSelected: false,
      sortOrder: 2,
    },
  ])

  console.log('  Created siding product with 3 tiers and 3 addons')

  // ─── Gutters - Seamless Gutter Install ──────────────────────────────

  const [gutterProduct] = await db.insert(estimatorProduct).values({
    tenantId: companyId,
    name: 'Seamless Gutter Install',
    description: 'Custom seamless gutter installation with downspouts and proper drainage routing.',
    measurementUnit: 'lin_ft',
    pitchAdjustable: false,
    defaultWasteFactor: '1.05',
    laborRate: '3.50',
    laborUnit: 'lin_ft',
    setupFee: '150.00',
    minimumCharge: '800.00',
    retailMarkupPct: '100.00',
    yr1MarkupPct: '20.00',
    day30MarkupPct: '10.00',
    todayDiscountPct: '10.00',
    sortOrder: 2,
    active: true,
  }).returning()

  await db.insert(estimatorMaterialTier).values([
    {
      productId: gutterProduct.id,
      tier: 'good',
      materialName: '5" Aluminum',
      materialCostPerUnit: '4.50',
      manufacturer: 'Spectra',
      productLine: 'K-Style',
      warrantyYears: 20,
      features: ['Seamless', '26-gauge'],
    },
    {
      productId: gutterProduct.id,
      tier: 'better',
      materialName: '6" Aluminum',
      materialCostPerUnit: '5.80',
      manufacturer: 'Spectra',
      productLine: 'K-Style HD',
      warrantyYears: 25,
      features: ['Seamless', '26-gauge', 'High capacity'],
    },
    {
      productId: gutterProduct.id,
      tier: 'best',
      materialName: '6" Copper',
      materialCostPerUnit: '18.00',
      manufacturer: 'Custom',
      productLine: 'Half-Round',
      warrantyYears: 50,
      features: ['Seamless', 'Natural patina', 'Premium look'],
    },
  ])

  await db.insert(estimatorAddon).values([
    {
      productId: gutterProduct.id,
      name: 'Gutter Guards',
      description: 'Leaf and debris protection',
      pricingType: 'per_unit',
      price: '8.00',
      unit: 'lin_ft',
      defaultSelected: false,
      sortOrder: 0,
    },
    {
      productId: gutterProduct.id,
      name: 'Downspout Extensions',
      description: 'Extended downspout routing away from foundation',
      pricingType: 'flat',
      price: '25.00',
      unit: 'each',
      defaultSelected: false,
      sortOrder: 1,
    },
    {
      productId: gutterProduct.id,
      name: 'Splash Blocks',
      description: 'Concrete splash blocks at downspout outlets',
      pricingType: 'flat',
      price: '18.00',
      unit: 'each',
      defaultSelected: false,
      sortOrder: 2,
    },
  ])

  console.log('  Created gutter product with 3 tiers and 3 addons')
  console.log('Estimator demo seed complete.')
}
