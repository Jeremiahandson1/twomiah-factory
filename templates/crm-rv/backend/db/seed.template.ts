import { drizzle } from 'drizzle-orm/node-postgres'
import { eq } from 'drizzle-orm'

import { company, user, supportKnowledgeBase, pricebookCategory, pricebookItem, unit, contact, salesLead, repairOrder, invoice } from './schema.ts'

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
    if (enabledFeatures.length > 0) {
      await db.update(company).set({ enabledFeatures, updatedAt: new Date() }).where(eq(company.id, comp.id))
      console.log(`Updated enabledFeatures: ${enabledFeatures.length} features`)
    }
  }

  // Create admin user only if not already present — never overwrite existing password
  const [existingUser] = await db.select().from(user).where(eq(user.email, '{{ADMIN_EMAIL}}')).limit(1)
  if (existingUser) {
    console.log('Admin user already exists - skipping password reset')
  } else {
    const passwordHash = await Bun.password.hash('{{DEFAULT_PASSWORD}}', 'bcrypt')
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

  // Seed a few sample RV / powersports units on first deploy (idempotent) so the
  // inventory + dashboard show real data out of the box. The dealer deletes these.
  const existingUnits = await db.select({ id: unit.id }).from(unit).where(eq(unit.companyId, comp.id)).limit(1)
  if (existingUnits.length === 0) {
    const cid = comp.id
    const now = Date.now(); const DAY = 86400000
    const ago = (d: number) => new Date(now - d * DAY)

    // ── Salespeople (so "which rep sold the most" works) ──
    const repHash = await Bun.password.hash('Demo-rep-pw-1!', 'bcrypt')
    const repNames = [['Mike', 'Sorenson'], ['Sarah', 'Becker'], ['Dave', 'Holt']]
    const reps: any[] = []
    for (let i = 0; i < repNames.length; i++) {
      try { const [r] = await db.insert(user).values({ email: `${repNames[i][0].toLowerCase()}.demo@dealer.test`, passwordHash: repHash, firstName: repNames[i][0], lastName: repNames[i][1], role: 'user', companyId: cid }).returning(); reps.push(r) } catch (e) { /* skip */ }
    }
    const repId = (i: number) => (reps.length ? reps[i % reps.length].id : null)

    // ── Inventory (boats / powersports / RV / pwc), cost set so gross/margin computes ──
    const unitDefs: any[] = [
      { category: 'boat', condition: 'new', stockNumber: 'BBE-101', year: 2026, make: 'Bennington', modelName: '22 SSBX', cost: '58000', internetPrice: '74995', msrp: '79900' },
      { category: 'boat', condition: 'new', stockNumber: 'BCR-104', year: 2026, make: 'Crestliner', modelName: '1850 Fish Hawk', cost: '31000', internetPrice: '41995', msrp: '44900' },
      { category: 'motorcycle', condition: 'new', stockNumber: 'IND-210', year: 2025, make: 'Indian', modelName: 'Scout Bobber', engineCc: 1133, cost: '9800', internetPrice: '12999', msrp: '13499' },
      { category: 'motorcycle', condition: 'used', stockNumber: 'HON-214', year: 2022, make: 'Honda', modelName: 'Gold Wing Tour', engineCc: 1833, mileage: 8400, cost: '18500', internetPrice: '24995', msrp: '0' },
      { category: 'atv', condition: 'new', stockNumber: 'HON-320', year: 2025, make: 'Honda', modelName: 'FourTrax Rancher', engineCc: 420, cost: '6200', internetPrice: '7999', msrp: '8499' },
      { category: 'utv', condition: 'new', stockNumber: 'POL-330', year: 2025, make: 'Polaris', modelName: 'RANGER XP 1000', engineCc: 999, drivetrain: '4wd', cost: '16800', internetPrice: '21499', msrp: '22999' },
      { category: 'utv', condition: 'new', stockNumber: 'CF-334', year: 2025, make: 'CFMoto', modelName: 'ZForce 950 Sport', engineCc: 963, cost: '12100', internetPrice: '15499', msrp: '16299' },
      { category: 'motorcycle', condition: 'new', stockNumber: 'YAM-218', year: 2025, make: 'Yamaha', modelName: 'MT-09', engineCc: 890, cost: '8400', internetPrice: '10599', msrp: '10999' },
      { category: 'boat', condition: 'used', stockNumber: 'BBE-108', year: 2022, make: 'Bennington', modelName: '20 SVSR', cost: '34000', internetPrice: '46995', msrp: '0' },
      { category: 'snowmobile', condition: 'new', stockNumber: 'SKI-410', year: 2025, make: 'Ski-Doo', modelName: 'MXZ Sport 600', cost: '9900', internetPrice: '12499', msrp: '12999' },
      { category: 'towable', condition: 'used', stockNumber: 'RV-1002', year: 2021, make: 'Forest River', modelName: 'Rockwood 2608BS', cost: '21000', internetPrice: '28995', msrp: '0' },
      { category: 'pwc', condition: 'new', stockNumber: 'SEA-520', year: 2025, make: 'Sea-Doo', modelName: 'GTI 130', cost: '9300', internetPrice: '11999', msrp: '12499' },
    ]
    const units: any[] = []
    for (let i = 0; i < unitDefs.length; i++) {
      try { const [un] = await db.insert(unit).values({ ...unitDefs[i], status: i < 4 ? 'sold' : 'available', companyId: cid, createdAt: ago(75 - i * 4) }).returning(); units.push(un) } catch (e) { /* skip */ }
    }
    const unitId = (i: number) => (units.length ? units[i % units.length].id : null)

    // ── Customers / contacts ──
    const names = [['Tom', 'Reilly'], ['Angela', 'Vance'], ['Mark', 'Doyle'], ['Priya', 'Nair'], ['Greg', 'Olsen'], ['Sam', 'Whitfield'], ['Karen', 'Lutz'], ['Brett', 'Conway'], ['Nina', 'Park'], ['Curt', 'Bauman'], ['Joel', 'Ferris'], ['Dana', 'Eklund']]
    const contacts: any[] = []
    for (let i = 0; i < names.length; i++) {
      try { const [ct] = await db.insert(contact).values({ type: i < 8 ? 'customer' : 'lead', name: names[i][0] + ' ' + names[i][1], email: `${names[i][0].toLowerCase()}.${names[i][1].toLowerCase()}@example.com`, phone: `715-555-${1000 + i}`, city: '{{CITY}}', state: '{{STATE}}', source: ['walk_in', 'web', 'referral', 'rv_trader'][i % 4], companyId: cid, createdAt: ago(80 - i * 5) }).returning(); contacts.push(ct) } catch (e) { /* skip */ }
    }
    const ctId = (i: number) => (contacts.length ? contacts[i % contacts.length].id : null)

    // ── Sales pipeline (sold deals w/ closedAt + dates, plus open + lost) ──
    const stages = ['closed_won', 'closed_won', 'closed_won', 'closed_won', 'desking', 'demo', 'contacted', 'new', 'closed_lost', 'desking', 'contacted', 'new', 'demo', 'closed_won', 'new', 'contacted']
    for (let i = 0; i < stages.length; i++) {
      const stage = stages[i]; const closed = stage.startsWith('closed')
      try {
        await db.insert(salesLead).values({
          source: ['walk_in', 'web', 'referral', 'rv_trader', 'cycle_trader'][i % 5], stage,
          contactId: ctId(i), unitId: unitId(i), assignedTo: repId(i),
          closedAt: closed ? ago(i * 2 + 1) : null,
          followUpDate: closed ? null : ago(-(i % 8) - 1),
          notes: stage === 'closed_won' ? 'Delivered — financed via Octane.' : stage === 'closed_lost' ? 'Bought elsewhere on price.' : 'Working the deal.',
          companyId: cid, createdAt: ago(50 - i * 2),
        })
      } catch (e) { /* skip */ }
    }

    // ── Service / repair orders ──
    const roStatuses = ['open', 'in_progress', 'waiting_parts', 'ready', 'closed', 'closed', 'in_progress', 'open']
    const roSvc = ['Annual service + winterization', 'Tire/track replacement', 'Warranty engine repair', 'Detail + safety inspection', 'Lower-unit service']
    for (let i = 0; i < roStatuses.length; i++) {
      const st = roStatuses[i]
      try {
        await db.insert(repairOrder).values({
          roNumber: 'RO-' + String(1001 + i), writeUpDate: ago(i * 2), status: st,
          customerId: ctId(i + 1), unitId: unitId(i + 4), advisorName: repNames[i % 3][0] + ' ' + repNames[i % 3][1],
          services: [{ description: roSvc[i % roSvc.length], laborHours: 2 + (i % 4), partsCost: 120 + i * 45 }],
          estimatedTotal: String(350 + i * 95), actualTotal: st === 'closed' ? String(365 + i * 95) : null,
          completedAt: st === 'closed' ? ago(i) : null, companyId: cid, createdAt: ago(i * 2),
        })
      } catch (e) { /* skip */ }
    }

    // ── Invoices (paid + open + overdue) ──
    for (let i = 0; i < 7; i++) {
      const sub = 800 + i * 640; const tax = Math.round(sub * 0.055); const paid = i < 4
      try {
        await db.insert(invoice).values({
          number: 'INV-' + String(2001 + i), status: paid ? 'paid' : i === 4 ? 'overdue' : 'sent',
          issueDate: ago(32 - i * 4), dueDate: ago(i * 4 - 8), subtotal: String(sub), taxAmount: String(tax), total: String(sub + tax),
          amountPaid: paid ? String(sub + tax) : '0', paidAt: paid ? ago(22 - i * 3) : null,
          contactId: ctId(i), companyId: cid, createdAt: ago(32 - i * 4),
        })
      } catch (e) { /* skip */ }
    }

    console.log(`Seeded demo data: ${units.length} units, ${contacts.length} contacts, ${reps.length} reps, pipeline + service + invoices`)
  }

  console.log('')
  console.log('Login credentials:')
  console.log('  Email: {{ADMIN_EMAIL}}')
  console.log('  Password: {{DEFAULT_PASSWORD}}')
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
