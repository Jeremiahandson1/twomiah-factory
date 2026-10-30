// RV, powersports and marine dealerships (templates/crm-rv): a sales floor, not the recurring-job model — unit
// inventory, the sales pipeline and the desked deal, F&I, title & registration, trade-ins, the service department's
// repair orders, rentals and the parts catalogue (server/crm/rv, web/src/crm/pages/rv).
import type { StarterContent } from '../../server/core/starter.ts'
import type { VerticalSettings } from '../../server/core/vertical.ts'

const DOC_TYPES = ['general', 'contract', 'title', 'inspection', 'photo', 'invoice', 'receipt', 'other']

// What a new business finds in Help on day one (server/core/starter.ts; written once at provisioning, then the owner's).
// Its template's seeded articles, rewritten against the unified screens with every claim checked in the code
// (2026-10-19): the unified app had given every vertical the contractor CRM's articles, and the templates' own named
// contact tags, click-a-date booking, roles on the Team page and overdue reminders, none of which the app has.
const STARTER: StarterContent = {
  helpArticles: [
    { title: "Getting Started", category: "Getting Started", isFaq: true,
      content: "Welcome! Start by adding your units on Inventory and your customers on Contacts. Then work each deal on the Sales Pipeline, from New to Sold. Use the menu on the left to move between pages." },
    { title: "Managing Inventory", category: "Inventory", isFaq: true,
      content: "Click Add Unit on the Inventory page for each new, used or consignment unit. Enter its stock number, VIN, year, make and model, and its prices (MSRP, listed price, internet price, cost). A unit is picked as the Unit of Interest on a deal, and marking that deal Sold marks the unit sold." },
    { title: "Contacts & Leads", category: "Getting Started", isFaq: false,
      content: "Keep leads, customers and vendors on the Contacts page (Add Contact). Convert a lead to a customer when they buy. A contact's page lists their quotes, invoices and jobs." },
    { title: "Working Deals", category: "Sales", isFaq: false,
      content: "On the Sales Pipeline, click New Lead and pick the contact, the Unit of Interest and the salesperson; you can note trade-in info. Move the card through New, Contacted, Demo, Desking and Sold (or Lost). Structure the price, trade, tax and fees in Desking. On F&I / Deal Jacket, add F&I products and work out the payment; sending a credit application to a lender is not connected yet. For a Sold deal, Title & Registration lists the documents the title needs; filing with the DMV is not connected." },
    { title: "Service & Parts", category: "Service", isFaq: false,
      content: "On the Service page, click New Repair Order and pick the customer and the unit, the advisor, the services and an estimated total. Change its status as the work moves. Look parts up in the Parts Catalog (Import parts loads a manufacturer's parts file)." },
    { title: "Invoices & Payments", category: "Billing", isFaq: false,
      content: "Create invoices for sales, service and parts, add line items, and record payment. Track outstanding balances." },
  ],
  // No price book in this vertical (featureRegistry: pricebook is not offered), so no categories.
  pricebookCategories: { byIndustry: {}, default: [] },
}

const rv: VerticalSettings = {
  id: 'rv',
  label: 'RV & Powersports',
  vocabulary: { readyText: 'your unit is ready for pickup.', customer: { one: 'customer', many: 'customers' }, work: { one: 'service job', many: 'service jobs' }, team: { one: 'staff member', many: 'staff' }, reviewAfter: 'a service job is completed', gallery: 'Gallery', customerCompany: true },
  mfaIssuer: 'Twomiah Powersports',
  featureSet: 'crm-rv',
  starter: STARTER,
  // The floor books test drives, drop-offs and deliveries (/api/schedule-events), which ask schedule:create and
  // schedule:update since T68 (templates/crm-rv middleware/permissions.ts).
  extraRolePermissions: { field: ['schedule:create', 'schedule:update'] },
  crm: {
    // No drawings to mark up; a dealership files titles and inspections (templates/crm-rv routes/documents.ts).
    documents: { markup: false, types: DOC_TYPES },
    // No field view in this CRM (tech_mobile_view is not offered); the base checklist stands unused.
    tech: { checklistType: 'site_checklist', checklistTitle: 'Site checklist' },
    // No projects, change orders, selections or project files at a dealership (routes/portal.ts).
    portal: { disable: ['projects', 'changeOrders', 'selections', 'projectFiles', 'service'] },
    // The marketplaces a dealership hears from (routes/leads.ts; screens.leads.platforms has the same ids).
    leads: { platforms: ['rv_trader', 'google_business', 'instagram', 'website'] },
    // A dealership sells to customers; a customer with a repair order or a sales lead is kept (routes/contacts.ts,
    // import.ts, services/{import,migration,quickbooks}.ts).
    contacts: { types: ['lead', 'customer', 'vendor'], customerType: 'customer', guards: ['repairOrder', 'salesLead'] },
    // Inventory, the pipeline and service (routes/dashboard.ts).
    dashboard: 'dealership',
    // INV-1001 onwards (routes/invoices.ts, routes/quotes.ts).
    invoices: { numbering: { prefix: 'INV', pad: 0, seed: 1000 } },
    // A website enquiry is a sales lead in the pipeline (routes/webhooks.ts, T59).
    websiteEnquiries: 'pipeline',
    // routes/support.ts
    support: {
      assistant: "an RV & powersports dealership CRM. The app's features are: unit Inventory, Contacts/leads, Deals, Service, Parts, F&I (the finance and insurance office), and Reports. Answer from these features and the knowledge base articles provided.",
    },
  },
  // templates/crm-rv/frontend/src/*Config.ts
  screens: {
    // The warranty and claim forms' examples, in this trade's words (live test 2026-10-22).
    warranties: { namePlaceholder: 'e.g., Service work — 90 days', categoryPlaceholder: 'e.g., service', claimTitlePlaceholder: 'e.g., Slide-out sticking after repair', claimLocationPlaceholder: 'e.g., Curb-side slide' },
    // The dealership's own dashboard at /crm/dashboard (crm/verticals/rv.tsx `dashboard`).
    home: 'rv',
    // The menu in this trade's words, by page address (shellConfig.ts).
    nav: { '/crm/inventory': 'Parts & Inventory' },
    // The shared Parts & Inventory page serves parts_tracking here, as the template's menu had it; field service's own
    // Parts Inventory page (/crm/parts) is not this CRM's.
    navFeatures: { '/crm/inventory': ['inventory', 'parts_tracking'] },
    navHidden: ['/crm/parts'],
    searchPlaceholder: 'Search units, customers, invoices...',
    contacts: {
      // a dealership sells to customers (contactsConfig.ts)
      types: [{ value: 'lead', label: 'Lead' }, { value: 'customer', label: 'Customer' }, { value: 'vendor', label: 'Vendor' }],
      convertLabel: 'Customer',
      // no projects UI in the dealership CRM
      sections: { projects: false, quotes: true, portal: true },
    },
    jobs: {},
    invoicing: { clientLabel: 'Customer', projects: false, jobs: true, quoteNamePlaceholder: 'e.g. Roof reseal and brake service' },
    documents: { types: DOC_TYPES },
    equipment: {},
    // Appointments on the calendar: test drives, drop-offs, deliveries (pages/SchedulePage.tsx).
    schedule: { events: true },
    import: {
      intro: 'Import customers, units, service jobs and invoices from CSV files',
      types: [
        { id: 'contacts', label: 'Customers', description: 'Import customers, leads and vendors' },
        { id: 'jobs', label: 'Service Jobs', description: 'Import repair orders and service jobs', feature: 'jobs' },
        { id: 'products', label: 'Parts/Services', description: 'Import parts and service items' },
        { id: 'invoices', label: 'Invoices', description: 'Import invoices and open balances from your DMS or QuickBooks' },
      ],
      contactTypes: [{ value: 'customer', label: 'Customer' }, { value: 'lead', label: 'Lead' }, { value: 'vendor', label: 'Vendor' }],
      defaultContactType: 'customer',
    },
    migration: { entityLabels: { contacts: 'Customers', jobs: 'Service Jobs & Repair Orders' } },
    // integrationsConfig.ts: the CallRail signing-key panel (shown only when Call Tracking is on) and the cards' words.
    integrations: {
      callTracking: true,
    },
    reviews: {},
    pricebook: {},
    // Units sold, front-end gross, close rate, the pipeline and service ROs; no contractor job, project or time panels
    // (reportingConfig.ts, RV T19 M8).
    reporting: { jobsLabel: 'Jobs', jobs: false, quotes: true, projects: false, team: false, eventsPipeline: false, dealership: true },
    dashboard: {},
    jobCosting: {},
    time: {},
    expenses: {},
    team: { roleLabel: 'Role', rolePlaceholder: 'e.g. Service Technician' },
    agreements: {},
    fleet: {},
    portal: {
      providerNoun: 'dealership',
      clientNav: ['quotes', 'invoices', 'paymentMethods', 'myJobs', 'sharedDocuments', 'messages'],
      collaboratorNav: ['myJobs', 'sharedDocuments', 'messages'],
      reviewerNav: ['sharedDocuments', 'messages'],
      labels: { myJobs: 'Service' },
      docTypeLabels: { general: 'General', contract: 'Sales Contract', title: 'Title & Registration', finance: 'Loan Documents', warranty: 'Warranty', insurance: 'Insurance', photo: 'Photo' },
    },
    // leadsConfig.ts — the ids are crm.leads.platforms.
    // What a lead can start the moment it becomes a contact (web/src/crm/screens.tsx LeadInbox): only the shared screens that open with
    // the contact chosen (?contactId=). Offered only if the business has the feature and the seat may create it.
    leads: {
      startWith: ['quote'],
      platforms: [
        {
          value: 'rv_trader', label: 'RV Trader / Cycle Trader', color: '#1565c0', tone: 'blue',
          description: 'Forward RV Trader / Cycle Trader buyer inquiries into your Lead Inbox.',
          instructions: [
            'TraderInteractive dealer portal → Settings → Lead notifications', 'Send lead emails to the inbound address below (or add it as a CC recipient)',
            "Each inquiry becomes a lead with the buyer's name, unit of interest and message",
          ],
        },
        {
          value: 'google_business', label: 'Google Business Profile', color: '#c62828', tone: 'indigo',
          description: 'Turn Google messages and booking requests into leads in your Lead Inbox.',
          instructions: [
            'Google emails the profile owner for every new message or booking request', 'Forward those notification emails to the inbound address below',
            'Gmail: Settings › Filters › from:google.com "Business Profile" › Forward', "Each forwarded message becomes a lead with the sender's name and note",
          ],
        },
        {
          value: 'instagram', label: 'Facebook Marketplace / Instagram', color: '#6a1b9a', tone: 'pink',
          description: 'Bring Marketplace messages and lead-form submissions from Meta into your CRM.',
          instructions: [
            'Meta emails you when someone messages your page or a Marketplace listing', 'Forward those notification emails to the inbound address below',
            'Or connect a Zapier / Make zap from Meta Lead Ads to the webhook URL below',
          ],
        },
        {
          value: 'website', label: 'Website contact form', color: '#2e7d32', tone: 'emerald',
          description: 'Every form submission on your website becomes a lead.',
          instructions: ["Point your website form's notification email at the inbound address below", 'Or use the webhook URL below with Zapier / Make from any form builder'],
        },
      ],
      jobTypeLabel: 'Interest',
    },
    // marketingConfig.ts: the drips are the Follow-Up product here.
    marketing: { contactTypes: [{ value: 'lead', label: 'Lead' }, { value: 'customer', label: 'Customer' }, { value: 'vendor', label: 'Vendor' }], sequencesLabel: 'Follow-Ups' },
    messages: {},
    settings: {},
    // The first-run wizard's integrations step (OnboardingWizard.tsx): a dealership imports from its DMS and hears from
    // the marketplaces, not Jobber, Angi, Thumbtack or Google LSA.
    onboarding: {
      integrations: ['dns', 'quickbooks', 'dms_import', 'rv_trader', 'cycle_trader', 'dealer_spike', 'stripe', 'twilio'],
      extra: [
        {
          id: 'dms_import', label: 'Existing DMS / Spreadsheet', category: 'accounting',
          description: 'Import your existing inventory, customers, and deals from your current DMS or a CSV.',
          guideSteps: [
            'Export your data (Inventory, Customers, Deals) as CSV from your current system', 'Go to Settings > Import in your CRM',
            'Upload each CSV file and map the columns', 'Review the import preview and confirm',
          ],
        },
        {
          id: 'rv_trader', label: 'RV Trader', category: 'lead_sources',
          // The Lead Sources page's own steps (email forwarding): there is no "Connect RV Trader" button (live test 10/22).
          description: 'Forward RV Trader buyer inquiries into your Lead Inbox.',
          guideSteps: [
            'Open Lead Sources and connect RV Trader / Cycle Trader to get your inbound email address',
            'In the TraderInteractive dealer portal: Settings → Lead notifications — send lead emails to that address (or add it as a CC)',
            "Each inquiry becomes a lead with the buyer's name, unit of interest and message",
          ],
          open: { to: '/crm/lead-sources', label: 'Open Lead Sources' },
        },
        {
          id: 'cycle_trader', label: 'Cycle Trader', category: 'lead_sources',
          description: 'Forward Cycle Trader / powersports buyer inquiries into your Lead Inbox.',
          guideSteps: [
            'Cycle Trader is the same TraderInteractive portal as RV Trader: open Lead Sources and connect RV Trader / Cycle Trader',
            'In the dealer portal: Settings → Lead notifications — send lead emails to the inbound address it shows',
            'Each inquiry becomes a lead in your Lead Inbox',
          ],
          open: { to: '/crm/lead-sources', label: 'Open Lead Sources' },
        },
        {
          id: 'dealer_spike', label: 'Dealer Spike / DX1', category: 'lead_sources',
          description: 'Route website and marketplace leads from your dealer website provider.',
          guideSteps: [
            'Open Lead Sources and connect Website contact form to get your inbound email address and webhook URL',
            'Point your Dealer Spike / DX1 lead notifications at that email address (or the webhook)', 'New website leads appear in your Lead Inbox',
          ],
          open: { to: '/crm/lead-sources', label: 'Open Lead Sources' },
        },
      ],
    },
  },
  // templates/website-premium-rv: the classic design (it served the base look); its contact section and empty-message reply.
  site: {
    design: 'classic',
    words: {
      contactAddressLabel: 'Address',
      contactMessageLabel: 'How can we help?',
      contactMessageRequired: 'Please write a short message.',
    },
  },
}

export default rv
