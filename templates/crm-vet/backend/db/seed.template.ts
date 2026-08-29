import { drizzle } from 'drizzle-orm/node-postgres'
import { eq } from 'drizzle-orm'

import { company, user, supportKnowledgeBase, pricebookCategory, pricebookItem, contact, patient, vaccination, appointment, visit, wellnessPlan } from './schema.ts'

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
    // Vertical-appropriate help articles (was shared contractor content).
    const helpArticles = [
      { title: 'Getting Started', content: 'Welcome! Start by adding clients and their patients, then book appointments and record visits. Use the sidebar to move between modules.', category: 'Getting Started', isFaq: true, sortOrder: 1 },
      { title: 'Patient Records', content: 'Each patient has a full medical record: visits, SOAP notes, vaccinations, prescriptions and lab results. Open a patient from the Patients page or from their owner.', category: 'Patients', isFaq: false, sortOrder: 2 },
      { title: 'Vaccinations & Reminders', content: 'Record vaccinations on a patient and the system tracks due dates. Reminders flags patients due for vaccines or wellness visits so you can reach out.', category: 'Patients', isFaq: true, sortOrder: 3 },
      { title: 'Appointments', content: 'Book appointments for a patient and provider from the Appointments page. Check patients in on arrival and start the visit to record care.', category: 'Appointments', isFaq: false, sortOrder: 4 },
      { title: 'Wellness Plans', content: 'Enroll patients in wellness plans from the Wellness Plans page to bundle preventive care. Enrollment and included services are tracked automatically.', category: 'Wellness', isFaq: false, sortOrder: 5 },
      { title: 'Invoices & Payments', content: 'Create an invoice for a client, add services and products, and record payment. Track outstanding balances and send invoices by email.', category: 'Billing', isFaq: false, sortOrder: 6 },
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

  const DEFAULT_CATEGORIES = ['Wellness Exams', 'Vaccinations', 'Dental', 'Surgery', 'Diagnostics', 'Grooming', 'Boarding']
  const DEFAULT_STATUSES = ['Scheduled', 'Confirmed', 'Checked In', 'In Progress', 'Completed', 'Cancelled', 'No-Show']

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

  // Seed sample veterinary data on first deploy (idempotent) so patients,
  // dashboard and reminders show real data out of the box. The clinic deletes these.
  const existingPatients = await db.select({ id: patient.id }).from(patient).where(eq(patient.companyId, comp.id)).limit(1)
  if (existingPatients.length === 0) {
    const isoDate = (deltaDays: number) => { const d = new Date(); d.setDate(d.getDate() + deltaDays); return d.toISOString().slice(0, 10) }

    const [o1] = await db.insert(contact).values({ type: 'client', name: 'Sarah Mitchell', email: 'sarah.mitchell@example.com', phone: '+1-608-555-0188', mobile: '+1-608-555-0188', companyId: comp.id }).returning()
    const [o2] = await db.insert(contact).values({ type: 'client', name: 'James Carter', email: 'james.carter@example.com', phone: '+1-608-555-0143', mobile: '+1-608-555-0143', companyId: comp.id }).returning()

    const [p1] = await db.insert(patient).values({ ownerId: o1.id, name: 'Bella', species: 'dog', breed: 'Labrador Retriever', sex: 'female', spayedNeutered: true, dob: isoDate(-365 * 4), weightLb: '62.5', color: 'Yellow', microchip: '985112000123456', companyId: comp.id }).returning()
    const [p2] = await db.insert(patient).values({ ownerId: o1.id, name: 'Max', species: 'dog', breed: 'Beagle', sex: 'male', spayedNeutered: true, dob: isoDate(-365 * 6), weightLb: '24.0', color: 'Tricolor', alerts: 'Anxious — muzzle for nail trims', companyId: comp.id }).returning()
    const [p3] = await db.insert(patient).values({ ownerId: o2.id, name: 'Luna', species: 'cat', breed: 'Domestic Shorthair', sex: 'female', spayedNeutered: true, dob: isoDate(-365 * 2), weightLb: '9.2', color: 'Gray tabby', companyId: comp.id }).returning()

    // Vaccinations — Bella's rabies due soon, Luna's FVRCP overdue → drive the reminder engine.
    await db.insert(vaccination).values([
      { patientId: p1.id, vaccine: 'Rabies', manufacturer: 'Boehringer', lotNumber: 'RB-4471', givenDate: isoDate(-350), dueDate: isoDate(15), isRabies: true, rabiesTag: 'WI-2025-0417', companyId: comp.id },
      { patientId: p1.id, vaccine: 'DHPP', givenDate: isoDate(-350), dueDate: isoDate(15), companyId: comp.id },
      { patientId: p3.id, vaccine: 'FVRCP', givenDate: isoDate(-380), dueDate: isoDate(-15), companyId: comp.id },
    ])

    const apptStart = new Date(); apptStart.setHours(14, 0, 0, 0)
    await db.insert(appointment).values({ patientId: p2.id, ownerId: o1.id, type: 'wellness', status: 'scheduled', reason: 'Annual wellness exam', startTime: apptStart, companyId: comp.id })

    const visitDate = new Date(); visitDate.setDate(visitDate.getDate() - 20)
    await db.insert(visit).values({ patientId: p1.id, visitDate, reason: 'Ear infection recheck', subjective: 'Owner reports less head-shaking', objective: 'AU clean, no discharge', assessment: 'Resolving otitis externa', plan: 'Continue cleaner 5 days', total: '78.50', companyId: comp.id })

    await db.insert(wellnessPlan).values({ name: 'Puppy/Kitten Wellness', description: 'First-year preventive care bundle', monthlyPrice: '49.00', annualPrice: '529.00', benefits: ['Core vaccines', 'Spay/neuter discount', '2 wellness exams', 'Monthly parasite prevention'], companyId: comp.id })

    console.log('Seeded sample veterinary data (2 owners, 3 pets, vaccinations, appointment, visit, wellness plan)')
  }

  console.log('')
  console.log('Login credentials:')
  console.log('  Email: {{ADMIN_EMAIL}}')
  console.log('  Password: (set at signup — use Forgot password on the login page if lost)')
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
