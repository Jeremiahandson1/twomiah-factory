// Veterinary practices (templates/crm-vet). A retention business, not a job-based one: owners and their patients,
// the day's appointments, visits with their SOAP notes and charges, vaccinations whose due dates drive recall, and
// wellness plans billed monthly. No jobs, quotes or projects.
import type { StarterContent } from '../../server/core/starter.ts'
import type { VerticalSettings } from '../../server/core/vertical.ts'

const DOC_TYPES = ['general', 'consent_form', 'medical_record', 'lab_result', 'photo', 'invoice', 'receipt', 'other']

// The lead platforms a practice is offered (templates/crm-vet routes/leads.ts and frontend/src/leadsConfig.ts).
const LEAD_PLATFORMS = [
  { value: 'google_business', label: 'Google Business Profile', color: '#c62828', tone: 'indigo', description: 'Turn Google messages and booking requests into leads in your Lead Inbox.', instructions: [
    'Google emails the profile owner for every new message or booking request', 'Forward those notification emails to the inbound address below',
    'Gmail: Settings › Filters › from:google.com "Business Profile" › Forward', "Each forwarded message becomes a lead with the sender's name and note"] },
  { value: 'yelp', label: 'Yelp', color: '#e65100', tone: 'sky', description: 'Forward Yelp quote requests and messages into your Lead Inbox.', instructions: [
    'Yelp for Business → Account Settings → Notifications', 'Turn on email alerts for "Request a quote" / messages', 'Forward those alerts to the inbound address below'] },
  { value: 'instagram', label: 'Instagram / Facebook', color: '#6a1b9a', tone: 'pink', description: 'Bring DMs and lead-form submissions from Meta into your CRM.', instructions: [
    'Meta emails you when someone messages your page or fills in a lead form', 'Forward those notification emails to the inbound address below',
    'Or connect a Zapier / Make zap from Meta Lead Ads to the webhook URL below'] },
  { value: 'website', label: 'Website contact form', color: '#2e7d32', tone: 'emerald', description: 'Every form submission on your website becomes a lead.', instructions: [
    "Point your website form's notification email at the inbound address below", 'Or use the webhook URL below with Zapier / Make from any form builder'] },
]

// What a new business finds in Help on day one (server/core/starter.ts; written once at provisioning, then the owner's).
// Its template's seeded articles, rewritten against the unified screens with every claim checked in the code
// (2026-10-19): the unified app had given every vertical the contractor CRM's articles, and the templates' own named
// contact tags, click-a-date booking, roles on the Team page and overdue reminders, none of which the app has.
const STARTER: StarterContent = {
  helpArticles: [
    { title: "Getting Started", category: "Getting Started", isFaq: true,
      content: "Welcome! Start by adding pet owners on the Owners page and their pets on Patients. Then book on Appointments and record each visit on the patient's Visits tab. Use the menu on the left to move between pages." },
    { title: "Patient Records", category: "Patients", isFaq: false,
      content: "Each patient has a chart with Visits (including SOAP notes), Vaccinations, Prescriptions, Lab Results, Documents and Invoices. Open a patient from the Patients page, or from the owner's page." },
    { title: "Vaccinations & Reminders", category: "Patients", isFaq: true,
      content: "Click Add Vaccine on a patient and enter the given date and due date. The Reminders page shows Vaccines Due and Lapsed Clients. Switch on Automatic reminders there and each owner is texted once about every vaccine coming due, on your clinic's clock; or select owners and Send Reminder to text them yourself. Owners who replied STOP are not texted." },
    { title: "Appointments", category: "Appointments", isFaq: false,
      content: "Click New Appointment on the Appointments page and pick the patient, type, provider, time and room. Use Check In when they arrive, Start when they go in, and Complete when done. Record the care with New Visit on the patient." },
    { title: "Wellness Plans", category: "Wellness", isFaq: false,
      content: "On the Wellness Plans page, click New Plan with its monthly and annual price and its benefits. Then Enroll Patient: the first period is billed straight away and renewals are billed as they come due." },
    { title: "Invoices & Payments", category: "Billing", isFaq: false,
      content: "Create an invoice for an owner on the Invoices page, add your line items, and Record Payment. Each invoice shows its Balance Due, and Send emails it. A patient's Invoices tab shows their invoices." },
  ],
  // No price book in this vertical (featureRegistry: pricebook is not offered), so no categories.
  pricebookCategories: { byIndustry: {}, default: [] },
}

const vet: VerticalSettings = {
  id: 'vet',
  label: 'Veterinary',
  mfaIssuer: 'Twomiah Veterinary',
  featureSet: 'crm-vet',
  starter: STARTER,
  // templates/crm-vet middleware/permissions.ts. Clinical staff (technician, receptionist) record care and bill for
  // it: patients, visits, vaccinations, appointments and wellness all ask contacts:* (R2-02); they text the owner
  // themselves (T30 L-RB). They do not see practice revenue (revenue:read, T62). schedule:create: the desk books the
  // appointment, so it says which vet takes it — the provider list is GET /api/team/assignable (team:read or
  // schedule:create, names only), as salon's stylists and RV's floor book; it was refused them, and the refusal took
  // New Appointment's patient list with it (live sweep, 2026-10-21). A vet has no Schedule page (no 'scheduling').
  extraRolePermissions: { field: ['contacts:create', 'contacts:update', 'invoices:read', 'invoices:create', 'invoices:update', 'sms:send', 'schedule:create'] },
  // The clinic's older seat name.
  roleMapping: { staff: 'field' },
  // A pet owner booking online is not asked for an address, is asked for the pet, and the booking becomes the pet's chart
  // and an appointment in the practice's book (templates/crm-vet routes/booking.ts: requireAddress: false, requirePet,
  // appointmentCalendar with its patient).
  booking: { requireAddress: false, calendar: 'practice', requirePet: true },
  crm: {
    patients: true,
    dashboard: 'practice',
    appointments: 'practice',
    // A clinic files against the animal: an x-ray, a referral letter, a vaccination certificate (Vet T12 M6).
    documents: { markup: false, types: DOC_TYPES },
    leads: { platforms: LEAD_PLATFORMS.map((p) => p.value) },
    // No field view in a clinic; the base checklist stays as the engine's default.
    tech: { checklistType: 'site_checklist', checklistTitle: 'Site checklist' },
    portal: { disable: ['projects', 'changeOrders', 'selections', 'projectFiles', 'collaborators', 'myJobs', 'service'] },
    support: {
      assistant: 'a veterinary practice management CRM. The app\'s features are: Patients (medical records, vaccinations, prescriptions, lab results), Clients (pet owners), Appointments, Reminders, Wellness Plans, Invoices & Payments, and Reports. This app has NO "jobs", "projects", or "quotes", and patients are a core feature (not just "contacts") — never say patients don\'t exist. Answer from these features and the knowledge base articles provided.',
    },
  },
  // templates/crm-vet/frontend/src/*Config.ts
  screens: {
    // The menu in a clinic's words, by page address.
    nav: { '/crm/contacts': 'Owners' },
    searchPlaceholder: 'Search patients, owners, invoices...',
    contacts: {
      // A clinic has owners, not "contacts", and no subcontractors at all (Vet T12 M11).
      title: 'Owners',
      types: [{ value: 'client', label: 'Owner' }, { value: 'lead', label: 'Enquiry' }, { value: 'vendor', label: 'Supplier' }],
      convertLabel: 'Owner',
      addLabel: 'Owner',
      sections: { patients: true, projects: false, quotes: false, portal: true },
      quickActions: [
        { label: 'Patients', to: '/crm/patients', icon: 'patients' },
        // Booking is a write: POST /api/appointments asks contacts:create (T68).
        // ?ownerId= opens New Appointment for this owner (crm/pages/vet/AppointmentsPage.tsx).
        { label: 'Book Appointment', to: '/crm/appointments?ownerId=:id', icon: 'appointment', permission: 'contacts:create' },
        { label: 'Create Invoice', to: '/crm/invoices?contactId=:id', icon: 'invoice' },
      ],
    },
    jobs: {},
    invoicing: { clientLabel: 'Owner', projects: false, jobs: false, quoteNamePlaceholder: 'e.g. Dental cleaning estimate' },
    documents: { projects: false, markup: false, types: DOC_TYPES },
    equipment: {},
    pricebook: {},
    // A clinic books appointments; it has no jobs, quotes or projects.
    reporting: { jobsLabel: 'Appointments', jobs: false, quotes: false, projects: false, team: true, eventsPipeline: false, dealership: false },
    // The practice's own dashboard at /crm/dashboard (crm/pages/vet/DashboardPage.tsx), as /api/dashboard is the
    // practice's (crm.dashboard).
    home: 'practice',
    dashboard: {},
    // /crm/appointments and /crm/reminders are the practice's book and recall, as the server's are (crm.appointments).
    book: 'practice',
    // The first-run wizard offers what a clinic connects: no Jobber, Angi, Thumbtack or Google LSA (FIT-01/F14).
    onboarding: { integrations: ['dns', 'quickbooks', 'stripe', 'twilio'] },
    jobCosting: {},
    time: {},
    expenses: {},
    team: { roleLabel: 'Role / Specialty', rolePlaceholder: 'e.g. Veterinary Technician' },
    commissions: {},
    agreements: {},
    fleet: {},
    tech: {},
    portal: {
      providerNoun: 'clinic',
      // Pets first: it is what an owner comes to the portal for (T24 H6).
      clientNav: ['pets', 'invoices', 'paymentMethods', 'sharedDocuments', 'messages'],
      collaboratorNav: ['sharedDocuments', 'messages'],
      reviewerNav: ['sharedDocuments', 'messages'],
    },
    leads: { platforms: LEAD_PLATFORMS, jobTypeLabel: 'Service', sourcesSubtitle: 'Where new-client enquiries arrive: Google, Yelp, Meta and your website' },
    marketing: {},
    messages: {},
    reviews: { manualHelp: '', subtitle: 'Automatically ask pet owners for a Google review after a visit', subjectLabel: 'Visit', autoRequestHelp: 'Automatically request a review after a completed visit', emptyHelp: 'Requests are created automatically after completed visits' },
    import: {
      intro: 'Import clients, products and invoices from CSV files',
      types: [
        { id: 'contacts', label: 'Clients', description: 'Import pet owners, leads and vendors' },
        { id: 'products', label: 'Products/Services', description: 'Import services, medications and retail products' },
        { id: 'invoices', label: 'Invoices', description: 'Import invoices and open balances from your previous practice software or QuickBooks' },
      ],
      contactTypes: [{ value: 'client', label: 'Client' }, { value: 'lead', label: 'Lead' }, { value: 'vendor', label: 'Vendor' }],
    },
    migration: { entityLabels: { contacts: 'Clients & Pet Owners', products: 'Services & Products' } },
    // Settings › Integrations in a clinic's words (templates/crm-vet integrationsConfig.ts). The CallRail panel shows only
    // where Call Tracking is switched on, which the registry does not offer this vertical today.
    integrations: {
      callTracking: true,
      copy: { quickbooks: 'Sync invoices, payments and clients with your books.', sms: 'Send appointment reminders and updates to pet owners and staff.', email: 'Send invoices, receipts and reminders by email.' },
    },
    settings: { licenseNumber: false },
  },
  site: {
    // templates/website-premium-vet: the classic look, and a clinic's words on the contact form.
    design: 'classic',
    words: {
      contactAddressLabel: 'Address',
      contactMessageLabel: 'How can we help?',
      contactMessageRequired: 'Please write a short message.',
    },
  },
}

export default vet
