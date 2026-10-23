// General contractor (templates/crm, the base CRM). Its role names and permissions are the shared defaults.
import type { VerticalSettings } from '../../server/core/vertical.ts'

const contractor: VerticalSettings = {
  id: 'contractor',
  label: 'Contractor',
  mfaIssuer: 'Twomiah Contractor',
  featureSet: 'crm',
  // Exterior Visualizer: the screens open company.visionUrl when the feature is on.
  visionUrl: () => process.env.VISION_URL || null,
  // templates/crm/frontend/src/*Config.ts
  screens: {
    // The warranty and claim forms' examples, in this trade's words (live test 2026-10-22).
    warranties: { namePlaceholder: 'e.g., Workmanship — one year', categoryPlaceholder: 'e.g., workmanship', claimTitlePlaceholder: 'e.g., Leak in master bathroom', claimLocationPlaceholder: 'e.g., Master bathroom, near shower' },
    contacts: { vendorPortalInvite: true, sections: { projects: true, quotes: true, portal: true } },
    jobs: {},
    invoicing: { clientLabel: 'Client', projects: true, jobs: true, quoteNamePlaceholder: 'e.g. Kitchen remodel — phase 1', pricebook: true },
    documents: { projects: true, markup: true, types: ['general', 'contract', 'permit', 'drawing', 'photo', 'invoice', 'receipt', 'other'] },
    equipment: {
      placeholders: { name: 'e.g., Job-site generator', manufacturer: 'e.g., DeWalt', location: 'e.g., Shop' },
      contacts: true,
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
    pricebook: {
      namePlaceholder: 'e.g. Drywall patch and paint',
      tiersTitle: 'Pricing tiers',
      tiersButton: 'Tiers',
      tierPresets: [
        { tier: 'best', name: 'Sign Today', description: 'Best price — available today only', recommended: true },
        { tier: 'better', name: 'Within 30 Days', description: 'Valid for 30 days from proposal date', recommended: false },
        { tier: 'good', name: 'Valid 1 Year', description: 'Price valid for up to 12 months', recommended: false },
      ],
    },
    reporting: { jobsLabel: 'Jobs', jobs: true, quotes: true, projects: true, team: true, eventsPipeline: false, dealership: false },
    dashboard: { jobsLabel: 'Jobs', projects: true },
    jobCosting: { jobsLabel: 'Jobs', costingLabel: 'Job Costing' },
    time: { jobLabel: 'Job' },
    expenses: { jobLabel: 'Job' },
    team: {},
    commissions: { roleWords: { technician: 'Crew', sales_rep: 'Sales', manager: 'Project managers', all: 'Everyone' }, planExample: 'Standard sales plan' },
    portal: {},
    leads: {},
    marketing: {},
    messages: {},
    agreements: { planNamePlaceholder: 'e.g., Annual home maintenance plan' },
    // The live map of the drivers' vehicles (BASE_CRM fleet.gps).
    fleet: { gps: true },
    reviews: {},
    migration: {},
    settings: {},
    tech: {
      title: 'My Jobs',
      checklist: {
        title: 'Site checklist',
        subtitle: 'Protection, the work, safety, clean-up and the walkthrough',
        items: [
          { id: 'site_protected', label: 'Floors, furniture and fixtures protected' },
          { id: 'work_matches_scope', label: 'Work matches the plan or quote' },
          { id: 'safety', label: 'Hazards cleared, tools put away' },
          { id: 'cleanup', label: 'Debris removed and site cleaned' },
          { id: 'walkthrough', label: 'Walkthrough done with the customer' },
          { id: 'photos', label: 'Before and after photos taken' },
        ],
      },
    },
  },
  site: {
    design: 'classic',
    words: {
      contactAddressLabel: 'Office',
      contactMessageLabel: "What you're working on",
      contactMessageRequired: 'Tell us a bit about your project.',
    },
  },
}

export default contractor
