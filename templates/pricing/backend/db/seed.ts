import { db, schema } from './index'
import { hash } from 'bcryptjs'
import { createId } from '@paralleldrive/cuid2'

const {
  company,
  user,
  territory,
  repProfile,
  productCategory,
  product,
  priceRange,
  addon,
  pricingGuardrail,
  contractTemplate,
} = schema

async function seed() {
  console.log('Seeding database...')

  // ─── Company ────────────────────────────────────────────────────────────────
  const companyId = createId()
  await db.insert(company).values({
    id: companyId,
    name: '{{COMPANY_NAME}}',
    slug: '{{COMPANY_SLUG}}',
    email: '{{ADMIN_EMAIL}}',
    phone: '{{COMPANY_PHONE}}',
    primaryColor: '{{PRIMARY_COLOR}}',
    settings: {},
  })
  console.log('Created company')

  // ─── Admin User ─────────────────────────────────────────────────────────────
  const adminId = createId()
  const passwordHash = await hash('{{DEFAULT_PASSWORD}}', 12)
  await db.insert(user).values({
    id: adminId,
    companyId,
    email: '{{ADMIN_EMAIL}}',
    passwordHash,
    firstName: 'Admin',
    lastName: 'User',
    role: 'admin',
    isActive: true,
  })
  console.log('Created admin user')

  // ─── Admin Rep Profile ──────────────────────────────────────────────────────
  const adminRepId = createId()
  await db.insert(repProfile).values({
    id: adminRepId,
    tenantId: companyId,
    userId: adminId,
    role: 'admin',
    maxDiscountPct: '100',
    commissionBasePct: '5',
    commissionBonusPct: '50',
    active: true,
  })
  console.log('Created admin rep profile')

  // ─── Demo Data ──────────────────────────────────────────────────────────────
  if (process.env.SEED_DEMO) {
    console.log('Seeding demo data...')

    // Territory
    const territoryId = createId()
    await db.insert(territory).values({
      id: territoryId,
      tenantId: companyId,
      name: 'Default Territory',
      description: 'Default sales territory',
      active: true,
    })

    // Demo Rep
    const demoRepUserId = createId()
    const demoRepHash = await hash('demo1234', 12)
    await db.insert(user).values({
      id: demoRepUserId,
      companyId,
      email: 'rep@demo.com',
      passwordHash: demoRepHash,
      firstName: 'Demo',
      lastName: 'Rep',
      role: 'rep',
      isActive: true,
    })

    const demoRepId = createId()
    await db.insert(repProfile).values({
      id: demoRepId,
      tenantId: companyId,
      userId: demoRepUserId,
      territoryId,
      role: 'rep',
      maxDiscountPct: '15',
      commissionBasePct: '5',
      commissionBonusPct: '50',
      active: true,
    })

    // Senior Rep
    const seniorRepUserId = createId()
    await db.insert(user).values({
      id: seniorRepUserId,
      companyId,
      email: 'senior@demo.com',
      passwordHash: demoRepHash,
      firstName: 'Senior',
      lastName: 'Rep',
      role: 'rep',
      isActive: true,
    })

    await db.insert(repProfile).values({
      tenantId: companyId,
      userId: seniorRepUserId,
      territoryId,
      role: 'senior_rep',
      maxDiscountPct: '25',
      commissionBasePct: '6',
      commissionBonusPct: '50',
      active: true,
    })

    // ── Windows Category ────────────────────────────────────────────────────
    const windowsCatId = createId()
    await db.insert(productCategory).values({
      id: windowsCatId,
      tenantId: companyId,
      name: 'Windows',
      icon: 'window',
      sortOrder: 0,
      active: true,
    })

    const windowProductId = createId()
    await db.insert(product).values({
      id: windowProductId,
      tenantId: companyId,
      categoryId: windowsCatId,
      name: 'Replacement Window',
      description: 'Standard double-hung replacement window',
      measurementType: 'united_inches',
      mode: 'menu',
      active: true,
      sortOrder: 0,
    })

    // Window Price Ranges
    await db.insert(priceRange).values([
      {
        productId: windowProductId,
        territoryId,
        minValue: '1',
        maxValue: '100',
        parPrice: '850.00',
        retailPrice: '1700.00',
        retailMarkupPct: '100',
        yr1MarkupPct: '20',
        day30MarkupPct: '10',
        todayDiscountPct: '10',
      },
      {
        productId: windowProductId,
        territoryId,
        minValue: '101',
        maxValue: '115',
        parPrice: '1050.00',
        retailPrice: '2100.00',
        retailMarkupPct: '100',
        yr1MarkupPct: '20',
        day30MarkupPct: '10',
        todayDiscountPct: '10',
      },
      {
        productId: windowProductId,
        territoryId,
        minValue: '116',
        maxValue: '130',
        parPrice: '1275.00',
        retailPrice: '2550.00',
        retailMarkupPct: '100',
        yr1MarkupPct: '20',
        day30MarkupPct: '10',
        todayDiscountPct: '10',
      },
    ])

    // Window Addons
    await db.insert(addon).values([
      {
        productId: windowProductId,
        groupName: 'Glass Options',
        name: 'Grilles',
        description: 'Decorative grille pattern',
        price: '85.00',
        priceType: 'flat',
        required: false,
        active: true,
        sortOrder: 0,
      },
      {
        productId: windowProductId,
        groupName: 'Glass Options',
        name: 'Low-E Glass',
        description: 'Energy-efficient low-emissivity glass coating',
        price: '125.00',
        priceType: 'flat',
        required: false,
        active: true,
        sortOrder: 1,
      },
      {
        productId: windowProductId,
        groupName: 'Accessories',
        name: 'Screens',
        description: 'Full window screen',
        price: '45.00',
        priceType: 'flat',
        required: false,
        active: true,
        sortOrder: 2,
      },
      {
        productId: windowProductId,
        groupName: 'Finish',
        name: 'Woodgrain Interior',
        description: 'Interior woodgrain laminate finish',
        price: '175.00',
        priceType: 'flat',
        required: false,
        active: true,
        sortOrder: 3,
      },
    ])

    // Window Guardrail
    await db.insert(pricingGuardrail).values({
      productId: windowProductId,
      territoryId,
      floorPrice: '850.00',
      maxRepDiscountPct: '15',
      maxSeniorDiscountPct: '25',
      managerPinRequiredBelowPct: '30',
    })

    // ── Siding Category ─────────────────────────────────────────────────────
    const sidingCatId = createId()
    await db.insert(productCategory).values({
      id: sidingCatId,
      tenantId: companyId,
      name: 'Siding',
      icon: 'layers',
      sortOrder: 1,
      active: true,
    })

    const sidingProductId = createId()
    await db.insert(product).values({
      id: sidingProductId,
      tenantId: companyId,
      categoryId: sidingCatId,
      name: 'Vinyl Siding',
      description: 'Premium vinyl siding installation',
      measurementType: 'sq_ft',
      mode: 'estimator',
      active: true,
      sortOrder: 0,
    })

    await db.insert(priceRange).values([
      {
        productId: sidingProductId,
        territoryId,
        minValue: '1',
        maxValue: '1000',
        parPrice: '4.50',
        retailPrice: '9.00',
        retailMarkupPct: '100',
        yr1MarkupPct: '20',
        day30MarkupPct: '10',
        todayDiscountPct: '10',
      },
      {
        productId: sidingProductId,
        territoryId,
        minValue: '1001',
        maxValue: '2000',
        parPrice: '4.00',
        retailPrice: '8.00',
        retailMarkupPct: '100',
        yr1MarkupPct: '20',
        day30MarkupPct: '10',
        todayDiscountPct: '10',
      },
    ])

    // ── Roofing Category ────────────────────────────────────────────────────
    const roofingCatId = createId()
    await db.insert(productCategory).values({
      id: roofingCatId,
      tenantId: companyId,
      name: 'Roofing',
      icon: 'home',
      sortOrder: 2,
      active: true,
    })

    const roofingProductId = createId()
    await db.insert(product).values({
      id: roofingProductId,
      tenantId: companyId,
      categoryId: roofingCatId,
      name: 'Asphalt Shingle Roof',
      description: 'Full roof replacement with architectural shingles',
      measurementType: 'sq_ft',
      mode: 'estimator',
      active: true,
      sortOrder: 0,
    })

    await db.insert(priceRange).values({
      productId: roofingProductId,
      territoryId,
      minValue: '1',
      maxValue: '5000',
      parPrice: '5.50',
      retailPrice: '11.00',
      retailMarkupPct: '100',
      yr1MarkupPct: '20',
      day30MarkupPct: '10',
      todayDiscountPct: '10',
    })

    // ── Gutters Category ────────────────────────────────────────────────────
    const guttersCatId = createId()
    await db.insert(productCategory).values({
      id: guttersCatId,
      tenantId: companyId,
      name: 'Gutters',
      icon: 'droplets',
      sortOrder: 3,
      active: true,
    })

    const gutterProductId = createId()
    await db.insert(product).values({
      id: gutterProductId,
      tenantId: companyId,
      categoryId: guttersCatId,
      name: 'Seamless Gutters',
      description: '5-inch seamless aluminum gutters',
      measurementType: 'linear_ft',
      mode: 'menu',
      active: true,
      sortOrder: 0,
    })

    await db.insert(priceRange).values([
      {
        productId: gutterProductId,
        territoryId,
        minValue: '1',
        maxValue: '150',
        parPrice: '12.00',
        retailPrice: '24.00',
        retailMarkupPct: '100',
        yr1MarkupPct: '20',
        day30MarkupPct: '10',
        todayDiscountPct: '10',
      },
      {
        productId: gutterProductId,
        territoryId,
        minValue: '151',
        maxValue: '300',
        parPrice: '10.50',
        retailPrice: '21.00',
        retailMarkupPct: '100',
        yr1MarkupPct: '20',
        day30MarkupPct: '10',
        todayDiscountPct: '10',
      },
    ])

    // ── Sample Contract Template ────────────────────────────────────────────
    await db.insert(contractTemplate).values({
      tenantId: companyId,
      state: null,
      contentHtml: `
<h1>Home Improvement Contract</h1>
<p><strong>Date:</strong> {{contract_date}}</p>
<p><strong>Customer:</strong> {{customer_name}}</p>
<p><strong>Address:</strong> {{customer_address}}</p>

<h2>Scope of Work</h2>
{{line_items}}

<h2>Total Price: {{total_price}}</h2>

<h3>Payment Terms</h3>
<p>Deposit of {{deposit_amount}} due upon signing. Balance due upon completion.</p>

<h3>Right to Cancel</h3>
<p>You, the buyer, may cancel this transaction at any time prior to midnight of the third business day after the date of this transaction. See the attached Notice of Cancellation form for an explanation of this right.</p>

<h3>Warranty</h3>
<p>All work is guaranteed for a period of one (1) year from completion. Manufacturer warranties apply where applicable.</p>

<p><strong>Company:</strong> {{COMPANY_NAME}}</p>
      `.trim(),
      rescissionDays: 3,
      version: 1,
      active: true,
    })

    console.log('Demo data seeded successfully')
  }

  console.log('Seed complete')
  process.exit(0)
}

seed().catch((err) => {
  console.error('Seed failed:', err)
  process.exit(1)
})
