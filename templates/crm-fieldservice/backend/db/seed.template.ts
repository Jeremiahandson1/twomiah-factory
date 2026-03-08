import { drizzle } from 'drizzle-orm/node-postgres'
import { eq } from 'drizzle-orm'
import bcrypt from 'bcryptjs'
import { company, user, supportKnowledgeBase } from './schema.ts'

const db = drizzle(process.env.DATABASE_URL!)

async function main() {
  console.log('Setting up your CRM...')

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
        generatedBy: '{{COMPANY_NAME}} Factory',
        generatedAt: new Date().toISOString(),
      },
    }).returning()
    console.log('Created company:', comp.name)
  } else {
    console.log('Company already exists:', comp.name)
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

  // Seed help articles if none exist
  const existingArticles = await db.select().from(supportKnowledgeBase).where(eq(supportKnowledgeBase.companyId, comp.id)).limit(1)
  if (existingArticles.length === 0) {
    const helpArticles = [
      { title: 'Getting Started with Your Field Service CRM', content: 'Welcome to your field service CRM! Start by adding customer contacts, creating service calls (AC Install, Furnace Repair, Duct Cleaning, etc.), and sending quotes. Use the sidebar to navigate between modules.', category: 'Getting Started', isFaq: true, sortOrder: 1 },
      { title: 'Managing Customers', content: 'Contacts are the foundation of your CRM. Add new customers from the Contacts page. Each customer can have multiple service calls, quotes, and invoices linked to them. Use tags to categorize by service type (HVAC, Plumbing, Electrical).', category: 'Getting Started', isFaq: false, sortOrder: 2 },
      { title: 'Creating and Sending Quotes', content: 'Navigate to Quotes to create a new quote for services like AC Installation, Heat Pump Replacement, or Furnace Repair. Select a customer, add line items with parts and labor, then send the quote via email. Customers can approve quotes online through the customer portal.', category: 'Quotes & Invoices', isFaq: false, sortOrder: 3 },
      { title: 'Invoice Management', content: 'Create invoices from the Invoices page or convert approved quotes to invoices. Set payment terms, add line items for parts, labor, and service fees, and send to customers. Track payment status and send reminders for overdue invoices.', category: 'Quotes & Invoices', isFaq: false, sortOrder: 4 },
      { title: 'How do I schedule service calls?', content: 'Go to the Schedule page to view your dispatch calendar. Click on a date to create a new service call or drag existing calls to reschedule. Assign technicians, set estimated duration, and choose the service type (repair, maintenance, install, emergency). The calendar supports day, week, and month views.', category: 'Scheduling', isFaq: true, sortOrder: 5 },
      { title: 'Team & Technician Management', content: 'Add team members from the Team page. Assign roles (admin, dispatcher, technician) to control access. Technicians can be assigned to service calls, tracked on the dispatch board, and have their time entries logged for payroll.', category: 'Team', isFaq: false, sortOrder: 6 },
      { title: 'How do I track technician time?', content: 'Use the Time page to log hours for service calls. Technicians can clock in/out at job sites or manually add time entries. Time entries are linked to specific service calls for accurate billing and labor cost tracking.', category: 'Time & Expenses', isFaq: true, sortOrder: 7 },
      { title: 'Equipment & Service History', content: 'Track customer equipment (HVAC units, water heaters, furnaces) and maintain complete service history. Attach photos, manuals, and warranty documents to customer records for quick reference during service calls.', category: 'Documents', isFaq: false, sortOrder: 8 },
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
