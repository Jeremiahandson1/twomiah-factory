import { drizzle } from 'drizzle-orm/node-postgres'
import { eq } from 'drizzle-orm'
import bcrypt from 'bcryptjs'
import { company, user, supportKnowledgeBase, contact, equipment, job, site, quote, quoteLineItem, serviceAgreement, agreementPlan, jobPhoto, smsConversation, smsMessage, pricebookCategory, pricebookItem } from './schema.ts'

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
    const [job1] = await db.insert(job).values({
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

    // Create demo quotes
    const existingQuotes = await db.select().from(quote).where(eq(quote.companyId, comp.id)).limit(1)
    if (existingQuotes.length === 0) {
      // Draft quote for Johnson — capacitor replacement
      await db.insert(quote).values({
        number: 'QTE-00001',
        name: 'AC Capacitor Replacement',
        status: 'draft',
        subtotal: '340.00',
        taxRate: '0',
        taxAmount: '0',
        discount: '0',
        total: '340.00',
        customerMessage: 'Your AC unit is running but the start capacitor is showing signs of wear. Replacing it now will prevent a breakdown during peak summer.',
        notes: 'Johnson called about AC making clicking noise on startup.',
        expiryDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        companyId: comp.id,
        contactId: johnson.id,
        equipmentId: eq1.id,
      }).returning().then(async ([q]) => {
        await db.insert(quoteLineItem).values([
          { description: 'Start/Run Capacitor (45/5 MFD)', quantity: '1', unitPrice: '85.00', total: '85.00', sortOrder: 0, quoteId: q.id },
          { description: 'Diagnostic Fee', quantity: '1', unitPrice: '95.00', total: '95.00', sortOrder: 1, quoteId: q.id },
          { description: 'Labor — Capacitor Install', quantity: '1', unitPrice: '160.00', total: '160.00', sortOrder: 2, quoteId: q.id },
        ])
      })

      // Approved quote for Martinez — coil cleaning + refrigerant, already converted to job
      const [martinezQuote] = await db.insert(quote).values({
        number: 'QTE-00002',
        name: 'Evaporator Coil Cleaning & Refrigerant Recharge',
        status: 'approved',
        subtotal: '1240.00',
        taxRate: '0',
        taxAmount: '0',
        discount: '0',
        total: '1240.00',
        customerMessage: 'The evaporator coil on the warehouse heat pump is heavily soiled and refrigerant is 1.5 lbs low. Cleaning and recharging will restore cooling capacity.',
        notes: 'Martinez warehouse unit — low performance complaint.',
        expiryDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        sentAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
        approvedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
        companyId: comp.id,
        contactId: martinez.id,
        equipmentId: eq4.id,
        siteId: martinezWarehouse.id,
      }).returning()

      await db.insert(quoteLineItem).values([
        { description: 'Evaporator Coil Chemical Cleaning', quantity: '1', unitPrice: '450.00', total: '450.00', sortOrder: 0, quoteId: martinezQuote.id },
        { description: 'R-410A Refrigerant (1.5 lbs)', quantity: '1.5', unitPrice: '120.00', total: '180.00', sortOrder: 1, quoteId: martinezQuote.id },
        { description: 'System Flush & Vacuum', quantity: '1', unitPrice: '275.00', total: '275.00', sortOrder: 2, quoteId: martinezQuote.id },
        { description: 'Labor — Diagnostic & Service (2 hrs)', quantity: '2', unitPrice: '167.50', total: '335.00', sortOrder: 3, quoteId: martinezQuote.id },
      ])

      // Create the converted job from this quote
      const [convertedJob] = await db.insert(job).values({
        number: 'JOB-00004',
        title: 'Evaporator Coil Cleaning & Refrigerant Recharge',
        description: 'Converted from Quote QTE-00002',
        status: 'scheduled',
        priority: 'normal',
        jobType: 'repair',
        scheduledDate: new Date('2026-03-25'),
        scheduledTime: '09:00',
        estimatedHours: '2',
        estimatedValue: '1240.00',
        address: '780 Industrial Blvd',
        city: '{{CITY}}',
        state: '{{STATE}}',
        zip: '{{ZIP}}',
        companyId: comp.id,
        contactId: martinez.id,
        quoteId: martinezQuote.id,
        equipmentId: eq4.id,
        siteId: martinezWarehouse.id,
      }).returning()

      // Link the quote back to the job
      await db.update(quote).set({ convertedToJobId: convertedJob.id }).where(eq(quote.id, martinezQuote.id))

      console.log('Created 2 demo quotes (1 draft, 1 approved → converted to job)')
    }

    // Create demo agreement plan + agreement with recurrence
    const existingAgreements = await db.select().from(serviceAgreement).where(eq(serviceAgreement.companyId, comp.id)).limit(1)
    if (existingAgreements.length === 0) {
      // Create a plan first
      const [plan] = await db.insert(agreementPlan).values({
        name: 'HVAC Maintenance Plan',
        description: 'Quarterly HVAC tune-ups with priority scheduling and 10% discount on repairs.',
        price: '299.00',
        billingFrequency: 'annual',
        visitsIncluded: 4,
        discountPercent: '10',
        priorityService: true,
        durationMonths: 12,
        autoRenew: true,
        active: true,
        companyId: comp.id,
      }).returning()

      // Create agreement for Johnson with auto-scheduling
      const ninetyDays = new Date()
      ninetyDays.setDate(ninetyDays.getDate() + 90)

      await db.insert(serviceAgreement).values({
        number: 'AGR-00001',
        name: 'HVAC Maintenance Plan — Johnson',
        status: 'active',
        startDate: new Date('2025-06-01'),
        endDate: new Date('2026-06-01'),
        billingFrequency: 'annual',
        amount: '299.00',
        renewalType: 'auto',
        notes: 'Covers both AC and furnace. Quarterly visits.',
        planId: plan.id,
        recurrenceRule: { frequency: 'quarterly' },
        nextServiceDate: ninetyDays,
        autoSchedule: true,
        reminderDaysBefore: 7,
        companyId: comp.id,
        contactId: johnson.id,
      })

      console.log('Created 1 demo agreement plan + 1 agreement with quarterly auto-scheduling')
    }

    // Create demo photos on JOB-00001
    const [adminUser] = await db.select().from(user).where(eq(user.email, '{{ADMIN_EMAIL}}')).limit(1)
    const existingPhotos = await db.select().from(jobPhoto).where(eq(jobPhoto.companyId, comp.id)).limit(1)
    if (existingPhotos.length === 0 && job1 && adminUser) {
      await db.insert(jobPhoto).values([
        {
          companyId: comp.id,
          jobId: job1.id,
          uploadedById: adminUser.id,
          url: 'https://placehold.co/800x600/e2e8f0/475569?text=AC+Unit+Before',
          caption: 'AC unit before service — dirty coils visible',
        },
        {
          companyId: comp.id,
          jobId: job1.id,
          uploadedById: adminUser.id,
          url: 'https://placehold.co/800x600/e2e8f0/475569?text=AC+Unit+After',
          caption: 'AC unit after service — coils cleaned and refrigerant topped off',
        },
      ])
      console.log('Created 2 demo photos on JOB-00001')
    }

    // Create demo SMS messages on Johnson contact
    const existingSms = await db.select().from(smsConversation).where(eq(smsConversation.companyId, comp.id)).limit(1)
    if (existingSms.length === 0 && johnson) {
      const phone = johnson.phone || '+15551234567'
      const [convo] = await db.insert(smsConversation).values({
        companyId: comp.id,
        phoneNumber: phone,
        contactId: johnson.id,
        status: 'active',
        lastMessageAt: new Date(),
      }).returning()

      await db.insert(smsMessage).values([
        {
          conversationId: convo.id,
          direction: 'outbound',
          body: 'Hi Sarah, this is {{COMPANY_NAME}} confirming your AC tune-up tomorrow at 9:00 AM. Reply STOP to opt out.',
          status: 'delivered',
          sentById: adminUser.id,
        },
        {
          conversationId: convo.id,
          direction: 'inbound',
          body: 'What time will you arrive?',
          status: 'received',
        },
        {
          conversationId: convo.id,
          direction: 'outbound',
          body: 'Between 2-4pm, we\'ll text when on the way.',
          status: 'delivered',
          sentById: adminUser.id,
        },
      ])
      console.log('Created 3 demo SMS messages on Johnson contact')
    }
  }

  // ── INDUSTRY-SPECIFIC PRICEBOOK & CATEGORIES ─────────
  const industry = '{{INDUSTRY}}'

  const SERVICE_CATEGORIES: Record<string, string[]> = {
    'HVAC':       ['Install', 'Repair', 'Maintenance', 'Emergency', 'Inspection'],
    'Plumbing':   ['Install', 'Repair', 'Maintenance', 'Emergency', 'Inspection'],
    'Electrical': ['Install', 'Repair', 'Maintenance', 'Emergency', 'Inspection'],
  }
  const DEFAULT_CATEGORIES = ['Install', 'Repair', 'Maintenance', 'Emergency', 'Inspection']

  type PricebookSeed = { name: string; description?: string; price: string; type: string; category: string }
  const INDUSTRY_PRICEBOOK: Record<string, PricebookSeed[]> = {
    'HVAC': [
      { name: 'AC Tune-Up', price: '89.00', type: 'service', category: 'Maintenance' },
      { name: 'Furnace Tune-Up', price: '89.00', type: 'service', category: 'Maintenance' },
      { name: 'AC Installation', description: 'Full AC system install — priced per estimate', price: '0.00', type: 'service', category: 'Install' },
      { name: 'Furnace Replacement', description: 'Full furnace replacement — priced per estimate', price: '0.00', type: 'service', category: 'Install' },
      { name: 'Refrigerant Recharge', price: '150.00', type: 'service', category: 'Repair' },
      { name: 'Filter Replacement', price: '25.00', type: 'service', category: 'Maintenance' },
      { name: 'Thermostat Install', price: '120.00', type: 'service', category: 'Install' },
      { name: 'Duct Cleaning', price: '299.00', type: 'service', category: 'Maintenance' },
    ],
    'Plumbing': [
      { name: 'Drain Cleaning', price: '150.00', type: 'service', category: 'Repair' },
      { name: 'Water Heater Install', description: 'Full water heater install — priced per estimate', price: '0.00', type: 'service', category: 'Install' },
      { name: 'Leak Repair', description: 'Leak diagnosis and repair — priced per estimate', price: '0.00', type: 'service', category: 'Repair' },
      { name: 'Toilet Replace', price: '200.00', type: 'service', category: 'Install' },
      { name: 'Faucet Install', price: '120.00', type: 'service', category: 'Install' },
      { name: 'Sewer Camera Inspection', price: '250.00', type: 'service', category: 'Inspection' },
    ],
    'Electrical': [
      { name: 'Panel Upgrade', description: 'Electrical panel upgrade — priced per estimate', price: '0.00', type: 'service', category: 'Install' },
      { name: 'Outlet Install', price: '120.00', type: 'service', category: 'Install' },
      { name: 'Ceiling Fan Install', price: '150.00', type: 'service', category: 'Install' },
      { name: 'EV Charger Install', description: 'EV charger installation — priced per estimate', price: '0.00', type: 'service', category: 'Install' },
      { name: 'Lighting Install', price: '100.00', type: 'service', category: 'Install' },
      { name: 'Safety Inspection', price: '200.00', type: 'service', category: 'Inspection' },
    ],
  }

  // Seed service categories
  const existingCats = await db.select().from(pricebookCategory).where(eq(pricebookCategory.companyId, comp.id)).limit(1)
  if (existingCats.length === 0) {
    const categories = SERVICE_CATEGORIES[industry] || DEFAULT_CATEGORIES
    const catMap: Record<string, string> = {}
    for (let i = 0; i < categories.length; i++) {
      const [cat] = await db.insert(pricebookCategory).values({
        name: categories[i],
        sortOrder: i,
        companyId: comp.id,
      }).returning()
      catMap[categories[i]] = cat.id
    }
    console.log(`Seeded ${categories.length} service categories for ${industry}`)

    // Seed pricebook items linked to categories
    const items = INDUSTRY_PRICEBOOK[industry]
    if (items) {
      for (const item of items) {
        await db.insert(pricebookItem).values({
          name: item.name,
          description: item.description || null,
          price: item.price,
          type: item.type,
          companyId: comp.id,
          categoryId: catMap[item.category] || null,
        })
      }
      console.log(`Seeded ${items.length} pricebook items for ${industry}`)
    }
  }

  console.log('')
  console.log('Login credentials:')
  console.log('  Email: {{ADMIN_EMAIL}}')
  console.log('  Password: {{DEFAULT_PASSWORD}}')
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
