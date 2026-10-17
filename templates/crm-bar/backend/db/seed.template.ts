import { drizzle } from 'drizzle-orm/node-postgres'
import { eq } from 'drizzle-orm'

import { company, user, supportKnowledgeBase, contact, equipment, job, site, quote, quoteLineItem, serviceAgreement, agreementPlan, jobPhoto, smsConversation, smsMessage, pricebookCategory, pricebookItem, loyaltyReward, eventSpace } from './schema.ts'

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

    // A new bar starts with what its first night needs to work, the way the pro systems do: Square Loyalty and Toast
    // ask for a reward when the programme is switched on, and a venue book starts with the venue. Bar Run 1: the
    // Regulars had nothing to spend points on and Parties had nowhere to book until the owner made them. Both are
    // ordinary rows the owner edits or deletes; written ONCE, at company creation, never on a later boot.
    await db.insert(loyaltyReward).values({
      companyId: comp.id, name: '$5 off', description: 'Your starting reward. Change the points or the amount on the Regulars page.',
      pointsCost: 100, type: 'fixed', valueCents: 500, active: true,
    })
    await db.insert(eventSpace).values({
      companyId: comp.id, name: 'Whole bar (buyout)', description: 'The whole place for a private party. Add your back room, patio or other spaces on the Spaces page.',
      amenities: [], active: true,
    })
    console.log('Seeded a starting reward and a starting space')
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
    // The bar's own help centre. It was crm-basic's (jobs, quotes, "log hours against a job") — Bar Run 1 follow-up,
    // 10/17. Each article names only screens and buttons this CRM has.
    const helpArticles = [
      { title: 'Getting started', category: 'Getting Started', isFaq: true, sortOrder: 1, content: 'Do these in order and you can ring up a check today. 1) Settings > Company: set your sales tax rate. 2) Bar Settings: your bar and kitchen hours. 3) Menu: make a section for food and one for drinks, then add your items with their prices; for food, say how many minutes it takes on the grill. 4) Taps: add each tap line, the beer and the price of a pour. 5) Settings > Users: invite your managers and bartenders. 6) Each person opens the Register and uses "Set my till PIN". Then open a tab on the Register and try it.' },
      { title: 'The Register: tabs, tables and paying', category: 'Register', isFaq: true, sortOrder: 2, content: 'Open a tab by name, a table, or a walk-up. Tap items to add them; "Send" sends the food to the grill (drinks never go there). "Fire just this" sends one item and holds the rest. To pay, choose Card (after you run it on your card reader), Cash (type what was handed over and the screen shows the change) or Gift card, and add the tip. "Split" divides a check by seat, by item, or evenly. Rename or move a check to another table at any time.' },
      { title: 'Voids and the manager PIN', category: 'Register', isFaq: true, sortOrder: 3, content: 'Anything not sent yet can be taken off by anyone. Once food or a drink has been sent, or a payment taken, a void needs a manager: the bartender\'s screen asks for a manager\'s till PIN, and the record shows both names and the reason. A manager signed in does it straight away. Set your PIN with "Set my till PIN" on the Register; nobody else here can use the same one.' },
      { title: 'The grill screen', category: 'Grill', isFaq: false, sortOrder: 4, content: 'Open Grill on the screen by the grill. Each ticket shows where it goes, how long it has waited and a cue that paces it ("Wings on now · Cheeseburger in 2 · Fries in 8") so everything is ready together. "On now" and "All day" at the top count what to start now and everything still to come. Tap a ticket when it is up; "Bring back" puts it back if you were early. The Register shows "Food\'s up".' },
      { title: 'Closing the night', category: 'Close-out', isFaq: true, sortOrder: 5, content: 'A night runs 4 AM to 4 AM, so a 1 AM sale counts toward tonight. Close-out shows the night: sales, tax, tips by person, voids, what sold, and how each check was paid. Type your starting float and what is in the drawer, and it shows over or short. "Close the night" records it and emails it to the bar. A check still open is listed; close it first, or close the night anyway and it stays open and counts on the night it is paid. A bartender needs a manager\'s PIN to close.' },
      { title: 'Gift cards', category: 'Gift Cards', isFaq: false, sortOrder: 6, content: 'Sell a gift card from the Register ("Sell a gift card"); it is issued when that check is paid, with no tax. Spend it like cash with Gift card when paying; anything left stays on the card. Gift Cards > Find shows a card\'s balance and every change to it. A manager can correct a balance (with a reason) or void a card. Cards never expire and carry no fees.' },
      { title: 'The Regulars (loyalty)', category: 'Regulars', isFaq: true, sortOrder: 7, content: 'Add a regular at the Register with a name and a phone number, then they earn points on what they spend on food and drink (never tax, tips or gift cards): 1 point a dollar to start. You start with one reward, $5 off for 100 points; change it or add more on the Regulars page. To spend it, put the regular on the check and choose the reward; "Take the reward off" gives the points back. The Regulars page lists everyone with their points and history.' },
      { title: 'Stock, costing and ordering', category: 'Stock', isFaq: false, sortOrder: 8, content: 'Stock: add what you buy as you buy it (a keg, a case of 24, a 750 ml bottle) with its price, its vendor and "Keep at least". Recipes & pours: say what each plate and pour uses, and you see what it costs and its cost percentage. When a delivery comes, "It came in". Do a count on your phone (Do a count), and the report shows what went missing in dollars. "Order what is below par" drafts the order to your rep.' },
      { title: 'The schedule and the time clock', category: 'Schedule', isFaq: true, sortOrder: 9, content: 'Schedule: build the week. Before you publish you see the gaps when nobody is on, anyone booked twice or on a day off you approved, each person\'s hours, the wages and the labor cost. "Publish this week" shares it; "Copy last week" starts the next one. Staff ask for a day off and a manager approves or denies it. On the bar tablet, tap "Clock in" on the Register (or "Time clock" on Schedule): each person clocks in and out with their own till PIN, and Time shows the hours.' },
      { title: 'Tonight and your website', category: 'Tonight', isFaq: false, sortOrder: 10, content: 'Tonight is your console for the night: kitchen and bar open, closed or closing early ("Open now", "Closed now", "Close at"), how busy it is, a note and tonight\'s special. Anything you change lasts until 4 AM and then goes back to your hours by itself. Mark an item 86 when you run out.' },
      { title: 'Parties and private events', category: 'Parties', isFaq: false, sortOrder: 11, content: 'Parties takes a private party from enquiry to booked: pick the date, the Space and the package, take a deposit and send the invoice. You start with one Space, the whole bar; add a back room or patio on the Spaces page. Party Packages are per-person menus with a minimum number of guests.' },
      { title: 'Your team and what each role can do', category: 'Team', isFaq: true, sortOrder: 12, content: 'Invite people from Settings > Users; they get an email to set their own password. Staff (bartenders) work the Register, the Grill, Tonight and the Regulars, and see their own shifts and clock. Managers can also void, close the night, run stock, gift cards, the schedule and reports. Admins and the owner also run the company settings and billing. Set each person\'s hourly rate on Team so the schedule shows wages.' },
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
