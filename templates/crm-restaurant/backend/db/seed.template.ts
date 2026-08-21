import { drizzle } from 'drizzle-orm/node-postgres'
import { eq } from 'drizzle-orm'

import { company, user, supportKnowledgeBase, pricebookCategory, pricebookItem, contact, eventSpace, menuPackage, event, eventMenuItem, eventTimeline, eventPayment } from './schema.ts'

const db = drizzle(process.env.DATABASE_URL!)

// Factory replaces these placeholders at generate time. Keeping them inside
// backtick strings guarantees the file is valid JS even if substitution fails —
// the runtime guard below falls back to [] so the seed still completes.
const __FEATURES_RAW = `{{ENABLED_FEATURES_JSON}}`
const __PRODUCTS_RAW = `{{PRODUCTS_JSON}}`
const enabledFeatures: string[] = __FEATURES_RAW.trim().startsWith('{{') ? [] : JSON.parse(__FEATURES_RAW)
const enabledProducts: string[] = __PRODUCTS_RAW.trim().startsWith('{{') ? [] : JSON.parse(__PRODUCTS_RAW)

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
      enabledFeatures,
      settings: {
        products: enabledProducts,
        siteUrl: '{{SITE_URL}}',
        cmsUrl: '{{CMS_URL}}',
        generatedBy: '{{COMPANY_NAME}} Factory',
        generatedAt: new Date().toISOString(),
      },
    }).returning()
    console.log('Created company:', comp.name)

    // Auto-enable estimator if feature was selected
    if (enabledFeatures.includes('instant_estimator')) {
      await db.update(company).set({ estimatorEnabled: true }).where(eq(company.id, comp.id))
      console.log('Estimator auto-enabled')
    }
  } else {
    console.log('Company already exists:', comp.name)
    // Always sync enabledFeatures on redeploy — the Factory may have updated them
    // Do NOT re-apply the generation-time feature list to an existing company:
    // the seed runs on EVERY boot (migrate && seed && start), so this clobbered
    // any feature change made after deploy — admin toggles, add-on purchases,
    // factory feature-sync — back to the baked list on every restart/redeploy.
    // enabledFeatures is set once at company creation above; after that the
    // factory sync owns it.
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

  // Seed help articles if none exist
  const existingArticles = await db.select().from(supportKnowledgeBase).where(eq(supportKnowledgeBase.companyId, comp.id)).limit(1)
  if (existingArticles.length === 0) {
    const helpArticles = [
      { title: 'Getting Started with Your CRM', content: 'Welcome to your CRM! Start by adding contacts, creating jobs, and sending quotes. Use the sidebar to navigate between modules. Each module has a list view and detail view for managing records.', category: 'Getting Started', isFaq: true, sortOrder: 1 },
      { title: 'Managing Contacts', content: 'Contacts are the foundation of your CRM. Add new contacts from the Contacts page. Each contact can have multiple jobs, quotes, and invoices linked to them. Use tags and notes to organize your contacts.', category: 'Getting Started', isFaq: false, sortOrder: 2 },
      { title: 'Creating and Sending Quotes', content: 'Navigate to Quotes to create a new quote. Select a contact, add line items with descriptions and prices, then send the quote via email. Customers can approve quotes online through the customer portal.', category: 'Quotes & Invoices', isFaq: false, sortOrder: 3 },
      { title: 'Invoice Management', content: 'Create invoices from the Invoices page or convert approved quotes to invoices. Set payment terms, add line items, and send to customers. Track payment status and send reminders for overdue invoices.', category: 'Quotes & Invoices', isFaq: false, sortOrder: 4 },
      { title: 'How do I schedule jobs?', content: 'Go to the Schedule page to view your calendar. Click on a date to create a new job or drag existing jobs to reschedule. You can assign team members and set job duration. The calendar supports day, week, and month views.', category: 'Scheduling', isFaq: true, sortOrder: 5 },
      { title: 'Team Management', content: 'Add team members from the Team page. Assign roles (admin, manager, technician) to control access. Team members can be assigned to jobs, tracked on the schedule, and have their time entries logged.', category: 'Team', isFaq: false, sortOrder: 6 },
      { title: 'How do I track time?', content: 'Use the Time page to log hours for jobs. Team members can clock in/out or manually add time entries. Time entries can be linked to specific jobs for accurate billing and labor cost tracking.', category: 'Time & Expenses', isFaq: true, sortOrder: 7 },
      { title: 'Document Management', content: 'Upload and organize documents in the Documents section. Attach files to contacts, jobs, or projects. Supported formats include PDF, images, and common document types.', category: 'Documents', isFaq: false, sortOrder: 8 },
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

  // ── INDUSTRY-SPECIFIC SEED DATA ──────────────────────
  const industry = '{{INDUSTRY}}'

  const INDUSTRY_CATEGORIES: Record<string, string[]> = {
    'Roofing': ['Roof Replacement', 'Roof Repair', 'Gutter Installation', 'Gutter Cleaning', 'Roof Inspection', 'Storm Damage Assessment'],
    'General Contractor': ['Foundation', 'Framing', 'Electrical Rough-in', 'Plumbing Rough-in', 'Insulation', 'Drywall', 'Painting', 'Flooring', 'Final Walkthrough'],
    'Remodeling': ['Kitchen Remodel', 'Bathroom Remodel', 'Basement Finish', 'Addition', 'Deck/Patio', 'Interior Demo', 'Tile Work', 'Cabinet Install'],
  }

  const INDUSTRY_STATUSES: Record<string, string[]> = {
    'Roofing': ['Lead', 'Estimate Sent', 'Approved', 'Scheduled', 'In Progress', 'Punch List', 'Complete', 'Invoiced'],
  }

  const DEFAULT_CATEGORIES = ['General Services', 'Repairs', 'Installation', 'Consultation', 'Maintenance']
  const DEFAULT_STATUSES = ['Estimate', 'Scheduled', 'In Progress', 'Complete', 'Invoiced']

  const existingCats = await db.select().from(pricebookCategory).where(eq(pricebookCategory.companyId, comp.id)).limit(1)
  if (existingCats.length === 0) {
    const categories = INDUSTRY_CATEGORIES[industry] || DEFAULT_CATEGORIES
    for (let i = 0; i < categories.length; i++) {
      await db.insert(pricebookCategory).values({
        name: categories[i],
        sortOrder: i,
        companyId: comp.id,
      })
    }
    console.log(`Seeded ${categories.length} service categories for ${industry}`)
  }

  // Store job statuses in company settings — only on first deploy
  const currentSettings = (comp.settings as any) || {}
  if (!currentSettings.jobStatuses) {
    const statuses = INDUSTRY_STATUSES[industry] || DEFAULT_STATUSES
    await db.update(company).set({
      settings: {
        ...currentSettings,
        jobStatuses: statuses,
      },
    }).where(eq(company.id, comp.id))
    console.log(`Set ${statuses.length} job statuses for ${industry}`)
  } else {
    console.log('Job statuses already configured — skipping')
  }

  // Seed spaces, catering packages and one live event on first deploy
  // (idempotent), so the pipeline, the calendar and the BEO all show real data
  // out of the box instead of five empty states. The venue edits or deletes these.
  const existingSpaces = await db.select({ id: eventSpace.id }).from(eventSpace).where(eq(eventSpace.companyId, comp.id)).limit(1)
  if (existingSpaces.length === 0) {
    const isoDate = (deltaDays: number) => { const d = new Date(); d.setDate(d.getDate() + deltaDays); return d.toISOString().slice(0, 10) }

    const [mainRoom] = await db.insert(eventSpace).values({
      name: 'The Cellar', description: 'Private room downstairs, own bar and entrance',
      seatedCapacity: 48, standingCapacity: 80, minimumSpend: '2500.00', hireFee: '350.00',
      amenities: ['Private bar', 'AV / screen', 'Step-free access'], companyId: comp.id,
    }).returning()
    await db.insert(eventSpace).values([
      { name: 'The Terrace', description: 'Covered outdoor terrace, heaters in winter', seatedCapacity: 30, standingCapacity: 55, minimumSpend: '1500.00', amenities: ['Heaters', 'Retractable roof'], companyId: comp.id },
      { name: 'Full Venue Buyout', description: 'The whole room, exclusive use', seatedCapacity: 110, standingCapacity: 180, minimumSpend: '9000.00', amenities: ['Exclusive use', 'Private bar', 'AV / screen'], companyId: comp.id },
    ])

    const [dinnerPkg] = await db.insert(menuPackage).values({
      name: 'Three-Course Set Dinner', category: 'dinner', pricePerPerson: '68.00', minGuests: 20,
      description: 'Choice of three per course, chosen in advance',
      courses: [
        { course: 'Starter', options: ['Burrata, heirloom tomato, basil', 'Chicken liver parfait, sourdough', 'Roast squash soup (v)'] },
        { course: 'Main', options: ['Braised short rib, pomme puree', 'Stone bass, fennel, salsa verde', 'Wild mushroom risotto (v)'] },
        { course: 'Dessert', options: ['Dark chocolate delice', 'Lemon posset, shortbread', 'Cheese plate (+$8)'] },
      ],
      dietaryNotes: 'Vegan and GF versions of every course available with 7 days notice',
      companyId: comp.id,
    }).returning()
    const [canapePkg] = await db.insert(menuPackage).values({
      name: 'Canape Reception', category: 'canape', pricePerPerson: '32.00', minGuests: 25,
      description: 'Six canapes per person, passed for one hour',
      courses: [{ course: 'Canapes', options: ['Beef tartare tartlet', 'Whipped cod roe, rye', 'Truffle arancini (v)', 'Prawn toast', 'Goat cheese, honey (v)', 'Chocolate truffle'] }],
      companyId: comp.id,
    }).returning()
    await db.insert(menuPackage).values([
      { name: 'Working Lunch Buffet', category: 'lunch', pricePerPerson: '38.00', minGuests: 12, description: 'Sandwiches, salads, soup and coffee', companyId: comp.id },
      { name: 'Drinks Package - Two Hours', category: 'bar', pricePerPerson: '45.00', minGuests: 15, description: 'House wine, beer and soft drinks, two hours', companyId: comp.id },
    ])

    const [client] = await db.insert(contact).values({ type: 'client', name: 'Priya Raman', email: 'priya.raman@example.com', phone: '+1-608-555-0166', mobile: '+1-608-555-0166', companyId: comp.id }).returning()
    await db.insert(contact).values({ type: 'lead', name: 'Northgate Logistics (holiday party)', email: 'events@example.com', phone: '+1-608-555-0121', companyId: comp.id })

    // A confirmed event 28 days out with a paid deposit and an outstanding
    // balance - so the dashboard, the BEO and the payments report all have
    // something real to render on day one.
    const [ev] = await db.insert(event).values({
      contactId: client.id, spaceId: mainRoom.id, name: 'Raman 40th Birthday',
      eventType: 'birthday', status: 'confirmed', eventDate: isoDate(28),
      startTime: '18:30', endTime: '23:30', guestCount: 40,
      quotedTotal: '4350.00', depositRequired: '1000.00', source: 'Website enquiry',
      dietaryRequirements: '2 x vegan, 1 x severe nut allergy (table 3)',
      setupNotes: 'Long table down the centre, low florals, own playlist via house AV',
      companyId: comp.id,
    }).returning()

    await db.insert(eventMenuItem).values([
      { eventId: ev.id, packageId: canapePkg.id, name: 'Canape Reception', perPerson: true, quantity: 40, unitPrice: '32.00', companyId: comp.id },
      { eventId: ev.id, packageId: dinnerPkg.id, name: 'Three-Course Set Dinner', perPerson: true, quantity: 40, unitPrice: '68.00', companyId: comp.id },
      { eventId: ev.id, name: 'Room hire - The Cellar', perPerson: false, quantity: 1, unitPrice: '350.00', companyId: comp.id },
    ])

    await db.insert(eventTimeline).values([
      { eventId: ev.id, time: '16:00', title: 'Room set - long table, 40 covers', department: 'setup', sortOrder: 1, companyId: comp.id },
      { eventId: ev.id, time: '17:30', title: 'Florals delivered', department: 'setup', details: 'Client brings own florist, side entrance', sortOrder: 2, companyId: comp.id },
      { eventId: ev.id, time: '18:30', title: 'Guests arrive - canapes passed', department: 'floor', details: 'Prosecco and soft on arrival', sortOrder: 3, companyId: comp.id },
      { eventId: ev.id, time: '19:30', title: 'Call to table, starters away', department: 'kitchen', sortOrder: 4, companyId: comp.id },
      { eventId: ev.id, time: '21:00', title: 'Speeches - hold desserts', department: 'floor', sortOrder: 5, companyId: comp.id },
      { eventId: ev.id, time: '23:30', title: 'Carriages', department: 'floor', sortOrder: 6, companyId: comp.id },
    ])

    await db.insert(eventPayment).values([
      { eventId: ev.id, label: 'Deposit', amount: '1000.00', dueDate: isoDate(-14), paidAt: new Date(Date.now() - 13 * 86400000), method: 'card', companyId: comp.id },
      { eventId: ev.id, label: 'Final balance', amount: '3350.00', dueDate: isoDate(21), companyId: comp.id },
    ])

    console.log('Seeded sample events data (3 spaces, 4 packages, 1 confirmed event with BEO + payments)')
  }

  console.log('')
  console.log('Login credentials:')
  console.log('  Email: {{ADMIN_EMAIL}}')
  console.log('  Password: (set at signup — use Forgot password on the login page if lost)')
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
