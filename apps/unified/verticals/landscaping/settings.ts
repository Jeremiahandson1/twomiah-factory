// Landscaping: lawn care, landscaping and tree service (templates/crm-landscaping). Field service's lineage — jobs at a
// customer's property, equipment, recurring service agreements, crews texted on their way — with its own modules: the
// weekly Route Board, area-based pricing and snow & ice contracts (server/crm/landscaping).
import type { StarterContent } from '../../server/core/starter.ts'
import { CREW_SCOPE_WITHHELD, type VerticalSettings } from '../../server/core/vertical.ts'

const DOC_TYPES = ['general', 'contract', 'permit', 'drawing', 'photo', 'invoice', 'receipt', 'other']

// What a new business finds in Help on day one (server/core/starter.ts; written once at provisioning, then the owner's).
// Its template's seeded articles, rewritten against the unified screens with every claim checked in the code
// (2026-10-19): the unified app had given every vertical the contractor CRM's articles, and the templates' own named
// contact tags, click-a-date booking, roles on the Team page and overdue reminders, none of which the app has.
const STARTER: StarterContent = {
  helpArticles: [
    { title: "Getting Started with Your Landscaping CRM", category: "Getting Started", isFaq: true,
      content: "Welcome! Start by adding your customers on the Contacts page and each property under Properties. Then create jobs on the Jobs page (New Job) and send quotes from Quotes. Use the menu on the left to move between pages." },
    { title: "Managing Customers & Properties", category: "Getting Started", isFaq: false,
      content: "Add a customer with Add Contact on the Contacts page. On their page, Add Property records each property with its address and access notes. Opening a property shows the equipment there and its service history. The customer's page also lists their jobs, quotes and invoices." },
    { title: "Creating and Sending Quotes", category: "Quotes & Invoices", isFaq: false,
      content: "Go to Quotes and click New Quote. Pick the customer and, if they have several, the property. Add a line item for each part of the work, then Save & send to email it; the customer needs an email address on file. If their client portal is on, they can approve online. Otherwise use Mark approved. An approved quote can become a job (Convert to Job) or an invoice (Create Invoice). With Area Pricing on, the Area Pricing page prices services by measured square footage." },
    { title: "Invoice Management", category: "Quotes & Invoices", isFaq: false,
      content: "Create an invoice with New Invoice on the Invoices page, or from an approved quote (Create Invoice). Bill a visit or a project like this. For regular billing, the Recurring page sets up Recurring Invoices (weekly, bi-weekly, monthly…). Snow Billing handles snow and ice contracts per push, per event or per inch; a seasonal contract leaves its visits uncharged, so bill the season with a recurring invoice. Use Send to email an invoice and Record Payment when paid. Settings › Invoice Reminders emails due-soon and overdue reminders for you, and can add a late fee." },
    { title: "How do I schedule jobs and routes?", category: "Scheduling", isFaq: true,
      content: "Give a job its Scheduled Date and Time, and pick the crew member under Assigned To. The Schedule page shows a day, a week or a month: click a job to open it, and with Drag & Drop Calendar on, drag it to another day, or in the Day view to another hour. For weekly mowing, choose Repeat on the New Job form (every week, every 2 weeks… or every month) and how many visits or until when: every visit goes on the Schedule, and Stop the series on any visit's page ends it. The Route Board (Recurring Route Board) holds a crew's route for each day: click New Route, then Add Stop for each property." },
    { title: "Team & Crew Management", category: "Team", isFaq: false,
      content: "Give someone a sign-in from Settings › Users (Add User), which can email them an invite. Their Access Role sets what they can do:\n• Viewer can look but change nothing.\n• Staff handles day-to-day work.\n• Manager has full access to work and invoicing.\n• Admin also has company settings and the team.\n\nThe Team page is your roster: each person's job title, department and hourly rate. Crew members can be assigned to jobs, and their hours are logged on the Time page." },
    { title: "How do I track crew time?", category: "Time & Expenses", isFaq: true,
      content: "Use the Time page. Click Clock In when you start and Clock Out when you finish, or use Log Time to enter hours by hand. With Log Time you can link the hours to a job. Managers approve entries." },
    { title: "Property & Job History", category: "Documents", isFaq: false,
      content: "Each property (on the customer's page, under Properties) keeps its access notes, the equipment there and its service history. With Crew View and Photo Capture on, crews add before-and-after photos to a job from Crew View, and the photos show on the job." },
  ],
  pricebookCategories: { byIndustry: {}, default: ["Maintenance", "Design & Install", "Irrigation", "Hardscape", "Snow"] },
}

const landscaping: VerticalSettings = {
  id: 'landscaping',
  label: 'Landscaping',
  vocabulary: { readyText: "we're on our way.", customer: { one: 'customer', many: 'customers' }, work: { one: 'job', many: 'jobs' }, team: { one: 'crew member', many: 'crew' }, reviewAfter: 'a job is completed', gallery: 'Portfolio', customerCompany: true },
  mfaIssuer: 'Twomiah Landscaping',
  featureSet: 'crm-landscaping',
  starter: STARTER,
  // A crew running late tells the customer from the contact record (templates/crm-landscaping middleware/permissions.ts,
  // T30 L-RB).
  extraRolePermissions: { field: ['sms:send'] },
  // Jobber's rule: a crew login sees the jobs assigned to it, the customers on those jobs and its own bookings — not the
  // whole business (live retest, 2026-10-24: a crew seat was shown every job and every customer's name).
  withheldRolePermissions: { field: CREW_SCOPE_WITHHELD },
  crm: {
    serviceSites: true,
    visitReports: true,
    // No defaultType: the engine's 'service'. The template's database default was field service's 'repair', and the
    // owner objected that "a landscaping job is labelled REPAIR" (T58); the template only hid the label on the
    // dispatch card and kept storing it. It billed no job on its own (no POST /api/jobs/:id/invoice).
    jobs: { photos: true, textArrival: true, repeatWeekdays: true },
    quotes: { textOnSend: true },
    // No drawings to mark up: plan markup is construction's (field service's fix, T28 L10 — the landscaping copy still
    // passed the table).
    documents: { markup: false, types: DOC_TYPES },
    agreements: { recurrence: true },
    // A crew's end-of-visit property checklist; rows of the HVAC type this CRM first shipped are still read.
    tech: { checklistType: 'property_checklist', checklistTitle: 'Property checklist', legacyChecklistTypes: ['hvac_inspection_checklist'] },
    portal: { disable: ['collaborators', 'projects', 'changeOrders', 'selections', 'projectFiles', 'sharedDocuments'] },
  },
  // templates/crm-landscaping/frontend/src/*Config.ts and the page wrappers' configs
  screens: {
    // The first-run wizard's integrations, by id (required: "absent, all" handed a salon Angi, Thumbtack and Jobber, 10/25).
    onboarding: { integrations: ['dns', 'quickbooks', 'jobber', 'angi', 'thumbtack', 'google_lsa', 'stripe', 'twilio'] },
    // The warranty and claim forms' examples, in this trade's words (live test 2026-10-22).
    warranties: { namePlaceholder: 'e.g., Plantings — one-year replacement', categoryPlaceholder: 'e.g., plantings', claimTitlePlaceholder: 'e.g., Shrub died after planting', claimLocationPlaceholder: 'e.g., Front bed, left of the driveway' },
    // The menu in this trade's words, by page address (shellConfig.ts). Field service's own items sit under
    // "Operations" here (T58: each named after what it is, so no pair reads as the same thing).
    nav: { '/crm/tech': 'Crew View', '/crm/parts': 'Parts & Materials', '/crm/pricebook-rates': 'Flat-Rate Pricing' },
    navSections: { 'Field Service': 'Operations' },
    searchPlaceholder: 'Search contacts, jobs, invoices...',
    // Projects are construction's (featureRegistry offers them to the contractor only): no Projects list or count on a
    // landscaper's contact (live test 2026-10-22). Each list also follows its own feature on the screen.
    contacts: { sections: { projects: false, quotes: true, equipment: true, sites: true, sms: true, portal: true } },
    // A landscaper works at a customer's property, not a "location" (live test 2026-10-22): the contact's page, the quote
    // and job forms.
    sites: { singular: 'Property', plural: 'Properties', namePlaceholder: 'e.g. "Home", "Lake cottage"' },
    // A landscaper does not take service calls: the work is a scheduled visit to a property — a job. (T41)
    // repeatWeekdays: a repeating job can run on chosen days of the week (Monday and Thursday); the server's jobs.repeatWeekdays is the same switch.
    jobs: { labels: { singular: 'Job', plural: 'Jobs', add: 'New Job' }, equipment: true, sites: true, photos: true, repeatWeekdays: true },
    invoicing: { clientLabel: 'Customer', projects: false, jobs: true, quoteSites: true, quoteEquipment: true, quoteCustomerMessage: true, quoteDecline: true, quickbooks: true, quoteNamePlaceholder: 'e.g. Spring cleanup and mulch', pricebook: true },
    // markup/projects: construction's, as for field service (the template still offered both; projects is not offered
    // to this vertical).
    documents: { markup: false, projects: false, types: DOC_TYPES },
    equipment: {
      placeholders: { name: 'e.g., Zero-turn mower 1', manufacturer: 'e.g., Toro', location: 'e.g., Shop, bay 2' },
      contacts: true, sites: true, linkedJobs: true,
      // A lawn-care crew's own kit, not HVAC / Plumbing / Electrical. (T41)
      categories: [
        { name: 'Mowers', icon: 'mower' }, { name: 'Trimmers & blowers', icon: 'tree' }, { name: 'Tree & stump', icon: 'tree' },
        { name: 'Trucks & trailers', icon: 'truck' }, { name: 'Snow & ice', icon: 'snow' }, { name: 'Irrigation', icon: 'plumbing' },
        { name: 'Hand tools', icon: 'tool' },
      ],
    },
    import: {
      types: [
        { id: 'contacts', label: 'Contacts', description: 'Import customers, vendors, and leads' },
        { id: 'projects', label: 'Projects', description: 'Import project records', feature: 'projects' },
        { id: 'jobs', label: 'Service Visits', description: 'Import work orders and service visits', feature: 'jobs' },
        { id: 'products', label: 'Products/Services', description: 'Import products and service items' },
        { id: 'invoices', label: 'Invoices', description: 'Import invoices and open balances from Jobber, HousecallPro or QuickBooks' },
      ],
    },
    migration: { entityLabels: { jobs: 'Service Visits & Work Orders' } },
    // The Pricebook and the Flat-Rate Pricebook (one book of items) in a grounds crew's words (live test 2026-10-22:
    // the flat-rate form said "AC Diagnostic - Residential" and "DIAG-001").
    pricebook: { tiersTitle: 'Good-Better-Best options', namePlaceholder: 'e.g. Spring cleanup', codePlaceholder: 'e.g., MOW-01', partsPlaceholder: 'Comma-separated, e.g., 2 yd mulch, 1x edging roll' },
    reporting: { jobsLabel: 'Jobs', jobs: true, quotes: true, projects: false, team: true, eventsPipeline: false, dealership: false },
    dashboard: { jobsLabel: 'Jobs', todayBoard: true, projects: false },
    jobCosting: { jobsLabel: 'Jobs', costingLabel: 'Job Costing' },
    time: {},
    expenses: {},
    // A roster row can be a crew with logins on it; their field seats read its jobs (crew scope, 2026-10-24).
    team: { rolePlaceholder: 'e.g. Crew Lead', crewLogins: true },
    agreements: { recurrence: true, planNamePlaceholder: 'e.g., Weekly mowing plan' },
    fleet: { gps: true },
    // A grounds crew's stock, not an HVAC van's (T63). Any category already stored on a part is still offered.
    parts: {
      namePlaceholder: 'e.g., 21" mower blade',
      categories: [
        'Mower & Equipment Parts', 'Blades & Line', 'Irrigation', 'Fertilizer & Chemicals', 'Seed & Sod',
        'Mulch, Soil & Stone', 'Plants & Trees', 'Hardscape', 'Misc',
      ],
    },
    portal: {
      providerNoun: 'landscaping team',
      clientNav: ['myJobs', 'visits', 'quotes', 'invoices', 'paymentMethods', 'equipment', 'agreements', 'serviceRequest', 'messages'],
      collaboratorNav: ['messages'],
      reviewerNav: ['messages'],
      labels: { myJobs: 'Service Visits', agreements: 'Service Plans' },
    },
    leads: {},
    marketing: {},
    messages: {},
    reviews: {},
    settings: {},
    commissions: { roleWords: { technician: 'Crew', sales_rep: 'Sales', manager: 'Manager', all: 'All roles' }, planExample: 'Crew standard' },
    tech: {
      title: 'My Visits',
      checklist: {
        title: 'Property checklist',
        subtitle: 'Gates, edges, hard surfaces, irrigation and debris',
        items: [
          { id: 'gates', label: 'Gates closed and pets secured' },
          { id: 'edges', label: 'Edges and trim done' },
          { id: 'hard_surfaces', label: 'Clippings cleared from drives and paths' },
          { id: 'irrigation', label: 'Irrigation heads checked' },
          { id: 'debris', label: 'Debris hauled or bagged' },
          { id: 'photos', label: 'Before and after photos taken' },
        ],
      },
    },
  },
  // templates/website-premium-landscaping (views/sections/contact/form-info.ejs, server-static.ts)
  site: {
    design: 'landscaping',
    words: {
      contactAddressLabel: 'Office',
      contactMessageLabel: "What you're working on",
      contactMessageRequired: 'Tell us a bit about your project.',
    },
  },
}

export default landscaping
