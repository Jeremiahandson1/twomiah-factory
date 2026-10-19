// Landscaping: lawn care, landscaping and tree service (templates/crm-landscaping). Field service's lineage — jobs at a
// customer's property, equipment, recurring service agreements, crews texted on their way — with its own modules: the
// weekly Route Board, area-based pricing and snow & ice contracts (server/crm/landscaping).
import type { VerticalSettings } from '../../server/core/vertical.ts'

const DOC_TYPES = ['general', 'contract', 'permit', 'drawing', 'photo', 'invoice', 'receipt', 'other']

const landscaping: VerticalSettings = {
  id: 'landscaping',
  label: 'Landscaping',
  mfaIssuer: 'Twomiah Landscaping',
  featureSet: 'crm-landscaping',
  // A crew running late tells the customer from the contact record (templates/crm-landscaping middleware/permissions.ts,
  // T30 L-RB).
  extraRolePermissions: { field: ['sms:send'] },
  crm: {
    serviceSites: true,
    // No defaultType: the engine's 'service'. The template's database default was field service's 'repair', and the
    // owner objected that "a landscaping job is labelled REPAIR" (T58); the template only hid the label on the
    // dispatch card and kept storing it. It billed no job on its own (no POST /api/jobs/:id/invoice).
    jobs: { photos: true, textArrival: true },
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
    // The menu in this trade's words, by page address (shellConfig.ts). Field service's own items sit under
    // "Operations" here (T58: each named after what it is, so no pair reads as the same thing).
    nav: { '/crm/tech': 'Crew View', '/crm/parts': 'Parts & Materials', '/crm/pricebook-rates': 'Flat-Rate Pricing' },
    navSections: { 'Field Service': 'Operations' },
    searchPlaceholder: 'Search contacts, jobs, invoices...',
    contacts: { sections: { projects: true, quotes: true, equipment: true, sites: true, sms: true, portal: true }, portalGate: false },
    // A landscaper does not take service calls: the work is a scheduled visit to a property — a job. (T41)
    jobs: { labels: { singular: 'Job', plural: 'Jobs', add: 'New Job' }, equipment: true, sites: true, photos: true },
    invoicing: { clientLabel: 'Customer', projects: false, jobs: true, quoteSites: true, quoteEquipment: true, quoteCustomerMessage: true, quoteDecline: true, quickbooks: true, quoteNamePlaceholder: 'e.g. Spring cleanup and mulch', pricebook: true },
    // markup/projects: construction's, as for field service (the template still offered both; projects is not offered
    // to this vertical).
    documents: { markup: false, projects: false, types: DOC_TYPES },
    equipment: {
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
    pricebook: { tiersTitle: 'Good-Better-Best options' },
    reporting: { jobsLabel: 'Jobs', jobs: true, quotes: true, projects: false, team: true, eventsPipeline: false, dealership: false },
    dashboard: { jobsLabel: 'Jobs', todayBoard: true, projects: false },
    jobCosting: { jobsLabel: 'Jobs', costingLabel: 'Job Costing' },
    time: { jobLabel: 'Service Visit' },
    expenses: { jobLabel: 'Service Visit' },
    team: { rolePlaceholder: 'e.g. Crew Lead' },
    agreements: { recurrence: true },
    fleet: { gps: true },
    // A grounds crew's stock, not an HVAC van's (T63). Any category already stored on a part is still offered.
    parts: {
      categories: [
        'Mower & Equipment Parts', 'Blades & Line', 'Irrigation', 'Fertilizer & Chemicals', 'Seed & Sod',
        'Mulch, Soil & Stone', 'Plants & Trees', 'Hardscape', 'Misc',
      ],
    },
    portal: {
      providerNoun: 'landscaping team',
      clientNav: ['myJobs', 'quotes', 'invoices', 'paymentMethods', 'equipment', 'agreements', 'serviceRequest', 'messages'],
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
