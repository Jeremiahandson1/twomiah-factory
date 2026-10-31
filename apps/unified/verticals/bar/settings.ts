// Bar: a bar and grill's CRM (templates/crm-bar) — the night (Tonight, the menu and taps, what's on), the register and
// the grill screen, close-outs, stock and purchasing, the schedule and the time clock, gift cards, the Regulars, and
// private parties (the restaurant's events module, server/crm/restaurant, which the bar shares). The template was
// crm-basic's copy made into a bar's, so the basic CRM's field modules are still in it, never offered to a bar (the
// registry gives crm-bar no jobs, quotes, scheduling, fleet or equipment); their switches follow the template anyway.
import type { StarterContent } from '../../server/core/starter.ts'
import type { VerticalSettings } from '../../server/core/vertical.ts'

// Permits and drawings are a builder's paperwork (templates/crm-bar routes/documents.ts and docsConfig.ts, T43).
const DOC_TYPES = ['general', 'contract', 'photo', 'invoice', 'receipt', 'other']

// What a new business finds in Help on day one (server/core/starter.ts; written once at provisioning, then the owner's).
// Its template's seeded articles, rewritten against the unified screens with every claim checked in the code
// (2026-10-19): the unified app had given every vertical the contractor CRM's articles, and the templates' own named
// contact tags, click-a-date booking, roles on the Team page and overdue reminders, none of which the app has.
const STARTER: StarterContent = {
  helpArticles: [
    { title: "Getting started", category: "Getting Started", isFaq: true,
      content: "Do these in order and you can ring up a check today. 1) Settings > Company: set your sales tax rate. 2) Bar Settings: your bar and kitchen hours. 3) Menu: make a section for food and one for drinks, then add your items with their prices; for food, say how many minutes it takes on the grill. 4) Taps: add each tap line, the beer and the price of a pour. 5) Settings > Users: invite your managers and bartenders. 6) Each person opens the Register and uses \"Set my till PIN\". Then open a tab on the Register and try it." },
    { title: "The Register: tabs, tables and paying", category: "Register", isFaq: true,
      content: "Open a check with New tab (by name), New table, or Walk-up, then tap items to add them. Send sends food to the grill; drinks don't go unless an item is set to. \"Fire just this\" sends one item and holds the rest. To pay:\n• Card: record it after you run it on your card reader.\n• Cash: type what was handed over and the screen shows the change.\n• Gift card.\n\nAdd the tip when you pay. Split moves items onto a new check, By seat splits a table by seat, and \"Split evenly\" is in the pay screen. The pencil on a check renames it or moves it." },
    { title: "Voids and the manager PIN", category: "Register", isFaq: true,
      content: "Anything not sent yet can be taken off by anyone. Once food or a drink has been sent, or a payment taken, a void needs a manager: the bartender's screen asks for a manager's till PIN, and the record shows both names and the reason. A manager signed in does it straight away. Set your PIN with \"Set my till PIN\" on the Register; nobody else here can use the same one." },
    { title: "The grill screen", category: "Grill", isFaq: false,
      content: "On the screen by the grill, open the Register and tap Grill screen. Each ticket shows where it goes, how long it has waited, and a cue that paces it (\"Wings on now · Cheeseburger in 2 · Fries in 8\") so everything is ready together. \"On now\" and \"All day\" at the top count what to start now and everything still to come. Tap Up when a ticket is ready; \"Bring back\" puts it back if you were early. The Register shows \"Food's up\"." },
    { title: "Closing the night", category: "Close-out", isFaq: true,
      content: "A night runs 4 AM to 4 AM, so a 1 AM sale counts toward tonight. Open Close-out from the Register. It shows the night's sales, tax, tips by person, voids, what sold, and how checks were paid. Type your starting float and what is counted in the drawer, and it shows over or short. \"Close the night\" records it and emails it to the bar. If a check is still open, close it first, or \"Close the night anyway\" and it counts on the night it is paid. A bartender needs a manager's till PIN to close." },
    { title: "Gift cards", category: "Gift Cards", isFaq: false,
      content: "Sell a gift card from the Register (\"Sell a gift card\"). It is issued when that check is paid, with no tax. Spend it like cash with Gift card when paying; anything left stays on the card. On the Gift Cards page, \"Find a card\" shows a card's balance and its ledger. A manager can correct the balance (with a reason) or void the card. Cards never expire and carry no fees." },
    { title: "The Regulars (loyalty)", category: "Regulars", isFaq: true,
      content: "Add a regular at the Register: \"Add a guest\", then \"Add a regular\" with a name and phone number. They earn points on what they spend on food and drink, never tax, tips or gift cards, at 1 point a dollar to start. Add rewards on the Regulars page (Reward); until there is one, a regular has nothing to spend points on. To spend points, put the regular on the check and tap the reward. \"Take the reward off\" gives the points back. The Regulars page lists everyone with their points and history." },
    { title: "Stock, costing and ordering", category: "Stock", isFaq: false,
      content: "On Stock, add what you buy with \"Stock item\" (a keg, a case of 24, a 750 ml bottle), with its price, vendor and \"Keep at least\". Under Recipes & pours, say what each plate and pour uses, and you see its cost and cost percentage. Do a count on your phone with \"Do a count\"; the Counts tab's Report shows what is unaccounted for. On Orders, \"Order what is below par\" drafts the order, and \"It came in\" receives it." },
    { title: "The schedule and the time clock", category: "Schedule", isFaq: true,
      content: "Schedule: build the week. Before you publish you see the gaps when nobody is on, anyone booked twice or on a day off you approved, each person's hours, the wages and the labor cost. \"Publish this week\" shares it; \"Copy last week\" starts the next one. Staff ask for a day off and a manager approves or denies it. On the bar tablet, tap \"Clock in\" on the Register (or \"Time clock\" on Schedule): each person clocks in and out with their own till PIN, and Time shows the hours." },
    { title: "Tonight and your website", category: "Tonight", isFaq: false,
      content: "Tonight is your console for the night: kitchen and bar open, closed or closing early (\"Open now\", \"Closed now\", \"Close at\"), how busy it is, a note and tonight's special. Anything you change lasts until 4 AM and then goes back to your hours by itself. Mark an item 86 when you run out." },
    { title: "Parties and private events", category: "Parties", isFaq: false,
      content: "Parties takes a private party from inquiry to booked. Click New Inquiry and pick the date and the Space. On the party, add a Party Package on the Food & Beverage tab (Add Line). On the Payments tab, Schedule Payment for the deposit; this raises the party's invoice, which you send from Invoices. Add your rooms (the whole bar, a back room, the patio) on the Spaces page. Party Packages are per-person menus with a minimum number of guests." },
    { title: "Your team and what each role can do", category: "Team", isFaq: true,
      content: "Invite people from Settings > Users; they get an email to set their own password. Staff (bartenders) work the Register, the Grill, Tonight and the Regulars, and see their own shifts and clock. Managers can also void, close the night, run stock, gift cards, the schedule and reports. Admins and the owner also run the company settings and billing. Set each person's hourly rate on Team so the schedule shows wages." },
  ],
  // No price book in this vertical (featureRegistry: pricebook is not offered), so no categories.
  pricebookCategories: { byIndustry: {}, default: [] },
}

const bar: VerticalSettings = {
  id: 'bar',
  label: 'Bar & Grill',
  vocabulary: { readyText: 'your table is ready.', customer: { one: 'guest', many: 'guests' }, work: null, team: { one: 'staff member', many: 'staff' }, reviewAfter: null, gallery: 'Gallery', customerCompany: false },
  // The template named itself 'Twomiah CRM' because crm-basic served three verticals (routes/mfa.ts, T41); this one is a bar's.
  mfaIssuer: 'Twomiah Bar',
  featureSet: 'crm-bar',
  starter: STARTER,
  // templates/crm-bar middleware/permissions.ts: the 1:1 text box is for the person on their way (T30 L-RB), and the
  // Regulars at the register — the bartender adds a regular and spends their reward, the same two grants the salon
  // gives its stylists. Correcting points and changing the programme stay a manager's.
  extraRolePermissions: { field: ['sms:send', 'loyalty:enroll', 'loyalty:redeem'] },
  crm: {
    // What a bar buys in (packages/tenant-backend expenses.ts validates against it): the shared list was a contractor's —
    // Materials, Equipment, Labor, Travel (bar live test, 2026-10-25).
    expenses: {
      categories: ['food', 'drink', 'supplies', 'repairs', 'utilities', 'rent', 'marketing', 'licenses', 'other'],
      categoryLabels: { food: 'Food stock', drink: 'Beer, wine & spirits', supplies: 'Supplies & smallwares', repairs: 'Repairs & maintenance', licenses: 'Licenses & permits' },
    },
    // The party request and the Regulars sign-up (crm/bar/enquiry.ts; templates/crm-bar routes/webhooks.ts).
    websiteForms: 'bar',
    // crm-basic's switches, as the copy kept them (routes/contacts, jobs, quotes, equipment, agreements, services/fleet).
    serviceSites: true,
    jobs: { photos: true, textArrival: true },
    quotes: { textOnSend: true },
    documents: { markup: false, types: DOC_TYPES },
    agreements: { recurrence: true },
    fleet: { gps: true },
    // Not the trades' marketplaces (routes/leads.ts, T42). Same ids as screens.leads.platforms.
    leads: { platforms: ['google_business', 'instagram', 'yelp', 'website'] },
    // No technician's view in this copy (no routes/tech.ts): the base checklist.
    tech: { checklistType: 'site_checklist', checklistTitle: 'Site checklist' },
    portal: { disable: ['collaborators', 'projects', 'changeOrders', 'selections', 'projectFiles', 'sharedDocuments'] },
    // Private parties: the events dashboard at home (routes/dashboard.ts), and the events module's hooks into contacts,
    // invoices and Stripe (routes/contacts.ts, invoices.ts, services/stripe.ts) — the restaurant's, byte for byte.
    dashboard: 'events',
    events: true,
    // /api/loyalty is the bar's Regulars (routes/barLoyalty.ts), not the salon's programme.
    loyalty: 'bar',
  },
  // A bar takes its bookings at its own door (templates/crm-bar routes/booking.ts, T42, crm-basic's).
  booking: { requireAddress: false },
  // templates/crm-bar/frontend/src/*Config.ts
  screens: {
    // shellConfig.ts: the menu in a bar's words (the bar's own items are crm/verticals/bar.tsx; the party screens are the
    // restaurant's, by the same features). The salon's Loyalty item shows on the same feature (loyalty_rewards), but a
    // bar's programme is the Regulars, so it is left out.
    nav: { '/crm/contacts': 'Guests', '/crm/events': 'Parties', '/crm/menus': 'Party Packages' },
    navSections: { Events: 'Parties' },
    navHidden: ['/crm/loyalty'],
    searchPlaceholder: 'Search guests, the menu, parties...',
    // The bar's home (crm/verticals/bar.tsx dashboard): Tonight at a glance above the party book.
    home: 'bar',
    // Its nights' sales above the shared Reports page (crm/verticals/bar.tsx reportsAbove; ReportsDashboard.tsx).
    reportsAbove: 'bar',
    contacts: {
      // The sidebar calls this page Guests, and so do its heading and its button (Bar Runs 1 and 2).
      title: 'Guests',
      addLabel: 'Guest',
      // Guests (regulars, party hosts), leads (a party enquiry not yet booked), and suppliers (distributors, the brewery
      // reps). A supplier is stored as `vendor`, so nothing saved under crm-basic's set changes.
      types: [{ value: 'client', label: 'Guest' }, { value: 'lead', label: 'Lead' }, { value: 'vendor', label: 'Supplier' }],
      // The parties list on a guest, texting, and none of crm-basic's field set (sites, equipment) — a guest has neither.
      gateByFeature: true,
      sections: { events: true, sms: true },
      // No portal panel: it follows client_portal, as the server's switches do, and a bar is not offered the portal (it
      // was shown regardless — portalGate: false — and its switch refused the owner; live sweep 2026-10-21).
      quickActions: [
        { label: 'Book a party', to: '/crm/events?contactId=:id', icon: 'event', feature: 'event_bookings' },
        { label: 'Create Invoice', to: '/crm/invoices?contactId=:id', icon: 'invoice', feature: 'invoices' },
      ],
    },
    jobs: { labels: { singular: 'Job', plural: 'Jobs', add: 'New Job' }, equipment: true, sites: true, photos: true },
    // A bar invoices guests for private parties (the events ledger): no jobs, no projects. 'open' = a party's invoice,
    // billed from its first scheduled payment, not yet emailed.
    invoicing: { clientLabel: 'Guest', projects: false, jobs: false, extraInvoiceStatuses: ['open'], quickbooks: true, quoteNamePlaceholder: 'e.g. Packers party, back room' },
    documents: { markup: false, projects: false, types: DOC_TYPES },
    equipment: {
      contacts: true, sites: true, linkedJobs: true,
      categories: [
        { name: 'Power tools', icon: 'tool' }, { name: 'Heavy equipment', icon: 'mower' }, { name: 'Trucks & trailers', icon: 'truck' },
        { name: 'HVAC', icon: 'hvac' }, { name: 'Plumbing', icon: 'plumbing' }, { name: 'Electrical', icon: 'electrical' },
      ],
    },
    import: {
      types: [
        { id: 'contacts', label: 'Contacts', description: 'Import customers, vendors, and leads' },
        { id: 'projects', label: 'Projects', description: 'Import project records', feature: 'projects' },
        { id: 'jobs', label: 'Jobs', description: 'Import work orders and jobs', feature: 'jobs' },
        { id: 'products', label: 'Products/Services', description: 'Import products and service items' },
        { id: 'invoices', label: 'Invoices', description: 'Import invoices and open balances from Jobber, HousecallPro or QuickBooks' },
      ],
    },
    migration: { entityLabels: { jobs: 'Jobs & Work Orders' } },
    pricebook: { tiersTitle: 'Good-Better-Best options' },
    // A bar reports its nights (the register's sales, above the shared page — reportsAbove) and its
    // parties' pipeline; no jobs, quotes, projects, and no jobs-per-person panel (tips by person are in the sales).
    reporting: { jobsLabel: 'Jobs', jobs: false, quotes: false, projects: false, team: false, eventsPipeline: true, dealership: false },
    dashboard: { jobsLabel: 'Jobs', todayBoard: true, projects: false },
    jobCosting: { jobsLabel: 'Jobs', costingLabel: 'Job Costing' },
    // A bar pays its hours and never bills them, and has no jobs to log them against (Bar Run 1).
    time: { jobsFeature: 'jobs', billable: false, subtitle: 'Clock in on the bar tablet with your till PIN, or log hours by hand' },
    expenses: {},
    // The column was the shared default, "Job Title / Trade" (Bar Run 2).
    team: { roleLabel: 'Position', rolePlaceholder: 'e.g. Bartender, line cook', subtitle: 'The people who work in your bar.' },
    agreements: { recurrence: true },
    fleet: { gps: true },
    // The four stored keys in a bar's words: nobody here is a tech (T51).
    commissions: { roleWords: { technician: 'Staff', sales_rep: 'Sales', manager: 'Managers', all: 'Everyone' }, planExample: 'Standard staff plan' },
    portal: {
      providerNoun: 'service team',
      clientNav: ['myJobs', 'quotes', 'invoices', 'paymentMethods', 'equipment', 'agreements', 'serviceRequest', 'messages'],
      collaboratorNav: ['messages'],
      reviewerNav: ['messages'],
      labels: { myJobs: 'Jobs', agreements: 'Maintenance Plans' },
    },
    leads: {
      platforms: [
        {
          value: 'google_business', label: 'Google Business Profile', color: '#c62828', tone: 'indigo', description: 'Turn Google messages and booking requests into leads in your Lead Inbox.',
          instructions: [
            'Google emails the profile owner for every new message or booking request', 'Forward those notification emails to the inbound address below',
            'Gmail: Settings › Filters › from:google.com "Business Profile" › Forward', "Each forwarded message becomes a lead with the sender's name and note",
          ],
        },
        {
          value: 'instagram', label: 'Instagram / Facebook', color: '#6a1b9a', tone: 'pink', description: 'Bring DMs and lead-form submissions from Meta into your CRM.',
          instructions: [
            'Meta emails you when someone messages your page or fills in a lead form', 'Forward those notification emails to the inbound address below',
            'Or connect a Zapier / Make zap from Meta Lead Ads to the webhook URL below',
          ],
        },
        {
          value: 'yelp', label: 'Yelp', color: '#e65100', tone: 'sky', description: 'Forward Yelp messages and requests into your Lead Inbox.',
          instructions: ['Yelp for Business → Account Settings → Notifications', 'Turn on email alerts for "Request a quote" / messages', 'Forward those alerts to the inbound address below'],
        },
        {
          value: 'website', label: 'Website contact form', color: '#2e7d32', tone: 'emerald', description: 'Every form submission on your website becomes a lead.',
          instructions: ["Point your website form's notification email at the inbound address below", 'Or use the webhook URL below with Zapier / Make from any form builder'],
        },
      ],
      jobTypeLabel: 'Service',
      sourcesSubtitle: 'Where new inquiries arrive: Google, Meta, Yelp and your website',
    },
    marketing: {},
    messages: {},
    reviews: {},
    // The Website admin in a bar's words, not a contractor's (the restaurant's live test, 2026-10-25).
    website: {
      gaps: {
        photos: { label: 'Photos of your bar, your food and your nights — three or more' },
        credentials: { label: 'Awards or press mentions', unlocks: 'A line guests read before they come in' },
      },
    },
    settings: {
      // No trade licence behind a bar (settingsConfig.ts, T41).
      licenseNumber: false,
      // A bar keeps timesheets and a pay week (Time Tracking is offered to it), so the work week stays; its clock sentence
      // drops "online bookings", which a bar does not have (store gaps, item 2).
      timeZoneHint: 'The one clock for your bar: your hours, reports, invoices, timesheets and the AI Receptionist all keep time on it.',
      // The same four rungs and words, described as what each does behind a bar (Bar Run 1). This replaces the shared
      // list, so Viewer is repeated or the bar could not hand out read-only access.
      roles: [
        { value: 'viewer', label: 'Viewer', description: 'read-only: can open any page but change nothing' },
        { value: 'field', label: 'Staff', description: 'the register, the grill, Tonight, the Regulars, and their own shifts and clock; no stock, gift cards, reports or pay' },
        { value: 'manager', label: 'Manager', description: 'everything staff can do plus voids and the close-out, stock, gift cards, the schedule and reports; not company settings or billing' },
        { value: 'admin', label: 'Admin', description: 'full access, including company settings and team' },
      ],
    },
    // No Jobber export and no Angi account behind a bar: the domain, QuickBooks, Stripe and texting (OnboardingWizard.tsx, T41).
    onboarding: { integrations: ['dns', 'quickbooks', 'stripe', 'twilio'] },
  },
  // The bar's own site, templates/website-premium-bar: its leather-book design, and its sections reading the night
  // (the Tonight board, the menu and taps, hours, what's on) straight from the bar add-on. Its contact section says
  // Address, asks for "Your message", and answers an empty one with "Please write a short message."
  site: {
    design: 'bar',
    facts: 'bar',
    // The header's Visit button (templates/website-premium-bar base.ejs).
    ctaHref: '/visit',
    words: {
      contactAddressLabel: 'Address',
      contactMessageLabel: 'Your message',
      contactMessageRequired: 'Please write a short message.',
    },
  },
}

export default bar
