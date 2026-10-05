import { drizzle } from 'drizzle-orm/node-postgres'
import { eq } from 'drizzle-orm'

import { company, user, supportKnowledgeBase, contact, equipment, job, site, quote, quoteLineItem, serviceAgreement, agreementPlan, jobPhoto, smsConversation, smsMessage, pricebookCategory, pricebookItem } from './schema.ts'

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
      logo: '{{COMPANY_LOGO}}',
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
  } else {
    console.log('Company already exists:', comp.name)
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
    // These eight articles are the first thing a new tenant reads, and they used to open with
    // "Getting Started with Your Field Service CRM" and go on about AC installs, furnace repairs,
    // duct cleaning and dispatching technicians. This template is shared by showcase, foodtruck and
    // basic (industryRouting.ts), so a gym, a venue and a food truck were all handed an HVAC
    // contractor's help centre on day one. T41 called it out on the showcase tenant.
    //
    // The wording below names only what the modules actually are, so it is true for all three.
    // One substantive correction while rewriting: the Team article told people to assign the roles
    // "admin, dispatcher, technician". Those are not this product's roles — DEFAULT_ROLES is
    // viewer / field (shown as Staff) / manager / admin — so the instruction could not be followed
    // as written. It now names the real four.
    const helpArticles = [
      { title: 'Getting Started with Your CRM', content: 'Welcome to your CRM. Start by adding your customer contacts, creating jobs for the work you have booked, and sending quotes. Use the sidebar to move between modules.', category: 'Getting Started', isFaq: true, sortOrder: 1 },
      { title: 'Managing Customers', content: 'Contacts are the foundation of your CRM. Add new customers from the Contacts page. Each customer can have any number of jobs, quotes and invoices linked to them. Use tags to group them the way you actually work — by service, by location, or by account type.', category: 'Getting Started', isFaq: false, sortOrder: 2 },
      { title: 'Creating and Sending Quotes', content: 'Go to Quotes to build a quote for a customer. Add a line item for each part of the work and anything you supply, then send the quote by email. Customers can approve a quote online through the customer portal, and an approved quote can be turned into a job or an invoice in one step.', category: 'Quotes & Invoices', isFaq: false, sortOrder: 3 },
      { title: 'Invoice Management', content: 'Create invoices from the Invoices page, or convert an approved quote into one. Set the payment terms, add your line items, and send it to the customer. Track payment status and send reminders for anything overdue.', category: 'Quotes & Invoices', isFaq: false, sortOrder: 4 },
      { title: 'How do I schedule work?', content: 'Go to the Schedule page to see your calendar. Click a date to create a job, or drag an existing job to move it. Assign who is doing it, set an estimated duration, and choose the job type. The calendar has day, week and month views.', category: 'Scheduling', isFaq: true, sortOrder: 5 },
      { title: 'Team Management', content: 'Add team members from the Team page. Each person gets a role — Viewer can look but change nothing, Staff handles day-to-day work, Manager has full access to work and invoicing, Admin also has company settings and the team itself. Team members can be assigned to jobs and have their time logged for payroll.', category: 'Team', isFaq: false, sortOrder: 6 },
      { title: 'How do I track time?', content: 'Use the Time page to log hours against a job. People can clock in and out on site, or add an entry by hand. Every entry links to a specific job, so billing and labour cost stay accurate.', category: 'Time & Expenses', isFaq: true, sortOrder: 7 },
      { title: 'Equipment & Service History', content: 'Track the equipment you look after for a customer and keep its full service history. Attach photos, manuals and warranty documents to the record so they are to hand the next time you are on site.', category: 'Documents', isFaq: false, sortOrder: 8 },
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

  // A NEW TENANT STARTS WITH THEIR OWN BUSINESS, NOT SOMEBODY ELSE'S. (T44)
  //
  // This template used to seed a complete invented business here — named customers, their sites and
  // equipment, jobs against that equipment, quotes, an agreement, a photo and an SMS thread. A real
  // shop signing up had to delete all of it before the CRM was about them, and every one of those
  // rows was a fictional trade business dropped into whatever vertical the tenant actually was. That
  // is where the "HVAC help centre on a gym" family of findings came from: five separate QA items
  // across two rounds, one root cause.
  //
  // The flagship `templates/crm/backend/db/seed.template.ts` seeds company, owner, help articles and
  // a pricebook skeleton and nothing else, and so do dispensary, homecare, salon and vet. The rule
  // this now follows is theirs: keep what TEACHES somebody how the screens work, never ship rows
  // that pretend to be records.
  //
  // If a demo book is wanted again it belongs behind an explicit "Load sample data" control the
  // owner chooses, not in the first boot of a CRM somebody is paying for.


  // ── INDUSTRY-SPECIFIC PRICEBOOK & CATEGORIES ─────────
  const industry = '{{INDUSTRY}}'

  const SERVICE_CATEGORIES: Record<string, string[]> = {
    'HVAC':       ['Install', 'Repair', 'Maintenance', 'Emergency', 'Inspection'],
    'Plumbing':   ['Install', 'Repair', 'Maintenance', 'Emergency', 'Inspection'],
    'Electrical': ['Install', 'Repair', 'Maintenance', 'Emergency', 'Inspection'],
  }
  // The fallback for a tenant whose industry is not one of the trades above — which on this
  // template is most of them: showcase, foodtruck and basic all land here. 'Emergency' and
  // 'Inspection' are a contractor's day; a studio sells sessions, a truck sells service. (T42)
  const DEFAULT_CATEGORIES = ['Service', 'Package', 'Hire', 'Extra', 'Other']

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
  console.log('  Password: (set at signup — use Forgot password on the login page if lost)')
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
