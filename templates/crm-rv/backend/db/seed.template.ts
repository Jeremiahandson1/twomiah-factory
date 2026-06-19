import { drizzle } from 'drizzle-orm/node-postgres'
import { eq } from 'drizzle-orm'

import { company, user, supportKnowledgeBase, unit } from './schema.ts'

const db = drizzle(process.env.DATABASE_URL!)

async function main() {
  console.log('Setting up Twomiah Drive...')

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
      enabledFeatures: {{ENABLED_FEATURES_JSON}},
      settings: {
        products: {{PRODUCTS_JSON}},
        siteUrl: '{{SITE_URL}}',
        cmsUrl: '{{CMS_URL}}',
        generatedBy: 'Twomiah Drive',
        generatedAt: new Date().toISOString(),
      },
    }).returning()
    console.log('Created dealership:', comp.name)
  } else {
    console.log('Dealership already exists:', comp.name)
  }

  // Always upsert admin user with correct password
  const passwordHash = await Bun.password.hash('{{DEFAULT_PASSWORD}}', 'bcrypt')
  const [existingUser] = await db.select().from(user).where(eq(user.email, '{{ADMIN_EMAIL}}')).limit(1)
  if (existingUser) {
    await db.update(user).set({ passwordHash, role: 'owner', isActive: true }).where(eq(user.id, existingUser.id))
    console.log('Updated admin user password')
  } else {
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

  // Seed help articles
  const existingArticles = await db.select().from(supportKnowledgeBase).where(eq(supportKnowledgeBase.companyId, comp.id)).limit(1)
  if (existingArticles.length === 0) {
    const helpArticles = [
      { title: 'Getting Started with Twomiah Drive', content: 'Welcome! Start by adding your unit inventory, then set up lead sources to capture inbound leads. Use the Inventory page to add RVs and powersports units manually or via VIN decode.', category: 'Getting Started', isFaq: true, sortOrder: 1 },
      { title: 'Adding Units to Inventory', content: 'Navigate to Inventory and click Add Unit. Pick a category (motorhome, towable, ATV, UTV, etc.), then enter details. For motorized units you can enter a VIN to auto-decode year, make, model, and trim via the free NHTSA decoder. Add photos, pricing, and condition.', category: 'Inventory', isFaq: true, sortOrder: 2 },
      { title: 'Managing Sales Leads', content: 'The Leads page shows your sales pipeline as a Kanban board. Leads flow: New > Contacted > Demo > Desking > Closed. Assign leads to salespeople and track follow-ups.', category: 'Sales', isFaq: false, sortOrder: 3 },
      { title: 'Importing ADF/XML Leads', content: 'Use ADF Import to paste ADF/XML lead data from third-party sources. The system parses customer name, email, phone, and unit interest automatically.', category: 'Sales', isFaq: true, sortOrder: 4 },
      { title: 'Service Department & Repair Orders', content: 'Create repair orders from the Service page. Assign an advisor, add service items, and track status. Customer check-in triggers service-to-sales bridge alerts.', category: 'Service', isFaq: false, sortOrder: 5 },
      { title: 'Service-to-Sales Alerts', content: 'When a customer with an active sales lead checks into service, the assigned salesperson gets an instant alert — creating face-to-face selling opportunities.', category: 'Service', isFaq: true, sortOrder: 6 },
    ]
    for (const article of helpArticles) {
      await db.insert(supportKnowledgeBase).values({ ...article, tags: [], companyId: comp.id })
    }
    console.log('Seeded', helpArticles.length, 'help articles')
  }

  // Seed sample inventory units (one towable RV, one motorhome, one powersports unit)
  const existingUnits = await db.select().from(unit).where(eq(unit.companyId, comp.id)).limit(1)
  if (existingUnits.length === 0) {
    await db.insert(unit).values([
      {
        category: 'towable',
        condition: 'new',
        stockNumber: 'RV-1001',
        year: 2025,
        make: 'Forest River',
        modelName: 'Wildwood 27RKS',
        towableType: 'travel_trailer',
        status: 'available',
        msrp: '42995.00',
        listedPrice: '34995.00',
        lengthFt: '32.5',
        sleeps: 6,
        slideOuts: 1,
        dryWeight: 6800,
        hitchWeight: 760,
        gvwr: 8800,
        freshTankGal: 48,
        greyTankGal: 64,
        blackTankGal: 32,
        awnings: 1,
        exteriorColor: 'Champagne',
        description: 'Rear kitchen travel trailer with single slide, sleeps 6.',
        photos: [],
        features: [],
        companyId: comp.id,
      },
      {
        category: 'motorhome',
        condition: 'new',
        stockNumber: 'RV-1002',
        year: 2024,
        make: 'Winnebago',
        modelName: 'Minnie Winnie 31K',
        rvClass: 'C',
        chassis: 'Ford E-450',
        status: 'available',
        msrp: '139900.00',
        listedPrice: '124900.00',
        lengthFt: '32.8',
        sleeps: 7,
        slideOuts: 2,
        gvwr: 14500,
        generatorHours: 12,
        awnings: 1,
        fuelType: 'gas',
        engine: '7.3L V8',
        mileage: 1450,
        exteriorColor: 'Silver',
        description: 'Class C motorhome on Ford E-450 chassis with bunk beds, sleeps 7.',
        photos: [],
        features: [],
        companyId: comp.id,
      },
      {
        category: 'utv',
        condition: 'new',
        stockNumber: 'PS-2001',
        year: 2025,
        make: 'Polaris',
        modelName: 'RZR Pro XP Ultimate',
        status: 'available',
        msrp: '32999.00',
        listedPrice: '30999.00',
        engineCc: 925,
        hours: 0,
        drivetrain: '4wd',
        fuelType: 'gas',
        exteriorColor: 'Matte Orange',
        description: 'Two-seat sport side-by-side with 181 HP turbocharged engine.',
        photos: [],
        features: [],
        companyId: comp.id,
      },
    ])
    console.log('Seeded 3 sample inventory units')
  }

  console.log('')
  console.log('Login credentials:')
  console.log('  Email: {{ADMIN_EMAIL}}')
  console.log('  Password: {{DEFAULT_PASSWORD}}')
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
