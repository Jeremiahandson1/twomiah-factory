// Field service: HVAC, plumbing, electrical, cleaning, pest, handyman (templates/crm-fieldservice). Jobs are service
// calls at a customer's service site, often on a piece of their equipment; techs are texted on their way.
import type { StarterContent } from '../../server/core/starter.ts'
import { CREW_SCOPE_WITHHELD, type VerticalSettings } from '../../server/core/vertical.ts'

const DOC_TYPES = ['general', 'contract', 'permit', 'drawing', 'photo', 'invoice', 'receipt', 'other']

// What a new business finds in Help on day one (server/core/starter.ts; written once at provisioning, then the owner's).
// Its template's seeded articles, rewritten against the unified screens with every claim checked in the code
// (2026-10-19): the unified app had given every vertical the contractor CRM's articles, and the templates' own named
// contact tags, click-a-date booking, roles on the Team page and overdue reminders, none of which the app has.
const STARTER: StarterContent = {
  helpArticles: [
    { title: "Getting Started with Your Field Service CRM", category: "Getting Started", isFaq: true,
      content: "Welcome! Start by adding your customers on the Contacts page. Then create service calls on the Service Calls page (New Service Call), and send quotes from Quotes. Use the menu on the left to move between pages." },
    { title: "Managing Customers", category: "Getting Started", isFaq: false,
      content: "Contacts are the foundation of your CRM. Add a customer with Add Contact on the Contacts page. A customer's page lists their service calls, quotes and invoices. Under Locations (Add Location), you can keep each address they have you work at, with access notes. Under Equipment (Add Equipment), you can record the units you service for them." },
    { title: "Creating and Sending Quotes", category: "Quotes & Invoices", isFaq: false,
      content: "Go to Quotes and click New Quote. Pick the customer, add a line item for each part and the labor, then choose Save & send to email it. The customer needs an email address on file. If their client portal is on (switched on from their contact page), the email lets them approve online. Otherwise, use Mark approved when they say yes. An approved quote can become a service call (Convert to Job) or an invoice (Create Invoice)." },
    { title: "Invoice Management", category: "Quotes & Invoices", isFaq: false,
      content: "Create an invoice with New Invoice on the Invoices page, from an approved quote (Create Invoice), or from a service call (Invoice). The due date starts from the payment terms in Settings › Company. Add line items for parts, labor and fees, then click Send to email it. Use Record Payment when the customer pays; the invoice shows the Balance Due. To chase unpaid invoices for you, turn on Settings › Invoice Reminders: due-soon and overdue reminders go out by email, each once, with a link to pay, and you can add a late fee. Send emails one again any time." },
    { title: "How do I schedule service calls?", category: "Scheduling", isFaq: true,
      content: "Give a service call its Scheduled Date, Scheduled Time and Estimated Hours, and pick the technician under Assigned To. The Schedule page shows a day, a week or a month: click a call to open it. With Drag & Drop Calendar on, drag a call to another day, or in the Day view to another hour, to move it. To repeat a call, choose Repeat on the New Service Call form (every week, every few weeks or every month) and how many visits or until when: every visit goes on the Schedule, and Stop the series on any visit's page ends it. With Dispatch Board on, the Dispatch Board shows today's calls and lets you assign a technician." },
    { title: "Team & Technician Management", category: "Team", isFaq: false,
      content: "Give someone a sign-in from Settings › Users (Add User), which can email them an invite. Their Access Role sets what they can do:\n• Viewer can look but change nothing.\n• Staff handles day-to-day work.\n• Manager has full access to work and invoicing.\n• Admin also has company settings and the team.\n\nThe Team page is your roster: each person's job title, department and hourly rate. Technicians can be assigned to service calls, and their hours are logged on the Time page." },
    { title: "How do I track technician time?", category: "Time & Expenses", isFaq: true,
      content: "Use the Time page. Click Clock In when you start and Clock Out when you finish, or use Log Time to enter hours by hand. With Log Time you can link the hours to a service call. Managers approve entries." },
    { title: "Equipment & Service History", category: "Documents", isFaq: false,
      content: "The Equipment page tracks your customers' units: brand, model, serial number, install date, warranty and maintenance interval. Click a unit's Service History to see its service calls and maintenance records, and use Add Service Record to log maintenance. A customer location also lists the equipment there and the work done at it. With Tech View and Photo Capture on, technicians add photos to a service call from Tech View." },
  ],
  pricebookCategories: { byIndustry: {}, default: ["Install", "Repair", "Maintenance", "Emergency", "Inspection"] },
}

const fieldservice: VerticalSettings = {
  id: 'fieldservice',
  label: 'Field Service',
  vocabulary: { readyText: "we're on our way.", customer: { one: 'customer', many: 'customers' }, work: { one: 'service call', many: 'service calls' }, team: { one: 'technician', many: 'technicians' }, reviewAfter: 'a service call is completed', gallery: 'Gallery', customerCompany: true },
  mfaIssuer: 'Twomiah Field Service',
  featureSet: 'crm-fieldservice',
  starter: STARTER,
  // A technician on the way to an address texts the customer from the contact record (templates/crm-fieldservice
  // middleware/permissions.ts, T30 L-RB).
  extraRolePermissions: { field: ['sms:send'] },
  // Crew scope: a technician reads its own and its crews' jobs and their customers (server/core/vertical.ts).
  withheldRolePermissions: { field: CREW_SCOPE_WITHHELD },
  crm: {
    serviceSites: true,
    jobs: { defaultType: 'repair', photos: true, billing: { prefix: 'INV', pad: 5, termsDays: 30 }, textArrival: true },
    quotes: { textOnSend: true },
    // No drawings to mark up: plan markup is construction's.
    documents: { markup: false, types: DOC_TYPES },
    agreements: { recurrence: true },
    // Vehicles' locations and trips (templates/crm-fieldservice services/fleet.ts options.gps).
    fleet: { gps: true },
    // One checklist for every trade this CRM serves; rows of the old HVAC-only type are still read.
    tech: { checklistType: 'service_checklist', checklistTitle: 'Service checklist', legacyChecklistTypes: ['hvac_inspection_checklist'] },
    portal: { disable: ['collaborators', 'projects', 'changeOrders', 'selections', 'projectFiles', 'sharedDocuments'] },
  },
  // templates/crm-fieldservice/frontend/src/*Config.ts
  screens: {
    // The first-run wizard's integrations, by id (required: "absent, all" handed a salon Angi, Thumbtack and Jobber, 10/25).
    onboarding: { integrations: ['dns', 'quickbooks', 'jobber', 'angi', 'thumbtack', 'google_lsa', 'stripe', 'twilio'] },
    // The warranty and claim forms' examples, in this trade's words (live test 2026-10-22).
    warranties: { namePlaceholder: 'e.g., Parts and labor — one year', categoryPlaceholder: 'e.g., parts', claimTitlePlaceholder: 'e.g., AC not cooling after repair', claimLocationPlaceholder: 'e.g., Attic air handler' },
    // The menu in this trade's words, by page address.
    nav: { '/crm/jobs': 'Service Calls', '/crm/job-costing': 'Service Call Costing', '/crm/tech': 'Tech View' },
    searchPlaceholder: 'Search contacts, service calls, invoices...',
    // No projects in field service (featureRegistry: the contractor's): no Projects list or count on a contact.
    contacts: { sections: { projects: false, quotes: true, equipment: true, sites: true, sms: true, portal: true } },
    jobs: { labels: { singular: 'Service Call', plural: 'Service Calls', add: 'New Service Call' }, equipment: true, sites: true, photos: true, billing: true },
    invoicing: { clientLabel: 'Customer', projects: false, jobs: true, quoteSites: true, quoteEquipment: true, quoteCustomerMessage: true, quoteDecline: true, quickbooks: true, quoteNamePlaceholder: 'e.g. AC Compressor Replacement', pricebook: true },
    documents: { markup: false, projects: false, types: DOC_TYPES },
    equipment: {
      placeholders: { name: 'e.g., Main AC Unit', manufacturer: 'e.g., Carrier', location: 'e.g., Basement, Attic' },
      contacts: true, sites: true, linkedJobs: true,
      categories: [
        { name: 'HVAC', icon: 'hvac' }, { name: 'Plumbing', icon: 'plumbing' }, { name: 'Electrical', icon: 'electrical' },
        { name: 'Appliance', icon: 'appliance' }, { name: 'Water heaters', icon: 'plumbing' },
      ],
    },
    import: {
      types: [
        { id: 'contacts', label: 'Contacts', description: 'Import customers, vendors, and leads' },
        { id: 'projects', label: 'Projects', description: 'Import project records', feature: 'projects' },
        { id: 'jobs', label: 'Service Calls', description: 'Import work orders and service calls', feature: 'jobs' },
        { id: 'products', label: 'Products/Services', description: 'Import products and service items' },
        { id: 'invoices', label: 'Invoices', description: 'Import invoices and open balances from Jobber, HousecallPro or QuickBooks' },
      ],
    },
    migration: { entityLabels: { jobs: 'Service Calls & Work Orders' } },
    pricebook: { tiersTitle: 'Good-Better-Best options', namePlaceholder: 'e.g. AC tune-up', codePlaceholder: 'e.g., DIAG-001', partsPlaceholder: 'Comma-separated, e.g., 1x Filter, 1x Capacitor' },
    // The van's stock, named as a tech would (crm/pages/fieldservice/PartsInventory).
    parts: { namePlaceholder: 'e.g., 16x25x1 Pleated Filter' },
    reporting: { jobsLabel: 'Service Calls', jobs: true, quotes: true, projects: false, team: true, eventsPipeline: false, dealership: false },
    dashboard: { jobsLabel: 'Service Calls', todayBoard: true, projects: false },
    jobCosting: { jobsLabel: 'Service Calls', costingLabel: 'Service Call Costing' },
    time: {},
    expenses: {},
    // A roster row can be a crew with logins on it; their field seats read its jobs (crew scope, 2026-10-24).
    team: { rolePlaceholder: 'e.g. Lead Technician', crewLogins: true },
    agreements: { recurrence: true, planNamePlaceholder: 'e.g., HVAC Maintenance Plan' },
    fleet: { gps: true },
    portal: {
      providerNoun: 'service team',
      clientNav: ['myJobs', 'quotes', 'invoices', 'paymentMethods', 'equipment', 'agreements', 'serviceRequest', 'messages'],
      collaboratorNav: ['messages'],
      reviewerNav: ['messages'],
      labels: { myJobs: 'Service Calls', agreements: 'Maintenance Plans' },
    },
    leads: {},
    marketing: {},
    messages: {},
    reviews: {},
    settings: {},
    commissions: { roleWords: { technician: 'Technician', sales_rep: 'Sales Rep', manager: 'Manager', all: 'All roles' }, planExample: 'Tech standard' },
    tech: {
      title: 'My Jobs',
      checklist: {
        title: 'Service checklist',
        subtitle: 'The problem, the fix, safety, clean-up and the customer',
        items: [
          { id: 'problem_confirmed', label: 'Problem confirmed with the customer' },
          { id: 'work_done', label: 'Work completed as agreed' },
          { id: 'tested', label: 'Tested and working' },
          { id: 'safety', label: 'Area left safe' },
          { id: 'cleanup', label: 'Work area cleaned up' },
          { id: 'customer_walkthrough', label: 'Customer shown what was done' },
        ],
      },
    },
  },
  site: {
    design: 'fieldservice',
    words: {
      contactAddressLabel: 'Office',
      contactMessageLabel: 'What do you need help with?',
      contactMessageRequired: 'Tell us what you need help with.',
    },
  },
}

export default fieldservice
