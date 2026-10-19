// Salon & barber (templates/crm-salon): the retention model — a service menu, the book of appointments, the client's
// chart and colour formula record, rebooking reminders, memberships and loyalty. Its own modules are server/crm/salon;
// this file holds what the shared ones are switched to for a salon.
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
  { value: 'yelp', label: 'Yelp', color: '#e65100', tone: 'sky', description: 'Forward Yelp quote requests and messages into your Lead Inbox.', instructions: [
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

const salon: VerticalSettings = {
  id: 'salon',
  label: 'Salon',
  mfaIssuer: 'Twomiah Salon',
  featureSet: 'crm-salon',
  // templates/crm-salon middleware/permissions.ts (Salon T28 M3): the fifth rung is a stylist, the viewer the front desk.
  roleLabels: { field: 'Stylist', viewer: 'Front Desk' },
  // A stylist's day: take a booking, move it, check the client in, log the visit, add the client and keep their card up
  // to date; they check their own client out, so they enrol and redeem loyalty. The front desk is the till.
  extraRolePermissions: {
    field: ['contacts:create', 'contacts:update', 'schedule:create', 'schedule:update', 'sms:send', 'loyalty:enroll', 'loyalty:redeem'],
    viewer: ['loyalty:enroll', 'loyalty:redeem'],
  },
  // An online booking is at the salon: no address asked unless the owner says so (templates/crm-salon routes/booking.ts).
  booking: { requireAddress: false },
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
    // The salon's own dashboard at /crm/dashboard (crm/verticals/salon.tsx), reading /api/dashboard as crm.dashboard says.
    home: 'salon',
    nav: {},
    searchPlaceholder: 'Search clients, services, invoices...',
    contacts: {
      types: CONTACT_TYPES,
      gateByFeature: true,
      sections: { projects: true, quotes: true, portal: true },
      quickActions: [
        { label: 'Create Quote', to: '/crm/quotes?contactId=:id', icon: 'quote', feature: 'quotes' },
        { label: 'Schedule Job', to: '/crm/jobs?contactId=:id', icon: 'job', feature: 'jobs' },
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
      copy: { quickbooks: 'Sync invoices, payments and clients with your books.', sms: 'Send appointment reminders and updates to clients and stylists.', email: 'Send invoices, receipts and reminders by email.' },
    },
    pricebook: {},
    reporting: { jobsLabel: 'Appointments', jobs: false, quotes: false, projects: false, team: true, eventsPipeline: false, dealership: false },
    dashboard: {},
    jobCosting: {},
    time: { jobLabel: 'Appointment' },
    expenses: { jobLabel: 'Appointment', categories: EXPENSE_CATEGORIES.map((value) => ({ value, label: EXPENSE_LABELS[value] || value.charAt(0).toUpperCase() + value.slice(1) })) },
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
    leads: { platforms: LEAD_PLATFORMS, jobTypeLabel: 'Service', sourcesSubtitle: 'Where new-client enquiries arrive: Google, Meta, Yelp, booking apps and your website' },
    marketing: { contactTypes: CONTACT_TYPES },
    messages: {},
    reviews: { subtitle: 'Automatically ask clients for a Google review after their visit', subjectLabel: 'Visit', autoRequestHelp: 'Automatically request a review after each completed visit (one per client per month)', emptyHelp: 'Requests are created automatically after completed visits' },
    booking: { calendarLabel: 'Appointment', calendarPath: '/crm/appointments', serviceMenuPath: '/crm/service-menu', concurrentLabel: 'Chairs bookable at once', concurrentHelp: 'Online bookings per time slot — the number of stylists taking online clients. Desk bookings count too.' },
    settings: {
      roles: [
        { value: 'viewer', label: 'Viewer', description: 'read-only: can open the book and records but change nothing' },
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
