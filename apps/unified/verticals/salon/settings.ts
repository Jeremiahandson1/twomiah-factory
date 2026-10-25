// Salon & barber (templates/crm-salon): the retention model — a service menu, the book of appointments, the client's
// chart and colour formula record, rebooking reminders, memberships and loyalty. Its own modules are server/crm/salon;
// this file holds what the shared ones are switched to for a salon.
import type { StarterContent } from '../../server/core/starter.ts'
import type { VerticalSettings } from '../../server/core/vertical.ts'

const DOC_TYPES = ['general', 'consent_form', 'photo', 'invoice', 'receipt', 'contract', 'other']

// templates/crm-salon/frontend/src/leadsConfig.ts
const LEAD_PLATFORMS = [
  { value: 'google_business', label: 'Google Business Profile', color: '#c62828', tone: 'indigo', description: 'Turn Google messages and booking requests into leads in your Lead Inbox.', instructions: [
    'Google emails the profile owner for every new message or booking request', 'Forward those notification emails to the inbound address below',
    'Gmail: Settings › Filters › from:google.com "Business Profile" › Forward', "Each forwarded message becomes a lead with the sender's name and note" ] },
  { value: 'instagram', label: 'Instagram / Facebook', color: '#6a1b9a', tone: 'pink', description: 'Bring DMs and lead-form submissions from Meta into your CRM.', instructions: [
    'Meta emails you when someone messages your page or fills in a lead form', 'Forward those notification emails to the inbound address below',
    'Or connect a Zapier / Make zap from Meta Lead Ads to the webhook URL below' ] },
  { value: 'yelp', label: 'Yelp', color: '#e65100', tone: 'sky', description: 'Forward Yelp messages and requests into your Lead Inbox.', instructions: [
    'Yelp for Business → Account Settings → Notifications', 'Turn on email alerts for "Request a quote" / messages', 'Forward those alerts to the inbound address below' ] },
  { value: 'booking_app', label: 'Booksy / StyleSeat / Vagaro', color: '#1565c0', tone: 'blue', description: 'Keep every client who books through an app in one place.', instructions: [
    'In the booking app, turn on "new client" or "new booking" email notifications', 'Forward those emails to the inbound address below',
    'When you convert a lead, an existing client with the same phone or email is linked instead of duplicated' ] },
  { value: 'website', label: 'Website contact form', color: '#2e7d32', tone: 'emerald', description: 'Every form submission on your website becomes a lead.', instructions: [
    "Point your website form's notification email at the inbound address below", 'Or use the webhook URL below with Zapier / Make from any form builder' ] },
]

const CONTACT_TYPES = [{ value: 'lead', label: 'Lead' }, { value: 'client', label: 'Client' }, { value: 'vendor', label: 'Supplier' }]

// The expense categories a salon buys in (templates/crm-salon routes/expenses.ts and peopleConfig.ts: one list).
const EXPENSE_CATEGORIES = ['stock', 'retail', 'tools', 'rent', 'utilities', 'training', 'marketing', 'travel', 'other']
const EXPENSE_LABELS: Record<string, string> = { stock: 'Stock & colour', retail: 'Retail products', tools: 'Tools & equipment', rent: 'Rent & chair rental' }

// What a new business finds in Help on day one (server/core/starter.ts; written once at provisioning, then the owner's).
// Its template's seeded articles, rewritten against the unified screens with every claim checked in the code
// (2026-10-19): the unified app had given every vertical the contractor CRM's articles, and the templates' own named
// contact tags, click-a-date booking, roles on the Team page and overdue reminders, none of which the app has.
const STARTER: StarterContent = {
  helpArticles: [
    { title: "Getting Started", category: "Getting Started", isFaq: true,
      content: "Welcome! Start by adding clients on the Clients page, building your Service Menu, and taking bookings in The Book. Use the menu on the left to move between pages." },
    { title: "Client Profiles", category: "Getting Started", isFaq: false,
      content: "A client's profile holds their contact details, hair type, allergies and sensitivities, patch test date and preferences. Add one with New Client on the Clients page. Open a client to see their Formula History, Appointments and Memberships, and use New Service Record to log a visit and its formula." },
    { title: "Building your Service Menu", category: "Services", isFaq: false,
      content: "The Service Menu is your list of services. Click New Service and set its price, duration and Rebook (days), which is when a client is due back. These are the services you book in The Book and log on a visit. Tick \"Bookable online\" to show a service on your booking page." },
    { title: "Taking bookings in The Book", category: "Bookings", isFaq: true,
      content: "The Book is your appointment calendar. Click New Appointment and pick the client, service, stylist, time and chair. When the client arrives, Check In; afterwards, use Log Service to record what was done, then Complete. Reschedule moves an appointment. With Online Booking on, clients can book services you've marked bookable online." },
    { title: "Rebooking & Recall", category: "Bookings", isFaq: false,
      content: "The Rebooking page shows who is Due to Rebook (from each service's rebook days), Lapsed Clients and upcoming Birthdays. Select clients and click Send Text to invite them back." },
    { title: "Memberships", category: "Memberships", isFaq: false,
      content: "On the Memberships page, click New Plan for a recurring plan or prepaid package, with its price, billing and visit credits. Then Enroll Client: the first period is billed straight away and renewals are billed as they come due. When a member uses a visit, click Use a credit." },
    { title: "Invoices & Payments", category: "Billing", isFaq: false,
      content: "Create an invoice for a client from the Invoices page, add line items, and record payment. Track outstanding balances and send the invoice by email." },
    { title: "Marketing campaigns", category: "Marketing", isFaq: false,
      content: "On the Marketing page, click New Campaign and give it a name, a subject line, an audience and the email. Send it now or Schedule it. The list shows each campaign's recipients, opens and clicks." },
  ],
  // No price book in this vertical (featureRegistry: pricebook is not offered), so no categories.
  pricebookCategories: { byIndustry: {}, default: [] },
}

const salon: VerticalSettings = {
  id: 'salon',
  label: 'Salon',
  vocabulary: { customer: { one: 'client', many: 'clients' }, work: { one: 'appointment', many: 'appointments' }, team: { one: 'team member', many: 'team' }, reviewAfter: 'a visit is checked out', gallery: 'Gallery' },
  mfaIssuer: 'Twomiah Salon',
  featureSet: 'crm-salon',
  starter: STARTER,
  // templates/crm-salon middleware/permissions.ts (Salon T28 M3): the fifth rung is a stylist, the viewer the front desk.
  roleLabels: { field: 'Stylist', viewer: 'Front Desk' },
  // A stylist's day: take a booking, move it, check the client in, log the visit, add the client and keep their card up
  // to date; they check their own client out, so they enrol and redeem loyalty. The front desk is the till.
  extraRolePermissions: {
    field: ['contacts:create', 'contacts:update', 'schedule:create', 'schedule:update', 'sms:send', 'loyalty:enroll', 'loyalty:redeem'],
    viewer: ['loyalty:enroll', 'loyalty:redeem'],
  },
  // An online booking is at the salon: no address asked unless the owner says so, and it lands in The Book as an
  // appointment (templates/crm-salon routes/booking.ts: appointmentCalendar; server/crm/salon/onlineBooking.ts).
  booking: { requireAddress: false, calendar: 'chair' },
  crm: {
    documents: { markup: false, types: DOC_TYPES },
    tech: { checklistType: 'site_checklist', checklistTitle: 'Site checklist' },
    portal: { disable: ['projects', 'changeOrders', 'selections', 'projectFiles', 'collaborators', 'myJobs', 'service'] },
    dashboard: 'salon',
    leads: { platforms: LEAD_PLATFORMS.map((p) => p.value), contactType: 'client' },
    contacts: { guards: ['appointment', 'serviceRecord', 'membershipEnrollment'] },
    team: { assignedWork: ['appointment'] },
    invoices: { tips: true, accountBalance: true, clock: 'booking' },
    expenses: { categories: EXPENSE_CATEGORIES, categoryLabels: EXPENSE_LABELS },
    reports: { teamProductivity: 'serviceRecords' },
    reviews: { subject: 'visit' },
    appointmentReminders: true,
    help: {
      productNoun: 'a salon & spa management CRM',
      // The seeded articles' titles and the feature each describes (templates/crm-salon utils/helpArticles.ts).
      articleFeatures: {
        'Client Profiles': 'client_profiles', 'Building your Service Menu': 'service_menu', 'Taking bookings in The Book': 'salon_booking',
        'Rebooking & Recall': 'rebooking_reminders', Memberships: 'salon_memberships', 'Invoices & Payments': 'invoices',
        'Marketing campaigns': 'email_marketing',
      },
      topics: [
        ['client_profiles', 'Client Profiles (hair type, allergies, colour formula history)'],
        ['service_menu', 'the Service Menu'],
        ['salon_booking', 'The Book (appointment calendar)'],
        ['online_booking', 'online Booking'],
        ['rebooking_reminders', 'Rebooking & Recall'],
        ['salon_memberships', 'Memberships'],
        ['invoices', 'Invoices & Payments'],
        ['email_marketing', 'Marketing campaigns'],
        ['reports', 'Reports'],
      ],
      fallbackTopics: 'Client Profiles and the Service Menu',
      notOffered: 'This app has NO "jobs", "projects", "quotes", or "change orders" — never suggest those.',
    },
  },
  // templates/crm-salon/frontend/src/*Config.ts
  screens: {
    // The first-run wizard's integrations, by id (required: "absent, all" handed a salon Angi, Thumbtack and Jobber, 10/25).
    onboarding: { integrations: ['dns', 'quickbooks', 'stripe', 'twilio'] },
    // The salon's own dashboard at /crm/dashboard (crm/verticals/salon.tsx), reading /api/dashboard as crm.dashboard says.
    home: 'salon',
    nav: {},
    // The bar's Regulars (crm/verticals/bar.tsx) shows on loyalty_rewards, which the salon's own Loyalty shares; a
    // salon's programme is its Loyalty page, so the bar's is left out — as the bar leaves out this one (2026-10-21).
    navHidden: ['/crm/regulars'],
    searchPlaceholder: 'Search clients, services, invoices...',
    contacts: {
      types: CONTACT_TYPES,
      gateByFeature: true,
      // Projects, quotes and jobs are not offered to a salon (featureRegistry): no list, count or button for them.
      sections: { projects: false, quotes: false, portal: true },
      quickActions: [
        { label: 'Create Invoice', to: '/crm/invoices?contactId=:id', icon: 'invoice' },
      ],
    },
    jobs: {},
    invoicing: { clientLabel: 'Client', projects: false, jobs: false, tips: true, extraInvoiceStatuses: ['open'], quoteNamePlaceholder: 'e.g. Bridal party package' },
    documents: { types: DOC_TYPES },
    equipment: {},
    import: {
      intro: 'Import clients, services and invoices from CSV files',
      types: [
        { id: 'contacts', label: 'Clients', description: 'Import clients, leads and suppliers' },
        { id: 'products', label: 'Products/Services', description: 'Import your service menu and retail products' },
        { id: 'invoices', label: 'Invoices', description: 'Import invoices and open balances from your previous booking app or QuickBooks' },
      ],
      contactTypes: [{ value: 'client', label: 'Client' }, { value: 'lead', label: 'Lead' }, { value: 'vendor', label: 'Supplier' }],
    },
    migration: { entityLabels: { contacts: 'Clients', products: 'Services & Products' } },
    integrations: {
      callTracking: true,
    },
    pricebook: {},
    reporting: { jobsLabel: 'Appointments', jobs: false, quotes: false, projects: false, team: true, eventsPipeline: false, dealership: false },
    dashboard: {},
    jobCosting: {},
    time: {},
    expenses: { categories: EXPENSE_CATEGORIES.map((value) => ({ value, label: EXPENSE_LABELS[value] || value.charAt(0).toUpperCase() + value.slice(1) })) },
    team: { roleLabel: 'Role / Specialty', rolePlaceholder: 'e.g. Senior Stylist' },
    agreements: {},
    fleet: {},
    commissions: {},
    portal: {
      providerNoun: 'salon',
      clientNav: ['invoices', 'paymentMethods', 'messages'],
      collaboratorNav: ['sharedDocuments', 'messages'],
      reviewerNav: ['messages'],
    },
    leads: { platforms: LEAD_PLATFORMS, jobTypeLabel: 'Service', sourcesSubtitle: 'Where new-client inquiries arrive: Google, Meta, Yelp, booking apps and your website' },
    marketing: { contactTypes: CONTACT_TYPES },
    messages: {},
    reviews: {},
    booking: { calendarLabel: 'Appointment', calendarPath: '/crm/appointments', serviceMenuPath: '/crm/service-menu', concurrentLabel: 'Chairs bookable at once', concurrentHelp: 'Online bookings per time slot — the number of stylists taking online clients. Desk bookings count too.' },
    settings: {
      roles: [
        // Front Desk holds loyalty:enroll and loyalty:redeem (extraRolePermissions): "change nothing" was untrue (salon run 10/25).
        { value: 'viewer', label: 'Viewer', description: 'the front desk: opens the book and records, signs clients up for loyalty and redeems their rewards; changes nothing else' },
        { value: 'field', label: 'Stylist', description: 'the book, clients and service records; no invoices or settings' },
        { value: 'manager', label: 'Manager', description: 'everything staff can do plus invoices, reports and the team; not company settings' },
        { value: 'admin', label: 'Admin', description: 'full access, including company settings and team' },
      ],
      licenseNumber: false,
    },
    tech: {},
  },
  // No salon website template: a salon was routed to website-premium-showcase (apps/api industryRouting.ts).
  site: {
    design: 'showcase',
    words: {
      contactAddressLabel: 'Address',
      contactMessageLabel: 'Your message',
      contactMessageRequired: 'Please include a message.',
    },
  },
}

export default salon
