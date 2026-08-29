import { drizzle } from 'drizzle-orm/node-postgres'
import { eq } from 'drizzle-orm'

import { company, user, supportKnowledgeBase, pricebookCategory, pricebookItem, contact, serviceMenu, clientProfile, serviceRecord, appointment, membershipPlan } from './schema.ts'

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
    // Salon-specific help articles — the shared template seeded contractor content
    // (jobs, quotes, scheduling, time tracking) that describes pages this app doesn't have. (HELP-02)
    const helpArticles = [
      { title: 'Getting Started', content: 'Welcome! Start by adding client profiles, building your Service Menu, and taking bookings in The Book. Use the sidebar to move between modules — each has a list and a detail view.', category: 'Getting Started', isFaq: true, sortOrder: 1 },
      { title: 'Client Profiles', content: 'Client Profiles hold everything about a guest: contact details, hair type, allergies and colour formula history. Open a client from the Clients page to see their full visit and formula history.', category: 'Getting Started', isFaq: false, sortOrder: 2 },
      { title: 'Building your Service Menu', content: 'The Service Menu is your catalogue of services with prices and durations. Add or edit services from the Service Menu page; these are what clients can book and what you log against a visit.', category: 'Services', isFaq: false, sortOrder: 3 },
      { title: 'Taking bookings in The Book', content: 'The Book is your appointment calendar. Create an appointment for a client and stylist, or let clients book themselves online. Check clients in and log the service performed when they arrive.', category: 'Bookings', isFaq: true, sortOrder: 4 },
      { title: 'Rebooking & Recall', content: 'Rebooking & Recall flags clients who are due back based on their last service. Send a reminder text to bring them in — great for colour maintenance and standing appointments.', category: 'Bookings', isFaq: false, sortOrder: 5 },
      { title: 'Memberships', content: 'Sell memberships (e.g. a monthly blowout club) from the Memberships page. Enrolled clients get their included visits tracked automatically.', category: 'Memberships', isFaq: false, sortOrder: 6 },
      { title: 'Invoices & Payments', content: 'Create an invoice for a client from the Invoices page, add line items, and record payment. Track outstanding balances and send the invoice by email.', category: 'Billing', isFaq: false, sortOrder: 7 },
      { title: 'Marketing campaigns', content: 'Reach your clients from the Marketing page — build an email campaign, pick an audience, and send. Track opens and results afterward.', category: 'Marketing', isFaq: false, sortOrder: 8 },
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

  // Salon service categories + appointment statuses — the shared template defaulted to a
  // contractor taxonomy (General Services/Repairs; Estimate/Invoiced). (PB-01, FIT-03)
  const DEFAULT_CATEGORIES = ['Haircuts', 'Color', 'Highlights & Balayage', 'Styling & Blowouts', 'Treatments', 'Add-ons']
  const DEFAULT_STATUSES = ['Booked', 'Confirmed', 'Checked In', 'Completed', 'Cancelled', 'No-Show']

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

  // Seed a starter service menu + sample clients on first deploy (idempotent),
  // so the book, the dashboard and the rebooking report show real data out of
  // the box instead of five empty states. The salon deletes or edits these.
  //
  // The rebook intervals are the industry defaults an owner would set anyway:
  // root touch-up ~6wk, cut ~6wk, balayage ~12wk, blowout on demand (no interval).
  const existingServices = await db.select({ id: serviceMenu.id }).from(serviceMenu).where(eq(serviceMenu.companyId, comp.id)).limit(1)
  if (existingServices.length === 0) {
    const isoDate = (deltaDays: number) => { const d = new Date(); d.setDate(d.getDate() + deltaDays); return d.toISOString().slice(0, 10) }
    const daysAgo = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return d }

    const [cut] = await db.insert(serviceMenu).values({ name: "Women's Cut & Style", category: 'hair', durationMin: 60, price: '65.00', rebookIntervalDays: 42, companyId: comp.id }).returning()
    const [mensCut] = await db.insert(serviceMenu).values({ name: "Men's Cut", category: 'hair', durationMin: 30, price: '35.00', rebookIntervalDays: 28, companyId: comp.id }).returning()
    const [root] = await db.insert(serviceMenu).values({ name: 'Root Touch-Up', category: 'colour', durationMin: 90, price: '95.00', rebookIntervalDays: 42, requiresPatchTest: true, companyId: comp.id }).returning()
    await db.insert(serviceMenu).values([
      { name: 'Balayage', category: 'colour', durationMin: 180, price: '250.00', priceIsFrom: true, rebookIntervalDays: 84, requiresPatchTest: true, companyId: comp.id },
      { name: 'Blowout', category: 'hair', durationMin: 45, price: '45.00', companyId: comp.id },
      { name: 'Deep Conditioning Treatment', category: 'hair', durationMin: 30, price: '35.00', companyId: comp.id },
    ])

    const [c1] = await db.insert(contact).values({ type: 'client', name: 'Sarah Mitchell', email: 'sarah.mitchell@example.com', phone: '+1-608-555-0188', mobile: '+1-608-555-0188', companyId: comp.id }).returning()
    const [c2] = await db.insert(contact).values({ type: 'client', name: 'James Carter', email: 'james.carter@example.com', phone: '+1-608-555-0143', mobile: '+1-608-555-0143', companyId: comp.id }).returning()

    await db.insert(clientProfile).values([
      { contactId: c1.id, hairType: 'Fine, wavy', allergies: 'PPD sensitivity — use PPD-free line', patchTestAt: isoDate(-30), preferences: 'Oat milk latte, prefers a quiet appointment', birthday: isoDate(21), companyId: comp.id },
      { contactId: c2.id, hairType: 'Thick, straight', preferences: 'Books the first slot of the day', companyId: comp.id },
    ])

    // Sarah's colour was 50 days ago on a 42-day interval → she reads as OVERDUE
    // on the rebooking report the day this deploys. James is due in ~2 weeks.
    await db.insert(serviceRecord).values([
      { contactId: c1.id, serviceId: root.id, performedAt: daysAgo(50), formula: [{ product: 'Wella Koleston', shade: '6/0', parts: '1' }, { product: 'Wella Koleston', shade: '7/1', parts: '1' }], developerVolume: '20 vol', processingMin: 35, result: 'Even coverage, no banding', priceCharged: '95.00', companyId: comp.id },
      { contactId: c1.id, serviceId: cut.id, performedAt: daysAgo(50), priceCharged: '65.00', companyId: comp.id },
      { contactId: c2.id, serviceId: mensCut.id, performedAt: daysAgo(14), priceCharged: '35.00', companyId: comp.id },
    ])

    const apptStart = new Date(); apptStart.setHours(14, 0, 0, 0)
    await db.insert(appointment).values({ contactId: c2.id, serviceId: mensCut.id, status: 'scheduled', station: 'Chair 2', startTime: apptStart, endTime: new Date(apptStart.getTime() + 30 * 60000), quotedPrice: '35.00', companyId: comp.id })

    await db.insert(membershipPlan).values({ name: 'Blowout Club', description: 'Four blowouts a month, book any open slot', price: '99.00', billingCycle: 'monthly', creditsTotal: 4, companyId: comp.id })

    console.log('Seeded sample salon data (6 services, 2 clients, formula history, appointment, membership plan)')
  }

  console.log('')
  console.log('Login credentials:')
  console.log('  Email: {{ADMIN_EMAIL}}')
  console.log('  Password: (set at signup — use Forgot password on the login page if lost)')
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
