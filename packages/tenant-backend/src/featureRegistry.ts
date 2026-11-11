// Central feature registry — THE feature vocabulary for the whole product.
//
// This single file is consumed by the Factory (apps/api re-exports it) AND vendored into every tenant
// at generation as backend/src/shared/featureRegistry.ts. Every place that decides whether a feature is
// on — Factory seeding, the tenant's Settings → Features page (GET /api/company/features/catalog), the
// sidebar gates, PUT /api/company/features validation, plan changes in billing, the boot-time sync —
// reads THESE ids. Nothing else may define feature ids; scripts/check-feature-vocabulary.ts enforces it
// in CI. An entry's templates[] says which products offer it; an id gated in a template that is not
// listed here simply never switches on (that is how unshipped modules stay dark).

export type FeatureDef = {
  id: string
  name: string
  description: string
  category: string
  core: boolean
  templates: string[] // which CRM templates support this feature: 'crm', 'crm-fieldservice', 'crm-landscaping', 'crm-homecare', 'crm-automotive'
  /**
   * If true, the feature is NOT READY: hidden from public surfaces (signup wizard, pricing pages, plan
   * upsell, marketing copy) and never switched on — not by a plan, a signup, an owner's Settings ›
   * Features, or the Factory's admin feature save. (Owner, 2026-10-09: "don't use projects that don't
   * work right yet.") check-not-ready-features.ts holds every one of those paths. Set to false to launch.
   */
  hidden?: boolean
  /**
   * How the feature is spoken of in copy, as word starts matched without case ('financing' also matches "Financing:").
   * While the feature is not ready (hidden), none of these may reach a business or its customers: not the Factory's
   * wizard and price lists, not a composed website, not a screen, page or PDF of a business that has not got it switched
   * on (owner, 2026-10-23: nothing advertises financing until it is live). notReadyWords() is the list;
   * apps/unified/tests/not-ready-unseen.test.ts holds the surfaces to it, with each hidden feature's name and description.
   */
  words?: string[]
  /**
   * Website section types that ARE this feature (the financing calculator is Consumer Financing's). A site renders one
   * only for a business with the feature on, and the Factory's composer offers it only while the feature is ready.
   */
  siteSections?: string[]
  /**
   * Offered to these templates but never in their STARTING set: the business switches it on when it is ready to use
   * it (it needs the business's own Stripe account, or a reader, or it is a bar-only part a restaurant may want), or
   * the Factory's preset for the unified app adds it (apps/api config/industryRouting.ts unifiedFeaturePreset). It
   * stays switchable (getFeaturesForPlan); only getDefaultFeaturesForTemplate leaves it out.
   */
  optIn?: string[]
  /**
   * The name and description a template's businesses see, where the shared one is another trade's: a restaurant's menu
   * is not "Menu & Taps" (taps are Draft Taps, its own switch — restaurant live test, 2026-10-25).
   * getFeaturesForTemplate applies it, so every list read for a template says it.
   */
  as?: Record<string, { name?: string; description?: string; category?: string }>
}

export const FEATURE_REGISTRY: FeatureDef[] = [
  // Core
  { id: 'contacts', name: 'Contacts', description: 'Clients, leads and suppliers in one place', category: 'Core', core: true, templates: ['crm', 'crm-fieldservice', 'crm-basic', 'crm-landscaping', 'crm-homecare', 'crm-automotive', 'crm-roof', 'crm-dispensary', 'crm-rv', 'crm-vet', 'crm-salon', 'crm-restaurant', 'crm-bar', 'crm-store'] },
  { id: 'jobs', name: 'Jobs', description: 'Job tracking and management', category: 'Core', core: true, templates: ['crm', 'crm-fieldservice', 'crm-basic', 'crm-landscaping', 'crm-automotive', 'crm-roof', 'crm-rv'] },
  { id: 'quotes', name: 'Quotes', description: 'Professional estimates and quotes', category: 'Core', core: true, templates: ['crm', 'crm-fieldservice', 'crm-basic', 'crm-landscaping', 'crm-automotive', 'crm-roof', 'crm-rv'] },
  { id: 'invoices', name: 'Invoices', description: 'Invoice generation and tracking', category: 'Core', core: true, templates: ['crm', 'crm-fieldservice', 'crm-basic', 'crm-landscaping', 'crm-automotive', 'crm-roof', 'crm-vet', 'crm-salon', 'crm-restaurant', 'crm-bar', 'crm-rv'] /* not crm-homecare: an agency invoices its clients' visits on its own Billing (Financial › Billing, the home-care add-on's invoices); this is the contact-billed book, a second one nothing of the agency's reads (live test, 2026-10-22) */ },
  { id: 'scheduling', name: 'Scheduling', description: 'Calendar and job scheduling', category: 'Core', core: true, templates: ['crm', 'crm-fieldservice', 'crm-basic', 'crm-landscaping', 'crm-homecare', 'crm-roof', 'crm-dispensary', 'crm-rv'] },
  { id: 'team', name: 'Team', description: 'Team member management', category: 'Core', core: true, templates: ['crm', 'crm-fieldservice', 'crm-basic', 'crm-landscaping', 'crm-homecare', 'crm-dispensary', 'crm-rv', 'crm-vet', 'crm-salon', 'crm-restaurant', 'crm-bar', 'crm-store'] },
  { id: 'dashboard', name: 'Dashboard', description: 'Overview dashboard', category: 'Core', core: true, templates: ['crm', 'crm-fieldservice', 'crm-basic', 'crm-landscaping', 'crm-homecare', 'crm-automotive', 'crm-roof', 'crm-dispensary', 'crm-rv', 'crm-vet', 'crm-salon', 'crm-restaurant', 'crm-bar', 'crm-store'] },

  // Construction
  { id: 'projects', name: 'Projects', description: 'Multi-phase project management', category: 'Construction', core: false, templates: ['crm'] },
  { id: 'rfis', name: 'RFIs', description: 'Request for information tracking', category: 'Construction', core: false, templates: ['crm'] },
  // The pages and backend route have always shipped (SubmittalsPage.tsx,
  // routes/submittals.ts) but no registry entry existed, so the sidebar gate
  // could never open and the feature was invisible to sales.
  { id: 'submittals', name: 'Submittals', description: 'Product submittal and approval workflow tracking', category: 'Construction', core: false, templates: ['crm'] },
  { id: 'change_orders', name: 'Change Orders', description: 'Change order management', category: 'Construction', core: false, templates: ['crm'] },
  { id: 'punch_lists', name: 'Punch Lists', description: 'Punch list tracking', category: 'Construction', core: false, templates: ['crm'] },
  // NOT READY until the owner has tested it: one allowance covering several selections, overages to the revised budget and WIP (contractor parity row 7).
  { id: 'shared_allowances', name: 'Shared allowances', description: 'One allowance covers several selections; what they go over is raised as a change order and shows on the revised budget and the WIP report', category: 'Construction', core: false, templates: ['crm'], hidden: true },
  // NOT READY until the owner has tested it: templates carry the budget, the selections and the schedule's links, ticked on saving and starting (contractor parity row 7b).
  { id: 'template_parts', name: 'Templates: budget, selections and links', description: 'A project template also keeps the budget lines, the selections and allowances and the links between tasks; tick which parts to keep and which to bring in', category: 'Construction', core: false, templates: ['crm'], hidden: true },
  // NOT READY until the owner has tested it: links between schedule tasks, and linked tasks moving with the one they wait on (contractor parity row 7c).
  { id: 'task_links', name: 'Task links on the schedule', description: 'Link a task to the one it waits on (after it ends, or when it starts, plus a lag); move a task and the tasks linked to it move with it', category: 'Construction', core: false, templates: ['crm'], hidden: true },
  { id: 'schedule_baseline', name: 'Schedule Baseline', description: 'Save a project’s schedule as its baseline, then see each task’s plan against where it stands — days late or early, and the finish', category: 'Projects', core: false, templates: ['crm'], hidden: true, words: ['schedule baseline', 'baseline'] },
  { id: 'builders_risk', name: "Builder's Risk & Square Footage", description: "Each project's square footage — price and budget per square foot — and its builder's risk policy, flagged as it nears its end", category: 'Projects', core: false, templates: ['crm'], hidden: true, words: ["builder's risk", 'square footage', 'per square foot'] },
  // NOT READY until the owner has tested it: parameters on a job or quote and line quantities / prices as formulas (contractor parity row 9; JobTread).
  { id: 'quote_formulas', name: 'Formula estimating', description: 'Parameters on a job or quote (square feet, wall height, openings); line quantities and prices as formulas over them and other lines, worked out again when a parameter changes', category: 'Construction', core: false, templates: ['crm'], hidden: true },
  // NOT READY until the owner has tested it: the client portal finished for contractors — per-project settings, schedule, daily logs, photos, to-dos, payment schedule, documents to sign, notices (contractor parity row 10).
  { id: 'client_portal_plus', name: 'Client portal: schedule, daily logs, to-dos and more', description: 'Choose per project what the client sees in their portal — the schedule, the daily logs and photos you share, their to-dos, the payment schedule, documents to sign — and what they are emailed about', category: 'Construction', core: false, templates: ['crm'], hidden: true },
  // NOT READY until the owner has tested it: the contractor's phone — projects, daily logs, punch list, to-dos, change orders, selections, files, inspections, clocked to a project and cost code (contractor parity row 11).
  { id: 'contractor_phone', name: 'Projects on the phone', description: 'The phone app opens each project: today’s daily log with photos, the punch list, to-dos, change orders, selections, files and inspections, saved with no signal; and the clock takes a project and a cost code', category: 'Construction', core: false, templates: ['crm'], hidden: true },
  // NOT READY until the owner has tested them (contractor parity row 12; Jobber / Buildertrend / JobTread Payments):
  { id: 'payment_method_choice', name: 'Card, bank or both, per invoice', description: 'Choose on each invoice whether the customer pays online by card, by bank (ACH) or either', category: 'Finance', core: false, templates: ['crm'], hidden: true },
  { id: 'invoice_tips', name: 'Tips on invoices', description: 'Customers can add a tip when they pay an invoice online; it is kept apart from what the invoice owes', category: 'Finance', core: false, templates: ['crm'], hidden: true },
  { id: 'payment_plans', name: 'Invoice installments', description: 'Split an invoice into installments with their own due dates; customers pay each from their portal and are reminded of each', category: 'Finance', core: false, templates: ['crm'], hidden: true },
  // NOT READY until the owner has tested it: the menu folded to a rail of icons, kept per user (contractor parity row 8; packages/tenant-ui shell/AppShell.tsx).
  { id: 'nav_rail', name: 'Collapse the menu to icons', description: 'Each person can fold the left menu down to a narrow rail of icons, and it stays that way for them', category: 'Construction', core: false, templates: ['crm'], hidden: true },
  { id: 'project_templates', name: 'Project Templates', description: 'Save a project as a template — its schedule and starter punch list — and start the next one from it', category: 'Construction', core: false, templates: ['crm'], hidden: true },
  { id: 'daily_logs', name: 'Daily Logs', description: 'Field daily log reports', category: 'Construction', core: false, templates: ['crm'] },
  { id: 'inspections', name: 'Inspections', description: 'Quality inspections', category: 'Construction', core: false, templates: ['crm'] },
  { id: 'inspection_checklists', name: 'Inspection Checklists', description: 'Checklists for each inspection — pass, fail or not applicable with a note and photos; a failed line adds a punch-list item', category: 'Construction', core: false, templates: ['crm'], hidden: true },
  { id: 'phone_inspections', name: 'Inspections on the Phone', description: 'Crew answer an inspection\'s checklist and add photos from the phone, on the jobs they are on', category: 'Construction', core: false, templates: ['crm'], hidden: true },
  { id: 'inspection_signature', name: 'Inspection Sign-off', description: 'The customer signs an inspection checklist on the phone, with the same record a signed quote keeps', category: 'Construction', core: false, templates: ['crm'], hidden: true },
  { id: 'inspection_auto_checklists', name: 'Automatic Inspection Checklists', description: 'A new inspection gets the right checklist by itself, by its type and the kinds of job on the project', category: 'Construction', core: false, templates: ['crm'], hidden: true },
  { id: 'bid_management', name: 'Bid Management', description: 'Bid tracking and submission', category: 'Construction', core: false, templates: ['crm'] },
  { id: 'takeoff_tools', name: 'Takeoff Tools', description: 'Material takeoff calculations', category: 'Construction', core: false, templates: ['crm'] },
  { id: 'selections', name: 'Selections', description: 'Client material selections portal', category: 'Construction', core: false, templates: ['crm'] },

  // Service Trade
  { id: 'drag_drop_calendar', name: 'Drag & Drop Calendar', description: 'Drag jobs to another day or hour on the Schedule (day, week and month views)', category: 'Service Trade', core: false, templates: ['crm', 'crm-fieldservice', 'crm-basic', 'crm-landscaping', 'crm-roof'] /* roofing: its Schedule is the shared page, and a roofing job's day and time are PUT /api/jobs/:id like every trade's (live test 2026-10-22: "no calendar drag"). */ },
  // The page behind this id (Recurring Invoices, /crm/recurring) bills a customer on a schedule; it never made jobs. It was
  // sold as "Recurring Jobs", and testers looked for jobs that repeat (live test 2026-10-22). Named for what it does.
  { id: 'recurring_jobs', name: 'Recurring Invoices', description: 'Invoices that bill a customer on a schedule — weekly to yearly', category: 'Service Trade', core: false, templates: ['crm', 'crm-fieldservice', 'crm-basic', 'crm-landscaping'] },
  { id: 'route_optimization', name: 'Route Optimization', description: 'Optimize daily service routes', category: 'Service Trade', core: false, templates: [] /* offered to no industry: no screen in any industry's menu or pages (scripts/check-unified-feature-has-screen.ts, live test 2026-10-22). The id stays because the server still gates its API on it. */ },
  { id: 'online_booking', name: 'Online Booking', description: 'Customer self-scheduling', category: 'Scheduling', core: false, templates: ['crm', 'crm-fieldservice', 'crm-basic', 'crm-landscaping', 'crm-salon', 'crm-vet'] },
  // The dispatch board is dispatch_board's (/crm/dispatch); this second id for it opened nothing. Offered to no industry —
  // contractor and basic, which had only this one, are offered dispatch_board instead (live test 2026-10-22).
  { id: 'service_dispatch', name: 'Service Dispatch', description: 'Real-time dispatch board', category: 'Service Trade', core: false, templates: [] },
  { id: 'service_agreements', name: 'Service Agreements', description: 'Maintenance agreement management', category: 'Service Trade', core: false, templates: ['crm-fieldservice', 'crm-basic', 'crm-landscaping', 'crm'] },
  { id: 'warranties', name: 'Warranties', description: 'Warranty tracking', category: 'Service Trade', core: false, templates: ['crm', 'crm-fieldservice', 'crm-basic', 'crm-landscaping', 'crm-rv'] },
  { id: 'recurring_routes', name: 'Recurring Route Board', description: 'Weekly mow routes grouped into per-day crew routes', category: 'Landscaping', core: false, templates: ['crm-landscaping'] },
  { id: 'area_pricing', name: 'Area-Based Pricing', description: 'Price services by measured property square footage', category: 'Landscaping', core: false, templates: ['crm-landscaping'] },
  // NOT READY until the owner has tested it: a PDF of the property's measured shapes over its satellite picture (apps/unified server/crm/landscaping/measurePrint.ts).
  // NOT READY until the owner has tested it: the Route Board finished (apps/unified server/crm/landscaping/recurringRoutes.ts).
  { id: 'route_board_tools', name: 'Route Board: seasons, drag and crew clashes', description: 'A season for each route with next season’s renewal, drag stops into order, a new stop’s visits made at once, the best order worked out from your yard, and a warning when the crew is already booked', category: 'Landscaping', core: false, templates: ['crm-landscaping'], hidden: true },
  // NOT READY until the owner has tested it: takeoffs on uploaded plans (apps/unified server/crm/landscaping/planTakeoffs.ts).
  { id: 'plan_takeoffs', name: 'Plan takeoffs', description: 'Upload a site plan (PDF or picture), set its scale, measure areas, lengths and counts on it, and put them on a quote', category: 'Landscaping', core: false, templates: ['crm-landscaping'], hidden: true },
  // NOT READY, and needs an imagery provider account first: finding lawn, beds and hardscape from the air (apps/unified server/data/aerialDetect.ts).
  { id: 'aerial_detect', name: 'Find areas from the air', description: 'Outline the lawn, beds and hardscape on the satellite map automatically, to check and adjust before saving', category: 'Landscaping', core: false, templates: ['crm-landscaping'], hidden: true },
  // NOT READY until the owner has tested it: the operating budget (apps/unified server/crm/landscaping/companyBudget.ts, data/companyBudget.ts).
  { id: 'company_budget', name: 'Budget, overhead and markup', description: 'Build the year’s operating budget — sales, field labour with burden and overtime, equipment, materials, subs and overhead with your own salary — choose how overhead is recovered (MORS, FLH or SORS), lock the active budget, and price quotes from it', category: 'Landscaping', core: false, templates: ['crm-landscaping'], hidden: true },
  // NOT READY until the owner has tested it: copy a route and route templates (apps/unified server/crm/landscaping/routeTemplates.ts).
  { id: 'route_copy', name: 'Copy routes and route templates', description: 'Copy a route — its stops in order, crew, start time, billing and season — to another day or as a new route, and save a route as a template to make routes from', category: 'Landscaping', core: false, templates: ['crm-landscaping'], hidden: true },
  // NOT READY until the owner has tested it: more repeat patterns and editing this and future visits (tenant-backend jobs.ts, time/series.ts).
  { id: 'job_repeat_patterns', name: 'More repeat patterns', description: 'Repeat a job every few days with days to skip, on the 1st and 3rd Friday of the month, or every year; a series of up to a year of visits; and change this visit and every later one at once', category: 'Landscaping', core: false, templates: ['crm-landscaping'], hidden: true },
  // NOT READY until the owner has tested it: snow finished (apps/unified server/crm/landscaping/snowBilling.ts, snowStorm.ts, data/snowForecast.ts).
  { id: 'snow_tools', name: 'Snow: depth bands, photos, salt by amount and the forecast', description: 'Price snow by depth bands, change a visit’s price before billing with a reason, require before and after photos, bill salt by the ton or bag (marked up on time and materials), text every customer on a storm, scale each stop’s time by the snowfall, and start a storm from the forecast', category: 'Landscaping', core: false, templates: ['crm-landscaping'], hidden: true },
  { id: 'measure_print', name: 'Print measurements', description: 'A PDF of the property’s drawn shapes over its satellite picture, each labelled with what it measures and its area, with the totals by type', category: 'Landscaping', core: false, templates: ['crm-landscaping'], hidden: true },
  // NOT READY until the owner has tested it: the rain day, finished (apps/unified server/crm/landscaping/rainDay.ts).
  { id: 'rain_day_tools', name: 'Rain day: whole weeks, undo and the forecast', description: 'Push a run of days at once or move a day to a chosen date, undo a rain day, have a big one run in the background and email when done, and see the week’s weather against the route days', category: 'Landscaping', core: false, templates: ['crm-landscaping'], hidden: true },
  // NOT READY until the owner has tested them: the crew's day on the phone (apps/unified server/crm/landscaping/crewDay.ts).
  { id: 'crew_day_map', name: 'Map of the day and Finish Day', description: 'The crew’s stops for the day on a map, numbered in route order with the next stop marked, and an end-of-day recap: done, could not do, still open, hours and the notes still owed', category: 'Landscaping', core: false, templates: ['crm-landscaping'], hidden: true },
  { id: 'visit_skip', name: 'Could not do it', description: 'The crew marks a visit as not done with a reason (weather, a locked gate, the customer asked…) and whether it needs rebooking; the office rebooks or closes it from the Route Board', category: 'Landscaping', core: false, templates: ['crm-landscaping'], hidden: true },
  { id: 'visit_materials', name: 'Materials used on a visit', description: 'The crew records the materials and quantities used on each visit from the phone, from the price book or typed in; they count in the job’s material cost', category: 'Landscaping', core: false, templates: ['crm-landscaping'], hidden: true },
  { id: 'crew_timers', name: 'Crew timers and Crew Score', description: 'The crew lead starts and stops each crew member’s own clock on a visit, and the Crew Score compares each crew’s budget hours with the hours worked', category: 'Landscaping', core: false, templates: ['crm-landscaping'], hidden: true },
  // NOT READY until the owner has tested it: the customer is messaged when a visit is done (apps/unified server/data/visitReports.ts).
  { id: 'visit_reports', name: 'Visit-done messages', description: 'Tell the customer a visit is done, with the crew\'s note and the after-photos', category: 'Landscaping', core: false, templates: ['crm-landscaping'], hidden: true },
  // NOT READY until the owner has tested it: the office side of the visit-done message (apps/unified server/crm/landscaping/visitReports.ts).
  { id: 'visit_message_tools', name: 'Visit messages: office screen and wording', description: 'See every visit-done message — sent, when, how, any failure and a copy of what the customer got — preview and send again, write the text and email in your own words, and choose services or route stops that are never messaged', category: 'Landscaping', core: false, templates: ['crm-landscaping'], hidden: true },
  // NOT READY until the owner has tested it: the customer's rating after a visit (apps/unified server/crm/landscaping/visitFeedback.ts).
  { id: 'visit_survey', name: 'Feedback after a visit', description: 'The visit-done message asks the customer to rate the visit 1 to 5 with a comment; the rating shows beside the visit and a low one emails the office', category: 'Landscaping', core: false, templates: ['crm-landscaping'], hidden: true },
  { id: 'snow_billing', name: 'Snow & Ice Billing', description: 'Per-push, per-event and per-inch snow billing; a seasonal contract leaves its visits uncharged (bill the season itself with a recurring invoice)', category: 'Landscaping', core: false, templates: ['crm-landscaping'] },
  { id: 'pricebook', name: 'Pricebook', description: 'Standardized pricing catalog', category: 'Service Trade', core: false, templates: ['crm', 'crm-fieldservice', 'crm-basic', 'crm-landscaping', 'crm-roof'] /* not crm-homecare: an agency has no quotes or invoices to price (owner, 2026-10-19) */ },

  // Field Service
  { id: 'photo_folders', name: 'Photo Folders', description: 'A job’s photos in folders — before, during, after, progress, damage and more — with each folder’s count, a folder picked when a photo is added, and photos moved between them', category: 'Field Service', core: false, templates: ['crm', 'crm-fieldservice', 'crm-basic', 'crm-landscaping'], hidden: true },
  { id: 'job_change_orders', name: 'Change Orders on Jobs', description: 'A change to a job’s price agreed with the customer — sent to sign in their portal, and billed as its own line on the job’s invoice', category: 'Field Service', core: false, templates: ['crm-fieldservice', 'crm-landscaping'], hidden: true },
  { id: 'portal_booking', name: 'Book from the Portal', description: 'Customers book a visit from their portal, with their details already filled in, and see the bookings they have made', category: 'Field Service', core: false, templates: ['crm-fieldservice', 'crm-basic', 'crm-landscaping'], hidden: true },
  { id: 'days_off', name: 'Days Off', description: 'Holidays and other days the whole business is closed: online booking offers no time on them, a job booked on one is checked first, and a plan visit that falls on one moves to the next open day', category: 'Field Service', core: false, templates: ['crm', 'crm-fieldservice', 'crm-basic', 'crm-landscaping', 'crm-roof'], hidden: true },
  { id: 'dispatch_board', name: 'Dispatch Board', description: 'A day of jobs by technician on one board — assign, reassign and set status', category: 'Field Service', core: false, templates: ['crm-fieldservice', 'crm-landscaping', 'crm', 'crm-basic'] },
  { id: 'maintenance_contracts', name: 'Maintenance Contracts', description: 'Maintenance plans whose included visits go on the Schedule for each term', category: 'Field Service', core: false, templates: ['crm-fieldservice', 'crm-landscaping'] },
  { id: 'flat_rate_pricebook', name: 'Flat-Rate Pricebook', description: 'Standard pricing for common services', category: 'Field Service', core: false, templates: ['crm-fieldservice', 'crm-landscaping'] },
  { id: 'parts_tracking', name: 'Parts & Inventory', description: 'Track parts, stock levels, and usage', category: 'Field Service', core: false, templates: ['crm-fieldservice', 'crm-landscaping', 'crm-rv'] },

  // Automotive
  { id: 'vehicle_inventory', name: 'Vehicle Inventory', description: 'VIN decode, stock management, pricing', category: 'Automotive', core: false, templates: ['crm-automotive'] },
  { id: 'sales_pipeline', name: 'Sales Pipeline', description: 'Kanban lead pipeline with ADF/XML import', category: 'Automotive', core: false, templates: ['crm-automotive'] },
  { id: 'service_department', name: 'Service Department', description: 'Repair orders and service check-in', category: 'Automotive', core: false, templates: ['crm-automotive'] },
  { id: 'service_to_sales', name: 'Service-to-Sales Bridge', description: 'Alert salespeople when their leads check into service', category: 'Automotive', core: false, templates: ['crm-automotive'] },

  // RV / Powersports (crm-rv) — dealership CRM layer (not a DMS)
  { id: 'unit_inventory', name: 'Unit Inventory', description: 'New/used/consignment units with VIN decode, floor-plan image, photos and full specifications', category: 'RV / Powersports', core: true, templates: ['crm-rv'] },
  { id: 'deal_pipeline', name: 'Sales Pipeline', description: 'Kanban pipeline linking each lead to a unit of interest, by stage and salesperson', category: 'RV / Powersports', core: true, templates: ['crm-rv'] },
  { id: 'service_dept', name: 'Service Department', description: 'Repair orders with a technician, service drop-offs on the Schedule, and service-to-sales alerts', category: 'RV / Powersports', core: true, templates: ['crm-rv'] },
  { id: 'deal_desk', name: 'Deal Desk', description: 'Structure deals with payment calculator, fees, tax and trade allowance', category: 'RV / Powersports', core: false, templates: ['crm-rv'] },
  { id: 'trade_in', name: 'Trade-In Management', description: 'Appraise trades, attach to a deal, recondition and roll back into used inventory', category: 'RV / Powersports', core: false, templates: ['crm-rv'] },
  { id: 'recall_lookup', name: 'Recall Lookup', description: 'Look up NHTSA recalls by VIN, unit or year/make/model (CPSC for off-road) — the recalls for that model, not whether this unit\'s was done', category: 'RV / Powersports', core: false, templates: ['crm-rv'] },
  { id: 'inventory_syndication', name: 'Marketplace Syndication', description: 'A listings feed of your available units that RV Trader, RVUSA, RVT, Cycle Trader, ATV Trader or a feed service can be set up to pull', category: 'RV / Powersports', core: false, templates: ['crm-rv'] },
  { id: 'service_status_texts', name: 'Service Status Updates', description: 'Automatic texts to the customer when a repair order is being worked on, waiting for parts, or ready for pickup', category: 'RV / Powersports', core: false, templates: ['crm-rv'] },
  { id: 'follow_up_sequences', name: 'Automated Follow-Up', description: 'Multi-step email follow-ups, sent on a delay after a lead is enrolled, for long RV/powersports research cycles', category: 'RV / Powersports', core: false, templates: ['crm-rv'] },

  // Veterinary (crm-vet) — client-relationship + preventive-care record (retention layer, not a clinical PIMS)
  // The wording here is what a prospect is sold. Three of these described things the app does not do — a
  // patient photo (the column exists; no screen sets or shows one), a calendar by provider (the schedule is
  // a day list that names each appointment's provider), and a "controlled-substance" line that read as if
  // controlled drugs could not be recorded at all, next to a form with exactly that checkbox. Each now says
  // what the product does. (Vet T12 L6)
  { id: 'patient_records', name: 'Patient Records', description: 'Pets linked to owners — multi-pet households, signalment, allergies/alerts, weight history', category: 'Veterinary', core: true, templates: ['crm-vet'] },
  { id: 'appointment_scheduling', name: 'Appointments', description: 'Day schedule showing each appointment\'s provider and type (wellness, sick, surgery, dental), with check-in', category: 'Veterinary', core: true, templates: ['crm-vet'] },
  { id: 'medical_records', name: 'Medical Records', description: 'Per-visit SOAP notes, vitals, problem/diagnosis list and treatments', category: 'Veterinary', core: true, templates: ['crm-vet'] },
  { id: 'vaccinations', name: 'Vaccinations', description: 'Vaccine history with due dates that drive reminders and rabies certificates', category: 'Veterinary', core: true, templates: ['crm-vet'] },
  { id: 'reminders_recall', name: 'Reminders & Recall', description: 'Vaccine-due reminder texts — sent automatically on the clinic\'s own schedule once switched on, or by hand — and a lapsed-client list to win back', category: 'Veterinary', core: true, templates: ['crm-vet'] },
  { id: 'wellness_plans', name: 'Wellness Plans', description: 'Preventive-care memberships billed monthly or yearly, each renewal invoiced as it comes due', category: 'Veterinary', core: false, templates: ['crm-vet'] },
  { id: 'lab_results', name: 'Lab Results', description: 'Record and attach lab/diagnostic results to the patient', category: 'Veterinary', core: false, templates: ['crm-vet'] },
  { id: 'rabies_certificates', name: 'Rabies Certificates', description: 'Generate printable rabies vaccination certificates from the vaccine record', category: 'Veterinary', core: false, templates: ['crm-vet'] },
  { id: 'prescriptions', name: 'Prescriptions', description: 'Prescription records with prescriber, refills and a controlled-substance flag; dispensing, EPCS and PDMP reporting are not included', category: 'Veterinary', core: false, templates: ['crm-vet'] },

  // Salon & Barber (crm-salon) — the retention archetype: service menu → the
  // book → formula record → rebooking reminder. Every id here gates exactly one
  // sidebar item in the template; nothing is listed that the app doesn't act on.
  { id: 'client_profiles', name: 'Client Profiles', description: 'Per-client chart — hair type, allergies and patch-test dates, preferences, regular stylist, lifetime value', category: 'Salon & Barber', core: true, templates: ['crm-salon'] },
  { id: 'service_menu', name: 'Service Menu', description: 'Priced menu with durations and per-service rebook intervals — the input to rebooking reminders', category: 'Salon & Barber', core: true, templates: ['crm-salon'] },
  { id: 'salon_booking', name: 'The Book', description: 'Chair and stylist scheduling with check-in, duration from the menu, and double-book protection', category: 'Salon & Barber', core: true, templates: ['crm-salon'] },
  { id: 'card_on_file', name: 'Client cards and no-show fees', description: 'Clients leave a card on Stripe\'s own page; a no-show or late-cancel fee is charged to it from The Book with one confirmed action and a receipt — all on your own Stripe account', category: 'Salon & Barber', core: false, templates: ['crm-salon'], hidden: true },
  { id: 'portal_appointments', name: 'Appointments in the client portal', description: 'A client sees their upcoming appointments in their portal and can move or cancel one booked online through its private link', category: 'Salon & Barber', core: false, templates: ['crm-salon'], hidden: true },
  { id: 'book_grid', name: 'Book time grid and blocked time', description: 'The Book as a time grid with a column per stylist, drag to move or resize, and blocked time (lunch, training) that online booking respects', category: 'Salon & Barber', core: false, templates: ['crm-salon'], hidden: true },
  // NOT READY until the owner has tested it: a service as a sequence of steps — hands-on, processing, blocked, extra — any number, in order (salon parity row 7; Fresha).
  { id: 'service_segments', name: 'Service steps: processing, blocked and extra time', description: 'Give a service several steps in order — hands-on, processing (the stylist is free), blocked and extra time; the Book, clash checks and online booking all follow them', category: 'Salon & Barber', core: false, templates: ['crm-salon'], hidden: true },
  // NOT READY until the owner has tested it: change a booked several-service visit — add, remove, re-time, re-assign a service; the client's requested stylist per service; one visit record per service (salon parity row 8; Fresha, Square).
  { id: 'visit_editing', name: 'Change a booked several-service visit', description: 'Add, remove, move or re-assign one service of a booked visit with the same clash checks; mark the stylist the client asked for; each service gets its own visit record and formula', category: 'Salon & Barber', core: false, templates: ['crm-salon'], hidden: true },
  { id: 'salon_client_app', name: 'Your own client app', description: "Clients put the salon's portal on their phone in the salon's name and colours (book, rebook, gift cards, memberships), and the salon can list itself in the directory. No commission", category: 'Salon & Barber', core: false, templates: ['crm-salon'], hidden: true },
  { id: 'reserve_with_google', name: 'Reserve with Google', description: "Clients find the salon on Google Search and Maps and book on its own page; Google's referrals are reported so the salon is credited. Needs Twomiah's Google partner approval", category: 'Salon & Barber', core: false, templates: ['crm-salon'], hidden: true },
  { id: 'online_multi_service', name: 'Book several services online', description: 'Clients add more services to one online booking, each with its own stylist or whoever is free; deposits, cards and forms cover them all', category: 'Salon & Barber', core: false, templates: ['crm-salon'], hidden: true },
  { id: 'processing_time', name: 'Processing time', description: 'A service can free its stylist while colour processes, so another client can be booked into the gap', category: 'Salon & Barber', core: false, templates: ['crm-salon'], hidden: true },
  { id: 'client_stylist_pick', name: 'Choose your stylist online', description: 'Clients booking online can pick who they book with, and are offered only that stylist\'s times', category: 'Salon & Barber', core: false, templates: ['crm-salon'], hidden: true },
  { id: 'intake_forms', name: 'Intake and consent forms', description: 'Forms a client fills in from their booking page (health history, consent to a service); the answers land on their chart', category: 'Salon & Barber', core: false, templates: ['crm-salon'], hidden: true },
  { id: 'salon_commissions', name: 'Stylist commissions', description: 'Pay each stylist a commission on their completed, paid visits: one rate for services, another for retail, optional monthly tiers; earned automatically, approved, paid out, with statements', category: 'Salon & Barber', core: false, templates: ['crm-salon'], hidden: true },
  { id: 'salon_gift_cards', name: 'Gift cards sold at the desk and spent at checkout', description: 'Sell your own gift cards at the desk (paid by cash, cheque or card), spend them as a payment on any sale, look up a balance, correct or void a card; a refund by gift card goes back onto the card. No expiry, no fees, every change on a ledger', category: 'Salon & Barber', core: false, templates: ['crm-salon'], hidden: true },
  { id: 'chair_checkout', name: 'Card reader at the chair, with the tip going to the stylist', description: 'The client pays on a Stripe card reader at the desk or the chair, on the salon\'s own Stripe account. The tip is chosen at the desk and recorded for the stylist; a split bill can be part cash, part gift card, part card. Works with Stripe\'s simulated reader for setting up', category: 'Salon & Barber', core: false, templates: ['crm-salon'], hidden: true },
  { id: 'salon_retail', name: 'Retail products with stock, sold at checkout', description: 'The products the salon sells off the shelf, with the count on hand, a reorder level, stock received and corrected, and sold onto a client\'s sale (or a walk-in sale) so the stylist earns retail commission', category: 'Salon & Barber', core: false, templates: ['crm-salon'], hidden: true },
  { id: 'salon_reports', name: 'Client retention, rebooking and retail reports', description: 'How many clients came back, how often, who has slipped away, each stylist\'s rebook rate, and retail sold by item and by stylist', category: 'Salon & Barber', core: false, templates: ['crm-salon'], hidden: true },
  { id: 'retention_sends', name: 'Automatic rebooking and win-back messages', description: 'Texts or emails that go out by themselves: rebook on the due date, birthday, win-back after a lapse, and a book-your-next-visit prompt after a completed visit; quiet hours and opt-outs respected', category: 'Salon & Barber', core: false, templates: ['crm-salon'], hidden: true },
  { id: 'booth_rent', name: 'Booth rent', description: 'Chair renters on the Team pay the salon rent on a schedule (weekly or monthly): an invoice on each due day, optional autopay from the renter\'s card on the salon\'s own Stripe with the same retry rules as memberships, a ledger and a statement for each renter', category: 'Salon & Barber', core: false, templates: ['crm-salon'], hidden: true },
  { id: 'multi_service_visits', name: 'Multi-service visits', description: 'One visit with several services in order, each with its own stylist, time and price, checked out together', category: 'Salon & Barber', core: false, templates: ['crm-salon'], hidden: true },
  { id: 'rebooking_reminders', name: 'Rebooking & Recall', description: 'Who is due back, who has lapsed, whose birthday is coming — with bulk texting', category: 'Salon & Barber', core: true, templates: ['crm-salon'] },
  { id: 'salon_memberships', name: 'Memberships & Packages', description: 'Recurring memberships and prepaid visit packages that burn down per redeem', category: 'Salon & Barber', core: false, templates: ['crm-salon'] },

  // Bar (crm-bar) — what a bar changes every night and its website shows live (routes/bar.ts, barPublic.ts).
  { id: 'bar_menu', name: 'Menu & Taps', description: 'The menu with real prices and one-tap 86, and the tap list — shown live on your website', category: 'Bar', core: true, templates: ['crm-bar', 'crm-restaurant'], optIn: ['crm-restaurant'],
    as: { 'crm-restaurant': { name: 'Menu', description: 'The menu with real prices, photos and one-tap 86 — shown live on your website', category: 'Register & Ordering' } } },
  { id: 'bar_register', name: 'Register & Grill', description: "Tabs, tables and walk-ups; send food to the grill screen, which paces it; take cash or card; split; voids a manager OKs; the night's close-out with the drawer count", category: 'Bar', core: true, templates: ['crm-bar', 'crm-restaurant'], optIn: ['crm-restaurant'],
    as: { 'crm-restaurant': { category: 'Register & Ordering' } } },
  // Offered to a restaurant too, opt-in, in the kitchen's words (restaurant-bar-depth #8): the same stock, count, recipes and
  // orders, and the same week to build and publish, proven on a restaurant tenant (tests/restaurant-kitchen-stock-schedule.test.ts).
  { id: 'bar_stock', name: 'Stock & Costing', description: 'Stock by the case and the keg, recipes, the count, what each plate and pour costs, what to reorder and the order to the rep', category: 'Bar', core: true, templates: ['crm-bar', 'crm-restaurant'], optIn: ['crm-restaurant'],
    as: { 'crm-restaurant': { name: 'Kitchen Stock & Costing', description: 'Stock by the case and the keg, recipes, the count, what each plate and pour costs against what the register sold, what to reorder and the order to the supplier', category: 'Register & Ordering' } } },
  { id: 'bar_schedule', name: 'Schedule', description: 'Build the week, see the gaps and the labor cost before you publish it, time off asked for and decided — and clock in on the bar tablet by PIN', category: 'Bar', core: true, templates: ['crm-bar', 'crm-restaurant'], optIn: ['crm-restaurant'],
    as: { 'crm-restaurant': { name: 'Staff Schedule', description: 'Build the week for the kitchen and floor, see the gaps and the labor cost before you publish it, time off asked for and decided — and clock in on the counter tablet by PIN', category: 'Register & Ordering' } } },
  // Counting by how full each open bottle is (restaurant-bar-depth #13). NOT READY (hidden) until the owner has tested it.
  { id: 'stock_fill_levels', name: 'Fill-Level Count', description: 'On the count, slide each open bottle to how full it is; the variance reads the same count', category: 'Bar', core: false, templates: ['crm-bar', 'crm-restaurant'], hidden: true },
  // The menu by time of day and 86 until we open (restaurant-bar-depth #11). NOT READY (hidden) until the owner has tested it.
  { id: 'menu_dayparts', name: 'Menu by Time of Day', description: 'Show lunch, dinner or brunch only in their hours on the website and the register, and have an 86 come back by itself when you next open', category: 'Register & Ordering', core: false, templates: ['crm-bar', 'crm-restaurant'], hidden: true },
  // An item count that counts down and refreshes (restaurant-bar parity row 13, Toast). NOT READY (hidden) until the owner has tested it.
  { id: 'menu_item_counts', name: 'Item Counts', description: 'Set how many of an item are left; each sale takes one, it 86es itself at zero, and the count comes back at open or when staff set it - shown on the register, the kiosk and online', category: 'Bar', core: false, templates: ['crm-bar', 'crm-restaurant'], hidden: true },
  // A card held for a tab, taken when the tab is closed (restaurant-bar-depth #12). NOT READY (hidden) until the owner has tested it on a real reader.
  { id: 'bar_tab_preauth', name: 'Card Tabs', description: 'Hold a guest\'s card on the counter reader for a tab, then take the check and the tip off it when they close out; a voided check lets the hold go', category: 'Register & Ordering', core: false, templates: ['crm-bar', 'crm-restaurant'], hidden: true },
  // Tip pooling and tip-out on the close-out (restaurant-bar-depth #9). NOT READY (hidden) until the owner has tested it.
  { id: 'bar_tip_pooling', name: 'Tip Pooling', description: 'Pool tips by role and hours, take tip-outs for the barback or the kitchen, and see who gets what on the close-out', category: 'Bar', core: false, templates: ['crm-bar', 'crm-restaurant'], hidden: true },
  // Availability windows and shift swaps (restaurant-bar-depth #10). NOT READY (hidden) until the owner has tested them.
  { id: 'bar_declared_tips', name: 'Declared Cash Tips', description: 'Staff declare the cash tips they were handed when they clock out; a manager sees and corrects them, and they join the tip pool, the tip-out and the payroll export', category: 'Bar', core: false, templates: ['crm-bar', 'crm-restaurant'], hidden: true },
  { id: 'bar_tip_import', name: 'Tips From Another Register', description: 'Bring in the tips taken on Toast or Square for a venue whose register is not ours, matched to your staff, into the same tip pool and tip-out rules', category: 'Bar', core: false, templates: ['crm-bar', 'crm-restaurant'], hidden: true },
  // Invoice scanning for receiving (restaurant-bar parity #7). NOT READY (hidden) until the owner has tested it.
  { id: 'bar_invoice_scan', name: 'Invoice Scanning', description: 'Photograph or upload a supplier invoice; it is read into lines, matched to your stock items, checked by a person, and only then received into the counts and costs', category: 'Bar', core: false, templates: ['crm-bar', 'crm-restaurant'], hidden: true },
  // Payroll export (restaurant-bar parity #8). NOT READY (hidden) until the owner has uploaded a real file to Gusto or ADP.
  { id: 'bar_payroll_export', name: 'Bar Payroll Export', description: 'A pay period\'s hours, overtime, tips, tip-outs and pooled tips for each person, as a file for Gusto, ADP or a spreadsheet', category: 'Bar', core: false, templates: ['crm-bar', 'crm-restaurant'], hidden: true },
  // Sales-driven labor forecast beside the schedule (restaurant-bar parity #9). NOT READY (hidden) until the owner has tried it on real sales.
  { id: 'bar_labor_forecast', name: 'Labor Forecast', description: 'Sales forecast by day and hour from the register\'s history and the booked events, and the staff each position needs against your target labor percent, shown beside the schedule before you publish', category: 'Bar', core: false, templates: ['crm-bar', 'crm-restaurant'], hidden: true },
  { id: 'bar_availability', name: 'Staff Availability', description: 'Staff say when they can work; the schedule flags a shift outside it', category: 'Bar', core: false, templates: ['crm-bar', 'crm-restaurant'], hidden: true },
  { id: 'bar_shift_swaps', name: 'Shift Swaps', description: 'Staff give a shift away or swap it with a colleague; a manager approves before anything moves', category: 'Bar', core: false, templates: ['crm-bar', 'crm-restaurant'], hidden: true },
  { id: 'gift_cards', name: 'Gift Cards', description: 'Your own gift cards: sold on the register, spent like cash, balance looked up by number — no expiry, no fees, every change on a ledger', category: 'Bar', core: true, templates: ['crm-bar'] },
  // Food service on the register (apps/unified server/crm/bar barTerminal.ts, barOrders.ts): the business's own Stripe.
  { id: 'card_reader', name: 'Card Reader', description: 'Take cards on a Stripe card reader at the register: the amount goes to the reader, the payment is recorded when Stripe confirms it, tips on the reader, refunds back to the card', category: 'Register & Ordering', core: false, templates: ['crm-bar', 'crm-restaurant'], optIn: ['crm-bar', 'crm-restaurant'] },
  { id: 'order_kiosk', name: 'Order Kiosk', description: 'A self-serve tablet: guests browse the menu with sizes and add-ons, order under their name or table, and pay on the card reader or at the counter; paid orders go to the grill marked KIOSK', category: 'Register & Ordering', core: false, templates: ['crm-bar', 'crm-restaurant'], optIn: ['crm-bar', 'crm-restaurant'] },
  { id: 'online_ordering', name: 'Online Ordering', description: 'Pickup orders from your website: your menu with a cart, paid by card on your own Stripe account, taken while the kitchen is open with your lead time and a pause switch; each order is a grill ticket, and the guest is told when it is received and ready', category: 'Register & Ordering', core: false, templates: ['crm-bar', 'crm-restaurant'], optIn: ['crm-bar', 'crm-restaurant'] },
  { id: 'draft_taps', name: 'Draft Taps', description: 'A tap list for the beer you pour, with pour sizes, rung on the register and shown on your website', category: 'Register & Ordering', core: false, templates: ['crm-restaurant'], optIn: ['crm-restaurant'] },
  { id: 'bar_tonight', name: 'Tonight', description: "Kitchen and bar open or closed, how busy, the note, tonight's special, the game and events — from a phone, live on your website", category: 'Bar', core: true, templates: ['crm-bar', 'crm-restaurant'], optIn: ['crm-restaurant'],
    as: { 'crm-restaurant': { description: "Kitchen open or closed, how busy, the note, today's special and events — from a phone, live on your website", category: 'Register & Ordering' } } },

  // Private Events & Catering (crm-restaurant) — enquiry -> booking -> deposit
  // -> banquet event order. Scoped to the private-events side of a restaurant,
  // NOT a POS or covers system. Every id here gates exactly one sidebar item or
  // tab in the template; nothing is listed that the app doesn't act on.
  { id: 'event_bookings', name: 'Events', description: 'Inquiry-to-confirmed pipeline with per-space double-book protection', category: 'Private Events & Catering', core: true, templates: ['crm-restaurant', 'crm-bar'] },
  { id: 'event_spaces', name: 'Spaces', description: 'Bookable rooms with seated/standing capacity, minimum spend and hire fees', category: 'Private Events & Catering', core: true, templates: ['crm-restaurant', 'crm-bar'] },
  { id: 'catering_menus', name: 'Catering Menus', description: 'Per-head packages with structured courses, choices and guest minimums', category: 'Private Events & Catering', core: true, templates: ['crm-restaurant', 'crm-bar'] },
  { id: 'banquet_orders', name: 'Run of Show / BEO', description: 'Minute-by-minute banquet event order the kitchen and floor work from, printable', category: 'Private Events & Catering', core: true, templates: ['crm-restaurant', 'crm-bar'] },
  { id: 'event_deposits', name: 'Deposits & Balances', description: 'Staged payment schedule per event with overdue tracking across the whole book', category: 'Private Events & Catering', core: true, templates: ['crm-restaurant', 'crm-bar'] },
  // Event depth (restaurant-bar-depth). NOT READY (hidden) until the owner has tested each (2026-10-30): no plan, signup or
  // Features page switches one on, and nothing advertises it while it is off. Each is gated on both sides, menu and server.
  { id: 'event_proposals', name: 'Event Proposals', description: 'Send a branded proposal the guest opens, chooses on and signs online; the event is booked when they accept', category: 'Private Events & Catering', core: false, templates: ['crm-restaurant', 'crm-bar'], hidden: true },
  { id: 'event_payment_automation', name: 'Payment Reminders & Autopay', description: 'Reminders before each deposit and balance is due, a pay link for each, and a card on file charged on the due date', category: 'Private Events & Catering', core: false, templates: ['crm-restaurant', 'crm-bar'], hidden: true },
  { id: 'event_contracts', name: 'Event Contracts & Several Signers', description: 'Contract templates with merge fields chosen per event, and a proposal signed by the client, a second signer and the venue in order; the event books when the last one signs', category: 'Private Events & Catering', core: false, templates: ['crm-restaurant', 'crm-bar'], hidden: true },
  { id: 'event_bank_payments', name: 'Event Bank (ACH) Payments', description: 'A client pays an instalment from a US bank account, or leaves one for autopay; recorded only once the bank has settled it', category: 'Private Events & Catering', core: false, templates: ['crm-restaurant', 'crm-bar'], hidden: true },
  { id: 'event_web_enquiries', name: 'Website Event Enquiries', description: 'A dated enquiry from your website form opens in the event book', category: 'Private Events & Catering', core: false, templates: ['crm-restaurant'], hidden: true },
  { id: 'event_form_campaigns', name: 'Event Form Rooms & Campaign Embeds', description: 'The website enquiry form offers your rooms and shows whether each looks free on the date, and each campaign gets its own form link and embed code that tags the lead source', category: 'Private Events & Catering', core: false, templates: ['crm-restaurant', 'crm-bar'], hidden: true },
  { id: 'event_marketing_spend', name: 'Event Marketing Spend', description: 'Enter what you spend advertising to each lead source each month; the source report shows the cost per enquiry and per booked event and the value booked for every dollar spent', category: 'Private Events & Catering', core: false, templates: ['crm-restaurant', 'crm-bar'], hidden: true },
  { id: 'event_report_schedules', name: 'Event Reports By Email', description: 'The lead-source and year reports emailed weekly or monthly to the people you choose', category: 'Private Events & Catering', core: false, templates: ['crm-restaurant', 'crm-bar'], hidden: true },
  { id: 'event_calendar', name: 'Room Calendar & Waitlist', description: 'Rooms held by the hour, a month and week grid by room, a waitlist for a taken date, and a calendar feed for each room', category: 'Private Events & Catering', core: false, templates: ['crm-restaurant', 'crm-bar'], hidden: true },
  { id: 'event_hold_expiry', name: 'Holds That Lapse', description: 'A hold on a room ends on a set day (the venue default, or its own), the team is reminded first, and when it lapses the room is released and offered to the waitlist in order', category: 'Private Events & Catering', core: false, templates: ['crm-restaurant', 'crm-bar'], hidden: true },
  { id: 'event_guarantee', name: 'Guest Count Cutoff', description: 'The guest count locks a set number of days before the event; the client is reminded first and a manager can change it with a reason', category: 'Private Events & Catering', core: false, templates: ['crm-restaurant', 'crm-bar'], hidden: true },
  { id: 'event_minimums', name: 'Food & Beverage Minimums', description: 'Minimum spend by day of the week and season, with any shortfall added to the bill', category: 'Private Events & Catering', core: false, templates: ['crm-restaurant', 'crm-bar'], hidden: true },
  { id: 'event_reports', name: 'Event Source & Year Reports', description: 'Enquiries, bookings and conversion by where they came from, and booked value by month against last year', category: 'Private Events & Catering', core: false, templates: ['crm-restaurant', 'crm-bar'], hidden: true },

  // Field Operations
  // Not home care: a caregiver's clock-in and clock-out is EVV (Compliance › EVV), the agency's own and always on — this
  // switch opened the trades' Time page, which an agency's menu does not have, so it switched nothing (live test 2026-10-22).
  { id: 'time_tracking', name: 'Time Tracking', description: 'Clock in and out, or log hours by hand; hours by person and day', category: 'Field Operations', core: false, templates: ['crm', 'crm-fieldservice', 'crm-basic', 'crm-landscaping', 'crm-salon', 'crm-bar', 'crm-restaurant'] /* a restaurant clocks in on the counter tablet by PIN like a bar: its Staff Schedule, tips by hours and payroll file read these hours (restaurant live test 2026-11-09) */ },
  // Where's the crew and the job-site geofences (/crm/geofences) and the phone app's location sharing. Not home care: its
  // caregivers' location is EVV's, at clock-in and clock-out, and the phone app offers tracking to the trades only.
  { id: 'gps_tracking', name: 'GPS Tracking', description: 'Crew locations and automatic clock-in and out at job-site fences, from the Twomiah phone app', category: 'Field Operations', core: false, templates: ['crm', 'crm-fieldservice', 'crm-basic', 'crm-landscaping'] },
  { id: 'photo_capture', name: 'Photo Capture', description: 'Job site photo documentation', category: 'Field Operations', core: false, templates: ['crm', 'crm-fieldservice', 'crm-basic', 'crm-landscaping', 'crm-roof'] },
  { id: 'equipment_tracking', name: 'Equipment', description: 'Equipment and tool tracking', category: 'Field Operations', core: false, templates: ['crm', 'crm-fieldservice', 'crm-basic', 'crm-landscaping'] },
  { id: 'fleet', name: 'Fleet Management', description: 'Vehicle fleet tracking', category: 'Field Operations', core: false, templates: ['crm', 'crm-fieldservice', 'crm-basic', 'crm-landscaping'] },

  // Finance
  { id: 'online_payments', name: 'Online Payments', description: 'Stripe payment processing — invoices and deposits paid by card, or by bank account where you turn that on in your Stripe account', category: 'Finance', core: false, templates: ['crm', 'crm-fieldservice', 'crm-basic', 'crm-landscaping', 'crm-homecare', 'crm-rv', 'crm-vet', 'crm-salon', 'crm-restaurant', 'crm-bar'] /* not crm-roof YET (owner, 2026-10-30): roofing payments are built and proven (apps/unified/tests/roof-online-payments.test.ts) but not released, and offering a feature advertises it. To release: add 'crm-roof' here and drop 'roofing' from SIGNUP_PAGE_HIDES.online_payments in tests/signup-questions.test.ts (and the website signup page's ASK_HIDDEN_FOR). */ },
  { id: 'expense_tracking', name: 'Expense Tracking', description: 'Expense logging and receipts', category: 'Finance', core: false, templates: ['crm', 'crm-fieldservice', 'crm-basic', 'crm-landscaping', 'crm-salon', 'crm-bar'] },
  { id: 'job_costing', name: 'Job Costing', description: 'Detailed job cost analysis', category: 'Finance', core: false, templates: ['crm', 'crm-fieldservice', 'crm-basic', 'crm-landscaping', 'crm-roof'] },
  // Not ready: a project's budget by cost code (from its approved quotes) beside what its jobs have cost, under Job Costing.
  { id: 'job_budgets', name: 'Project Budgets', description: 'A project\'s budget by cost code, set by its approved quotes, beside what its jobs have cost so far', category: 'Finance', core: false, templates: ['crm'], hidden: true },
  // Not ready: cost codes on time, expenses and vendor bills, so the project budget shows actual cost and profit per line.
  { id: 'cost_by_code', name: 'Cost by Cost Code', description: 'File time, expenses and vendor bills under a cost code, so each budget line shows what it really cost and the profit it will make', category: 'Finance', core: false, templates: ['crm'], hidden: true },
  // Not ready: save a quote as a template and start the next from it ("create similar"; Quotes), and the automatic nudge to a customer who has not answered a sent quote.
  { id: 'quote_templates', name: 'Quote Templates', description: 'Save a quote as a template, start a new quote from one, or create a quote similar to an old one', category: 'Finance', core: false, templates: ['crm', 'crm-fieldservice', 'crm-landscaping', 'crm-basic'], hidden: true },
  { id: 'quote_followup', name: 'Quote Follow-up', description: 'Email a customer who has not answered a quote, a few days after it was sent — once per step, never after they answer or unsubscribe', category: 'Finance', core: false, templates: ['crm', 'crm-fieldservice', 'crm-landscaping', 'crm-basic'], hidden: true },
  // Not ready: the usual markup by kind of line (labour, material…) filled in on a quote line, with the margin shown live; and a picture on a quote line the customer sees.
  // Landscaping too (parity row 27): the active budget's markups fill these (apps/unified server/data/companyBudget.ts).
  { id: 'markup_defaults', name: 'Markup Defaults', description: 'Set your usual markup for labour, material and the rest; a quote line with a cost fills it in, and the quote shows your margin as you build it', category: 'Finance', core: false, templates: ['crm', 'crm-landscaping'], hidden: true },
  { id: 'quote_line_images', name: 'Pictures on Quote Lines', description: 'Put a picture on a quote line so the customer sees what they are choosing', category: 'Finance', core: false, templates: ['crm', 'crm-landscaping'], hidden: true },
  // NOT READY until the owner has tested it: a line of words only on a quote — a heading or a note, no price (Jobber “Add text”).
  { id: 'quote_text_lines', name: 'Text lines on quotes', description: 'Add a line of words only to a quote — a heading or a note with no quantity or price — shown on the customer’s page and the PDF', category: 'Finance', core: false, templates: ['crm', 'crm-fieldservice', 'crm-basic', 'crm-landscaping', 'crm-roof'], hidden: true },
  // NOT READY until the owner has tested it: the office opens the customer’s page for a quote, read only, without sending it (tenant-backend portal/documentLinks.ts).
  { id: 'quote_preview', name: 'Preview quote as client', description: 'Open exactly the page the customer will see for a quote — options, ticks, deposit and the sign button — read only, without sending it', category: 'Finance', core: false, templates: ['crm', 'crm-fieldservice', 'crm-basic', 'crm-landscaping', 'crm-roof'], hidden: true },
  { id: 'lead_lost', name: 'Lost Leads', description: 'Mark an enquiry Lost with the reason (price, hired someone else, not ready…), so the owner can see why work is not coming in', category: 'Communication', core: false, templates: ['crm'], hidden: true },
  { id: 'lead_site_visit', name: 'Site Visits', description: 'Book the visit to look at the work from an enquiry, straight onto the schedule, and move or cancel it', category: 'Communication', core: false, templates: ['crm'], hidden: true },
  { id: 'weekly_client_update', name: 'Weekly Client Update', description: "One email a week to each client listing what's new in their portal — daily logs, photos, files, reports — and whether they opened it", category: 'Communication', core: false, templates: ['crm', 'crm-roof'], hidden: true, words: ['weekly client update', 'client update'] },
  { id: 'lead_map', name: 'Lead Map', description: 'Your enquiries on a map, from the location each one gave', category: 'Communication', core: false, templates: ['crm', 'crm-roof', 'crm-fieldservice', 'crm-landscaping', 'crm-basic'], hidden: true, words: ['lead map'] },
  { id: 'lead_pipeline', name: 'Pipeline Strip', description: 'One strip from new enquiry to won work, and the list of quotes still waiting on a customer, longest first', category: 'Communication', core: false, templates: ['crm', 'crm-fieldservice', 'crm-landscaping', 'crm-basic'], hidden: true },
  { id: 'owner_dashboard', name: 'Owner Dashboard', description: 'On the home screen: what needs the owner today (quotes with no answer, bills due, jobs nobody is on, projects over budget) and who is on which job', category: 'Core', core: false, templates: ['crm', 'crm-fieldservice', 'crm-landscaping', 'crm-basic'], hidden: true },
  { id: 'crew_dashboard', name: 'Crew Dashboard', description: 'On the home screen for a crew member: my jobs today and next, my hours this week, my open tasks', category: 'Core', core: false, templates: ['crm', 'crm-fieldservice', 'crm-landscaping', 'crm-basic'], hidden: true },
  { id: 'purchase_orders', name: 'Purchase Orders', description: 'Commit spend with vendors per job — sent, acknowledged, received, billed', category: 'Finance', core: false, templates: ['crm', 'crm-dispensary'] },
  { id: 'vendor_bills', name: 'Bills & Payables', description: 'Vendor bills with due dates, payments, and committed-vs-billed job rollups', category: 'Finance', core: false, templates: ['crm'] },
  { id: 'bid_packages', name: 'Bid Packages', description: 'Send a scope of work to your subs to price in their portal, compare the bids line by line, and turn the winner into a purchase order', category: 'Projects', core: false, templates: ['crm'], hidden: true, words: ['bid packages', 'bid requests', 'bids to subs'] },
  { id: 'vendor_portal', name: 'Vendor Portal', description: 'Subs and suppliers acknowledge POs and submit invoices through a private link', category: 'Communication', core: false, templates: ['crm'] },
  // Consumer Financing — NOT ready (2026-10-23). The trades the pros offer it to (Jobber, Housecall Pro, ServiceTitan:
  // contractors, roofers, HVAC/field service, landscapers; and RV/powersports service) get the lender flow in the unified
  // app: connect the lender in Settings › Integrations, "as low as $X/mo" + Apply on quotes and on the customer's quote and
  // invoice pages, an application link texted or emailed, signed lender webhooks that move the application and record the
  // funded payment, and a Financing page. Hidden until a real lender sandbox run passes (owner: untested features stay
  // off), so no plan, signup, Features page or Factory save switches it on, and nothing advertises it while it is off
  // (apps/unified/tests/not-ready-unseen.test.ts). The RV dealer's F&I page is its deal pipeline's, not this switch's.
  { id: 'consumer_financing', name: 'Consumer Financing', description: 'Customers apply for a loan from your quote or invoice; the lender pays you', category: 'Finance', core: false, templates: ['crm', 'crm-roof', 'crm-fieldservice', 'crm-basic', 'crm-landscaping', 'crm-rv'], hidden: true, words: ['financing', 'finance option', 'wisetack'], siteSections: ['financing'] },
  // Job Reminders — NOT ready (2026-10-30). The reminder text and email the day before a job the office booked
  // (apps/unified server/crm/field/jobReminders.ts), per business, off until the owner switches it on, inside the
  // business's sending hours. Hidden until the owner has tested it; no plan, signup or Features page switches it on.
  { id: 'team_revenue_reports', name: 'Team Revenue Reports', description: 'Revenue per tech, and how many quotes each rep and tech turns into work', category: 'Advanced', core: false, templates: ['crm-fieldservice', 'crm-basic'], hidden: true, words: ['team revenue'] },
  { id: 'plan_reports', name: 'Plan Reports', description: 'Service plans sold by rep, renewals coming due and plans that ended', category: 'Advanced', core: false, templates: ['crm-fieldservice', 'crm-basic'], hidden: true, words: ['plan reports'] },
  { id: 'tech_availability', name: 'Tech Availability', description: 'Working hours and time off for each tech, shown on the Dispatch Board and checked when a job is given to them', category: 'Field Service', core: false, templates: ['crm-fieldservice', 'crm-basic'], hidden: true, words: ['tech availability'] },
  { id: 'service_zones', name: 'Service Zones', description: 'Name the areas you work in by ZIP code; the Dispatch Board shows each job’s zone and can show one zone at a time', category: 'Field Service', core: false, templates: ['crm-fieldservice', 'crm-basic', 'crm-landscaping'], hidden: true, words: ['service zones', 'zones'] },
  { id: 'marketing_roi', name: 'Marketing ROI', description: 'For each lead source: the leads, the customers and jobs they became, the money they brought, against what you spent on it', category: 'Marketing', core: false, templates: ['crm-fieldservice', 'crm-basic', 'crm-landscaping'], hidden: true, words: ['marketing roi', 'return on marketing'] },
  { id: 'skill_matching', name: 'Skill Matching', description: 'The skills each person has and each kind of job needs — a warning when a job goes to someone without them, and Find a time offers only people who have them', category: 'Field Service', core: false, templates: ['crm-fieldservice', 'crm-basic', 'crm-landscaping', 'crm-roof'], hidden: true, words: ['skill matching', 'skills'] },
  { id: 'job_checklists', name: 'Job Checklists', description: 'Checklists you build for each kind of job, filled in on the phone and signed by the customer on site', category: 'Field Service', core: false, templates: ['crm-fieldservice', 'crm-basic', 'crm-landscaping'], hidden: true, words: ['job checklists', 'checklists'] },
  { id: 'job_reminders', name: 'Job Reminders', description: 'Automatic reminder texts and emails before the jobs you book', category: 'Communication', core: false, templates: ['crm-fieldservice', 'crm-basic'], hidden: true, words: ['job reminders'] },
  { id: 'tech_tracking', name: "Where's My Tech", description: 'The on-my-way text carries a private link showing where the tech is until they arrive', category: 'Field Service', core: false, templates: ['crm-fieldservice', 'crm-basic', 'crm-landscaping'], hidden: true, words: ["where's my tech", 'tech tracking'] },
  { id: 'credit_memos', name: 'Customer Credit', description: "Credit you owe a customer, kept on them and used to pay any of their invoices — and a refund can be kept as credit instead", category: 'Finance', core: false, templates: ['crm', 'crm-fieldservice', 'crm-basic', 'crm-landscaping', 'crm-roof'], hidden: true, words: ['customer credit', 'credit memo', 'credit memos'] },
  { id: 'quickbooks', name: 'QuickBooks', description: 'QuickBooks sync — we integrate accounting, we do not replace it', category: 'Finance', core: false, templates: ['crm', 'crm-fieldservice', 'crm-basic', 'crm-landscaping', 'crm-homecare', 'crm-roof', 'crm-rv', 'crm-vet', 'crm-salon', 'crm-restaurant', 'crm-bar', 'crm-store'], optIn: ['crm-store'] },

  // Communication
  // The store (parity tier 2 #12, 11/10): offered, off until the owner switches it on (texting uses a number and the usage wallet), as its email marketing.
  { id: 'two_way_texting', name: 'Two-Way Texting', description: 'Unified SMS inbox — every customer conversation logged', category: 'Communication', core: false, templates: ['crm', 'crm-fieldservice', 'crm-basic', 'crm-landscaping', 'crm-homecare', 'crm-roof', 'crm-dispensary', 'crm-rv', 'crm-vet', 'crm-salon', 'crm-restaurant', 'crm-bar', 'crm-store'], optIn: ['crm-store'] },
  { id: 'call_tracking', name: 'Call Tracking', description: 'Inbound call tracking and recording', category: 'Communication', core: false, templates: ['crm', 'crm-fieldservice', 'crm-basic', 'crm-landscaping', 'crm-homecare', 'crm-automotive', 'crm-bar'] /* not crm-roof: no call-tracking screen there — the API is consumed by the AI receptionist page, so it rides that switch */ },
  { id: 'google_business', name: 'Google Reviews', description: 'Connect your Google Business Profile — see your rating and reply to reviews from the CRM', category: 'Communication', core: true, templates: ['crm', 'crm-roof', 'crm-vet', 'crm-salon', 'crm-restaurant', 'crm-fieldservice', 'crm-basic', 'crm-dispensary', 'crm-landscaping', 'crm-rv', 'crm-homecare', 'crm-store', 'crm-bar'] },
  { id: 'branded_email', name: 'Branded Email', description: 'support@yourdomain addresses — forward anywhere or receive replies in the CRM email inbox', category: 'Communication', core: true, templates: ['crm', 'crm-roof', 'crm-vet', 'crm-salon', 'crm-restaurant', 'crm-fieldservice', 'crm-basic', 'crm-dispensary', 'crm-landscaping', 'crm-rv', 'crm-homecare', 'crm-bar', 'crm-store'] },
  // A salon's clients have one too (salon live test 11/07): their upcoming and past visits, Book again, gift cards, membership and points
  // (salon parity rows 12, 21, 25), reached by the private link the contact page issues — which this switch gates on the server.
  { id: 'client_portal', name: 'Client Portal', description: 'A customer portal by private link — quotes to approve, invoices to view and pay, and their projects where you run them', category: 'Communication', core: false, templates: ['crm', 'crm-fieldservice', 'crm-basic', 'crm-landscaping', 'crm-roof', 'crm-salon'] },
  { id: 'lead_inbox', name: 'Lead Inbox', description: 'Every inquiry in one inbox — marketplaces, ads, booking apps and your website', category: 'Communication', core: false, templates: ['crm', 'crm-fieldservice', 'crm-basic', 'crm-landscaping', 'crm-homecare', 'crm-automotive', 'crm-roof', 'crm-rv', 'crm-vet', 'crm-salon', 'crm-restaurant', 'crm-bar', 'crm-store'] /* crm-store: a store with a website sees its enquiries in the CRM, not only in the owner's email (store live test, 2026-10-26) */ },

  // Marketing
  // Twomiah Ads — NOT ready (2026-09-17). The page, the routes and the connector all still exist in the templates
  // and every surface is gated on this id; the id stays in the vocabulary so those gates are not "unknown". Offered
  // to NO template and hidden, so it cannot be seeded by a plan, shown on a tenant's Features page, or picked in the
  // Factory wizard. Put the templates back when the service is ready.
  { id: 'paid_ads', name: 'Paid Ads Hub (Google + Meta)', description: 'Google & Meta campaign management — not yet available', category: 'Marketing', core: false, templates: [], hidden: true },
  { id: 'google_reviews', name: 'Review Requests', description: 'Ask customers for a Google review — sent automatically after a completed job or salon visit once switched on in Reviews › Settings, or by hand from Reviews', category: 'Marketing', core: false, templates: ['crm', 'crm-fieldservice', 'crm-basic', 'crm-landscaping', 'crm-rv', 'crm-vet', 'crm-salon', 'crm-restaurant', 'crm-roof', 'crm-bar', 'crm-store'], optIn: ['crm-store'] },
  { id: 'email_marketing', name: 'Email Marketing', description: 'Drip campaigns and newsletters', category: 'Marketing', core: false, templates: ['crm', 'crm-fieldservice', 'crm-basic', 'crm-landscaping', 'crm-restaurant', 'crm-rv', 'crm-salon', 'crm-vet', 'crm-bar', 'crm-store'], optIn: ['crm-store'] },
  { id: 'referral_program', name: 'Referral Program', description: 'Customer referral tracking', category: 'Marketing', core: false, templates: [] /* offered to no industry: nothing reads it (scripts/check-unified-feature-has-screen.ts, live test 2026-10-22) */ },

  // Advanced
  { id: 'barcode_scanning', name: 'Barcode Scanning', description: "Scan a part's or product's barcode with the phone's camera to find it — Stock on the phone, and the store's stock list", category: 'Advanced', core: false, templates: ['crm', 'crm-fieldservice', 'crm-basic', 'crm-landscaping', 'crm-store'], hidden: true, words: ['barcode scanning', 'barcode'] },
  { id: 'inventory', name: 'Inventory', description: 'Warehouse and material inventory', category: 'Advanced', core: false, templates: ['crm', 'crm-fieldservice', 'crm-basic', 'crm-landscaping'] },
  // crm-dispensary was added in T18: it had shipped a complete, authenticated /api/documents for a
  // long time with no page, no route and no nav entry in front of it, so the only way to reach it was
  // by hand. A licensed retailer keeps its state licence, a lab COA per batch and METRC transport
  // manifests, so the answer was to finish it rather than delete it. Non-core, so it stays OFF until
  // an owner switches it on — no existing tenant changes behaviour.
  { id: 'documents', name: 'Documents', description: 'Document management and storage', category: 'Advanced', core: false, templates: ['crm', 'crm-fieldservice', 'crm-basic', 'crm-landscaping', 'crm-homecare', 'crm-rv', 'crm-vet', 'crm-salon', 'crm-restaurant', 'crm-roof', 'crm-dispensary', 'crm-bar'] },
  { id: 'reports', name: 'Reports', description: 'Revenue, outstanding balances and work done for any period, with CSV downloads', category: 'Advanced', core: false, templates: ['crm', 'crm-fieldservice', 'crm-basic', 'crm-landscaping', 'crm-homecare', 'crm-roof', 'crm-rv', 'crm-vet', 'crm-salon', 'crm-restaurant', 'crm-bar'] },
  { id: 'ar_aging', name: 'Receivables Aging', description: 'Who owes what, by customer — current, 1–30, 31–60, 61–90 and over 90 days past due', category: 'Advanced', core: false, templates: ['crm', 'crm-fieldservice', 'crm-basic', 'crm-landscaping', 'crm-roof', 'crm-rv', 'crm-vet', 'crm-salon', 'crm-restaurant', 'crm-bar'], hidden: true },
  { id: 'wip_report', name: 'Work in Progress Report', description: 'Each open project: contract value, billed, cost to date, percent complete and over or under billing', category: 'Advanced', core: false, templates: ['crm', 'crm-fieldservice', 'crm-basic', 'crm-landscaping'], hidden: true },
  { id: 'custom_dashboards', name: 'Custom Dashboards', description: 'Drag-and-drop widget dashboards', category: 'Advanced', core: false, templates: [] /* offered to no industry: nothing reads it (scripts/check-unified-feature-has-screen.ts, live test 2026-10-22) */ },
  { id: 'ai_receptionist', name: 'AI Receptionist', description: 'Missed-call text-back: replies by text or email to missed calls and voicemails, with each voicemail written out', category: 'Advanced', core: false, templates: ['crm', 'crm-fieldservice', 'crm-basic', 'crm-landscaping', 'crm-homecare', 'crm-automotive', 'crm-roof', 'crm-bar'] },
  // Not ready (fieldservice parity item 12, 2026-10-31): the business's line answered live by an AI voice that books into real
  // open slots, takes a message or transfers — every word from the owner's own wording. Needs the owner's voice provider
  // account (docs/parity/fieldservice-ai-call-answering.md), so it stays hidden until that is in place.
  { id: 'ai_call_answering', name: 'AI Call Answering', description: 'Answers your line live with an AI voice that books visits into real open times, answers hours, price and service-area questions, takes a message or transfers to a person — using only the wording and services you set', category: 'Advanced', core: false, templates: ['crm', 'crm-fieldservice', 'crm-basic', 'crm-landscaping', 'crm-homecare', 'crm-automotive', 'crm-roof', 'crm-bar'], hidden: true, words: ['call answering', 'phone answering', 'live answering'] },
  { id: 'map_view', name: 'Map View', description: 'Map-based job visualization', category: 'Advanced', core: false, templates: [] /* offered to no industry: no screen in any industry's menu or pages (scripts/check-unified-feature-has-screen.ts, live test 2026-10-22). The id stays because the server still gates its API on it. */ },

  // Roofing
  { id: 'measurement_reports', name: 'Measurement Reports', description: 'Satellite roof measurement ordering', category: 'Roofing', core: false, templates: ['crm-roof'], hidden: true },
  { id: 'tap_to_pay', name: 'Tap to Pay on the phone', description: "Take a customer's card by tapping it on your own phone, paid into your own Stripe account, and recorded on the invoice", category: 'Finance', core: false, templates: ['crm', 'crm-fieldservice', 'crm-basic', 'crm-landscaping', 'crm-roof', 'crm-salon'], hidden: true, words: ['tap to pay', 'contactless'] },
  { id: 'quote_proposals', name: 'Good / Better / Best', description: 'One quote with two to six priced options, each with photos, a brand and a warranty: the customer picks one and signs, and the price and deposit follow their pick', category: 'Finance', core: false, templates: ['crm', 'crm-fieldservice', 'crm-basic', 'crm-landscaping', 'crm-roof'], hidden: true, words: ['quote options', 'good better best', 'proposal options'] },
  // Not ready (roofing depth, gaps 6 and 10): the owner tests them first.
  { id: 'inspection_reports', name: 'Inspection Reports', description: 'A branded photo report of a roof inspection, shared by a private link and as a PDF', category: 'Roofing', core: false, templates: ['crm-roof'], hidden: true },
  // Not ready (roofing parity row 8): arrows, circles and text drawn on a job photo, on the web and the phone; the marked copy is kept beside the original.
  { id: 'photo_markup', name: 'Draw on Photos', description: 'Draw arrows, circles and notes on a job photo, on the web or the phone; the marked copy is kept beside the original and can go in a proposal or an inspection report', category: 'Roofing', core: false, templates: ['crm-roof', 'crm-landscaping'], hidden: true, words: ['markup photos', 'annotate photos'] },
  { id: 'portal_job_files', name: 'Homeowner Photos & Documents', description: 'The photos and documents you choose to share with a homeowner, in their portal', category: 'Roofing', core: false, templates: ['crm-roof'], hidden: true },
  { id: 'insurance_workflow', name: 'Insurance Workflow', description: 'Insurance claim tracking with adjuster info', category: 'Roofing', core: false, templates: ['crm-roof'] },
  // Not ready (owner tests it first): the held-depreciation reminder when a job is done, and mortgage-company check tracking.
  { id: 'insurance_extras', name: 'Insurance Follow-ups', description: 'Reminds you to send the certificate of completion for held depreciation, tracks mortgage-company checks through endorsement, and gives supplements your own statuses and a tracker across every claim', category: 'Roofing', core: false, templates: ['crm-roof'], hidden: true },
  // Not ready (owner tests it first): rename the pipeline stages and keep separate Retail and Insurance boards. Display names only.
  { id: 'pipeline_boards', name: 'Pipeline Stages & Boards', description: 'Rename the pipeline stages and keep separate Retail and Insurance boards', category: 'Roofing', core: false, templates: ['crm-roof'], hidden: true },
  // Not a switch. The pipeline board is roof's INDEX ROUTE — the first screen after login — so there is
  // no state of the product where it is off, and the Settings toggle could never do anything. `core` is a
  // global flag, but this feature is offered to crm-roof alone, so marking it core locks it to "Included"
  // for roofers and touches nothing else. (roof T18 L9)
  { id: 'pipeline_board', name: 'Pipeline Board', description: 'Visual Kanban pipeline for roofing jobs', category: 'Roofing', core: true, templates: ['crm-roof'] },
  { id: 'crews', name: 'Crews', description: 'Crew management and assignment', category: 'Roofing', core: false, templates: ['crm-roof'] },
  { id: 'materials', name: 'Materials', description: 'Material ordering and tracking', category: 'Roofing', core: false, templates: ['crm-roof'] },
  { id: 'roof_material_list', name: 'Material List Calculator', description: 'Work out the shingles, underlayment and trim from a roof\'s squares, then order them — not yet available', category: 'Roofing', core: false, templates: ['crm-roof'], hidden: true },
  // NOT READY (on top of consumer_financing, itself not ready until the lender partner agreement): financing beside each proposal option (roofing parity row 30; apps/unified server/crm/financing/).
  { id: 'proposal_financing', name: 'Financing on each proposal option', description: 'Each Good / Better / Best option shows its own estimated monthly payment, and the customer applies once they have chosen', category: 'Finance', core: false, templates: ['crm-roof'], hidden: true },
  // NOT READY until the owner has tested it: the crew's work orders in the phone app (roofing parity row 29; apps/unified server/crm/roof/crewOrders.ts).
  { id: 'crew_app', name: 'Crew work orders in the phone app', description: 'A crew member signed in to the phone app sees their crew’s work orders and accepts, turns down, starts and finishes them — with no signal too', category: 'Roofing', core: false, templates: ['crm-roof'], hidden: true },
  // NOT READY until the owner has tested it: crew scheduling and on site (roofing parity row 28; apps/unified server/data/crewScheduling.ts).
  { id: 'crew_scheduling', name: 'Crew scheduling and on site', description: 'Sent work orders on the schedule, the crew texted when one moves, I’m here / Leaving for now with office alerts, an on-site checklist, an in-progress status, and each crew’s trades and certificates with their expiry', category: 'Roofing', core: false, templates: ['crm-roof'], hidden: true },
  // NOT READY until the owner has tested it: work order send options (roofing parity row 27; apps/unified server/crm/roof/workOrders.ts).
  { id: 'work_order_send_options', name: 'Work order sending options', description: 'Send a work order by email with CC as well as text, show the crew page in Spanish with your Spanish scope, ask for approval per crew or per order, and set how long the sub sees it and whether they see the materials and photos', category: 'Roofing', core: false, templates: ['crm-roof'], hidden: true },
  // NOT READY until the owner has tested it (CompanyCam needs the business's account): work order tools (roofing parity row 26).
  { id: 'work_order_tools', name: 'Work orders from the proposal, and scope templates', description: 'Fill a work order’s scope and materials from the signed proposal (no prices), save scopes as templates, and bring in CompanyCam photos once your account is connected', category: 'Roofing', core: false, templates: ['crm-roof'], hidden: true },
  // NOT READY, and swaths need a hail-data provider account first: storm data tools (roofing parity row 25; apps/unified server/data/hailSwaths.ts).
  { id: 'storm_data_tools', name: 'Hail swaths and storm lead scores', description: 'Bring in hail swaths from a hail-data provider (date, severity, hail, wind, rainfall) and score each storm lead by the storm, where they are, their roof’s age and whether they are a past customer', category: 'Roofing', core: false, templates: ['crm-roof'], hidden: true },
  // NOT READY until the owner has tested it: territories from Census boundaries (roofing parity row 24; apps/unified server/data/censusBoundary.ts).
  { id: 'territory_boundaries', name: 'Territories from ZIP, city, county or state', description: 'Make a territory from a ZIP, city, county or state boundary (US Census outlines), shown on the map before you save it', category: 'Roofing', core: false, templates: ['crm-roof'], hidden: true },
  // NOT READY until the owner has tested it: territories finished (roofing parity row 23; apps/unified server/crm/roof/field/territories.ts).
  { id: 'territory_tools', name: 'Territories: import, nesting, redraw and the phone warning', description: 'Import territories from a KML file, put a territory inside another, redraw a boundary on the map, and warn a rep on the phone when they knock outside their territory', category: 'Roofing', core: false, templates: ['crm-roof'], hidden: true },
  // NOT READY until the owner has tested it: the job thread, company documents and packets in the homeowner portal (roofing parity row 22).
  { id: 'portal_posts_packets', name: 'Portal messages, company documents and packets', description: 'A message thread on each job in the homeowner’s portal, company documents (warranty terms, brochures) every homeowner sees, and sharing several files in one go', category: 'Roofing', core: false, templates: ['crm-roof'], hidden: true },
  // NOT READY until the owner has tested it: the homeowner portal's office tools (roofing parity row 21; apps/unified server/crm/roof/portalFiles/office.ts).
  { id: 'portal_tools', name: 'Homeowner portal tools', description: 'See exactly what the homeowner sees, tell them when something new is shared, see when they last opened their portal, and close it once the job is Collected', category: 'Roofing', core: false, templates: ['crm-roof'], hidden: true },
  // NOT READY until the owner has tested it: statuses and checklists under the milestones (roofing parity row 20; apps/unified server/crm/roof/pipeline.ts).
  { id: 'pipeline_statuses', name: 'Statuses and checklists', description: 'Add your own statuses under each pipeline milestone — for every job type or only some — each with its checklist the crew and office tick off', category: 'Roofing', core: false, templates: ['crm-roof'], hidden: true },
  // NOT READY until the owner has tested it: a company's own pipeline boards (roofing parity row 19; apps/unified server/crm/roof/pipeline.ts).
  { id: 'pipeline_custom_boards', name: 'Pipeline boards of your own', description: 'Make as many pipeline boards as you like — by job type, assignee, rep, location or subcontractor — each with its colour, seen by everyone, just you, or chosen roles', category: 'Roofing', core: false, templates: ['crm-roof'], hidden: true },
  // NOT READY until the owner has tested it: a card surcharge (roofing parity row 18; apps/unified server/data/cardSurcharge.ts — state rules).
  { id: 'card_surcharge', name: 'Card surcharge', description: 'Pass the card fee on to customers who pay by credit card, where your state allows it: capped by state, never on debit or prepaid cards, shown before they pay and on the receipt', category: 'Roofing', core: false, templates: ['crm-roof', 'crm'], hidden: true },
  // NOT READY until the owner has tested it: the payouts view (roofing parity row 18; apps/unified server/crm/roof/cardSurcharge.ts).
  { id: 'payments_overview', name: 'Payments and payouts', description: 'See what is on its way to your bank and your recent payouts from Stripe, inside the CRM', category: 'Roofing', core: false, templates: ['crm-roof', 'crm'], hidden: true },
  // NOT READY until the owner has tested it: text an invoice now or on a schedule, and payment receipts (roofing parity row 17; apps/unified server/crm/roof/invoiceRequests.ts).
  { id: 'invoice_text_requests', name: 'Text invoices and payment receipts', description: 'Text an invoice’s pay link now or on a schedule, again every few days until it is paid, and email a receipt to the homeowner and the rep for every payment', category: 'Roofing', core: false, templates: ['crm-roof', 'crm'], hidden: true },
  // NOT READY until the owner has tested it: pay part of an invoice and pay toward an approved estimate from the customer's page (roofing parity row 16; tenant-backend portal.ts payOptions).
  { id: 'portal_pay_options', name: 'Pay any amount, pay from the estimate', description: 'The homeowner chooses how much to pay on an invoice, and pays toward an approved estimate from its page', category: 'Roofing', core: false, templates: ['crm-roof', 'crm'], hidden: true },
  { id: 'material_supply', name: 'Supplier Ordering', description: 'Send a material order to the supplier by email, with the supplier\'s own price list locked to it — not yet available', category: 'Roofing', core: false, templates: ['crm-roof'], hidden: true },
  { id: 'roof_permits', name: 'Permit Tracking', description: 'Track the permits on a job — type, number, fee and status — and see every job\'s permits on one board — not yet available', category: 'Roofing', core: false, templates: ['crm-roof'], hidden: true },
  { id: 'roof_work_orders', name: 'Crew & Sub Work Orders', description: 'Text a crew or subcontractor a work order they accept, reject or complete from a private link — not yet available', category: 'Roofing', core: false, templates: ['crm-roof'], hidden: true },
  { id: 'canvassing_tool', name: 'Canvassing Tool', description: 'Door-to-door canvassing management', category: 'Roofing', core: false, templates: ['crm-roof'] },
  { id: 'storm_lead_gen', name: 'Storm Lead Gen', description: 'Storm damage lead generation', category: 'Roofing', core: false, templates: ['crm-roof'] },
  { id: 'storm_customer_map', name: 'Storm Map', description: 'Past customers inside a storm’s path — not yet available', category: 'Roofing', core: false, templates: ['crm-roof'], hidden: true },
  { id: 'canvass_territories', name: 'Canvass Territories', description: 'Draw territories and assign them to reps — not yet available', category: 'Roofing', core: false, templates: ['crm-roof'], hidden: true },

  // Dispensary — POS & Sales
  { id: 'pos', name: 'Point of Sale', description: 'POS terminal for walk-in and pickup orders', category: 'POS & Sales', core: true, templates: ['crm-dispensary'] },
  { id: 'products', name: 'Product Catalog', description: 'Your products, their variants, prices and stock', category: 'POS & Sales', core: true, templates: ['crm-dispensary', 'crm-store'] },
  { id: 'orders', name: 'Orders', description: 'Order management and history', category: 'POS & Sales', core: true, templates: ['crm-dispensary', 'crm-store'] },
  // Store sales reports — NOT ready (2026-10-30). Sales over time, top products, repeat customers and the average order for a
  // store's own days (revenue:read: the owner and the managers). Hidden until the owner has run it on the live shop, so no
  // plan, signup, Features page or Factory save switches it on (apps/unified/tests/not-ready-unseen.test.ts).
  { id: 'store_sales_reports', name: 'Store Sales Reports', description: 'Sales over time, top products, repeat customers and the average order, for your own days', category: 'POS & Sales', core: false, templates: ['crm-store'], hidden: true },
  // Store low-stock alerts — NOT ready (2026-10-30). A threshold per option, a Low stock filter and tile on Products, and ONE email
  // to the owner when a sale takes an option down to it. Hidden until the owner has run it on the live shop.
  { id: 'store_low_stock', name: 'Store Stock Alerts', description: 'Set a level per product option; get one email when a sale takes it down to that level, and see what is running low', category: 'POS & Sales', core: false, templates: ['crm-store'], hidden: true },
  // Store product writer — NOT ready (2026-10-30). Drafts a product's description, search description and photo descriptions in a chosen
  // tone for the owner to read and change; nothing is saved until the owner saves. Hidden until the owner has run it on the live shop.
  { id: 'store_ai_writer', name: 'Store Product Writer', description: 'Draft a product description, search-result text and photo descriptions in a tone you pick, for you to edit before saving', category: 'POS & Sales', core: false, templates: ['crm-store'], hidden: true },
  { id: 'store_accounts', name: 'Store Customer Accounts', description: 'Shoppers sign in with an emailed link or code to see their own orders, keep addresses, order again and pay their group’s prices', category: 'POS & Sales', core: false, templates: ['crm-store'], hidden: true },
  { id: 'store_returns', name: 'Store Returns and Exchanges', description: 'Shoppers and staff start returns; you approve, receive the goods back, then refund to the card or store credit or send an exchange', category: 'POS & Sales', core: false, templates: ['crm-store'], hidden: true },
  // Store customer segments — NOT ready (2026-10-31). Save a question about what customers spent, how often they ordered and what they bought
  // (or did not buy) over a period, and send a campaign or a follow-up email to it. Hidden until the owner has run it on the live shop.
  { id: 'store_segments', name: 'Store Customer Segments', description: 'Save groups of customers by what they spent, how many orders they made and what they bought, and send campaigns and follow-up emails to them', category: 'POS & Sales', core: false, templates: ['crm-store'], hidden: true },
  // Store post-purchase emails — NOT ready (2026-10-31). A first-order email, a thank-you with products to go with the order, and a replenishment
  // reminder for consumables, each N days after the order arrives, off until the owner switches it on. Hidden until run on the live shop.
  { id: 'store_followups', name: 'Store Post-Purchase Emails', description: 'Email a customer after their order arrives: a first-order follow-up, a thank-you with products to go with it, and a reminder to reorder consumables', category: 'POS & Sales', core: false, templates: ['crm-store'], hidden: true },
  // Store reorders — NOT ready (2026-10-31). "Draft a reorder": a purchase order per supplier from the low-stock list and the daily email, with suggested
  // counts and the supplier's cost; the owner edits it, emails it, and books what arrives against it. Hidden until run on the live shop.
  { id: 'store_reorders', name: 'Store Supplier Reorders', description: 'Draft a purchase order for each supplier from what is running low, email it, and book the stock in when it arrives', category: 'POS & Sales', core: false, templates: ['crm-store'], hidden: true },
  { id: 'store_counter', name: 'Sell at the Counter', description: 'Ring up a sale in the shop — paid in cash or on your own card machine — and the stock comes off', category: 'Store', core: false, templates: ['crm-store'], hidden: true, words: ['sell at the counter', 'point of sale', 'pos'] },
  { id: 'store_carrier_rates', name: 'Carrier Rates at Checkout', description: "Shoppers enter their ZIP and choose from your shipping carrier's live rates for their cart, instead of your flat or zone rate", category: 'Store', core: false, templates: ['crm-store'], hidden: true, words: ['carrier rates', 'calculated shipping'] },
  { id: 'store_report_schedules', name: 'Saved & Scheduled Sales Reports', description: 'Save a sales report — over time, by product, by option, discount codes — and have it emailed as a spreadsheet every week or month', category: 'Store', core: false, templates: ['crm-store'], hidden: true, words: ['scheduled reports', 'saved reports'] },
  { id: 'store_locations', name: 'Stock by Location', description: 'Count stock at each place you keep it; sales take from your first location first, and moving stock between locations keeps the total', category: 'Store', core: false, templates: ['crm-store'], hidden: true, words: ['stock by location', 'inventory locations'] },
  { id: 'store_fast_checkout', name: 'Store Accelerated Checkout', description: 'Shoppers keep a card on the shop\'s own Stripe account (with their consent) and pay in one tap — at checkout, from order history, and with Apple Pay, Google Pay and Link buttons', category: 'POS & Sales', core: false, templates: ['crm-store'], hidden: true },
  { id: 'store_audiences', name: 'Store Audiences & Purchase Tags', description: 'Send a customer segment to Meta and Google Ads as a hashed audience (file or direct), and report purchases to Meta and Google Tag Manager', category: 'Marketing', core: false, templates: ['crm-store'], hidden: true },
  // Store Apps & integrations — NOT ready (2026-10-31, parity row 8). Three hidden pieces: the catalogue page (connect state and settings of the
  // shop's accounts), the Store API (per-shop keys with scopes), and outgoing signed webhooks (retries and a delivery log). Hidden until a run
  // in a real browser has been seen.
  { id: 'store_apps', name: 'Store Apps & Integrations', description: 'One page listing every account the shop connects (payments, shipping, QuickBooks, email, reviews, Google and Meta), with whether it is connected and where to change it', category: 'Marketing', core: false, templates: ['crm-store'], hidden: true },
  { id: 'store_api', name: 'Store API', description: 'Keys, each limited to what it may read or change, so a script or another system can read products, orders, customers and stock, and change stock counts', category: 'Marketing', core: false, templates: ['crm-store'], hidden: true },
  { id: 'store_webhooks', name: 'Store Webhooks', description: 'The shop posts orders created, paid, fulfilled and refunded, and product and stock changes, to addresses you give it, signed, with retries and a delivery log', category: 'Marketing', core: false, templates: ['crm-store'], hidden: true },
  { id: 'cash_management', name: 'Cash Management', description: 'Cash drawer sessions and end-of-day reconciliation', category: 'POS & Sales', core: false, templates: ['crm-dispensary'] },

  // Dispensary — Inventory & Compliance
  { id: 'dispensary_inventory', name: 'Inventory Tracking', description: 'Stock levels, adjustments, low-stock alerts', category: 'Inventory & Compliance', core: true, templates: ['crm-dispensary'] },
  { id: 'purchase_limits', name: 'Purchase Limits', description: 'Michigan 2.5oz per transaction enforcement', category: 'Inventory & Compliance', core: true, templates: ['crm-dispensary'] },
  { id: 'audit_log', name: 'Audit Log', description: 'Immutable audit trail for all sensitive actions', category: 'Inventory & Compliance', core: true, templates: ['crm-dispensary'] },
  { id: 'id_verification', name: 'ID Verification', description: 'Customer ID verification tracking at pickup/delivery', category: 'Inventory & Compliance', core: true, templates: ['crm-dispensary'] },

  // Dispensary — Loyalty & Marketing
  { id: 'loyalty_rewards', name: 'Loyalty Program', description: 'Points and rewards for regulars; member tiers (Silver, Gold…) in the salon and dispensary programs', category: 'Loyalty & Marketing', core: false, templates: ['crm-dispensary', 'crm-salon', 'crm-bar'] },
  { id: 'sms_marketing', name: 'SMS Marketing', description: 'Text message campaigns and opt-in management', category: 'Loyalty & Marketing', core: false, templates: ['crm-dispensary'] },
  { id: 'email_campaigns', name: 'Email Campaigns', description: 'Email marketing and deal notifications', category: 'Loyalty & Marketing', core: false, templates: ['crm-dispensary'] },

  // Dispensary — Delivery & Online
  { id: 'delivery', name: 'Delivery', description: 'Delivery zones, driver management, and tracking', category: 'Delivery & Online', core: false, templates: ['crm-dispensary'] },
  { id: 'order_ahead', name: 'Order Ahead', description: 'Online ordering for pickup and delivery', category: 'Delivery & Online', core: false, templates: ['crm-dispensary'] },
  { id: 'public_menu', name: 'Public Menu', description: 'Public-facing product menu with strain info', category: 'Delivery & Online', core: true, templates: ['crm-dispensary'] },

  // Dispensary — Analytics & Merch
  { id: 'dispensary_analytics', name: 'Analytics', description: 'Sales reports, product performance, peak hours', category: 'Analytics', core: false, templates: ['crm-dispensary'] },
  { id: 'merch_store', name: 'Merch Store', description: 'Non-cannabis merchandise with Stripe checkout', category: 'Analytics', core: false, templates: ['crm-dispensary'] },

  // Dispensary — NEW: Compliance & Tracking
  { id: 'metrc', name: 'Metrc Integration', description: 'Direct Metrc API integration for state compliance sync', category: 'Compliance', core: false, templates: ['crm-dispensary'] },
  { id: 'compliance', name: 'Compliance Reporting', description: 'State-format compliance reports, license management, waste tracking', category: 'Compliance', core: false, templates: ['crm-dispensary'] },
  { id: 'labels', name: 'Label Printing', description: 'Compliant cannabis labels with QR codes, barcodes, custom design', category: 'Compliance', core: false, templates: ['crm-dispensary'] },

  // Dispensary — NEW: Inventory & RFID
  // The description is what EVERY template does: crm, crm-fieldservice, crm-landscaping and crm-basic put jobs,
  // people and stock locations at a branch and report revenue and stock value by branch; crm-dispensary keeps stock
  // per store with transfers. Keep it to what all five do — it is what the signup and pricing pages print.
  { id: 'multi_location', name: 'Multi-Location', description: 'Run several locations from one account, with staff, stock and reporting for each location', category: 'Inventory & Compliance', core: false, templates: ['crm-dispensary', 'crm-fieldservice', 'crm-basic', 'crm-landscaping', 'crm'] },
  { id: 'batches', name: 'Batch/Lot Tracking', description: 'Full batch lifecycle from receipt to depletion', category: 'Inventory & Compliance', core: false, templates: ['crm-dispensary'] },
  { id: 'rfid', name: 'RFID Scanning', description: 'RFID tag management, scanning, and bulk inventory counts', category: 'Inventory & Compliance', core: false, templates: ['crm-dispensary'] },

  // Dispensary — NEW: Delivery & Tracking
  { id: 'delivery_tracking', name: 'Delivery Tracking', description: 'Real-time GPS tracking, route optimization, customer tracking', category: 'Delivery & Online', core: false, templates: ['crm-dispensary'] },

  // Dispensary — NEW: POS Enhancements
  { id: 'kiosk', name: 'Self-Service Kiosk', description: 'Customer-facing kiosk for self-service ordering', category: 'POS & Sales', core: false, templates: ['crm-dispensary'] },
  { id: 'ai_recommendations', name: 'AI Recommendations', description: 'Personalized product suggestions based on purchase history', category: 'POS & Sales', core: false, templates: ['crm-dispensary'] },
  { id: 'pin_login', name: 'PIN Login', description: 'Quick PIN-based login for budtenders at POS', category: 'POS & Sales', core: false, templates: ['crm-dispensary'] },
  { id: 'tip_management', name: 'Tip Management', description: 'Collect and distribute tips across budtenders', category: 'POS & Sales', core: false, templates: ['crm-dispensary'] },

  // Dispensary — NEW: Marketing
  { id: 'referrals', name: 'Referral Program', description: 'Customer referral tracking with automatic rewards', category: 'Loyalty & Marketing', core: false, templates: ['crm-dispensary'] },

  // Dispensary — NEW: Analytics & BI
  { id: 'custom_reports', name: 'Custom Reports & BI', description: 'Report builder, BI widgets, budtender performance', category: 'Analytics', core: false, templates: ['crm-dispensary'] },
  { id: 'bi_dashboard', name: 'BI Dashboard', description: 'Drag-and-drop business intelligence dashboard', category: 'Analytics', core: false, templates: ['crm-dispensary'] },
  { id: 'budtender_performance', name: 'Budtender Performance', description: 'Per-budtender sales attribution and metrics', category: 'Analytics', core: false, templates: ['crm-dispensary'] },
  { id: 'website_analytics', name: 'Website & SEO Analytics', description: 'Page views, traffic sources, UTM campaigns, real-time visitors', category: 'Analytics', core: false, templates: ['crm-dispensary'] },

  // Dispensary — NEW: Supply Chain
  { id: 'cultivation', name: 'Cultivation / Grow Tracking', description: 'Plant tracking from seed to harvest with grow room management', category: 'Supply Chain', core: false, templates: ['crm-dispensary'] },
  { id: 'manufacturing', name: 'Manufacturing / Processing', description: 'Extraction, infusion, and processing job management', category: 'Supply Chain', core: false, templates: ['crm-dispensary'] },
  { id: 'wholesale', name: 'Distribution / Wholesale', description: 'B2B customers, wholesale orders, manifests, lab testing/CoA', category: 'Supply Chain', core: false, templates: ['crm-dispensary'] },
  { id: 'lab_testing', name: 'Lab Testing (CoA)', description: 'Lab test tracking with Certificate of Analysis import', category: 'Supply Chain', core: false, templates: ['crm-dispensary'] },

  // Dispensary — NEW: Enterprise
  { id: 'multi_store', name: 'Multi-Store / Chain', description: 'Cross-location dashboard and reporting', category: 'Enterprise', core: false, templates: ['crm-dispensary'] },
  { id: 'franchise', name: 'Franchise Management', description: 'Manage franchise locations with shared settings', category: 'Enterprise', core: false, templates: ['crm-dispensary'] },
  { id: 'open_api', name: 'Open API', description: 'Published OpenAPI spec for third-party integrations', category: 'Enterprise', core: false, templates: ['crm-dispensary'] },
  { id: 'ach_payments', name: 'ACH/Bank Transfers', description: 'Accept ACH bank transfer payments', category: 'Enterprise', core: false, templates: ['crm-dispensary'] },

  // Cross-vertical pages that ship in several templates and are gated in their sidebars
  { id: 'support_tickets', name: 'Support Tickets', description: 'Customer support ticket queue with statuses and assignment', category: 'Communication', core: false, templates: ['crm', 'crm-fieldservice', 'crm-basic', 'crm-landscaping', 'crm-restaurant', 'crm-rv', 'crm-salon', 'crm-vet', 'crm-bar'] },
  { id: 'tech_mobile_view', name: 'Technician / Crew Mobile View', description: 'Mobile-first field view: today\'s jobs, directions, on my way / on site / done, photos and a checklist', category: 'Field Service', core: false, templates: ['crm-fieldservice', 'crm-landscaping', 'crm'] },
  { id: 'commission_tracking', name: 'Commission Tracking', description: 'Commission plans for sales reps and crews: earned by hand or automatically when an invoice is paid, approved, paid out, with statements', category: 'Finance', core: false, templates: ['crm-fieldservice', 'crm-basic', 'crm-landscaping', 'crm', 'crm-roof'] },

  // Construction pages that ship in crm
  { id: 'lien_waivers', name: 'Lien Waivers', description: 'Conditional and unconditional lien waiver tracking per payment', category: 'Construction', core: false, templates: ['crm'] },
  { id: 'draw_schedules', name: 'Draw Schedules', description: 'Construction-loan draw schedules and draw requests', category: 'Construction', core: false, templates: ['crm'] },
  { id: 'aia_forms', name: 'AIA G702/G703 Billing', description: 'Application and certificate for payment with continuation sheet', category: 'Construction', core: false, templates: ['crm'] },
  { id: 'gantt_charts', name: 'Gantt Chart', description: 'Project schedule as a Gantt chart with dependencies', category: 'Construction', core: false, templates: ['crm'] },

  // Roofing
  { id: 'storm_radar_overlay', name: 'Storm Radar', description: 'Live storm radar overlay on the service-area map — not yet available', category: 'Roofing', core: false, templates: ['crm-roof'], hidden: true },

  // Dispensary — sidebar modules that had no registry entry
  { id: 'checkin', name: 'Customer Check-In', description: 'Front-desk check-in with ID capture', category: 'POS & Sales', core: false, templates: ['crm-dispensary'] },
  { id: 'queue_management', name: 'Queue Management', description: 'Waiting-room queue and budtender assignment', category: 'POS & Sales', core: false, templates: ['crm-dispensary'] },
  { id: 'approvals', name: 'Manager Approvals', description: 'Manager PIN approval for discounts, voids and refunds', category: 'POS & Sales', core: false, templates: ['crm-dispensary'] },
  { id: 'offline_mode', name: 'Offline Mode', description: 'Keep selling when the connection drops and sync later', category: 'POS & Sales', core: false, templates: ['crm-dispensary'] },
  { id: 'pay_by_bank', name: 'Pay by Bank', description: 'Bank-to-bank checkout for cashless payment', category: 'POS & Sales', core: false, templates: ['crm-dispensary'] },
  { id: 'ai_budtender', name: 'AI Budtender', description: 'Guided product recommendations from effects, terpenes and purchase history', category: 'POS & Sales', core: false, templates: ['crm-dispensary'] },
  { id: 'biotrack', name: 'BioTrack Sync', description: 'BioTrackTHC state traceability sync', category: 'Compliance', core: false, templates: ['crm-dispensary'] },
  { id: 'equivalency', name: 'Equivalency Calculator', description: 'Flower-equivalent purchase-limit math per state rules', category: 'Compliance', core: false, templates: ['crm-dispensary'] },
  { id: 'tax_filing', name: 'Tax Filing Reports', description: 'Excise and sales-tax filing summaries', category: 'Compliance', core: false, templates: ['crm-dispensary'] },
  { id: 'fraud_detection', name: 'Fraud Detection', description: 'Transaction anomaly scanning and alerts', category: 'Compliance', core: false, templates: ['crm-dispensary'] },
  { id: 'predictive_inventory', name: 'Inventory Forecasting', description: 'Demand forecasting and reorder suggestions', category: 'Inventory & Compliance', core: false, templates: ['crm-dispensary'] },
  { id: 'gamified_loyalty', name: 'Loyalty Challenges', description: 'Gamified challenges and streak rewards on top of the loyalty program', category: 'Loyalty & Marketing', core: false, templates: ['crm-dispensary'] },
  { id: 'seo_pages', name: 'SEO Landing Pages', description: 'Auto-generated strain and category landing pages', category: 'Loyalty & Marketing', core: false, templates: ['crm-dispensary'] },
  { id: 'digital_signage', name: 'Digital Signage', description: 'In-store menu boards driven by live inventory', category: 'Delivery & Online', core: false, templates: ['crm-dispensary'] },
  { id: 'curbside', name: 'Curbside Pickup', description: 'Curbside order handoff with arrival notifications', category: 'Delivery & Online', core: false, templates: ['crm-dispensary'] },
  { id: 'menu_sync', name: 'Menu Sync', description: 'Push the live menu to third-party menus and the public menu', category: 'Delivery & Online', core: false, templates: ['crm-dispensary'] },
  { id: 'training_lms', name: 'Training Center', description: 'Budtender onboarding courses and certifications', category: 'Enterprise', core: false, templates: ['crm-dispensary'] },
  { id: 'marketplace', name: 'Integrations Marketplace', description: 'Connect third-party menus, payments and compliance tools', category: 'Enterprise', core: false, templates: ['crm-dispensary'] },
  { id: 'platform', name: 'Platform Settings', description: 'Advanced platform configuration and API keys', category: 'Enterprise', core: false, templates: ['crm-dispensary'] },
  { id: 'soc2', name: 'SOC 2 Controls', description: 'Security controls dashboard and evidence log', category: 'Enterprise', core: false, templates: ['crm-dispensary'] },

  // Add-on Products
  // Paid add-on — offered ONLY to contractor (crm) and roofer (crm-roof). Never included in a plan.
  { id: 'visualizer', name: 'Exterior Visualizer', description: 'Paid add-on (extra cost) — AI-powered exterior visualization for siding, roofing, paint colors', category: 'Add-on Products', core: false, templates: ['crm', 'crm-roof'] },
  // Instant Roof Estimator — NOT ready (2026-08-20). Its routes/pages still exist in crm and
  // crm-roof and every surface is gated on this id. Offered to NO template and hidden, so it can
  // never be seeded, toggled or sold; the id stays in the vocabulary so the gates are not "unknown".
  // Add the templates back only when the feature actually works.
  { id: 'instant_estimator', name: 'Instant Roof Estimator', description: 'Instant roof estimate from a satellite measurement — not yet available', category: 'Add-on Products', core: false, templates: [], hidden: true },

  // Home care depth (cloud/homecare-depth, 2026-10-30) — NOT READY until the owner has tested each. Offered to no template
  // beyond crm-homecare and hidden, so no plan, signup or Settings › Features save can switch one on; a test switches one on
  // by writing the company's list, as the financing tests do.
  { id: 'care_cert_reminders', name: 'Credential expiry reminders', description: 'Reminders to the caregiver and the office (by app, phone and email) at the lead times the agency picks, for caregivers\' and clients\' credentials; a credential search; an expired caregiver is flagged when scheduling, or kept off shifts if the agency chooses', category: 'Home Care', core: false, templates: ['crm-homecare'], hidden: true },
  { id: 'care_medication_reminders', name: 'Medication reminders', description: 'Dose times on each medicine; a push to the caregiver on the visit when a dose is due, and a notice to the office when a dose during a visit was never recorded', category: 'Home Care', core: false, templates: ['crm-homecare'], hidden: true },
  { id: 'care_visit_questions', name: 'Clock-in and clock-out questions', description: 'Questions the caregiver answers when clocking in or out (safety, how the client is, breaks); required ones must be answered, and a worrying answer tells the office', category: 'Home Care', core: false, templates: ['crm-homecare'], hidden: true },
  { id: 'care_visit_items', name: 'Forms, interventions and goals in a visit', description: 'Attach forms, interventions and goals to a client\'s visits (and tasks to every visit); the caregiver works through them during the visit, required ones must be finished to clock out, and the agency can require a visit note', category: 'Home Care', core: false, templates: ['crm-homecare'], hidden: true },
  { id: 'care_family_texts', name: 'Family arrival texts', description: 'A text to relatives who asked for it when the caregiver arrives and when they leave, from the agency\'s own number', category: 'Home Care', core: false, templates: ['crm-homecare'], hidden: true },
  { id: 'care_required_tasks', name: 'Required tasks before clock-out', description: 'Mark a client\'s task required: the caregiver cannot clock out until it is done, or skipped with a reason. A task\'s days of the week and AM/PM are read (a Tuesday task holds only Tuesday visits), the phone greys Clock out while one is open, and a report shows whether every assigned task was done', category: 'Home Care', core: false, templates: ['crm-homecare'], hidden: true },
  { id: 'care_visit_signature', name: 'Client signature on every visit', description: 'The caregiver has the client sign on the phone at the end of a visit, with the time; a client who cannot sign gets a reason from a list; the agency can make it required before clock-out', category: 'Home Care', core: false, templates: ['crm-homecare'], hidden: true },
  { id: 'care_family_content', name: 'Daily care, meals, vitals and documents for the family', description: 'The family portal shows the tasks planned for each upcoming visit, a task log for each past visit, and the meals the caregiver recorded on the phone; each relative has their own switch for vitals and for documents, and the office picks which documents the family may see', category: 'Home Care', core: false, templates: ['crm-homecare'], hidden: true },
  { id: 'care_family_comms', name: 'Family requests, texts and emails in the agency\'s words', description: 'A relative can ask for a visit change, a service change or a new visit (an office task and an Open requests tile); arrival and finish notices by text and email in the agency\'s own wording; the relative\'s STOP honoured by our own record; a screen of every family text sent or held and why; the portal emails (account created, forgot password, access granted, access revoked) in the agency\'s words; arrival and finish notices as app notices on a relative\'s own phone or browser, and alert rules the agency writes for relatives, the office or the caregiver', category: 'Home Care', core: false, templates: ['crm-homecare'], hidden: true },
  { id: 'care_shift_repeats', name: 'Monthly and every-few-weeks shifts', description: 'Repeat a shift monthly (every 2nd Tuesday) or every 3 to 12 weeks, and make one repeating shift on several weekdays at once', category: 'Home Care', core: false, templates: ['crm-homecare'], hidden: true },
  { id: 'care_match_prefs', name: 'Match on skills, gender and language', description: 'Suggested caregivers weigh the skills a client needs, a gender preference and a language, and say why for each', category: 'Home Care', core: false, templates: ['crm-homecare'], hidden: true },
  { id: 'care_supervisory_visits', name: 'Supervisory visits', description: 'A check-in on each client every 60 or 90 days (or a service code’s or the client’s own cycle): planned on the calendar for a named supervisor, reminded the day before, done from their phone with the agency’s own questions and both signatures, and what is due or overdue on the dashboard', category: 'Home Care', core: false, templates: ['crm-homecare'], hidden: true },
  { id: 'care_margin_reports', name: 'Client margin and caregiver turnover', description: 'What each client brings in against what their caregivers cost (overtime and mileage included) — per client, per visit, by referral source, payer, department and branch, as a trend and a drill-down, two periods side by side, downloaded as CSV or PDF — and how many caregivers join and leave, with a stored leaving date, applicant-to-hire, hire-to-first-shift, call-outs, cost per hire and payroll accuracy', category: 'Home Care', core: false, templates: ['crm-homecare'], hidden: true },
  { id: 'care_report_builder', name: 'Report builder, dashboards and scheduled reports', description: 'Build your own reports over every visit field (filters, sorting, grouping; saved, copied, from a standard library), financial / authorization-utilisation / caregiver dashboards and your own dashboards (profit margin by location and referral source among the tiles), a daily manager report, workforce analytics (workload, underused staff, cancellation trends), a caregiver performance report (late clock-ins and outs, visits done / missed / cancelled, ADL and form completion, client ratings), and reports emailed on a schedule as an encrypted link', category: 'Home Care', core: false, templates: ['crm-homecare'], hidden: true },
  { id: 'care_caregiver_surveys', name: 'Caregiver satisfaction and retention risk', description: 'Ask caregivers how it is going on the phone at points the agency sets (after the first visit with a client, 90 days in, every so many days); a low score alerts the office; results by branch, manager and caregiver with a trend; and a retention-risk score per caregiver with its reasons (hours drop, call-outs, missed visits, survey, tenure) and its trend', category: 'Home Care', core: false, templates: ['crm-homecare'], hidden: true },
  { id: 'care_import', name: 'Import clients, caregivers and schedules from a spreadsheet', description: 'Bring in a CSV of clients, caregivers or recurring shifts: match the columns, preview every row, skip duplicates, run it as a dry run first, and undo a whole import', category: 'Home Care', core: false, templates: ['crm-homecare'], hidden: true },
  { id: 'care_import_all', name: 'Import every record kind', description: 'Beyond clients, caregivers and shifts: authorizations, certifications and client credentials, medicine lists, pay rates, payers, important contacts, past invoices, training, leave, journal entries, reviews and expenses — each with a template, a duplicate rule and undo', category: 'Home Care', core: false, templates: ['crm-homecare'], hidden: true },
  { id: 'care_import_wizard', name: 'Import wizard: Excel, saved mappings, updates', description: 'Excel files and pasted data, column mappings saved for next time, a day/month/year choice, fixing a cell on the preview, re-imports that update the fields the owner allows (with undo), matching by reference code or name and zip, custom fields, payers in one cell, and a zip of documents or qualifications attached in bulk', category: 'Home Care', core: false, templates: ['crm-homecare'], hidden: true },
  { id: 'care_migration', name: 'Assisted migration', description: 'Send the old system\'s export to Twomiah from the app; Twomiah staff load it with the same importer, compare record counts old vs new, and both sides tick a sign-off checklist', category: 'Home Care', core: false, templates: ['crm-homecare'], hidden: true },
  { id: 'care_payroll_rules', name: 'Pay rules: state overtime, paid travel, ADP and Paychex files', description: 'Overtime by the agency\'s own state rule (every state, with holidays, breaks, sleepovers and limits), paid travel and mileage between visits, and payroll files for ADP, Paychex and Excel', category: 'Home Care', core: false, templates: ['crm-homecare'], hidden: true },
  { id: 'care_payroll_providers', name: 'Payroll pushed to ADP, Paychex or Gusto', description: 'Send the pay run straight to ADP Workforce Now, Paychex Flex or Gusto, or run full-service payroll (taxes filed, caregivers paid) through an embedded provider, once the agency\'s provider account is connected', category: 'Home Care', core: false, templates: ['crm-homecare'], hidden: true },
  { id: 'care_autopay', name: 'Automatic payment of invoices (card or bank)', description: 'A family saves a card or a bank account (US ACH debit, Canadian pre-authorized debit) on Stripe\'s own page — from the office or from their portal — and each invoice is charged to it, on the agency\'s own Stripe account, as the invoice is sent or on the day the office schedules, in one go or in parts; retried on the agency\'s own schedule if declined, with a plain notice to the family and the office, a receipt after each payment and a warning before a card expires', category: 'Home Care', core: false, templates: ['crm-homecare'], hidden: true },
  { id: 'care_billing_contacts', name: 'Billing contacts', description: 'Who pays each client’s invoices — the client, a family member or someone else — with up to five email addresses that get every invoice, reminder and payment notice; set for many clients at once', category: 'Home Care', core: false, templates: ['crm-homecare'], hidden: true },
  { id: 'care_visit_optimizer', name: 'Visit optimizer', description: 'Fill many open visits at once: pick the visits, say how much travel time, continuity, skills, waiting between visits and daily and weekly hours matter, review the proposed caregiver for each, then assign them or offer them', category: 'Home Care', core: false, templates: ['crm-homecare'], hidden: true },
  { id: 'care_no_arrival', name: 'Caregiver not arrived alerts', description: 'When a scheduled visit passes its start and grace minutes with no clock-in, a No-Show alert is raised once and the office, the caregiver and (if chosen) the client’s family are told', category: 'Home Care', core: false, templates: ['crm-homecare'], hidden: true },
  { id: 'care_quickbooks', name: 'Home care invoices in QuickBooks', description: 'Each sent invoice, its payments and write-offs go into QuickBooks on the QuickBooks sync — the client (or the payer it is billed to) as the customer — and a deleted invoice or payment is taken out there too', category: 'Home Care', core: false, templates: ['crm-homecare'], hidden: true },
  { id: 'care_split_billing', name: 'Split billing', description: 'One visit billed to several payers in order — each a percent or an amount per hour — with the family paying the rest; no one is billed more than the visit', category: 'Home Care', core: false, templates: ['crm-homecare'], hidden: true, words: ['split billing', 'share of cost', 'copay'] },
  { id: 'care_ltc_billing', name: 'Long-term care insurance billing', description: 'A long-term care insurance payer with the client\'s policy and claim numbers, and a claim packet (cover sheet, itemised services and visit times) for each invoice', category: 'Home Care', core: false, templates: ['crm-homecare'], hidden: true },
  { id: 'care_pickup_rewards', name: 'Pickup bonus, points and rewards', description: 'The bonus on an open shift is paid through the pay run once the visit is worked; caregivers earn points for extra shifts, on-time clock-ins and minimum weekly hours and spend them on rewards the agency sets; a caregiver also says on the phone how many hours they want and asks for time off', category: 'Home Care', core: false, templates: ['crm-homecare'], hidden: true },
  { id: 'care_open_shift_offers', name: 'Open shift offers: decline, deadlines, series and a message record', description: 'A caregiver can decline an open shift with a reason or hide it; each offer shows Not sent, Pending, Accepted, Declined, Expired or Closed with response counts and an answer-by time; the agency chooses what caregivers see and how many days ahead; offers go by app, text and email with each person\'s notification settings honoured and every message kept with how it ended; a whole recurring series can be offered at once', category: 'Home Care', core: false, templates: ['crm-homecare'], hidden: true },
  { id: 'care_offline_saves', name: 'Safe saves from the phone without signal', description: 'A task, a medicine entry or a photo saved on the phone without signal and sent later is recorded once, at the time it was made, and a dose someone else already recorded is refused in plain words', category: 'Home Care', core: false, templates: ['crm-homecare'], hidden: true },
]

export const FEATURE_MAP = Object.fromEntries(FEATURE_REGISTRY.map(f => [f.id, f]))

/** The feature a website section type belongs to (FeatureDef.siteSections), if any. */
export function siteSectionFeature(type: string): string | null {
  return FEATURE_REGISTRY.find((f) => f.siteSections?.includes(type))?.id ?? null
}

/** The words of every not-ready feature (FeatureDef.words), and their pattern: null when none is not ready. */
export function notReadyWords(): string[] {
  return [...new Set(FEATURE_REGISTRY.filter((f) => f.hidden).flatMap((f) => f.words || []))]
}
export function notReadyPattern(): RegExp | null {
  const w = notReadyWords()
  // Words are letters only (the registry's own), so they go into the pattern as they are.
  return w.length ? new RegExp('\\b(?:' + w.join('|') + ')', 'i') : null
}

/**
 * A feature list with the not-ready (hidden) ones taken out. A not-ready feature is switched on by no path — the
 * owner's Features page, the Factory's admin, a tenant's first setup or a feature sync — so a door that writes the list
 * from outside passes it through this. (Owner, 2026-10-19: storm radar, roof reports, the estimator and Ads stay off
 * until they are tested.)
 */
export function withoutNotReady(features: string[]): string[] {
  return features.filter((f) => !FEATURE_MAP[f]?.hidden)
}

/**
 * A feature list with what this product does not offer taken out — ONE rule for every door that writes a business's
 * features (the owner's Settings › Features, the Factory's sync, a first setup, the in-CRM subscription service) and for
 * the boot-time sweep of the rows already written (apps/unified server/modules/company.ts dropUnofferedFeatures).
 *
 * A feature taken off an industry's templates[] stayed switched on for every business that already had it: home care's
 * shared Invoices was withdrawn on 2026-10-22, but an agency created before then still had it on — a second billing
 * book beside its own Billing, its payments counted by neither the dashboard nor Billing, its pages reachable only by a
 * typed address (live test 2026-10-22). So the list is the offer: an id kept is one this template lists (a not-ready one
 * a platform admin already switched on included — withoutNotReady is the rule for switching one ON); an id no template
 * lists, or only other templates, goes.
 */
export function withinOffer(template: string, features: string[]): string[] {
  return [...new Set(features)].filter((f) => typeof f === 'string' && !!FEATURE_MAP[f]?.templates.includes(template))
}

export function getCategories(): string[] {
  const seen = new Set<string>()
  return FEATURE_REGISTRY.filter(f => { if (seen.has(f.category)) return false; seen.add(f.category); return true }).map(f => f.category)
}

export function getFeaturesForTemplate(template: string): FeatureDef[] {
  return FEATURE_REGISTRY.filter(f => f.templates.includes(template)).map((f) => (f.as?.[template] ? { ...f, ...f.as[template] } : f))
}

/**
 * What a new business starts with: its industry's whole CRM — every feature its template offers except paid Add-on
 * Products and not-ready (hidden) features. The same list as getFeaturesForPlan, since plans are priced by seats only.
 * (Owner, 2026-10-20: a contractor that signs up gets the construction CRM, not a nine-screen core. The old lean
 * core-only start, plus the per-template extras roof and bar needed to work at all, are gone; Higgs ran 59 of 61.)
 */
export function getDefaultFeaturesForTemplate(template: string): string[] {
  return includedByDefault(template).filter((id) => !FEATURE_MAP[id]?.optIn?.includes(template))
}

/**
 * Features safe to advertise on public surfaces (signup wizard, pricing pages, plan upsell).
 * Excludes anything flagged `hidden: true` — features still being built but not ready to sell.
 */
export function getAdvertisableFeatures(): FeatureDef[] {
  return FEATURE_REGISTRY.filter(f => !f.hidden)
}

/** Public-facing feature list for a single template. Excludes hidden features. */
export function getAdvertisableFeaturesForTemplate(template: string): FeatureDef[] {
  return FEATURE_REGISTRY.filter(f => f.templates.includes(template) && !f.hidden)
}

/**
 * What a business may switch on: every feature its template offers — EXCEPT paid Add-on Products (Exterior Visualizer,
 * Instant Roof Estimator: off by default everywhere, sold separately) and features still flagged hidden (not ready).
 * Plans are priced by seats (website, starter10, team25, business50), never by features, so the plan does not change
 * the list. The old feature-tier lists (starter/pro/business/construction/storm/enterprise) were the retired pricing and
 * are gone (owner, 2026-10-19). An unknown plan name gets the same list: a typo must never switch on a paid add-on.
 */
function includedByDefault(template: string): string[] {
  return getFeaturesForTemplate(template)
    .filter(f => !isPaidAddOn(f.id) && !f.hidden)
    .map(f => f.id)
}

/** A paid Add-on Product (Exterior Visualizer): sold separately, so never in a plan and never the owner's own switch to turn on. */
export function isPaidAddOn(id: string): boolean {
  return FEATURE_MAP[id]?.category === 'Add-on Products'
}

/** Every plan: includedByDefault. The plan argument stays for the callers that pass one. */
export function getFeaturesForPlan(template: string, _plan?: string): string[] {
  return includedByDefault(template)
}
