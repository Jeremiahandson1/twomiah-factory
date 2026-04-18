import { drizzle } from 'drizzle-orm/node-postgres'
import { eq } from 'drizzle-orm'

import { company, user, product, productCategory, loyaltyReward, deliveryZone, supportKnowledgeBase } from './schema.ts'

const db = drizzle(process.env.DATABASE_URL!)

// Factory replaces this placeholder at generate time. Keeping it inside a
// backtick string guarantees the file is valid JS even if substitution fails —
// the runtime guard below falls back to [] so the seed still completes.
const __FEATURES_RAW = `{{ENABLED_FEATURES_JSON}}`
const enabledFeatures: string[] = __FEATURES_RAW.trim().startsWith('{{') ? [] : JSON.parse(__FEATURES_RAW)

async function main() {
  console.log('Setting up your dispensary CRM...')

  // Upsert company
  let [comp] = await db.select().from(company).where(eq(company.slug, '{{COMPANY_SLUG}}')).limit(1)
  if (!comp) {
    ;[comp] = await db.insert(company).values({
      name: '{{COMPANY_NAME}}',
      slug: '{{COMPANY_SLUG}}',
      email: '{{COMPANY_EMAIL}}',
      phone: '{{COMPANY_PHONE}}',
      address: '{{COMPANY_ADDRESS}}',
      city: '{{CITY}}',
      state: '{{STATE}}',
      zip: '{{ZIP}}',
      primaryColor: '{{PRIMARY_COLOR}}',
      secondaryColor: '{{SECONDARY_COLOR}}',
      website: '{{SITE_URL}}',
      enabledFeatures,
      taxRate: '10',
      loyaltyPointsPerDollar: 1,
      purchaseLimitOz: '2.5',
      loyaltyEnabled: true,
      deliveryEnabled: false,
      merchEnabled: false,
      storeHours: {
        mon: '9:00-21:00',
        tue: '9:00-21:00',
        wed: '9:00-21:00',
        thu: '9:00-21:00',
        fri: '9:00-22:00',
        sat: '10:00-22:00',
        sun: '10:00-20:00',
      },
      settings: {
        siteUrl: '{{SITE_URL}}',
        cmsUrl: '{{CMS_URL}}',
        generatedBy: '{{COMPANY_NAME}} Factory',
        generatedAt: new Date().toISOString(),
      },
    }).returning()
    console.log('Created company:', comp.name)
  } else {
    console.log('Company already exists:', comp.name)
  }

  // Create admin user only if not already present — never overwrite existing password
  const [existingUser] = await db.select().from(user).where(eq(user.email, '{{ADMIN_EMAIL}}')).limit(1)
  if (existingUser) {
    console.log('Admin user already exists - skipping password reset')
  } else {
    const passwordHash = await Bun.password.hash('{{DEFAULT_PASSWORD}}', 'bcrypt')
    await db.insert(user).values({
      email: '{{ADMIN_EMAIL}}',
      passwordHash,
      firstName: '{{OWNER_FIRST_NAME}}',
      lastName: '{{OWNER_LAST_NAME}}',
      role: 'owner',
      companyId: comp.id,
    })
    console.log('Created admin user')
  }

  // ── PRODUCT CATEGORIES ──────────────────────
  const existingCats = await db.select().from(productCategory).where(eq(productCategory.companyId, comp.id)).limit(1)
  if (existingCats.length === 0) {
    const categories = [
      { name: 'Flower', slug: 'flower', displayOrder: 1 },
      { name: 'Pre-Rolls', slug: 'pre-rolls', displayOrder: 2 },
      { name: 'Edibles', slug: 'edibles', displayOrder: 3 },
      { name: 'Concentrates', slug: 'concentrates', displayOrder: 4 },
      { name: 'Vapes', slug: 'vapes', displayOrder: 5 },
      { name: 'Topicals', slug: 'topicals', displayOrder: 6 },
      { name: 'Accessories', slug: 'accessories', displayOrder: 7 },
      { name: 'Merch', slug: 'merch', displayOrder: 8 },
    ]
    for (const cat of categories) {
      await db.insert(productCategory).values({
        ...cat,
        companyId: comp.id,
      })
    }
    console.log(`Seeded ${categories.length} product categories`)
  }

  // ── SAMPLE PRODUCTS ──────────────────────
  const existingProducts = await db.select().from(product).where(eq(product.companyId, comp.id)).limit(1)
  if (existingProducts.length === 0) {
    const products = [
      // Flower (3)
      {
        name: 'Blue Dream',
        slug: 'blue-dream',
        category: 'flower',
        strainName: 'Blue Dream',
        strainType: 'sativa',
        thcPercent: '22',
        cbdPercent: '0.1',
        weightGrams: '3.5',
        unitType: 'eighth',
        price: '35',
        cost: '18',
        sku: 'FLW-BD-001',
        stockQuantity: 50,
        description: 'A legendary sativa-dominant hybrid with sweet berry aroma and balanced full-body relaxation.',
        effects: ['euphoric', 'creative', 'relaxed'],
        flavors: ['berry', 'sweet', 'herbal'],
        featured: true,
      },
      {
        name: 'OG Kush',
        slug: 'og-kush',
        category: 'flower',
        strainName: 'OG Kush',
        strainType: 'indica',
        thcPercent: '25',
        cbdPercent: '0.3',
        weightGrams: '3.5',
        unitType: 'eighth',
        price: '40',
        cost: '20',
        sku: 'FLW-OGK-001',
        stockQuantity: 40,
        description: 'A classic indica with earthy pine notes and heavy body effects. Perfect for evening use.',
        effects: ['relaxed', 'sleepy', 'happy'],
        flavors: ['earthy', 'pine', 'woody'],
        featured: true,
      },
      {
        name: 'Girl Scout Cookies',
        slug: 'girl-scout-cookies',
        category: 'flower',
        strainName: 'Girl Scout Cookies',
        strainType: 'hybrid',
        thcPercent: '24',
        cbdPercent: '0.2',
        weightGrams: '3.5',
        unitType: 'eighth',
        price: '45',
        cost: '22',
        sku: 'FLW-GSC-001',
        stockQuantity: 35,
        description: 'Award-winning hybrid with sweet and earthy flavor. Delivers powerful full-body euphoria.',
        effects: ['euphoric', 'happy', 'relaxed'],
        flavors: ['sweet', 'earthy', 'mint'],
        featured: true,
      },

      // Pre-Rolls (2)
      {
        name: 'Classic Joint',
        slug: 'classic-joint',
        category: 'preroll',
        strainName: 'House Blend',
        strainType: 'hybrid',
        thcPercent: '20',
        cbdPercent: '0.1',
        weightGrams: '1',
        unitType: 'each',
        price: '8',
        cost: '3',
        sku: 'PRE-CJ-001',
        stockQuantity: 100,
        description: 'A perfectly rolled 1g joint with our house blend flower. Great for on-the-go.',
        effects: ['relaxed', 'happy'],
        flavors: ['earthy', 'herbal'],
      },
      {
        name: 'Infused Pre-Roll',
        slug: 'infused-pre-roll',
        category: 'preroll',
        strainName: 'Diamond Dust',
        strainType: 'hybrid',
        thcPercent: '35',
        cbdPercent: '0.1',
        weightGrams: '1',
        unitType: 'each',
        price: '18',
        cost: '8',
        sku: 'PRE-INF-001',
        stockQuantity: 60,
        description: 'Premium flower infused with live resin and rolled in kief for maximum potency.',
        effects: ['euphoric', 'creative', 'uplifted'],
        flavors: ['sweet', 'citrus', 'pine'],
        featured: true,
      },

      // Edibles (2)
      {
        name: 'Gummy Bears',
        slug: 'gummy-bears',
        category: 'edible',
        thcPercent: '10',
        cbdPercent: '0',
        unitType: 'each',
        price: '20',
        cost: '8',
        sku: 'EDI-GB-001',
        stockQuantity: 80,
        description: 'Delicious assorted fruit gummy bears. 10mg THC per piece, 10 pieces per pack (100mg total).',
        effects: ['relaxed', 'happy', 'sleepy'],
        flavors: ['fruity', 'sweet'],
      },
      {
        name: 'Chocolate Bar',
        slug: 'chocolate-bar',
        category: 'edible',
        thcPercent: '100',
        cbdPercent: '0',
        unitType: 'each',
        price: '25',
        cost: '10',
        sku: 'EDI-CB-001',
        stockQuantity: 45,
        description: 'Rich dark chocolate bar scored into 10 pieces. 10mg THC per square, 100mg total.',
        effects: ['relaxed', 'euphoric'],
        flavors: ['chocolate', 'rich', 'sweet'],
      },

      // Concentrates (2)
      {
        name: 'Live Resin',
        slug: 'live-resin',
        category: 'concentrate',
        strainName: 'Wedding Cake',
        strainType: 'hybrid',
        thcPercent: '80',
        cbdPercent: '0.5',
        weightGrams: '1',
        unitType: 'gram',
        price: '45',
        cost: '22',
        sku: 'CON-LR-001',
        stockQuantity: 30,
        description: 'Fresh-frozen live resin with full terpene profile. Rich flavor and potent effects.',
        effects: ['euphoric', 'creative', 'relaxed'],
        flavors: ['sweet', 'vanilla', 'earthy'],
      },
      {
        name: 'Shatter',
        slug: 'shatter',
        category: 'concentrate',
        strainName: 'Gorilla Glue',
        strainType: 'hybrid',
        thcPercent: '85',
        cbdPercent: '0.2',
        weightGrams: '1',
        unitType: 'gram',
        price: '40',
        cost: '18',
        sku: 'CON-SH-001',
        stockQuantity: 25,
        description: 'Glass-like shatter with high THC content. Clean, potent, and easy to dose.',
        effects: ['relaxed', 'euphoric', 'happy'],
        flavors: ['earthy', 'pine', 'diesel'],
      },

      // Vapes (2)
      {
        name: 'Distillate Cartridge',
        slug: 'distillate-cart',
        category: 'vape',
        strainName: 'Pineapple Express',
        strainType: 'sativa',
        thcPercent: '90',
        cbdPercent: '0',
        weightGrams: '1',
        unitType: 'each',
        price: '35',
        cost: '15',
        sku: 'VAP-DC-001',
        stockQuantity: 55,
        description: 'High-potency distillate cartridge with botanical terpenes. 510-thread compatible.',
        effects: ['energetic', 'creative', 'uplifted'],
        flavors: ['pineapple', 'tropical', 'sweet'],
      },
      {
        name: 'Live Resin Cartridge',
        slug: 'live-resin-cart',
        category: 'vape',
        strainName: 'Sunset Sherbet',
        strainType: 'indica',
        thcPercent: '75',
        cbdPercent: '1',
        weightGrams: '0.5',
        unitType: 'each',
        price: '40',
        cost: '20',
        sku: 'VAP-LRC-001',
        stockQuantity: 40,
        description: 'Premium live resin cartridge with strain-specific terpenes for authentic flavor.',
        effects: ['relaxed', 'sleepy', 'happy'],
        flavors: ['berry', 'citrus', 'sweet'],
      },

      // Merch (1)
      {
        name: 'Branded T-Shirt',
        slug: 'branded-tshirt',
        category: 'merch',
        unitType: 'each',
        price: '25',
        cost: '10',
        sku: 'MER-TS-001',
        stockQuantity: 100,
        description: 'Comfortable cotton t-shirt with our dispensary logo. Available in S, M, L, XL.',
        isMerch: true,
        requiresAgeVerify: false,
        effects: [],
        flavors: [],
      },
    ]

    for (const prod of products) {
      await db.insert(product).values({
        ...prod,
        companyId: comp.id,
      })
    }
    console.log(`Seeded ${products.length} sample products`)
  }

  // ── LOYALTY REWARDS ──────────────────────
  const existingRewards = await db.select().from(loyaltyReward).where(eq(loyaltyReward.companyId, comp.id)).limit(1)
  if (existingRewards.length === 0) {
    const rewards = [
      {
        name: '$5 Off Any Purchase',
        description: 'Redeem 500 points for $5 off your next order.',
        pointsCost: 500,
        discountType: 'fixed',
        discountValue: '5',
        minTier: 'bronze',
      },
      {
        name: '10% Off Edibles',
        description: 'Redeem 750 points for 10% off any edible product.',
        pointsCost: 750,
        discountType: 'percent',
        discountValue: '10',
        applicableCategories: ['edible'],
        minTier: 'silver',
      },
      {
        name: 'Free Pre-Roll',
        description: 'Redeem 1000 points for a free classic pre-roll.',
        pointsCost: 1000,
        discountType: 'free_item',
        discountValue: '0',
        minTier: 'gold',
      },
    ]

    for (const reward of rewards) {
      await db.insert(loyaltyReward).values({
        ...reward,
        companyId: comp.id,
      })
    }
    console.log(`Seeded ${rewards.length} loyalty rewards`)
  }

  // ── DEFAULT DELIVERY ZONE ──────────────────────
  const existingZones = await db.select().from(deliveryZone).where(eq(deliveryZone.companyId, comp.id)).limit(1)
  if (existingZones.length === 0) {
    await db.insert(deliveryZone).values({
      name: 'Local Delivery',
      zipCodes: ['90210', '90211', '90212', '90213', '90214'],
      deliveryFee: '5',
      minOrder: '25',
      estimatedMinutes: 60,
      active: true,
      companyId: comp.id,
    })
    console.log('Seeded default delivery zone')
  }

  // ── HELP ARTICLES ──────────────────────
  const existingArticles = await db.select().from(supportKnowledgeBase).where(eq(supportKnowledgeBase.companyId, comp.id)).limit(1)
  if (existingArticles.length === 0) {
    const helpArticles = [
      { title: 'Getting Started with Your Dispensary CRM', content: 'Welcome to your dispensary management system! Start by reviewing your product menu, setting up categories, and configuring your store hours. Use the sidebar to navigate between modules.', category: 'Getting Started', isFaq: true, sortOrder: 1 },
      { title: 'Managing Your Menu', content: 'Add and edit products from the Menu page. Each product can have strain info, THC/CBD percentages, pricing, and inventory tracking. Organize products into categories for easy browsing.', category: 'Getting Started', isFaq: false, sortOrder: 2 },
      { title: 'Processing Orders', content: 'Create walk-in, pickup, or delivery orders from the POS. Add items, verify customer ID, apply loyalty rewards, and process payment. All orders are tracked with full audit history.', category: 'Orders', isFaq: true, sortOrder: 3 },
      { title: 'Inventory Management', content: 'Track stock levels for every product. Set low-stock thresholds for alerts. Record inventory adjustments for restocks, damages, or count corrections. All changes are logged in the audit trail.', category: 'Inventory', isFaq: false, sortOrder: 4 },
      { title: 'How does the loyalty program work?', content: 'Customers earn points on every purchase based on your points-per-dollar setting. Points can be redeemed for rewards you configure. Members progress through tiers (bronze, silver, gold, platinum) based on lifetime spending.', category: 'Loyalty', isFaq: true, sortOrder: 5 },
      { title: 'Setting Up Delivery', content: 'Enable delivery in Settings, then configure delivery zones with zip codes, fees, and minimum order amounts. Assign drivers to delivery orders and track order status through completion.', category: 'Delivery', isFaq: false, sortOrder: 6 },
      { title: 'Cash Management', content: 'Open a cash session at the start of each shift with an opening balance. The system tracks expected cash from sales. Close the session with an actual count to identify any variance.', category: 'Cash Management', isFaq: true, sortOrder: 7 },
      { title: 'Compliance & Audit Log', content: 'All actions are recorded in the audit log for compliance purposes. Track ID verifications, inventory changes, voided orders, and user activity. Export logs for regulatory reporting.', category: 'Compliance', isFaq: false, sortOrder: 8 },
    ]
    for (const article of helpArticles) {
      await db.insert(supportKnowledgeBase).values({
        ...article,
        tags: [],
        companyId: comp.id,
      })
    }
    console.log('Seeded', helpArticles.length, 'help articles')
  }

  console.log('')
  console.log('Login credentials:')
  console.log('  Email: {{ADMIN_EMAIL}}')
  console.log('  Password: {{DEFAULT_PASSWORD}}')
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
