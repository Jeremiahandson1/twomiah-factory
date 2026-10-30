// Restaurant: restaurants, caterers, event venues and food trucks (templates/crm-restaurant; industryRouting.ts sends food
// trucks here with their own starting features). Two sides:
//   · PRIVATE EVENTS — an enquiry becomes a booking, the booking gets a menu and a banquet event order, deposits are
//     scheduled against the event's one invoice. Its events, rooms and catering packages are the events module
//     (server/crm/restaurant), which the bar shares.
//   · THE FOOD SIDE (2026-10-24) — the bar's menu, register and grill, Tonight's kitchen hours, and where switched on the
//     card reader, the order kiosk and online ordering for pickup (server/crm/bar), so a restaurant or a truck can run its
//     counter on Twomiah. The bar-only parts stay out unless switched on: long tabs (Register Settings) and draft taps
//     (the 'draft_taps' feature). Not table service or covers.
import type { StarterContent } from '../../server/core/starter.ts'
import type { VerticalSettings } from '../../server/core/vertical.ts'

// A venue files menus and floor plans, not permits and drawings (templates/crm-restaurant routes/documents.ts and
// frontend docsConfig.ts).
const DOC_TYPES = ['general', 'contract', 'menu', 'floor_plan', 'photo', 'invoice', 'receipt', 'other']

// What a new business finds in Help on day one (server/core/starter.ts; written once at provisioning, then the owner's).
// Its template's seeded articles, rewritten against the unified screens with every claim checked in the code
// (2026-10-19): the unified app had given every vertical the contractor CRM's articles, and the templates' own named
// contact tags, click-a-date booking, roles on the Team page and overdue reminders, none of which the app has.
const STARTER: StarterContent = {
  helpArticles: [
    { title: "Getting Started", category: "Getting Started", isFaq: true,
      content: "Welcome! Start by adding your rooms on the Spaces page and your packages on Catering Menus. Then log each inquiry on Events (New Inquiry) and move it through to a confirmed event. Use the menu on the left to move between pages." },
    { title: "Managing Events", category: "Events", isFaq: true,
      content: "Events run from Inquiry to Tentative to Confirmed to Completed; an event can also be marked Lost or Cancelled. Change the stage from the picker on the event. Click Edit to set the date, the space, the guest count and the coordinator. Use the Food & Beverage tab for the menu and the Run of Show tab for the timing." },
    { title: "Event Spaces", category: "Events", isFaq: false,
      content: "Add each bookable room with New Space on the Spaces page: seated and standing capacity, minimum spend and hire fee. An event booked in a space holds it once the event is Tentative or later, so the same space can't be double-booked. An inquiry doesn't hold the room." },
    { title: "Catering Menus", category: "Catering", isFaq: false,
      content: "Build per-head packages on the Catering Menus page (New Package), with the price per person, minimum guests and courses. On an event's Food & Beverage tab, click Add Line and pick a package. A per-person line starts at the event's guest count, and you can change the quantity." },
    { title: "Run of Show & BEO", category: "Events", isFaq: false,
      content: "On an event's Run of Show tab, click Add Step for each timed step (time, department, what happens). Print BEO opens the Banquet Event Order for the kitchen and the floor team to print." },
    { title: "The Register & the Grill", category: "Kitchen & Counter", isFaq: false,
      content: "Add your dishes on Menu (prices, sizes and add-ons like Add bacon). On the Register, tap New table or Walk-up, ring the items, and Send fires the food to the Grill screen as one ticket. Take cash or card. Set your kitchen hours under Hours & Settings, and close the kitchen for a night from Tonight." },
    { title: "Kiosk, Online Orders and Card Readers", category: "Kitchen & Counter", isFaq: false,
      content: "Each is switched on in Settings › Features. Register Settings adds a Stripe card reader by its pairing code (your Stripe account must be connected in Settings › Integrations), sets up the kiosk and online ordering for pickup, and takes your DoorDash and Uber Eats links for your website." },
    { title: "Deposits & Payments", category: "Billing", isFaq: false,
      content: "On an event's Payments tab, click Schedule Payment for each deposit or installment, with its amount and due date. The first one raises the event's invoice. Use Record payment as money comes in, and the tab shows what is still owed. If the space has a minimum spend, the event warns while food & beverage is below it." },
  ],
  // No price book in this vertical (featureRegistry: pricebook is not offered), so no categories.
  pricebookCategories: { byIndustry: {}, default: [] },
}

const restaurant: VerticalSettings = {
  id: 'restaurant',
  label: 'Restaurant & Events',
  vocabulary: { readyText: "we're ready for you.", customer: { one: 'guest', many: 'guests' }, work: null, team: { one: 'staff member', many: 'staff' }, reviewAfter: null, gallery: 'Gallery', customerCompany: true },
  // templates/crm-restaurant routes/mfa.ts
  mfaIssuer: 'Twomiah Events',
  featureSet: 'crm-restaurant',
  starter: STARTER,
  // The template's middleware/permissions.ts is the base CRM's, unchanged: no role labels or extra permissions.
  crm: {
    // The events dashboard in place of the jobs one, and the events module's hooks into contacts, invoices and Stripe.
    dashboard: 'events',
    events: true,
    // The food side: a restaurant's register rings walk-ups and tables until the owner turns long tabs on, and its tap
    // list needs 'draft_taps' as well as the menu (server/crm/bar barRegisterRoutes.ts, barRoutes.ts).
    foodService: { tabs: false, tapsFeature: 'draft_taps' },
    // No drawings to mark up (the template passed no plan-markup table).
    documents: { markup: false, types: DOC_TYPES },
    // A venue's enquiries come from wedding marketplaces, Google, Meta and its own site (routes/leads.ts); the same ids
    // as screens.leads.platforms.
    leads: { platforms: ['the_knot', 'weddingwire', 'google_business', 'instagram', 'website'] },
    // No technician's view in this CRM (no routes/tech.ts): the base checklist.
    tech: { checklistType: 'site_checklist', checklistTitle: 'Site checklist' },
    // The template's routes/portal.ts is the base CRM's.
    portal: { disable: ['service'] },
    // What the help assistant is told this software is: "You are a helpful support assistant for <this>" (routes/support.ts).
    support: {
      assistant: 'a private-events & catering CRM for a restaurant/venue. The app\'s features are: Events (an inquiry->confirmed pipeline), Event Spaces, Catering Menus, Run of Show / BEO, Deposits & Payments, Contacts, Invoices, and Reports. This app has NO "jobs", "projects", "quotes", or construction concepts — never suggest those. Answer from these features and the knowledge base articles provided.',
    },
  },
  // templates/crm-restaurant/frontend/src/*Config.ts
  screens: {
    // shellConfig.ts: the menu keeps the base CRM's words; the events items are crm/verticals/restaurant.tsx's.
    searchPlaceholder: 'Search events, contacts, the menu...',
    // The bar's food screens (crm/verticals/bar.tsx) in a restaurant's words; the tap list only with draft taps on.
    nav: { '/crm/bar-settings': 'Hours & Settings' },
    navSections: { 'The Bar': 'Kitchen & Counter' },
    navFeatures: { '/crm/taps': ['draft_taps'] },
    // Bar Settings without the bar's speakeasy door game (crm/pages/bar/BarSettingsPage.tsx), and no bar of its own: the
    // kitchen's hours alone there and on Tonight (TonightPage.tsx).
    foodService: { speakeasy: false, bar: false },
    // The food side's home (crm/pages/bar/HomePage.tsx): Tonight, today on the register and the party book, each by its
    // feature — the events dashboard alone showed no sales (bar live test, 2026-10-25).
    home: 'bar',
    contacts: {
      // A venue deals with clients and their vendors (florists, DJs, photographers) — not subcontractors. (T16/T17 L10)
      types: [{ value: 'lead', label: 'Lead' }, { value: 'client', label: 'Client' }, { value: 'vendor', label: 'Vendor' }],
      gateByFeature: true,
      // Projects, quotes and jobs are not offered to a venue (featureRegistry): no list, count or button for them.
      sections: { projects: false, quotes: false, events: true, portal: true },
      quickActions: [
        { label: 'Create Event', to: '/crm/events?contactId=:id', icon: 'event', feature: 'event_bookings' },
        { label: 'Create Invoice', to: '/crm/invoices?contactId=:id', icon: 'invoice', feature: 'invoices' },
      ],
    },
    jobs: {},
    // 'open' = an event's invoice: billed from its first scheduled payment, not yet emailed.
    invoicing: { clientLabel: 'Client', projects: false, jobs: false, extraInvoiceStatuses: ['open'], quoteNamePlaceholder: 'e.g. Webb anniversary dinner' },
    documents: { markup: false, projects: false, types: DOC_TYPES },
    import: {
      intro: 'Import contacts, events, spaces, menus and more from CSV files',
      types: [
        { id: 'contacts', label: 'Contacts', description: 'Import customers, vendors, and leads' },
        { id: 'projects', label: 'Projects', description: 'Import project records', feature: 'projects' },
        { id: 'jobs', label: 'Jobs', description: 'Import work orders and jobs', feature: 'jobs' },
        { id: 'events', label: 'Events', description: 'Import bookings, inquiries, and confirmed events', feature: 'event_bookings' },
        { id: 'spaces', label: 'Spaces', description: 'Import event spaces and their capacities', feature: 'event_bookings' },
        { id: 'menus', label: 'Menu Packages', description: 'Import per-person menu and catering packages', feature: 'event_bookings' },
        { id: 'products', label: 'Products/Services', description: 'Import products and service items' },
        { id: 'invoices', label: 'Invoices', description: 'Import invoices and open balances from your previous system or QuickBooks' },
      ],
    },
    migration: {},
    // An events venue reports on its bookings pipeline instead of jobs; the pipeline shows where event_bookings is on
    // (the template's ReportsDashboard.tsx set it from hasFeature). Team productivity reads time entries, and this CRM
    // has no time tracking. (T16/T17 L9)
    reporting: { jobsLabel: 'Jobs', jobs: false, quotes: false, projects: false, team: false, eventsPipeline: true, dealership: false },
    // The roster in a restaurant's words. It has no Time Tracking, pay run or job costing (featureRegistry), so nothing reads an
    // hourly rate here: no Rate column or box, and no "schedule and pay" (store gaps, item 2).
    team: { roleLabel: 'Role', rolePlaceholder: 'e.g. Event Coordinator', subtitle: 'The people who work in your restaurant.', hourlyRate: false },
    portal: {},
    leads: {
      platforms: [
        {
          value: 'the_knot', label: 'The Knot', color: '#1565c0', tone: 'blue', description: 'Forward The Knot inquiries into your Lead Inbox.',
          instructions: ['The Knot Pro → Settings → Notifications → turn on new-lead emails', 'Forward those emails to the inbound address below', 'Each inquiry becomes a lead with the couple\'s name, date and message'],
        },
        {
          value: 'weddingwire', label: 'WeddingWire', color: '#00897b', tone: 'emerald', description: 'Forward WeddingWire inquiries into your Lead Inbox.',
          instructions: ['WeddingWire for Vendors → Account → Notifications', 'Enable email alerts for new messages / requests', 'Forward those alerts to the inbound address below'],
        },
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
          value: 'website', label: 'Website contact form', color: '#2e7d32', tone: 'emerald', description: 'Every form submission on your website becomes a lead.',
          instructions: ["Point your website form's notification email at the inbound address below", 'Or use the webhook URL below with Zapier / Make from any form builder'],
        },
      ],
      jobTypeLabel: 'Event Type',
    },
    marketing: {},
    messages: {},
    reviews: {},
    settings: {
      // The Website admin in a restaurant's words, not a contractor's ("Photos of your real work", "Licenses, insurance and
    // certifications", "Finished work" — live test 2026-10-25).
    website: {
      gaps: {
        photos: { label: 'Photos of your food, your room and your events — three or more' },
        credentials: { label: 'Awards, press mentions or your food-safety rating', unlocks: 'A line guests read before they book or come in' },
      },
    },
      licenseNumber: false,
      // No pay run behind a restaurant (Time Tracking is not offered to it), so no "Work week starts on … Overtime is hours
      // over 40"; and its clock names what it keeps: no timesheets, online bookings or AI Receptionist (not offered to it).
      workWeek: false,
      timeZoneHint: 'The one clock for your restaurant: your opening hours, events, invoices and reports all keep time on it.',
      // The four rungs, described as what each does in a restaurant (the shared list said "view jobs, log time", live test
      // 2026-10-25). This replaces the shared list, so Viewer is repeated.
      roles: [
        { value: 'viewer', label: 'Viewer', description: 'read-only: can open any page but change nothing' },
        { value: 'field', label: 'Staff', description: 'the register, the grill and Tonight, and reading the events book; not settings, the team or billing' },
        { value: 'manager', label: 'Manager', description: 'events, deposits and invoices, the menu and register settings; not company settings or billing' },
        { value: 'admin', label: 'Admin', description: 'full access, including company settings and team' },
      ],
    },
    // Jobber import and Angi / Thumbtack / Local Services lead sources are field-service concepts (OnboardingWizard.tsx,
    // FIT-01/F14).
    onboarding: { integrations: ['dns', 'quickbooks', 'stripe', 'twilio'] },
  },
  // No premium site of its own: industryRouting.ts sends restaurants and venues to the showcase site
  // (templates/website-premium-showcase: its contact section and its empty-message reply).
  site: {
    design: 'showcase',
    // The menu entered on Menu, live on the website (server/crm/bar/barSite.ts createMenuSite): its own /menu page and
    // nav item while it has items, whether or not online ordering is on. Not the bar's taps or Tonight board.
    facts: 'menu',
    words: {
      contactAddressLabel: 'Address',
      contactMessageLabel: 'Your message',
      contactMessageRequired: 'Please write a short message.',
    },
  },
}

export default restaurant
