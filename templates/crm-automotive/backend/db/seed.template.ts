import { drizzle } from 'drizzle-orm/node-postgres'
import { eq } from 'drizzle-orm'
import bcrypt from 'bcryptjs'
import { company, user, supportKnowledgeBase } from './schema.ts'

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
  const passwordHash = await bcrypt.hash('{{DEFAULT_PASSWORD}}', 12)
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
      { title: 'Getting Started with Twomiah Drive', content: 'Welcome! Start by adding your vehicle inventory, then set up lead sources to capture inbound leads. Use the Inventory page to add vehicles manually or via VIN decode.', category: 'Getting Started', isFaq: true, sortOrder: 1 },
      { title: 'Adding Vehicles to Inventory', content: 'Navigate to Inventory and click Add Vehicle. Enter a VIN to auto-decode year, make, model, and trim via the free NHTSA decoder. Add photos, pricing, and condition.', category: 'Inventory', isFaq: true, sortOrder: 2 },
      { title: 'Managing Sales Leads', content: 'The Leads page shows your sales pipeline as a Kanban board. Leads flow: New > Contacted > Demo > Desking > Closed. Assign leads to salespeople and track follow-ups.', category: 'Sales', isFaq: false, sortOrder: 3 },
      { title: 'Importing ADF/XML Leads', content: 'Use ADF Import to paste ADF/XML lead data from third-party sources. The system parses customer name, email, phone, and vehicle interest automatically.', category: 'Sales', isFaq: true, sortOrder: 4 },
      { title: 'Service Department & Repair Orders', content: 'Create repair orders from the Service page. Assign an advisor, add service items, and track status. Customer check-in triggers service-to-sales bridge alerts.', category: 'Service', isFaq: false, sortOrder: 5 },
      { title: 'Service-to-Sales Alerts', content: 'When a customer with an active sales lead checks into service, the assigned salesperson gets an instant alert — creating face-to-face selling opportunities.', category: 'Service', isFaq: true, sortOrder: 6 },
    ]
    for (const article of helpArticles) {
      await db.insert(supportKnowledgeBase).values({ ...article, tags: [], companyId: comp.id })
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
