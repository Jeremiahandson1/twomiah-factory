// Field service: HVAC, plumbing, electrical, cleaning, pest, handyman (templates/crm-fieldservice). Jobs are service
// calls at a customer's service site, often on a piece of their equipment; techs are texted on their way.
import type { VerticalSettings } from '../../server/core/vertical.ts'

const DOC_TYPES = ['general', 'contract', 'permit', 'drawing', 'photo', 'invoice', 'receipt', 'other']

const fieldservice: VerticalSettings = {
  id: 'fieldservice',
  label: 'Field Service',
  mfaIssuer: 'Twomiah Field Service',
  featureSet: 'crm-fieldservice',
  // A technician on the way to an address texts the customer from the contact record (templates/crm-fieldservice
  // middleware/permissions.ts, T30 L-RB).
  extraRolePermissions: { field: ['sms:send'] },
  crm: {
    serviceSites: true,
    jobs: { defaultType: 'repair', photos: true, billing: { prefix: 'INV', pad: 5, termsDays: 30 }, textArrival: true },
    quotes: { textOnSend: true },
    // No drawings to mark up: plan markup is construction's.
    documents: { markup: false, types: DOC_TYPES },
    agreements: { recurrence: true },
    // One checklist for every trade this CRM serves; rows of the old HVAC-only type are still read.
    tech: { checklistType: 'service_checklist', checklistTitle: 'Service checklist', legacyChecklistTypes: ['hvac_inspection_checklist'] },
    portal: { disable: ['collaborators', 'projects', 'changeOrders', 'selections', 'projectFiles', 'sharedDocuments'] },
  },
  // templates/crm-fieldservice/frontend/src/*Config.ts
  screens: {
    // The menu in this trade's words, by page address.
    nav: { '/crm/jobs': 'Service Calls', '/crm/job-costing': 'Service Call Costing', '/crm/tech': 'Tech View' },
    searchPlaceholder: 'Search contacts, service calls, invoices...',
    contacts: { sections: { projects: true, quotes: true, equipment: true, sites: true, sms: true, portal: true }, portalGate: false },
    jobs: { labels: { singular: 'Service Call', plural: 'Service Calls', add: 'New Service Call' }, equipment: true, sites: true, photos: true, billing: true },
    invoicing: { clientLabel: 'Customer', projects: false, jobs: true, quoteSites: true, quoteEquipment: true, quoteCustomerMessage: true, quoteDecline: true, quickbooks: true, quoteNamePlaceholder: 'e.g. AC Compressor Replacement', pricebook: true },
    documents: { markup: false, projects: false, types: DOC_TYPES },
    equipment: {
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
    pricebook: { tiersTitle: 'Good-Better-Best options' },
    reporting: { jobsLabel: 'Service Calls', jobs: true, quotes: true, projects: false, team: true, eventsPipeline: false, dealership: false },
    dashboard: { jobsLabel: 'Service Calls', todayBoard: true, projects: false },
    jobCosting: { jobsLabel: 'Service Calls', costingLabel: 'Service Call Costing' },
    time: { jobLabel: 'Service Call' },
    expenses: { jobLabel: 'Service Call' },
    team: { rolePlaceholder: 'e.g. Lead Technician' },
    agreements: { recurrence: true },
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
