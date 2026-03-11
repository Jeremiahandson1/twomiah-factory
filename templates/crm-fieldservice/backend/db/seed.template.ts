import { drizzle } from 'drizzle-orm/node-postgres'
import { eq } from 'drizzle-orm'
import bcrypt from 'bcryptjs'
import { company, user, supportKnowledgeBase, contact, equipment, job, site } from './schema.ts'

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

  // Seed demo contacts and equipment if none exist
  const existingContacts = await db.select().from(contact).where(eq(contact.companyId, comp.id)).limit(1)
  if (existingContacts.length === 0) {
    // Create demo customers
    const [johnson] = await db.insert(contact).values({
      name: 'Sarah Johnson',
      type: 'client',
      email: 'sarah.johnson@email.com',
      phone: '(555) 234-5678',
      address: '1842 Oak Valley Dr',
      city: '{{CITY}}',
      state: '{{STATE}}',
      zip: '{{ZIP}}',
      source: 'Google',
      portalEnabled: true,
      companyId: comp.id,
    }).returning()

    const [martinez] = await db.insert(contact).values({
      name: 'Robert Martinez',
      type: 'client',
      email: 'rmartinez@email.com',
      phone: '(555) 876-5432',
      address: '305 Elm Street',
      city: '{{CITY}}',
      state: '{{STATE}}',
      zip: '{{ZIP}}',
      source: 'Referral',
      portalEnabled: true,
      companyId: comp.id,
    }).returning()

    await db.insert(contact).values({
      name: 'Lisa Chen',
      type: 'lead',
      email: 'lchen@email.com',
      phone: '(555) 345-6789',
      address: '22 Maple Court',
      city: '{{CITY}}',
      state: '{{STATE}}',
      zip: '{{ZIP}}',
      source: 'Website',
      companyId: comp.id,
    }).returning()

    console.log('Created 3 demo contacts')

    // Create demo sites for Martinez (commercial account)
    const [martinezOffice] = await db.insert(site).values({
      name: 'Main Office',
      address: '305 Elm Street',
      city: '{{CITY}}',
      state: '{{STATE}}',
      zip: '{{ZIP}}',
      accessNotes: 'Front desk reception. Ask for building manager.',
      companyId: comp.id,
      contactId: martinez.id,
    }).returning()

    const [martinezWarehouse] = await db.insert(site).values({
      name: 'Warehouse B',
      address: '780 Industrial Blvd',
      city: '{{CITY}}',
      state: '{{STATE}}',
      zip: '{{ZIP}}',
      accessNotes: 'Gate code: 4829. Loading dock on east side. Call ahead.',
      companyId: comp.id,
      contactId: martinez.id,
    }).returning()

    console.log('Created 2 demo sites for Martinez')

    // Create demo equipment linked to customers
    const [eq1] = await db.insert(equipment).values({
      name: 'Central AC Unit',
      manufacturer: 'Carrier',
      model: '24ACC636A003',
      serialNumber: 'CAR-2019-48271',
      status: 'active',
      location: 'Backyard (east side)',
      purchaseDate: new Date('2019-06-15'),
      warrantyExpiry: new Date('2029-06-15'),
      notes: '3-ton, 16 SEER. Annual tune-up due each spring.',
      companyId: comp.id,
      contactId: johnson.id,
    }).returning()

    await db.insert(equipment).values({
      name: 'Gas Furnace',
      manufacturer: 'Lennox',
      model: 'SL280UHV070V36B',
      serialNumber: 'LNX-2019-93847',
      status: 'active',
      location: 'Basement utility room',
      purchaseDate: new Date('2019-06-15'),
      warrantyExpiry: new Date('2029-06-15'),
      notes: '70K BTU, two-stage variable speed. Paired with Carrier AC.',
      companyId: comp.id,
      contactId: johnson.id,
    }).returning()

    const [eq3] = await db.insert(equipment).values({
      name: 'Tankless Water Heater',
      manufacturer: 'Rinnai',
      model: 'RU199iN',
      serialNumber: 'RIN-2021-55102',
      status: 'active',
      location: 'Garage wall mount',
      purchaseDate: new Date('2021-11-03'),
      warrantyExpiry: new Date('2033-11-03'),
      notes: '199K BTU natural gas. Descale annually.',
      companyId: comp.id,
      contactId: martinez.id,
      siteId: martinezOffice.id,
    }).returning()

    const [eq4] = await db.insert(equipment).values({
      name: 'Heat Pump System',
      manufacturer: 'Trane',
      model: 'XR15',
      serialNumber: 'TRN-2016-22039',
      status: 'needs_repair',
      location: 'Side yard',
      purchaseDate: new Date('2016-03-22'),
      warrantyExpiry: new Date('2026-03-22'),
      notes: '3.5-ton heat pump. Compressor making noise — needs diagnostic.',
      companyId: comp.id,
      contactId: martinez.id,
      siteId: martinezWarehouse.id,
    }).returning()

    console.log('Created 4 demo equipment records')

    // Create demo jobs linked to equipment
    await db.insert(job).values({
      number: 'JOB-00001',
      title: 'Annual AC Tune-Up',
      description: 'Spring maintenance on Carrier central AC. Check refrigerant levels, clean coils, inspect electrical connections.',
      status: 'completed',
      priority: 'normal',
      jobType: 'maintenance',
      scheduledDate: new Date('2025-04-10'),
      scheduledTime: '09:00',
      estimatedHours: '1.5',
      address: johnson.address,
      city: johnson.city,
      state: johnson.state,
      zip: johnson.zip,
      completedAt: new Date('2025-04-10'),
      companyId: comp.id,
      contactId: johnson.id,
      equipmentId: eq1.id,
    }).returning()

    await db.insert(job).values({
      number: 'JOB-00002',
      title: 'Heat Pump Diagnostic — Compressor Noise',
      description: 'Customer reports loud rattling from outdoor unit. Inspect compressor, check mounting bolts, test capacitor and contactors.',
      status: 'scheduled',
      priority: 'high',
      jobType: 'repair',
      scheduledDate: new Date('2026-03-15'),
      scheduledTime: '10:00',
      estimatedHours: '2',
      address: martinez.address,
      city: martinez.city,
      state: martinez.state,
      zip: martinez.zip,
      companyId: comp.id,
      contactId: martinez.id,
      equipmentId: eq4.id,
    })

    await db.insert(job).values({
      number: 'JOB-00003',
      title: 'Tankless Water Heater Descaling',
      description: 'Annual flush and descale of Rinnai tankless unit. Check for error codes, inspect venting.',
      status: 'scheduled',
      priority: 'normal',
      jobType: 'maintenance',
      scheduledDate: new Date('2026-03-20'),
      scheduledTime: '14:00',
      estimatedHours: '1',
      address: martinez.address,
      city: martinez.city,
      state: martinez.state,
      zip: martinez.zip,
      companyId: comp.id,
      contactId: martinez.id,
      equipmentId: eq3.id,
    })

    console.log('Created 3 demo service calls linked to equipment')
  }

  console.log('')
  console.log('Login credentials:')
  console.log('  Email: {{ADMIN_EMAIL}}')
  console.log('  Password: {{DEFAULT_PASSWORD}}')
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
