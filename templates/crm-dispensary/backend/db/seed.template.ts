import { drizzle } from 'drizzle-orm/node-postgres'
import { eq } from 'drizzle-orm'

import { company, user, productCategory, supportKnowledgeBase } from './schema.ts'

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
      logo: '{{COMPANY_LOGO}}',
      website: '{{SITE_URL}}',
      enabledFeatures,
      taxRate: '10',
      loyaltyPointsPerDollar: 1,
      purchaseLimitOz: '1',
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
    const passwordHash = '{{HASHED_DEFAULT_PASSWORD}}' // bcrypt hash injected at generation — plaintext never touches the repo
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

  // ── NO SAMPLE PRODUCTS ──────────────────────
  // A shop's catalogue is its own. This used to insert twelve invented products with invented
  // prices, SKUs and stock counts, on every new tenant — sellable rows that reach Metrc and the
  // compliance reports, and that a new operator has to notice and delete before they are trusted.
  // The categories above are a taxonomy and stay; the inventory does not. (Dispensary T32)

  // ── NO SAMPLE LOYALTY REWARDS ──────────────────────
  // These seeded active: $5 off for 500 points, 10% off edibles, a free pre-roll. A customer could
  // redeem an offer the shop never made. An offer is a commitment, so the shop writes it. (T32)

  // ── NO DEFAULT DELIVERY ZONE ──────────────────────
  // This seeded an ACTIVE zone with a $5 fee and a $25 minimum over Beverly Hills zip codes
  // (90210-90214) — on whatever shop happened to boot. Where a shop delivers, and for how much, is
  // not something to guess on its behalf. (T32)

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
  console.log('  Password: (set at signup — use Forgot password on the login page if lost)')
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
