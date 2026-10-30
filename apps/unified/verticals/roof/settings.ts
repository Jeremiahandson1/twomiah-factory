// Roofing contractors (templates/crm-roof; docs/UNIFIED_ROOF_PLAN.md). A job-based trade on the CRM's own customers,
// jobs, quotes and invoices; roofing's own parts — insurance claims and supplements, measurements and roof reports,
// storms and canvassing, crews and materials — are its add-on (server/crm/roof, web/src/crm/pages/roof).
import type { StarterContent } from '../../server/core/starter.ts'
import { CREW_SCOPE_WITHHELD, type VerticalSettings } from '../../server/core/vertical.ts'

// What a roofer files (templates/crm-roof/frontend/src/docsConfig.ts): a document hangs off a JOB, never a project.
const DOC_TYPES = ['general', 'contract', 'permit', 'warranty', 'insurance', 'scope', 'inspection', 'photo', 'invoice', 'receipt', 'other']

// What a new roofer finds on day one (server/core/starter.ts; written once at provisioning, then the owner's), from
// templates/crm-roof/backend/db/seed.template.ts. The seed's invented roofing company (crews, homeowners, jobs, claims)
// was removed there on purpose (T44) and is not carried; what it kept is:
//   • the default canvassing script — no screen creates one (CanvassingDashboard edits and deletes only), so without it
//     the module arrives with nothing to read from. Its first step named a storm date ("March 10th") that is true of no
//     real roofer's street; it says "the recent hail storm" here, for the canvasser to make specific;
//   • ten free roof reports and the estimator's roofing headline (the company row's other estimator values are the
//     columns' own defaults).
const STARTER: StarterContent = {
  // Roofing's guides are written against its moved screens when they land (plan step 4); until then, none — the base
  // CRM's articles name pages a roofer doesn't have.
  helpArticles: [],
  pricebookCategories: {
    byIndustry: {},
    // The base CRM's 'Roofing' set (server/core/starter.ts), which every roofer is.
    default: ['Roof Replacement', 'Roof Repair', 'Gutter Installation', 'Gutter Cleaning', 'Roof Inspection', 'Storm Damage Assessment'],
  },
  company: { reportCredits: 10, estimatorHeadline: 'Get Your Free Roof Estimate' },
  canvassingScripts: [{
    name: 'Hail Damage — Standard Script',
    isDefault: true,
    steps: [
      {
        title: 'Introduction',
        body: "Hi, I'm [Name] with [Company]. I'm in the neighborhood today because the recent hail storm caused damage to many roofs in this area. Have you had a chance to look at your roof since the storm?",
        tips: "Be friendly and non-pushy. Mention the specific storm date — it shows you're local and informed. If they haven't looked, that's your opening.",
      },
      {
        title: 'Damage Assessment',
        body: 'I noticed from the street that your roof may have some damage. Would it be okay if I took a quick look from the ground? I can point out anything I see — no obligation at all.',
        tips: 'Never go on the roof without explicit permission. Point out damage from the ground — dented gutters, missing shingles, granule loss in downspouts. Take photos of anything visible.',
      },
      {
        title: 'The Ask',
        body: 'Based on what I can see, I think you may have a legitimate insurance claim. Most homeowners in this area are getting full roof replacements covered by insurance with just their deductible out of pocket. Would you like to learn more about how the process works?',
        tips: "Don't promise anything specific about coverage. Use phrases like 'may have' and 'legitimate claim'. Let them ask questions. If they're skeptical, mention neighbors who've already filed.",
      },
      {
        title: 'Close',
        body: 'I can schedule a free inspection for you this week. We handle all the insurance paperwork — you just need to be home for about 30 minutes. What day works best for you?',
        tips: 'Offer specific time slots rather than open-ended availability. Get their phone number to confirm. Leave a door hanger if they want to think about it. Always be professional — you represent your company in the neighborhood.',
      },
    ],
  }],
}

const roof: VerticalSettings = {
  // 'roofing': what the mobile app recognises a roofer by (apps/mobile src/vertical — given anything else it fell back to
  // the contractor's tabs), what the template's sign-in reported and what the Factory calls this vertical.
  id: 'roofing',
  label: 'Roofing',
  vocabulary: { readyText: "we're on our way.", customer: { one: 'customer', many: 'customers' }, work: { one: 'job', many: 'jobs' }, team: { one: 'crew member', many: 'crew' }, reviewAfter: 'a job is completed', gallery: 'Portfolio', customerCompany: true },
  mfaIssuer: 'Twomiah Roofing',
  featureSet: 'crm-roof',
  starter: STARTER,
  // A roofer's people on the roof and the doors are "Field" — the word its own screens use (the Field app, field work,
  // canvassing in the field) and the roofing brief's. One word everywhere: the server's refusals and Users rows
  // (permissions.roleLabel), and through the screens' roleLabels the role picker and the View As banner. Live re-test 3
  // (2026-10-24): "Staff shows as 'Staff' in Users, not 'Field'."
  roleLabels: { field: 'Field' },
  // templates/crm-roof middleware/permissions.ts. Door-knocking is the crew's job after a storm: they start a session,
  // log a stop and correct the one they just logged (T41) — not delete one, and not the shop's scripts. The read-only
  // seat sees the team's canvassing and writes none of it (owner's decision, 2026-10-11).
  extraRolePermissions: {
    field: ['canvassing:create', 'canvassing:update'],
    viewer: ['canvassing:read'],
  },
  // Crew scope: a Field login reads the jobs it is on (assigned, the rep, or its crew's) and their homeowners
  // (server/core/vertical.ts).
  withheldRolePermissions: { field: CREW_SCOPE_WITHHELD },
  crm: {
    roof: true,
    // The roofer's own /api/dashboard (server/crm/roof/field/dashboard.ts).
    dashboard: 'roof',
    // Roofing sells no Call Tracking: the call log and the CallRail key are the AI Receptionist page's, on its switch.
    callTrackingSwitch: 'ai_receptionist',
    documents: { markup: true, types: DOC_TYPES },
    tech: { checklistType: 'site_checklist', checklistTitle: 'Site checklist' },
    // A homeowner's portal (templates/crm-roof routes/portal.ts): their jobs, quotes to sign, invoices to pay, and a
    // service request. `service` stays on for that request; its equipment and agreements sections follow features a
    // roofer is never offered (equipment_tracking, service_agreements — featureRegistry), so they don't show. No
    // projects or the construction paperwork that hangs off them.
    portal: { disable: ['projects', 'changeOrders', 'selections', 'projectFiles', 'collaborators'] },
  },
  // The screens' settings are filled as roofing's screens land (plan step 4).
  screens: {
    // The first-run wizard's integrations, by id (required: "absent, all" handed a salon Angi, Thumbtack and Jobber, 10/25).
    onboarding: { integrations: ['dns', 'quickbooks', 'jobber', 'angi', 'thumbtack', 'google_lsa', 'stripe', 'twilio'] },
    // The roofer's own home and screens (web/src/crm/verticals/roof.tsx).
    home: 'roofing',
    // The homeowner's portal tabs. The default list (projects, change orders, selections) is the contractor's, none of
    // which a roofer mounts, so the portal had no Jobs tab (roofing retest 2026-10-24): their job, its stage and its
    // inspection and install dates, read-only — packages/tenant-backend portal.ts /my-jobs carries no money.
    portal: {
      providerNoun: 'roofing team',
      clientNav: ['myJobs', 'quotes', 'invoices', 'paymentMethods', 'serviceRequest', 'messages'],
      collaboratorNav: ['messages'],
      reviewerNav: ['messages'],
      labels: { myJobs: 'Jobs' },
    },
    // A roofing job's stages in the pipeline board's words (web/src/crm/pages/roof/jobs/model.ts STAGE_LABELS), wherever a
    // stage is shown — a badge, a filter, the job's timeline ("Status changed: Invoiced → Collected"). Live test
    // 2026-10-22: "in_production", "final_inspection" and "invoiced → collected" were printed as stored.
    codeLabels: {
      inspection_scheduled: 'Inspection Scheduled', measurement_ordered: 'Measurement Ordered', proposal_sent: 'Proposal Sent',
      material_ordered: 'Material Ordered', in_production: 'In Production', final_inspection: 'Final Inspection',
      new_construction: 'New Construction',
    },
    // Job costing and commissions (offered to roofing, featureRegistry): a roof's jobs are in pipeline stages, a rep is paid on the
    // contract or the gross profit when the whole job is paid (server/crm/roof/commissions.ts), so the screens say so.
    jobCosting: {
      jobsLabel: 'Jobs', costingLabel: 'Job Costing',
      statuses: [['', 'All stages'], ['lead', 'Lead'], ['inspection_scheduled', 'Inspection Scheduled'], ['inspected', 'Inspected'], ['measurement_ordered', 'Measurement Ordered'],
        ['proposal_sent', 'Proposal Sent'], ['signed', 'Signed'], ['material_ordered', 'Material Ordered'], ['in_production', 'In Production'],
        ['final_inspection', 'Final Inspection'], ['invoiced', 'Invoiced'], ['collected', 'Collected'], ['lost', 'Lost'], ['cancelled', 'Cancelled']],
    },
    commissions: {
      roleWords: { technician: 'Crew', sales_rep: 'Sales rep', manager: 'Manager', all: 'Everyone' },
      planExample: 'Sales rep, 8% of the contract',
      salesRepAutoEarn: true,
      planTypeWords: { flat_rate: 'Flat amount per job', percent_of_invoice: '% of the contract (before tax)', percent_of_margin: '% of gross profit' },
      planBaseWords: { percent_of_invoice: 'the contract before tax', percent_of_margin: 'the job\u2019s gross profit' },
    },
    // A quote is for one of the homeowner's jobs (quote.job_id): the shared quote form offers them.
    // jobs: an approved quote on no job converts to a roofing job (Convert to Job; the server makes it with insertRoofJob,
    // modules/crm.ts makeJob) — the tester looked for it and found none (2026-10-22).
    // pricebook: roofing is sold the Pricebook (featureRegistry), and a quote or invoice line is priced from it, with its
    // cost recorded, as for the other trades that sell it; roofing's own app had no pricebook behind the switch at all.
    invoicing: { clientLabel: 'Homeowner', projects: false, jobs: true, quoteJobs: true, quoteNamePlaceholder: 'e.g. Full roof replacement', pricebook: true },
    pricebook: { namePlaceholder: 'e.g. Ridge vent replacement' },
    documents: { projects: false, markup: true, types: DOC_TYPES },
  },
  // templates/website-premium-roofing views/sections/contact/form-info.ejs
  site: {
    design: 'roofing',
    words: {
      contactAddressLabel: 'Office',
      contactMessageLabel: "What you're working on",
      contactMessageRequired: 'Tell us a bit about your project.',
    },
  },
}

export default roof
