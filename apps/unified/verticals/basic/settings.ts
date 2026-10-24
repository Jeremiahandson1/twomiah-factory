// Basic: the general small-business CRM (templates/crm-basic) — what industryRouting.ts sends showcase (gyms, studios,
// venues, photographers), food trucks and any business with no vertical of its own. A copy of field service with the
// trade taken out: jobs at a customer's sites, equipment, recurring agreements, but no service calls, no tech view, no
// builder's paperwork and no contractor lead marketplaces.
import type { StarterContent } from '../../server/core/starter.ts'
import { CREW_SCOPE_WITHHELD, type VerticalSettings } from '../../server/core/vertical.ts'

// Permits and drawings are a builder's paperwork (templates/crm-basic routes/documents.ts and docsConfig.ts, T43).
const DOC_TYPES = ['general', 'contract', 'photo', 'invoice', 'receipt', 'other']

// What a new business finds in Help on day one (server/core/starter.ts; written once at provisioning, then the owner's).
// Its template's seeded articles, rewritten against the unified screens with every claim checked in the code
// (2026-10-19): the unified app had given every vertical the contractor CRM's articles, and the templates' own named
// contact tags, click-a-date booking, roles on the Team page and overdue reminders, none of which the app has.
const STARTER: StarterContent = {
  helpArticles: [
    { title: "Getting Started with Your CRM", category: "Getting Started", isFaq: true,
      content: "Welcome to your CRM. Start by adding your customer contacts, creating jobs for the work you have booked, and sending quotes. Use the menu on the left to move between pages." },
    { title: "Managing Customers", category: "Getting Started", isFaq: false,
      content: "Contacts are the foundation of your CRM. Add one with Add Contact on the Contacts page, as a Lead, Client or Supplier. A contact's page lists their jobs, quotes and invoices, and under Locations (Add Location) the addresses you work at." },
    { title: "Creating and Sending Quotes", category: "Quotes & Invoices", isFaq: false,
      content: "Go to Quotes and click New Quote. Add a line item for each part of the work and anything you supply, then choose Save & send to email it; the customer needs an email address on file. If their client portal is on (switched on from their contact page), the email lets them approve online. Otherwise, use Mark approved when they say yes. An approved quote becomes a job with Convert to Job, or an invoice with Create Invoice." },
    { title: "Invoice Management", category: "Quotes & Invoices", isFaq: false,
      content: "Create an invoice with New Invoice on the Invoices page, or from an approved quote (Create Invoice). The due date starts from the payment terms in Settings › Company. Add your line items, then click Send to email it. Use Record Payment when you're paid; the invoice shows the Balance Due. To chase unpaid invoices for you, turn on Settings › Invoice Reminders: due-soon and overdue reminders go out by email, each once, with a link to pay, and you can add a late fee. Send emails one again any time." },
    { title: "How do I schedule work?", category: "Scheduling", isFaq: true,
      content: "Give a job its Scheduled Date, Scheduled Time and Estimated Hours, and pick who is doing it under Assigned To. The Schedule page shows a day, a week or a month: click a job to open it. With Drag & Drop Calendar on, drag a job to another day, or in the Day view to another hour, to move it. To repeat a job, choose Repeat on the New Job form (every week, every few weeks or every month) and how many visits or until when: every visit goes on the Schedule, and Stop the series on any visit's page ends it." },
    { title: "Team Management", category: "Team", isFaq: false,
      content: "Give someone a sign-in from Settings › Users (Add User), which can email them an invite. Their Access Role sets what they can do:\n• Viewer can look but change nothing.\n• Staff handles day-to-day work.\n• Manager has full access to work and invoicing.\n• Admin also has company settings and the team.\n\nThe Team page is your roster: each person's job title, department and hourly rate. Team members can be assigned to jobs, and their hours are logged on the Time page." },
    { title: "How do I track time?", category: "Time & Expenses", isFaq: true,
      content: "Use the Time page. Click Clock In and Clock Out, or use Log Time to add hours by hand and link them to a job. Managers approve entries." },
    { title: "Files and documents", category: "Documents", isFaq: false,
      content: "Keep your files on the Documents page. Click Upload and give each file a name, a type (contract, photo, invoice, receipt…) and a description, so you can find it again with search and the filters." },
  ],
  pricebookCategories: { byIndustry: {}, default: ["Service", "Package", "Hire", "Extra", "Other"] },
}

const basic: VerticalSettings = {
  id: 'basic',
  label: 'Business',
  // Shared by showcase, food truck and basic, so no one trade to name (templates/crm-basic routes/mfa.ts, T41).
  mfaIssuer: 'Twomiah CRM',
  featureSet: 'crm-basic',
  starter: STARTER,
  // The 1:1 text box on the contact record is for the person on their way (templates/crm-basic
  // middleware/permissions.ts, T30 L-RB).
  extraRolePermissions: { field: ['sms:send'] },
  // Crew scope: a staff seat reads its own and its crews' jobs and their customers (server/core/vertical.ts).
  withheldRolePermissions: { field: CREW_SCOPE_WITHHELD },
  crm: {
    serviceSites: true,
    // No billing a job on its own: the basic copy's job table had no invoice link mounted (routes/jobs.ts).
    jobs: { photos: true, textArrival: true },
    quotes: { textOnSend: true },
    documents: { markup: false, types: DOC_TYPES },
    agreements: { recurrence: true },
    fleet: { gps: true },
    // Not the trades' marketplaces: a gym can't sign up to Angi (routes/leads.ts, T42). Same ids as screens.leads.
    leads: { platforms: ['google_business', 'instagram', 'yelp', 'website'] },
    // No technician's view in this copy (no routes/tech.ts; tech_mobile_view is not in its features): the base checklist.
    tech: { checklistType: 'site_checklist', checklistTitle: 'Site checklist' },
    portal: { disable: ['collaborators', 'projects', 'changeOrders', 'selections', 'projectFiles', 'sharedDocuments'] },
  },
  // A studio doesn't come to your house: the booking form doesn't ask for an address unless the owner says so
  // (templates/crm-basic routes/booking.ts, T42).
  booking: { requireAddress: false },
  // templates/crm-basic/frontend/src/*Config.ts
  screens: {
    // The warranty and claim forms' examples, in this trade's words (live test 2026-10-22).
    warranties: { namePlaceholder: 'e.g., Workmanship — 90 days', categoryPlaceholder: 'e.g., workmanship', claimTitlePlaceholder: 'e.g., Problem with the finished work', claimLocationPlaceholder: 'e.g., Front entrance' },
    searchPlaceholder: 'Search contacts, jobs, invoices...',
    contacts: {
      // A supplier is stored as `vendor`; not a builder's Subcontractor (contactsConfig.ts, T64).
      types: [{ value: 'lead', label: 'Lead' }, { value: 'client', label: 'Client' }, { value: 'vendor', label: 'Supplier' }],
      // No projects here (featureRegistry: the contractor's): no Projects list or count on a contact.
      sections: { projects: false, quotes: true, equipment: true, sites: true, sms: true, portal: true },
    },
    jobs: { labels: { singular: 'Job', plural: 'Jobs', add: 'New Job' }, equipment: true, sites: true, photos: true },
    // The template's quote-name example was field service's ('AC Compressor Replacement'); a neutral one here.
    invoicing: { clientLabel: 'Customer', projects: false, jobs: true, quoteSites: true, quoteEquipment: true, quoteCustomerMessage: true, quoteDecline: true, quickbooks: true, quoteNamePlaceholder: 'e.g. Standard package', pricebook: true },
    documents: { markup: false, projects: false, types: DOC_TYPES },
    equipment: {
      placeholders: { name: 'e.g., Work van', manufacturer: 'e.g., Ford', location: 'e.g., Shop' },
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
    // Neutral words for a general service business (it fell back to the shared default, which suits no one in particular).
    pricebook: { tiersTitle: 'Good-Better-Best options', namePlaceholder: 'e.g. Standard visit' },
    reporting: { jobsLabel: 'Jobs', jobs: true, quotes: true, projects: false, team: true, eventsPipeline: false, dealership: false },
    dashboard: { jobsLabel: 'Jobs', todayBoard: true, projects: false },
    jobCosting: { jobsLabel: 'Jobs', costingLabel: 'Job Costing' },
    time: { jobLabel: 'Job' },
    expenses: { jobLabel: 'Job' },
    // "Trade" and "Lead Technician" are a contractor's words (peopleConfig.ts, T51).
    // A roster row can be a crew with logins on it; their field seats read its jobs (crew scope, 2026-10-24).
    team: { roleLabel: 'Job title', rolePlaceholder: 'e.g. Shift lead', crewLogins: true },
    agreements: { recurrence: true, planNamePlaceholder: 'e.g., Monthly service plan' },
    fleet: { gps: true },
    portal: {
      providerNoun: 'service team',
      clientNav: ['myJobs', 'quotes', 'invoices', 'paymentMethods', 'equipment', 'agreements', 'serviceRequest', 'messages'],
      collaboratorNav: ['messages'],
      reviewerNav: ['messages'],
      labels: { myJobs: 'Jobs', agreements: 'Maintenance Plans' },
    },
    // The general lead platforms (leadsConfig.ts, T42); the ids are crm.leads.platforms.
    leads: {
      platforms: [
        {
          value: 'google_business', label: 'Google Business Profile', color: '#c62828', tone: 'indigo',
          description: 'Turn Google messages and booking requests into leads in your Lead Inbox.',
          instructions: [
            'Google emails the profile owner for every new message or booking request', 'Forward those notification emails to the inbound address below',
            'Gmail: Settings › Filters › from:google.com "Business Profile" › Forward', "Each forwarded message becomes a lead with the sender's name and note",
          ],
        },
        {
          value: 'instagram', label: 'Instagram / Facebook', color: '#6a1b9a', tone: 'pink',
          description: 'Bring DMs and lead-form submissions from Meta into your CRM.',
          instructions: [
            'Meta emails you when someone messages your page or fills in a lead form', 'Forward those notification emails to the inbound address below',
            'Or connect a Zapier / Make zap from Meta Lead Ads to the webhook URL below',
          ],
        },
        {
          value: 'yelp', label: 'Yelp', color: '#e65100', tone: 'sky',
          description: 'Forward Yelp quote requests and messages into your Lead Inbox.',
          instructions: ['Yelp for Business → Account Settings → Notifications', 'Turn on email alerts for "Request a quote" / messages', 'Forward those alerts to the inbound address below'],
        },
        {
          value: 'website', label: 'Website contact form', color: '#2e7d32', tone: 'emerald',
          description: 'Every form submission on your website becomes a lead.',
          instructions: ["Point your website form's notification email at the inbound address below", 'Or use the webhook URL below with Zapier / Make from any form builder'],
        },
      ],
      jobTypeLabel: 'Service',
      sourcesSubtitle: 'Where new enquiries arrive: Google, Meta, Yelp and your website',
    },
    marketing: {},
    messages: {},
    reviews: {},
    // No trade licence for a gym or a venue (settingsConfig.ts, T41).
    settings: { licenseNumber: false },
    // Only the four every business can use: no Jobber, Angi, Thumbtack or Local Services (OnboardingWizard.tsx, T41).
    onboarding: { integrations: ['dns', 'quickbooks', 'stripe', 'twilio'] },
    // The four stored role keys in this CRM's words: nobody here is a technician (pages/CommissionsPage.tsx, T51).
    commissions: { roleWords: { technician: 'Staff', sales_rep: 'Sales', manager: 'Managers', all: 'Everyone' }, planExample: 'Standard staff plan' },
    // No tech view (tech_mobile_view is not in this CRM's features), so no screens.tech.
  },
  // The showcase site (templates/website-premium-showcase): its contact section and its empty-message reply.
  site: {
    design: 'showcase',
    words: {
      contactAddressLabel: 'Address',
      contactMessageLabel: 'Your message',
      contactMessageRequired: 'Please write a short message.',
    },
  },
}

export default basic
