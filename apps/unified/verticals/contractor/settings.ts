// General contractor (templates/crm, the base CRM). Its role names and permissions are the shared defaults.
import { BASE_CRM, CREW_SCOPE_WITHHELD, type VerticalSettings } from '../../server/core/vertical.ts'

const contractor: VerticalSettings = {
  id: 'contractor',
  label: 'Contractor',
  vocabulary: { readyText: "we're on our way.", customer: { one: 'customer', many: 'customers' }, work: { one: 'job', many: 'jobs' }, team: { one: 'crew member', many: 'crew' }, reviewAfter: 'a job is completed', gallery: 'Portfolio', customerCompany: true },
  mfaIssuer: 'Twomiah Contractor',
  featureSet: 'crm',
  // Crew scope: a crew login reads its own and its crews' jobs and their customers (server/core/vertical.ts).
  withheldRolePermissions: { field: CREW_SCOPE_WITHHELD },
  // A builder's Sales rep and Crew (Buildertrend's and JobTread's seats; contractor live test 11/07: the rep was refused their own leads and
  // quotes, and the crew read the price list's prices). Both are the Field rung — the jobs they are on and their customers — and everything
  // that ranks a role reads them as Field. The Sales rep also works leads and writes quotes: its OWN (leads assigned to it, quotes it wrote
  // or is the salesperson on — without leads:read-all / quotes:read-all the routes narrow it) and its own commissions. A Crew seat goes
  // without the price list's prices. An existing Staff (field) login keeps Staff.
  roleLabels: { sales_rep: 'Sales rep', crew: 'Crew' },
  roleMapping: { sales_rep: 'field', crew: 'field' },
  // contacts:read-all: the rep quotes the customers the office added too (Jobber's Salesperson sees every client; field service
  // re-check 11/10). Their leads, quotes and projects stay their own (roleWithheld).
  roleExtra: { sales_rep: ['contacts:read-all', 'leads:read', 'leads:create', 'leads:update', 'quotes:read', 'quotes:create', 'quotes:update', 'contacts:create', 'contacts:update', 'schedule:create', 'schedule:update', 'projects:create', 'projects:update'] },
  roleWithheld: { crew: ['prices:read'], sales_rep: ['leads:read-all', 'quotes:read-all', 'projects:read-all'] },
  // Exterior Visualizer: the screens open company.visionUrl when the feature is on.
  visionUrl: () => process.env.VISION_URL || null,
  // A new job is for a customer (packages/tenant-backend jobs.ts options.requireCustomer).
  // quoteSellerCommissions: the sales rep who sold the project earns a % of the contract as its invoices are paid (contractor live test 11/07).
  // team.roles: the seats a login may be given here, the shared ones and the contractor's Sales rep and Crew (roleMapping above).
  crm: { ...BASE_CRM, jobs: { ...BASE_CRM.jobs, requireCustomer: true }, quoteSellerCommissions: true, team: { roles: ['admin', 'manager', 'sales_rep', 'crew', 'field', 'viewer'] } },
  // templates/crm/frontend/src/*Config.ts
  screens: {
    // The menu's groups (web/src/navGroups.ts): a builder reads Sales, Projects, Field, Finance, then the website and bookings.
    // Every page a builder can be offered is filed here by address; a page left out stays under the heading it had.
    navGroupOrder: ['Sales', 'Projects', 'Field', 'Finance', 'Website', 'Bookings', 'Account'],
    // The crew's menu is their work (contractor live test 11/07: it listed Reviews, Agreements, Commissions, Fleet, Inventory, Bookings and
    // Support): the office's pages leave it. Typed in, each still answers as it does for any Staff seat.
    navHiddenFor: {
      crew: ['/crm/reviews', '/crm/google-reviews', '/crm/agreements', '/crm/commissions', '/crm/fleet', '/crm/inventory', '/crm/bookings', '/crm/bookings/calendar', '/crm/bookings/waitlist', '/crm/bookings/insights', '/crm/bookings/settings', '/crm/support', '/crm/marketing', '/crm/warranties', '/crm/equipment', '/crm/lead-sources'],
    },
    navGroups: {
      '/crm/dashboard': '',
      '/crm/contacts': 'Sales',
      '/crm/leads': 'Sales',
      '/crm/lead-sources': 'Sales',
      '/crm/quotes': 'Sales',
      '/crm/bids': 'Sales',
      '/crm/takeoffs': 'Sales',
      '/crm/visualizer': 'Sales',
      '/crm/pricebook': 'Sales',
      '/crm/agreements': 'Sales',
      '/crm/marketing': 'Sales',
      '/crm/ads': 'Sales',
      '/crm/reviews': 'Sales',
      '/crm/google-reviews': 'Sales',
      '/crm/email': 'Sales',
      '/crm/call-tracking': 'Sales',
      '/crm/ai-receptionist': 'Sales',
      '/crm/messages': 'Sales',
      '/crm/projects': 'Projects',
      '/crm/jobs': 'Projects',
      '/crm/tasks': 'Projects',
      '/crm/selections': 'Projects',
      '/crm/change-orders': 'Projects',
      '/crm/rfis': 'Projects',
      '/crm/submittals': 'Projects',
      '/crm/punch-lists': 'Projects',
      '/crm/daily-logs': 'Projects',
      '/crm/inspections': 'Projects',
      '/crm/gantt': 'Projects',
      '/crm/documents': 'Projects',
      '/crm/warranties': 'Projects',
      '/crm/tech': 'Field',
      '/crm/schedule': 'Field',
      '/crm/time': 'Field',
      '/crm/team': 'Field',
      '/crm/locations': 'Field',
      '/crm/fleet': 'Field',
      '/crm/geofences': 'Field',
      '/crm/equipment': 'Field',
      '/crm/inventory': 'Field',
      '/crm/dispatch': 'Field',
      '/crm/maintenance': 'Field',
      '/crm/parts': 'Field',
      '/crm/pricebook-rates': 'Field',
      '/crm/invoices': 'Finance',
      '/crm/recurring': 'Finance',
      '/crm/expenses': 'Finance',
      '/crm/purchase-orders': 'Finance',
      '/crm/bills': 'Finance',
      '/crm/lien-waivers': 'Finance',
      '/crm/draw-schedules': 'Finance',
      '/crm/aia-forms': 'Finance',
      '/crm/commissions': 'Finance',
      '/crm/job-costing': 'Finance',
      '/crm/reports': 'Finance',
      '/crm/website': 'Website',
      '/crm/website/pages': 'Website',
      '/crm/website/photos': 'Website',
      '/crm/website/blog': 'Website',
      '/crm/website/portfolio': 'Website',
      '/crm/website/settings': 'Website',
      '/crm/domain': 'Website',
      '/crm/bookings': 'Bookings',
      '/crm/bookings/calendar': 'Bookings',
      '/crm/bookings/waitlist': 'Bookings',
      '/crm/bookings/insights': 'Bookings',
      '/crm/bookings/settings': 'Bookings',
      '/crm/support': 'Account',
      '/crm/audit': 'Account',
      '/crm/help': 'Account',
      '/crm/contact-support': 'Account',
    },
    // The first-run wizard's integrations, by id (required: "absent, all" handed a salon Angi, Thumbtack and Jobber, 10/25).
    onboarding: { integrations: ['dns', 'quickbooks', 'jobber', 'angi', 'thumbtack', 'google_lsa', 'stripe', 'twilio'] },
    // The warranty and claim forms' examples, in this trade's words (live test 2026-10-22).
    warranties: { namePlaceholder: 'e.g., Workmanship — one year', categoryPlaceholder: 'e.g., workmanship', claimTitlePlaceholder: 'e.g., Leak in master bathroom', claimLocationPlaceholder: 'e.g., Master bathroom, near shower' },
    contacts: { vendorPortalInvite: true, sections: { projects: true, quotes: true, portal: true } },
    // The form asks for the customer (server/core/vertical.ts crm.jobs.requireCustomer is the half that refuses).
    jobs: { requireCustomer: true },
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
    // todayBoard: a builder's crew is out on jobs every day; the board (scheduled, dispatched, in progress, done today) was off for them.
    dashboard: { jobsLabel: 'Jobs', todayBoard: true, projects: true, overdueTile: true },
    jobCosting: { jobsLabel: 'Jobs', costingLabel: 'Job Costing' },
    time: {},
    expenses: {},
    // A roster row can be a crew with logins on it; their field seats read its jobs (crew scope, 2026-10-24).
    team: { crewLogins: true },
    // A builder's sales plan is a % of the contract, earned by the rep on the signed quote as its invoices are paid (contractor live test 11/07).
    commissions: { roleWords: { technician: 'Crew', sales_rep: 'Sales rep', manager: 'Project managers', all: 'Everyone' }, planExample: 'Sales rep 5% of contract', quoteSeller: true, planTypeWords: { percent_of_invoice: '% of the contract (on each invoice, before tax)' } },
    portal: {},
    // What a lead can start the moment it becomes a contact (web/src/crm/screens.tsx LeadInbox): only the shared screens that open with
    // the contact chosen (?contactId=). Offered only if the business has the feature and the seat may create it.
    leads: { startWith: ['job', 'project', 'quote'] },
    marketing: {},
    messages: {},
    agreements: { planNamePlaceholder: 'e.g., Annual home maintenance plan' },
    // The live map of the drivers' vehicles (BASE_CRM fleet.gps).
    fleet: { gps: true },
    reviews: {},
    migration: {},
    // The role picker (Settings › Users): the contractor's seats, each said by what it holds.
    settings: {
      roles: [
        { value: 'viewer', label: 'Viewer', description: 'read-only: sees the projects, jobs, quotes and reports; changes nothing' },
        { value: 'crew', label: 'Crew', description: 'the jobs they are on, daily logs, punch lists, photos and their own time; no prices and no company money' },
        { value: 'sales_rep', label: 'Sales rep', description: 'every customer; their own leads, quotes and projects, the jobs they are on and their own commissions; not settings, the team or billing' },
        { value: 'field', label: 'Staff', description: 'the jobs they are on and day-to-day work; not settings, the team or billing' },
        { value: 'manager', label: 'Manager', description: 'runs the projects, jobs, crews, quotes and purchase orders; not billing or company settings' },
        { value: 'admin', label: 'Admin', description: 'full access, including billing, company settings and logins' },
      ],
    },
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
