// Bar: a bar and grill's CRM (templates/crm-bar) — the night (Tonight, the menu and taps, what's on), the register and
// the grill screen, close-outs, stock and purchasing, the schedule and the time clock, gift cards, the Regulars, and
// private parties (the restaurant's events module, server/crm/restaurant, which the bar shares). The template was
// crm-basic's copy made into a bar's, so the basic CRM's field modules are still in it, never offered to a bar (the
// registry gives crm-bar no jobs, quotes, scheduling, fleet or equipment); their switches follow the template anyway.
import type { VerticalSettings } from '../../server/core/vertical.ts'

// Permits and drawings are a builder's paperwork (templates/crm-bar routes/documents.ts and docsConfig.ts, T43).
const DOC_TYPES = ['general', 'contract', 'photo', 'invoice', 'receipt', 'other']

const bar: VerticalSettings = {
  id: 'bar',
  label: 'Bar & Grill',
  // The template named itself 'Twomiah CRM' because crm-basic served three verticals (routes/mfa.ts, T41); this one is a bar's.
  mfaIssuer: 'Twomiah Bar',
  featureSet: 'crm-bar',
  // templates/crm-bar middleware/permissions.ts: the 1:1 text box is for the person on their way (T30 L-RB), and the
  // Regulars at the register — the bartender adds a regular and spends their reward, the same two grants the salon
  // gives its stylists. Correcting points and changing the programme stay a manager's.
  extraRolePermissions: { field: ['sms:send', 'loyalty:enroll', 'loyalty:redeem'] },
  crm: {
    // The party request and the Regulars sign-up (crm/bar/enquiry.ts; templates/crm-bar routes/webhooks.ts).
    websiteForms: 'bar',
    // crm-basic's switches, as the copy kept them (routes/contacts, jobs, quotes, equipment, agreements, services/fleet).
    serviceSites: true,
    jobs: { photos: true, textArrival: true },
    quotes: { textOnSend: true },
    documents: { markup: false, types: DOC_TYPES },
    agreements: { recurrence: true },
    fleet: { gps: true },
    // Not the trades' marketplaces (routes/leads.ts, T42). Same ids as screens.leads.platforms.
    leads: { platforms: ['google_business', 'instagram', 'yelp', 'website'] },
    // No technician's view in this copy (no routes/tech.ts): the base checklist.
    tech: { checklistType: 'site_checklist', checklistTitle: 'Site checklist' },
    portal: { disable: ['collaborators', 'projects', 'changeOrders', 'selections', 'projectFiles', 'sharedDocuments'] },
    // Private parties: the events dashboard at home (routes/dashboard.ts), and the events module's hooks into contacts,
    // invoices and Stripe (routes/contacts.ts, invoices.ts, services/stripe.ts) — the restaurant's, byte for byte.
    dashboard: 'events',
    events: true,
    // /api/loyalty is the bar's Regulars (routes/barLoyalty.ts), not the salon's programme.
    loyalty: 'bar',
  },
  // A bar takes its bookings at its own door (templates/crm-bar routes/booking.ts, T42, crm-basic's).
  booking: { requireAddress: false },
  // templates/crm-bar/frontend/src/*Config.ts
  screens: {
    // shellConfig.ts: the menu in a bar's words (the bar's own items are crm/verticals/bar.tsx; the party screens are the
    // restaurant's, by the same features). The salon's Loyalty item shows on the same feature (loyalty_rewards), but a
    // bar's programme is the Regulars, so it is left out.
    nav: { '/crm/contacts': 'Guests', '/crm/events': 'Parties', '/crm/menus': 'Party Packages' },
    navSections: { Events: 'Parties' },
    navHidden: ['/crm/loyalty'],
    searchPlaceholder: 'Search guests, the menu, parties...',
    // The bar's home (crm/verticals/bar.tsx dashboard): Tonight at a glance above the party book.
    home: 'bar',
    // Its nights' sales above the shared Reports page (crm/verticals/bar.tsx reportsAbove; ReportsDashboard.tsx).
    reportsAbove: 'bar',
    contacts: {
      // The sidebar calls this page Guests, and so do its heading and its button (Bar Runs 1 and 2).
      title: 'Guests',
      addLabel: 'Guest',
      // Guests (regulars, party hosts), leads (a party enquiry not yet booked), and suppliers (distributors, the brewery
      // reps). A supplier is stored as `vendor`, so nothing saved under crm-basic's set changes.
      types: [{ value: 'client', label: 'Guest' }, { value: 'lead', label: 'Lead' }, { value: 'vendor', label: 'Supplier' }],
      // The parties list on a guest, texting, and none of crm-basic's field set (sites, equipment) — a guest has neither.
      gateByFeature: true,
      sections: { events: true, sms: true },
      portalGate: false,
      quickActions: [
        { label: 'Book a party', to: '/crm/events?contactId=:id', icon: 'event', feature: 'event_bookings' },
        { label: 'Create Invoice', to: '/crm/invoices?contactId=:id', icon: 'invoice', feature: 'invoices' },
      ],
    },
    jobs: { labels: { singular: 'Job', plural: 'Jobs', add: 'New Job' }, equipment: true, sites: true, photos: true },
    // A bar invoices guests for private parties (the events ledger): no jobs, no projects. 'open' = a party's invoice,
    // billed from its first scheduled payment, not yet emailed.
    invoicing: { clientLabel: 'Guest', projects: false, jobs: false, extraInvoiceStatuses: ['open'], quickbooks: true, quoteNamePlaceholder: 'e.g. Packers party, back room' },
    documents: { markup: false, projects: false, types: DOC_TYPES },
    equipment: {
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
    pricebook: { tiersTitle: 'Good-Better-Best options' },
    // A bar reports its nights (the register's sales, above the shared page — reportsAbove) and its
    // parties' pipeline; no jobs, quotes, projects, and no jobs-per-person panel (tips by person are in the sales).
    reporting: { jobsLabel: 'Jobs', jobs: false, quotes: false, projects: false, team: false, eventsPipeline: true, dealership: false },
    dashboard: { jobsLabel: 'Jobs', todayBoard: true, projects: false },
    jobCosting: { jobsLabel: 'Jobs', costingLabel: 'Job Costing' },
    // A bar pays its hours and never bills them, and has no jobs to log them against (Bar Run 1).
    time: { jobLabel: 'Job', jobsFeature: 'jobs', billable: false, subtitle: 'Clock in on the bar tablet with your till PIN, or log hours by hand' },
    expenses: { jobLabel: 'Job' },
    // The column was the shared default, "Job Title / Trade" (Bar Run 2).
    team: { roleLabel: 'Position', rolePlaceholder: 'e.g. Bartender, line cook' },
    agreements: { recurrence: true },
    fleet: { gps: true },
    // The four stored keys in a bar's words: nobody here is a tech (T51).
    commissions: { roleWords: { technician: 'Staff', sales_rep: 'Sales', manager: 'Managers', all: 'Everyone' }, planExample: 'Standard staff plan' },
    portal: {
      providerNoun: 'service team',
      clientNav: ['myJobs', 'quotes', 'invoices', 'paymentMethods', 'equipment', 'agreements', 'serviceRequest', 'messages'],
      collaboratorNav: ['messages'],
      reviewerNav: ['messages'],
      labels: { myJobs: 'Jobs', agreements: 'Maintenance Plans' },
    },
    leads: {
      platforms: [
        {
          value: 'google_business', label: 'Google Business Profile', color: '#c62828', tone: 'indigo', description: 'Turn Google messages and booking requests into leads in your Lead Inbox.',
          instructions: [
            'Google emails the profile owner for every new message or booking request', 'Forward those notification emails to the inbound address below',
            'Gmail: Settings › Filters › from:google.com "Business Profile" › Forward', "Each forwarded message becomes a lead with the sender's name and note",
          ],
        },
        {
          value: 'instagram', label: 'Instagram / Facebook', color: '#6a1b9a', tone: 'pink', description: 'Bring DMs and lead-form submissions from Meta into your CRM.',
          instructions: [
            'Meta emails you when someone messages your page or fills in a lead form', 'Forward those notification emails to the inbound address below',
            'Or connect a Zapier / Make zap from Meta Lead Ads to the webhook URL below',
          ],
        },
        {
          value: 'yelp', label: 'Yelp', color: '#e65100', tone: 'sky', description: 'Forward Yelp quote requests and messages into your Lead Inbox.',
          instructions: ['Yelp for Business → Account Settings → Notifications', 'Turn on email alerts for "Request a quote" / messages', 'Forward those alerts to the inbound address below'],
        },
        {
          value: 'website', label: 'Website contact form', color: '#2e7d32', tone: 'emerald', description: 'Every form submission on your website becomes a lead.',
          instructions: ["Point your website form's notification email at the inbound address below", 'Or use the webhook URL below with Zapier / Make from any form builder'],
        },
      ],
      jobTypeLabel: 'Service',
      sourcesSubtitle: 'Where new enquiries arrive: Google, Meta, Yelp and your website',
    },
    marketing: {},
    messages: {},
    reviews: {},
    settings: {
      // No trade licence behind a bar (settingsConfig.ts, T41).
      licenseNumber: false,
      // The same four rungs and words, described as what each does behind a bar (Bar Run 1). This replaces the shared
      // list, so Viewer is repeated or the bar could not hand out read-only access.
      roles: [
        { value: 'viewer', label: 'Viewer', description: 'read-only: can open any page but change nothing' },
        { value: 'field', label: 'Staff', description: 'the register, the grill, Tonight, the Regulars, and their own shifts and clock; no stock, gift cards, reports or pay' },
        { value: 'manager', label: 'Manager', description: 'everything staff can do plus voids and the close-out, stock, gift cards, the schedule and reports; not company settings or billing' },
        { value: 'admin', label: 'Admin', description: 'full access, including company settings and team' },
      ],
    },
    // No Jobber export and no Angi account behind a bar: the domain, QuickBooks, Stripe and texting (OnboardingWizard.tsx, T41).
    onboarding: { integrations: ['dns', 'quickbooks', 'stripe', 'twilio'] },
  },
  // The bar's own site is templates/website-premium-bar (the Tonight board, the menu and taps read live from
  // /api/public/bar). Its look is not one of the site designs yet; the closest is the showcase's. Its contact section
  // says Address, asks for "Your message", and answers an empty one with "Please write a short message."
  site: {
    design: 'showcase',
    words: {
      contactAddressLabel: 'Address',
      contactMessageLabel: 'Your message',
      contactMessageRequired: 'Please write a short message.',
    },
  },
}

export default bar
