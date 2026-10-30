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
  { id: 'project_templates', name: 'Project Templates', description: 'Save a project as a template — its schedule and starter punch list — and start the next one from it', category: 'Construction', core: false, templates: ['crm'], hidden: true },
  { id: 'daily_logs', name: 'Daily Logs', description: 'Field daily log reports', category: 'Construction', core: false, templates: ['crm'] },
  { id: 'inspections', name: 'Inspections', description: 'Quality inspections', category: 'Construction', core: false, templates: ['crm'] },
  { id: 'inspection_checklists', name: 'Inspection Checklists', description: 'Checklists for each inspection — pass, fail or not applicable with a note and photos; a failed line adds a punch-list item', category: 'Construction', core: false, templates: ['crm'], hidden: true },
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
  { id: 'snow_billing', name: 'Snow & Ice Billing', description: 'Per-push, per-event and per-inch snow billing; a seasonal contract leaves its visits uncharged (bill the season itself with a recurring invoice)', category: 'Landscaping', core: false, templates: ['crm-landscaping'] },
  { id: 'pricebook', name: 'Pricebook', description: 'Standardized pricing catalog', category: 'Service Trade', core: false, templates: ['crm', 'crm-fieldservice', 'crm-basic', 'crm-landscaping', 'crm-roof'] /* not crm-homecare: an agency has no quotes or invoices to price (owner, 2026-10-19) */ },

  // Field Service
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
  { id: 'rebooking_reminders', name: 'Rebooking & Recall', description: 'Who is due back, who has lapsed, whose birthday is coming — with bulk texting', category: 'Salon & Barber', core: true, templates: ['crm-salon'] },
  { id: 'salon_memberships', name: 'Memberships & Packages', description: 'Recurring memberships and prepaid visit packages that burn down per redeem', category: 'Salon & Barber', core: false, templates: ['crm-salon'] },

  // Bar (crm-bar) — what a bar changes every night and its website shows live (routes/bar.ts, barPublic.ts).
  { id: 'bar_menu', name: 'Menu & Taps', description: 'The menu with real prices and one-tap 86, and the tap list — shown live on your website', category: 'Bar', core: true, templates: ['crm-bar', 'crm-restaurant'], optIn: ['crm-restaurant'],
    as: { 'crm-restaurant': { name: 'Menu', description: 'The menu with real prices, photos and one-tap 86 — shown live on your website', category: 'Register & Ordering' } } },
  { id: 'bar_register', name: 'Register & Grill', description: "Tabs, tables and walk-ups; send food to the grill screen, which paces it; take cash or card; split; voids a manager OKs; the night's close-out with the drawer count", category: 'Bar', core: true, templates: ['crm-bar', 'crm-restaurant'], optIn: ['crm-restaurant'],
    as: { 'crm-restaurant': { category: 'Register & Ordering' } } },
  { id: 'bar_stock', name: 'Stock & Costing', description: 'Stock by the case and the keg, recipes, the count, what each plate and pour costs, what to reorder and the order to the rep', category: 'Bar', core: true, templates: ['crm-bar'] },
  { id: 'bar_schedule', name: 'Schedule', description: 'Build the week, see the gaps and the labor cost before you publish it, time off asked for and decided — and clock in on the bar tablet by PIN', category: 'Bar', core: true, templates: ['crm-bar'] },
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

  // Field Operations
  // Not home care: a caregiver's clock-in and clock-out is EVV (Compliance › EVV), the agency's own and always on — this
  // switch opened the trades' Time page, which an agency's menu does not have, so it switched nothing (live test 2026-10-22).
  { id: 'time_tracking', name: 'Time Tracking', description: 'Clock in and out, or log hours by hand; hours by person and day', category: 'Field Operations', core: false, templates: ['crm', 'crm-fieldservice', 'crm-basic', 'crm-landscaping', 'crm-salon', 'crm-bar'] },
  // Where's the crew and the job-site geofences (/crm/geofences) and the phone app's location sharing. Not home care: its
  // caregivers' location is EVV's, at clock-in and clock-out, and the phone app offers tracking to the trades only.
  { id: 'gps_tracking', name: 'GPS Tracking', description: 'Crew locations and automatic clock-in and out at job-site fences, from the Twomiah phone app', category: 'Field Operations', core: false, templates: ['crm', 'crm-fieldservice', 'crm-basic', 'crm-landscaping'] },
  { id: 'photo_capture', name: 'Photo Capture', description: 'Job site photo documentation', category: 'Field Operations', core: false, templates: ['crm', 'crm-fieldservice', 'crm-basic', 'crm-landscaping', 'crm-roof'] },
  { id: 'equipment_tracking', name: 'Equipment', description: 'Equipment and tool tracking', category: 'Field Operations', core: false, templates: ['crm', 'crm-fieldservice', 'crm-basic', 'crm-landscaping'] },
  { id: 'fleet', name: 'Fleet Management', description: 'Vehicle fleet tracking', category: 'Field Operations', core: false, templates: ['crm', 'crm-fieldservice', 'crm-basic', 'crm-landscaping'] },

  // Finance
  { id: 'online_payments', name: 'Online Payments', description: 'Stripe payment processing — invoices and deposits paid by card, or by bank account where you turn that on in your Stripe account', category: 'Finance', core: false, templates: ['crm', 'crm-fieldservice', 'crm-basic', 'crm-landscaping', 'crm-homecare', 'crm-rv', 'crm-vet', 'crm-salon', 'crm-restaurant', 'crm-bar'] },
  { id: 'expense_tracking', name: 'Expense Tracking', description: 'Expense logging and receipts', category: 'Finance', core: false, templates: ['crm', 'crm-fieldservice', 'crm-basic', 'crm-landscaping', 'crm-salon', 'crm-bar'] },
  { id: 'job_costing', name: 'Job Costing', description: 'Detailed job cost analysis', category: 'Finance', core: false, templates: ['crm', 'crm-fieldservice', 'crm-basic', 'crm-landscaping'] },
  { id: 'purchase_orders', name: 'Purchase Orders', description: 'Commit spend with vendors per job — sent, acknowledged, received, billed', category: 'Finance', core: false, templates: ['crm', 'crm-dispensary'] },
  { id: 'vendor_bills', name: 'Bills & Payables', description: 'Vendor bills with due dates, payments, and committed-vs-billed job rollups', category: 'Finance', core: false, templates: ['crm'] },
  { id: 'vendor_portal', name: 'Vendor Portal', description: 'Subs and suppliers acknowledge POs and submit invoices through a private link', category: 'Communication', core: false, templates: ['crm'] },
  // Consumer Financing — NOT ready (2026-10-23). The trades the pros offer it to (Jobber, Housecall Pro, ServiceTitan:
  // contractors, roofers, HVAC/field service, landscapers; and RV/powersports service) get the lender flow in the unified
  // app: connect the lender in Settings › Integrations, "as low as $X/mo" + Apply on quotes and on the customer's quote and
  // invoice pages, an application link texted or emailed, signed lender webhooks that move the application and record the
  // funded payment, and a Financing page. Hidden until a real lender sandbox run passes (owner: untested features stay
  // off), so no plan, signup, Features page or Factory save switches it on, and nothing advertises it while it is off
  // (apps/unified/tests/not-ready-unseen.test.ts). The RV dealer's F&I page is its deal pipeline's, not this switch's.
  { id: 'consumer_financing', name: 'Consumer Financing', description: 'Customers apply for a loan from your quote or invoice; the lender pays you', category: 'Finance', core: false, templates: ['crm', 'crm-roof', 'crm-fieldservice', 'crm-landscaping', 'crm-rv'], hidden: true, words: ['financing', 'finance option', 'wisetack'], siteSections: ['financing'] },
  { id: 'quickbooks', name: 'QuickBooks', description: 'QuickBooks sync — we integrate accounting, we do not replace it', category: 'Finance', core: false, templates: ['crm', 'crm-fieldservice', 'crm-basic', 'crm-landscaping', 'crm-homecare', 'crm-roof', 'crm-rv', 'crm-vet', 'crm-salon', 'crm-restaurant', 'crm-bar'] },

  // Communication
  { id: 'two_way_texting', name: 'Two-Way Texting', description: 'Unified SMS inbox — every customer conversation logged', category: 'Communication', core: false, templates: ['crm', 'crm-fieldservice', 'crm-basic', 'crm-landscaping', 'crm-homecare', 'crm-roof', 'crm-dispensary', 'crm-rv', 'crm-vet', 'crm-salon', 'crm-restaurant', 'crm-bar'] },
  { id: 'call_tracking', name: 'Call Tracking', description: 'Inbound call tracking and recording', category: 'Communication', core: false, templates: ['crm', 'crm-fieldservice', 'crm-basic', 'crm-landscaping', 'crm-homecare', 'crm-automotive', 'crm-bar'] /* not crm-roof: no call-tracking screen there — the API is consumed by the AI receptionist page, so it rides that switch */ },
  { id: 'google_business', name: 'Google Reviews', description: 'Connect your Google Business Profile — see your rating and reply to reviews from the CRM', category: 'Communication', core: true, templates: ['crm', 'crm-roof', 'crm-vet', 'crm-salon', 'crm-restaurant', 'crm-fieldservice', 'crm-basic', 'crm-dispensary', 'crm-landscaping', 'crm-rv', 'crm-homecare', 'crm-store', 'crm-bar'] },
  { id: 'branded_email', name: 'Branded Email', description: 'support@yourdomain addresses — forward anywhere or receive replies in the CRM email inbox', category: 'Communication', core: true, templates: ['crm', 'crm-roof', 'crm-vet', 'crm-salon', 'crm-restaurant', 'crm-fieldservice', 'crm-basic', 'crm-dispensary', 'crm-landscaping', 'crm-rv', 'crm-homecare', 'crm-bar', 'crm-store'] },
  { id: 'client_portal', name: 'Client Portal', description: 'A customer portal by private link — quotes to approve, invoices to view and pay, and their projects where you run them', category: 'Communication', core: false, templates: ['crm', 'crm-fieldservice', 'crm-basic', 'crm-landscaping', 'crm-roof'] },
  { id: 'lead_inbox', name: 'Lead Inbox', description: 'Every inquiry in one inbox — marketplaces, ads, booking apps and your website', category: 'Communication', core: false, templates: ['crm', 'crm-fieldservice', 'crm-basic', 'crm-landscaping', 'crm-homecare', 'crm-automotive', 'crm-roof', 'crm-rv', 'crm-vet', 'crm-salon', 'crm-restaurant', 'crm-bar', 'crm-store'] /* crm-store: a store with a website sees its enquiries in the CRM, not only in the owner's email (store live test, 2026-10-26) */ },

  // Marketing
  // Twomiah Ads — NOT ready (2026-09-17). The page, the routes and the connector all still exist in the templates
  // and every surface is gated on this id; the id stays in the vocabulary so those gates are not "unknown". Offered
  // to NO template and hidden, so it cannot be seeded by a plan, shown on a tenant's Features page, or picked in the
  // Factory wizard. Put the templates back when the service is ready.
  { id: 'paid_ads', name: 'Paid Ads Hub (Google + Meta)', description: 'Google & Meta campaign management — not yet available', category: 'Marketing', core: false, templates: [], hidden: true },
  { id: 'google_reviews', name: 'Review Requests', description: 'Ask customers for a Google review — sent automatically after a completed job or salon visit once switched on in Reviews › Settings, or by hand from Reviews', category: 'Marketing', core: false, templates: ['crm', 'crm-fieldservice', 'crm-basic', 'crm-landscaping', 'crm-rv', 'crm-vet', 'crm-salon', 'crm-restaurant', 'crm-roof', 'crm-bar'] },
  { id: 'email_marketing', name: 'Email Marketing', description: 'Drip campaigns and newsletters', category: 'Marketing', core: false, templates: ['crm', 'crm-fieldservice', 'crm-basic', 'crm-landscaping', 'crm-restaurant', 'crm-rv', 'crm-salon', 'crm-vet', 'crm-bar'] },
  { id: 'referral_program', name: 'Referral Program', description: 'Customer referral tracking', category: 'Marketing', core: false, templates: [] /* offered to no industry: nothing reads it (scripts/check-unified-feature-has-screen.ts, live test 2026-10-22) */ },

  // Advanced
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
  { id: 'map_view', name: 'Map View', description: 'Map-based job visualization', category: 'Advanced', core: false, templates: [] /* offered to no industry: no screen in any industry's menu or pages (scripts/check-unified-feature-has-screen.ts, live test 2026-10-22). The id stays because the server still gates its API on it. */ },

  // Roofing
  { id: 'measurement_reports', name: 'Measurement Reports', description: 'Satellite roof measurement ordering', category: 'Roofing', core: false, templates: ['crm-roof'], hidden: true },
  { id: 'insurance_workflow', name: 'Insurance Workflow', description: 'Insurance claim tracking with adjuster info', category: 'Roofing', core: false, templates: ['crm-roof'] },
  // Not a switch. The pipeline board is roof's INDEX ROUTE — the first screen after login — so there is
  // no state of the product where it is off, and the Settings toggle could never do anything. `core` is a
  // global flag, but this feature is offered to crm-roof alone, so marking it core locks it to "Included"
  // for roofers and touches nothing else. (roof T18 L9)
  { id: 'pipeline_board', name: 'Pipeline Board', description: 'Visual Kanban pipeline for roofing jobs', category: 'Roofing', core: true, templates: ['crm-roof'] },
  { id: 'crews', name: 'Crews', description: 'Crew management and assignment', category: 'Roofing', core: false, templates: ['crm-roof'] },
  { id: 'materials', name: 'Materials', description: 'Material ordering and tracking', category: 'Roofing', core: false, templates: ['crm-roof'] },
  { id: 'canvassing_tool', name: 'Canvassing Tool', description: 'Door-to-door canvassing management', category: 'Roofing', core: false, templates: ['crm-roof'] },
  { id: 'storm_lead_gen', name: 'Storm Lead Gen', description: 'Storm damage lead generation', category: 'Roofing', core: false, templates: ['crm-roof'] },

  // Dispensary — POS & Sales
  { id: 'pos', name: 'Point of Sale', description: 'POS terminal for walk-in and pickup orders', category: 'POS & Sales', core: true, templates: ['crm-dispensary'] },
  { id: 'products', name: 'Product Catalog', description: 'Your products, their variants, prices and stock', category: 'POS & Sales', core: true, templates: ['crm-dispensary', 'crm-store'] },
  { id: 'orders', name: 'Orders', description: 'Order management and history', category: 'POS & Sales', core: true, templates: ['crm-dispensary', 'crm-store'] },
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
  { id: 'commission_tracking', name: 'Commission Tracking', description: 'Commission plans for sales reps and crews: earned by hand or automatically when an invoice is paid, approved, paid out, with statements', category: 'Finance', core: false, templates: ['crm-fieldservice', 'crm-basic', 'crm-landscaping', 'crm'] },

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
    .filter(f => f.category !== 'Add-on Products' && !f.hidden)
    .map(f => f.id)
}

/** Every plan: includedByDefault. The plan argument stays for the callers that pass one. */
export function getFeaturesForPlan(template: string, _plan?: string): string[] {
  return includedByDefault(template)
}
