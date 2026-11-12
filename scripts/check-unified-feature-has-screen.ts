// CI guard: every feature an industry is offered has a screen in that industry's app (2026-10-22).
//
// Live testers on a contractor found GPS Tracking, Route Optimization, Map View, Consumer Financing, Referral Program,
// Custom Dashboards and Recurring Jobs switched on in Settings › Features with no page anywhere; a home-care agency
// was sold GPS ("/crm/gps — there's no page here"). The registry's templates[] (packages/tenant-backend/src/
// featureRegistry.ts) is what the Factory's signup, its admin and the tenant's Settings › Features all offer, so a
// feature listed there for an industry is a promise to that industry.
//
// For each vertical (apps/unified/verticals/<v>/settings.ts) and each feature its featureSet is offered and may switch on
// (getAdvertisableFeaturesForTemplate — every one but the not-ready), there must be a SURFACE:
//   · an item in that vertical's own menu whose `features` name it — the menu is BUILT, not read: the admin page's
//     shell (apps/unified/web/src/shell.ts SHELL_HERE) is loaded in a browser-like window with the vertical's screen
//     settings, one child process per vertical (each vertical's menu is decided when the module loads);
//   · a Settings page offered for it (the roofer's estimator card), or
//   · one entry in SURFACES below: a page IN THAT VERTICAL'S MENU where the feature lives as a tab, a panel or a
//     behaviour, with the code that does it (a needle in a file, comments stripped). An entry names its page, so it
//     covers only the verticals whose menu has that page — never a blanket.
// A feature with none fails here: build its screen, wire the page that exists, or take the industry off templates[].
//
//   bun scripts/check-unified-feature-has-screen.ts
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const ROOT = join(import.meta.dir, '..')
const UNIFIED = join(ROOT, 'apps/unified')

interface MenuItem { to: string; features: string[] }
interface Built { id: string; featureSet: string; screens: any; menu: MenuItem[]; settings: { to: string; feature?: string }[] }

// ── child: build one vertical's menu ─────────────────────────────────────────────────────────────────────────────────
if (process.argv[2] === '--menu') {
  const v = process.argv[3]
  const s: any = (await import(join(UNIFIED, 'verticals', v, 'settings.ts'))).default
  const { Window } = await import('happy-dom')
  const w = new Window({ url: 'https://tenant.test/crm' })
  // The page as the server serves it (server/http/adminScreens.ts): the vertical's screens as JSON in #vertical-screens.
  w.document.body.innerHTML = `<script type="application/json" id="vertical-screens">${JSON.stringify(s.screens || {}).replace(/</g, '\\u003c')}</script>`
  for (const k of ['window', 'document', 'navigator', 'localStorage', 'HTMLElement', 'Element', 'Node', 'getComputedStyle']) {
    ;(globalThis as any)[k] = k === 'window' ? w : (w as any)[k]
  }
  const shell = await import(join(UNIFIED, 'web/src/shell.ts'))
  const roof = await import(join(UNIFIED, 'web/src/crm/verticals/roof.tsx'))
  const store = await import(join(UNIFIED, 'web/src/crm/verticals/store.tsx'))
  const built: Built = {
    id: s.id, featureSet: s.featureSet, screens: s.screens || {},
    menu: shell.SHELL_HERE.nav.map((i: any) => ({ to: i.to, features: i.features || [] })),
    settings: [...shell.SETTINGS_SUB_PAGES.map((to: string) => ({ to })), ...roof.SETTINGS_EXTRA, ...store.SETTINGS_EXTRA].map((x: any) => ({ to: x.to, feature: x.feature })),
  }
  process.stdout.write('\n@@MENU@@' + JSON.stringify(built) + '\n')
  process.exit(0)
}

// ── parent ───────────────────────────────────────────────────────────────────────────────────────────────────────────
let failed = 0
const fail = (m: string) => { failed++; console.error('FAIL: ' + m) }

/** Source with comments removed: a rule about what the product does is not satisfied by prose about it. */
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1')

/**
 * Where a feature lives inside a page rather than as a menu item of its own. `page` must be in the vertical's built menu
 * (or its Settings pages); `needle`, if given, must be in `file` with comments stripped; `when` narrows it by the
 * vertical's settings. Each entry says what the person does there.
 */
const SURFACES: { feature: string; page: string; file?: string; needle?: string; when?: (b: Built) => boolean; what: string }[] = [
  // Launched 2026-11-12 (the 186 live-tested features): each one where it lives — a tab, panel or behaviour on that page,
  // or, for what the customer sees (portal, website, checkout), the page where the business sees the result.
  { feature: 'care_shift_repeats', page: '/crm/scheduling', file: 'apps/unified/server/crm/homecare/scheduling/repeatInput.ts', needle: "SHIFT_REPEAT_FEATURE = 'care_shift_repeats'", what: 'monthly and every-few-weeks shifts on the scheduling hub' },
  { feature: 'portal_pay_options', page: '/crm/invoices', file: 'packages/tenant-backend/src/portal/portal.ts', needle: "if (!deps.payOptions || found.status !== 'approved') return {}", what: 'pay any amount, or from the estimate, in the portal' },
  { feature: 'aerial_detect', page: '/crm/area-pricing', file: 'apps/unified/web/src/crm/pages/landscaping/MeasureMap.tsx', needle: 'hasFeature(\'aerial_detect\')', what: 'find lawn and bed areas from the aerial on the measure map' },
  { feature: 'ar_aging', page: '/crm/reports', file: 'packages/tenant-ui/src/reporting/ReportsPage.tsx', needle: 'hasFeature(\'ar_aging\')', what: 'the receivables aging report on Reports' },
  { feature: 'bar_availability', page: '/crm/shifts', file: 'apps/unified/web/src/crm/pages/bar/StaffRequestsUi.tsx', needle: 'hasFeature(\'bar_availability\')', what: 'staff availability on the bar\'s schedule' },
  { feature: 'bar_declared_tips', page: '/crm/tips', file: 'apps/unified/web/src/crm/pages/bar/ClockPage.tsx', needle: 'hasFeature(\'bar_declared_tips\')', what: 'declared cash tips at clock-out and on Tips' },
  { feature: 'bar_labor_forecast', page: '/crm/shifts', file: 'apps/unified/web/src/crm/pages/bar/BarSchedulePage.tsx', needle: 'hasFeature(\'bar_labor_forecast\')', what: 'the labor forecast on the bar\'s schedule' },
  { feature: 'bar_shift_swaps', page: '/crm/shifts', file: 'apps/unified/web/src/crm/pages/bar/BarSchedulePage.tsx', needle: 'hasFeature(\'bar_shift_swaps\')', what: 'shift swaps on the bar\'s schedule' },
  { feature: 'bar_tab_preauth', page: '/crm/register', file: 'apps/mobile/src/trades/bar.ts', needle: '\'bar_tab_preauth\'', what: 'card tabs opened on the phone register' },
  { feature: 'bar_tip_import', page: '/crm/tips', file: 'apps/unified/web/src/crm/pages/bar/TipsPage.tsx', needle: 'hasFeature(\'bar_tip_import\')', what: 'tips imported from another register on Tips' },
  { feature: 'barcode_scanning', page: '/crm/inventory', file: 'apps/mobile/src/trades/stock.ts', needle: '\'barcode_scanning\'', what: 'scan a barcode in the phone app\'s stock count' },
  { feature: 'bid_packages', page: '/crm/projects', file: 'apps/unified/web/src/crm/pages/ProjectDetailPage.tsx', needle: 'hasFeature(\'bid_packages\')', what: 'bid packages on a project\'s page' },
  { feature: 'builders_risk', page: '/crm/projects', file: 'apps/unified/web/src/crm/pages/ProjectDetailPage.tsx', needle: 'hasFeature(\'builders_risk\')', what: 'builder\'s risk and square footage on a project' },
  { feature: 'call_tracking_numbers', page: '/crm/call-tracking', file: 'apps/unified/web/src/crm/pages/CallTrackingPage.tsx', needle: 'hasFeature(\'call_tracking_numbers\')', what: 'buy and manage tracking numbers on Call Tracking' },
  { feature: 'caller_id', page: '/crm/messages', file: 'apps/unified/web/src/crm/CallerIdPop.tsx', needle: 'hasFeature(\'caller_id\')', what: 'the caller\'s card when a call comes in' },
  { feature: 'card_on_file', page: '/crm/appointments', file: 'apps/unified/web/src/crm/pages/salon/AppointmentsPage.tsx', needle: 'hasFeature(\'card_on_file\')', what: 'client cards and no-show fees on the salon\'s appointments' },
  { feature: 'care_family_content', page: '/crm/family-portal', file: 'apps/unified/web/src/crm/pages/homecare/clients/DocumentsManagement.tsx', needle: 'hasFeature(\'care_family_content\')', what: 'daily care, meals and documents in the family portal\'s admin' },
  { feature: 'care_family_texts', page: '/crm/family-portal', file: 'apps/unified/web/src/crm/pages/homecare/portals/FamilyPortalAdmin.tsx', needle: 'hasFeature(\'care_family_texts\')', what: 'family arrival texts set in the family portal admin' },
  { feature: 'care_match_prefs', page: '/crm/company-optimizer', file: 'apps/unified/web/src/crm/pages/homecare/shifts/CompanyOptimizer.tsx', needle: 'hasFeature(\'care_match_prefs\')', what: 'match on skills, gender and language in the optimizer' },
  { feature: 'care_medication_reminders', page: '/crm/medications', file: 'apps/unified/web/src/crm/pages/homecare/clients/MedicationsManagement.tsx', needle: 'hasFeature(\'care_medication_reminders\')', what: 'medication reminders on a client\'s medications' },
  { feature: 'care_offline_saves', page: '/crm/medications', file: 'apps/unified/web/src/crm/pages/homecare/clients/MedicationsManagement.tsx', needle: 'hasFeature(\'care_offline_saves\')', what: 'safe saves from the phone without signal' },
  { feature: 'care_payroll_providers', page: '/crm/pay-period', file: 'apps/unified/web/src/crm/pages/homecare/office/PayRules.tsx', needle: 'hasFeature(\'care_payroll_providers\')', what: 'push payroll to ADP, Paychex or Gusto from pay rules' },
  { feature: 'care_quickbooks', page: '/crm/billing', file: 'apps/unified/web/src/crm/screens.tsx', needle: 'hasFeature(\'care_quickbooks\')', what: 'home care invoices sent to QuickBooks' },
  { feature: 'client_portal_plus', page: '/crm/projects', file: 'apps/unified/web/src/crm/screens.tsx', needle: 'hasFeature(\'client_portal_plus\')', what: 'the client portal\'s schedule, logs and to-dos, from a project' },
  { feature: 'client_stylist_pick', page: '/crm/bookings/settings', file: 'apps/unified/web/src/crm/pages/salon/BookSettingsPage.tsx', needle: 'hasFeature(\'client_stylist_pick\')', what: 'choose your stylist online, set in book settings' },
  { feature: 'contractor_phone', page: '/crm/projects', file: 'apps/mobile/src/trades/contractor.ts', needle: '\'contractor_phone\'', what: 'projects on the phone app' },
  { feature: 'cost_by_code', page: '/crm/expenses', file: 'packages/tenant-ui/src/people/ExpensesPage.tsx', needle: 'hasFeature(\'cost_by_code\')', what: 'cost codes on expenses and time' },
  { feature: 'credit_memos', page: '/crm/invoices', file: 'apps/unified/web/src/crm/screens.tsx', needle: 'hasFeature(\'credit_memos\')', what: 'customer credit on invoices' },
  { feature: 'crew_app', page: '/crm/jobs', file: 'apps/mobile/src/home/tiles.ts', needle: '\'crew_app\'', what: 'crew work orders in the phone app' },
  { feature: 'crew_dashboard', page: '/crm/dashboard', file: 'apps/unified/web/src/crm/pages/HomePanels.tsx', needle: 'hasFeature(\'crew_dashboard\')', what: 'the crew dashboard' },
  { feature: 'crew_day_map', page: '/crm/recurring-routes', file: 'apps/unified/web/src/crm/crewVisitTools.tsx', needle: 'hasFeature(\'crew_day_map\')', what: 'the map of the day and Finish Day' },
  { feature: 'crew_scheduling', page: '/crm/jobs', file: 'apps/unified/web/src/crm/screens.tsx', needle: 'hasFeature(\'crew_scheduling\')', what: 'crew scheduling and on-site on a job' },
  { feature: 'crew_timers', page: '/crm/recurring-routes', file: 'apps/unified/web/src/crm/crewVisitTools.tsx', needle: 'hasFeature(\'crew_timers\')', what: 'crew timers and the crew score' },
  { feature: 'days_off', page: '/crm/schedule', file: 'apps/unified/web/src/screens.tsx', needle: '\'days_off\'', what: 'days off on the schedule and dispatch board' },
  { feature: 'event_bank_payments', page: '/crm/events', file: 'apps/unified/web/src/crm/eventDepth.tsx', needle: 'hasFeature(\'event_bank_payments\')', what: 'bank (ACH) payments on an event' },
  { feature: 'event_contracts', page: '/crm/events', file: 'apps/unified/web/src/crm/eventDepth.tsx', needle: 'hasFeature(\'event_contracts\')', what: 'contracts and several signers on an event' },
  { feature: 'event_guarantee', page: '/crm/events', file: 'apps/unified/web/src/crm/eventDepth.tsx', needle: 'hasFeature(\'event_guarantee\')', what: 'the guest count cutoff on an event' },
  { feature: 'event_hold_expiry', page: '/crm/events', file: 'apps/unified/web/src/crm/eventDepth.tsx', needle: 'hasFeature(\'event_hold_expiry\')', what: 'holds that lapse on an event' },
  { feature: 'event_minimums', page: '/crm/events', file: 'apps/unified/web/src/crm/eventDepth.tsx', needle: 'hasFeature(\'event_minimums\')', what: 'food and beverage minimums on an event and its rooms' },
  { feature: 'event_payment_automation', page: '/crm/events', file: 'apps/unified/web/src/crm/eventDepth.tsx', needle: 'hasFeature(\'event_payment_automation\')', what: 'payment reminders and autopay on an event' },
  { feature: 'event_proposals', page: '/crm/events', file: 'apps/unified/web/src/crm/eventDepth.tsx', needle: 'hasFeature(\'event_proposals\')', what: 'proposals on an event' },
  { feature: 'inspection_auto_checklists', page: '/crm/inspections', file: 'apps/unified/web/src/crm/pages/InspectionsPage.tsx', needle: 'hasFeature(\'inspection_auto_checklists\')', what: 'automatic checklists on Inspections' },
  { feature: 'inspection_checklists', page: '/crm/inspections', file: 'apps/unified/web/src/crm/pages/InspectionsPage.tsx', needle: 'hasFeature(\'inspection_checklists\')', what: 'checklists on Inspections' },
  { feature: 'inspection_reports', page: '/crm/jobs', file: 'apps/unified/web/src/crm/pages/roof/jobs/JobDetailPage.tsx', needle: 'hasFeature(\'inspection_reports\')', what: 'inspection reports on a roofing job' },
  { feature: 'inspection_signature', page: '/crm/inspections', file: 'apps/unified/web/src/crm/pages/InspectionChecklist.tsx', needle: 'hasFeature(\'inspection_signature\')', what: 'sign-off on an inspection checklist' },
  { feature: 'intake_forms', page: '/crm/clients', file: 'apps/unified/web/src/crm/pages/salon/IntakeResponses.tsx', needle: 'hasFeature(\'intake_forms\')', what: 'intake and consent forms on a salon client' },
  { feature: 'invoice_text_requests', page: '/crm/invoices', file: 'apps/unified/web/src/crm/pages/roof/InvoiceTextPanel.tsx', needle: 'hasFeature(\'invoice_text_requests\')', what: 'text an invoice and its receipt' },
  { feature: 'job_budgets', page: '/crm/job-costing', file: 'packages/tenant-ui/src/reporting/JobCostingPage.tsx', needle: 'hasFeature(\'job_budgets\')', what: 'project budgets on Job Costing' },
  { feature: 'job_change_orders', page: '/crm/jobs', file: 'apps/unified/web/src/crm/jobChangeOrders.tsx', needle: 'hasFeature(\'job_change_orders\')', what: 'change orders on a job' },
  { feature: 'job_repeat_patterns', page: '/crm/jobs', file: 'packages/tenant-ui/src/jobs/JobDetailPage.tsx', needle: 'hasFeature(\'job_repeat_patterns\')', what: 'more repeat patterns on a job' },
  { feature: 'lead_lost', page: '/crm/leads', file: 'apps/unified/web/src/screens.tsx', needle: 'hasFeature(\'lead_lost\')', what: 'mark a lead lost, with the reason' },
  { feature: 'lead_pipeline', page: '/crm/leads', file: 'apps/unified/web/src/crm/pages/LeadPipelineStrip.tsx', needle: 'hasFeature(\'lead_pipeline\')', what: 'the pipeline strip on Leads' },
  { feature: 'lead_site_visit', page: '/crm/leads', file: 'apps/unified/web/src/screens.tsx', needle: 'hasFeature(\'lead_site_visit\')', what: 'site visits on a lead' },
  { feature: 'markup_defaults', page: '/crm/quotes', file: 'apps/unified/web/src/screens.tsx', needle: '\'markup_defaults\'', what: 'markup defaults on quotes' },
  { feature: 'material_supply', page: '/crm/purchase-orders', file: 'apps/unified/web/src/crm/pages/roof/field/MaterialOrderDetail.tsx', needle: 'hasFeature(\'material_supply\')', what: 'supplier ordering of roofing materials' },
  { feature: 'measure_print', page: '/crm/area-pricing', file: 'apps/unified/web/src/crm/pages/landscaping/AreaPricingPage.tsx', needle: 'hasFeature(\'measure_print\')', what: 'print measurements' },
  { feature: 'menu_dayparts', page: '/crm/menu', file: 'apps/unified/web/src/crm/pages/bar/MenuPage.tsx', needle: 'hasFeature(\'menu_dayparts\')', what: 'the menu by time of day' },
  { feature: 'menu_item_counts', page: '/crm/menu', file: 'apps/unified/web/src/crm/pages/bar/MenuPage.tsx', needle: 'hasFeature(\'menu_item_counts\')', what: 'item counts on the menu' },
  { feature: 'multi_service_visits', page: '/crm/appointments', file: 'apps/unified/web/src/crm/pages/salon/AppointmentsPage.tsx', needle: 'hasFeature(\'multi_service_visits\')', what: 'several services in one salon visit' },
  { feature: 'nav_rail', page: '/crm/dashboard', file: 'packages/tenant-ui/src/shell/AppShell.tsx', needle: '\'nav_rail\'', what: 'collapse the menu to icons' },
  { feature: 'owner_dashboard', page: '/crm/dashboard', file: 'apps/unified/web/src/crm/pages/HomePanels.tsx', needle: 'hasFeature(\'owner_dashboard\')', what: 'the owner dashboard' },
  { feature: 'payment_method_choice', page: '/crm/invoices', file: 'apps/unified/web/src/crm/invoicePaymentsPanel.tsx', needle: 'hasFeature(\'payment_method_choice\')', what: 'card, bank or both per invoice' },
  { feature: 'payment_plans', page: '/crm/invoices', file: 'apps/unified/web/src/crm/invoicePaymentsPanel.tsx', needle: 'hasFeature(\'payment_plans\')', what: 'installments on an invoice' },
  { feature: 'phone_inspections', page: '/crm/inspections', file: 'apps/mobile/src/inspections/rules.ts', needle: '\'phone_inspections\'', what: 'inspections on the phone app' },
  { feature: 'photo_folders', page: '/crm/jobs', file: 'apps/unified/web/src/crm/screens.tsx', needle: 'hasFeature(\'photo_folders\')', what: 'photo folders on a job\'s photos' },
  { feature: 'photo_markup', page: '/crm/jobs', file: 'apps/unified/web/src/crm/crewVisitTools.tsx', needle: 'hasFeature(\'photo_markup\')', what: 'draw on photos' },
  { feature: 'pipeline_custom_boards', page: '/crm/sales-pipeline', file: 'apps/unified/web/src/crm/pages/roof/jobs/PipelineBoard.tsx', needle: 'hasFeature(\'pipeline_custom_boards\')', what: 'pipeline boards of your own' },
  { feature: 'portal_job_files', page: '/crm/jobs', file: 'apps/unified/web/src/crm/pages/roof/jobs/JobDetailPage.tsx', needle: 'hasFeature(\'portal_job_files\')', what: 'homeowner photos and documents on a roofing job' },
  { feature: 'portal_tools', page: '/crm/jobs', file: 'apps/unified/web/src/crm/pages/roof/jobs/ShareWithHomeowner.tsx', needle: 'hasFeature(\'portal_tools\')', what: 'share a job with the homeowner' },
  { feature: 'processing_time', page: '/crm/service-menu', file: 'apps/unified/web/src/crm/pages/salon/ServiceMenuPage.tsx', needle: 'hasFeature(\'processing_time\')', what: 'processing time on a service' },
  { feature: 'project_templates', page: '/crm/projects', file: 'apps/unified/web/src/crm/pages/ProjectsPage.tsx', needle: 'hasFeature(\'project_templates\')', what: 'project templates' },
  { feature: 'quote_followup', page: '/crm/quotes', file: 'apps/unified/web/src/screens.tsx', needle: '\'quote_followup\'', what: 'quote follow-up' },
  { feature: 'quote_formulas', page: '/crm/quotes', file: 'packages/tenant-ui/src/invoicing/QuotesPage.tsx', needle: '\'quote_formulas\'', what: 'formula estimating on quotes and the pricebook' },
  { feature: 'quote_line_images', page: '/crm/quotes', file: 'packages/tenant-ui/src/invoicing/QuotesPage.tsx', needle: '\'quote_line_images\'', what: 'pictures on quote lines' },
  { feature: 'quote_preview', page: '/crm/quotes', file: 'packages/tenant-ui/src/invoicing/QuoteDetailPage.tsx', needle: '\'quote_preview\'', what: 'preview a quote as the client' },
  { feature: 'quote_proposals', page: '/crm/quotes', file: 'apps/unified/web/src/crm/proposalOptions.tsx', needle: 'hasFeature(\'quote_proposals\')', what: 'Good / Better / Best options on a quote' },
  { feature: 'quote_templates', page: '/crm/quotes', file: 'packages/tenant-ui/src/invoicing/QuoteDetailPage.tsx', needle: '\'quote_templates\'', what: 'quote templates' },
  { feature: 'quote_text_lines', page: '/crm/quotes', file: 'packages/tenant-ui/src/invoicing/QuotesPage.tsx', needle: '\'quote_text_lines\'', what: 'text lines on quotes' },
  { feature: 'rain_day_tools', page: '/crm/recurring-routes', file: 'apps/unified/web/src/crm/pages/landscaping/RainDayPanel.tsx', needle: 'hasFeature(\'rain_day_tools\')', what: 'rain days: whole weeks, undo and the forecast' },
  { feature: 'retention_sends', page: '/crm/marketing', file: 'apps/unified/web/src/crm/pages/salon/OfferCodePanel.tsx', needle: 'hasFeature(\'retention_sends\')', what: 'automatic rebooking and win-back messages' },
  { feature: 'roof_material_list', page: '/crm/jobs', file: 'apps/unified/web/src/crm/pages/roof/field/JobMaterials.tsx', needle: 'hasFeature(\'roof_material_list\')', what: 'the material list on a roofing job' },
  { feature: 'roof_work_orders', page: '/crm/jobs', file: 'apps/unified/web/src/crm/pages/roof/jobs/JobDetailPage.tsx', needle: 'hasFeature(\'roof_work_orders\')', what: 'crew and sub work orders on a roofing job' },
  { feature: 'route_board_tools', page: '/crm/recurring-routes', file: 'apps/unified/web/src/crm/pages/landscaping/RecurringRoutesPage.tsx', needle: 'hasFeature(\'route_board_tools\')', what: 'the route board: seasons, drag and crew clashes' },
  { feature: 'route_copy', page: '/crm/recurring-routes', file: 'apps/unified/web/src/crm/pages/landscaping/RouteCopyPanel.tsx', needle: 'hasFeature(\'route_copy\')', what: 'copy routes and route templates' },
  { feature: 'schedule_baseline', page: '/crm/gantt', file: 'apps/unified/web/src/crm/pages/GanttChartsPage.tsx', needle: 'hasFeature(\'schedule_baseline\')', what: 'the schedule baseline on the Gantt' },
  { feature: 'service_segments', page: '/crm/service-menu', file: 'apps/unified/web/src/crm/pages/salon/ServiceMenuPage.tsx', needle: 'hasFeature(\'service_segments\')', what: 'service steps on the service menu' },
  { feature: 'service_zones', page: '/crm/dispatch', file: 'apps/unified/web/src/screens.tsx', needle: '\'service_zones\'', what: 'service zones on the dispatch board and schedule' },
  { feature: 'shared_allowances', page: '/crm/selections', file: 'apps/unified/web/src/crm/pages/SelectionsPage.tsx', needle: 'hasFeature(\'shared_allowances\')', what: 'shared allowances on Selections' },
  { feature: 'skill_matching', page: '/crm/dispatch', file: 'apps/unified/web/src/screens.tsx', needle: '\'skill_matching\'', what: 'skill matching on the dispatch board and schedule' },
  { feature: 'snow_tools', page: '/crm/snow-billing', file: 'apps/unified/web/src/crm/pages/landscaping/SnowBillingPage.tsx', needle: 'hasFeature(\'snow_tools\')', what: 'snow depth bands, photos and salt' },
  { feature: 'stock_fill_levels', page: '/crm/stock', file: 'apps/unified/web/src/crm/pages/bar/CountPage.tsx', needle: 'hasFeature(\'stock_fill_levels\')', what: 'fill-level counts' },
  { feature: 'store_api', page: '/crm/apps', file: 'apps/unified/web/src/crm/pages/store/orders/AppsPage.tsx', needle: 'hasFeature(\'store_api\')', what: 'API keys on Apps' },
  { feature: 'store_low_stock', page: '/crm/products', file: 'apps/unified/web/src/crm/pages/store/catalog/ProductEditPage.tsx', needle: 'hasFeature(\'store_low_stock\')', what: 'stock alerts on a product\'s options' },
  { feature: 'store_report_schedules', page: '/crm/sales', file: 'apps/unified/web/src/crm/pages/store/orders/SalesPage.tsx', needle: 'hasFeature(\'store_report_schedules\')', what: 'saved and scheduled sales reports' },
  { feature: 'store_webhooks', page: '/crm/apps', file: 'apps/unified/web/src/crm/pages/store/orders/AppsPage.tsx', needle: 'hasFeature(\'store_webhooks\')', what: 'webhooks on Apps' },
  { feature: 'storm_data_tools', page: '/crm/storm-map', file: 'apps/unified/web/src/crm/pages/roof/field/StormLeadsPage.tsx', needle: 'hasFeature(\'storm_data_tools\')', what: 'hail swaths and storm lead scores' },
  { feature: 'task_links', page: '/crm/gantt', file: 'apps/unified/web/src/crm/pages/GanttChartsPage.tsx', needle: 'hasFeature(\'task_links\')', what: 'task links on the Gantt' },
  { feature: 'template_parts', page: '/crm/projects', file: 'apps/unified/web/src/crm/pages/ProjectsPage.tsx', needle: 'hasFeature(\'template_parts\')', what: 'a project template\'s budget, selections and links' },
  { feature: 'territory_boundaries', page: '/crm/territories', file: 'apps/unified/web/src/crm/pages/roof/field/TerritoriesPage.tsx', needle: 'hasFeature(\'territory_boundaries\')', what: 'territories from ZIP, city, county or state' },
  { feature: 'territory_tools', page: '/crm/territories', file: 'apps/unified/web/src/crm/pages/roof/field/TerritoriesPage.tsx', needle: 'hasFeature(\'territory_tools\')', what: 'territory import, nesting and redraw' },
  { feature: 'visit_editing', page: '/crm/appointments', file: 'apps/unified/web/src/crm/pages/salon/AppointmentsPage.tsx', needle: 'hasFeature(\'visit_editing\')', what: 'change a booked several-service visit' },
  { feature: 'visit_materials', page: '/crm/recurring-routes', file: 'apps/unified/web/src/crm/crewVisitTools.tsx', needle: 'hasFeature(\'visit_materials\')', what: 'materials used on a visit' },
  { feature: 'visit_reports', page: '/crm/visit-messages', file: 'apps/unified/web/src/crm/pages/landscaping/CrewWorkPanel.tsx', needle: 'hasFeature(\'visit_reports\')', what: 'visit-done messages' },
  { feature: 'visit_skip', page: '/crm/recurring-routes', file: 'apps/unified/web/src/crm/crewVisitTools.tsx', needle: 'hasFeature(\'visit_skip\')', what: 'could not do it, on a visit' },
  { feature: 'visit_survey', page: '/crm/visit-messages', file: 'apps/unified/web/src/crm/pages/landscaping/VisitMessagesPage.tsx', needle: 'hasFeature(\'visit_survey\')', what: 'feedback after a visit' },
  { feature: 'weekly_client_update', page: '/crm/projects', file: 'apps/unified/web/src/screens.tsx', needle: '\'weekly_client_update\'', what: 'the weekly client update' },
  { feature: 'wip_report', page: '/crm/reports', file: 'packages/tenant-ui/src/reporting/ReportsPage.tsx', needle: 'hasFeature(\'wip_report\')', what: 'the work in progress report on Reports' },
  { feature: 'work_order_send_options', page: '/crm/jobs', file: 'apps/unified/web/src/crm/pages/roof/field/CrewsPage.tsx', needle: 'hasFeature(\'work_order_send_options\')', what: 'work order sending options' },
  { feature: 'work_order_tools', page: '/crm/jobs', file: 'apps/unified/web/src/crm/pages/roof/field/JobWorkOrders.tsx', needle: 'hasFeature(\'work_order_tools\')', what: 'work orders from the proposal, and scope templates' },
  { feature: 'care_import_all', page: '/crm/data-import', file: 'apps/unified/server/crm/homecare/office/csvImport.ts', needle: '\'care_import_all\'', what: 'import every record kind' },
  { feature: 'care_import_wizard', page: '/crm/data-import', file: 'apps/unified/server/crm/homecare/office/csvImport.ts', needle: '\'care_import_wizard\'', what: 'the import wizard: Excel, saved mappings, updates' },
  { feature: 'care_no_arrival', page: '/crm/no-show-alerts', file: 'apps/unified/server/crm/homecare/core/noArrival.ts', needle: '\'care_no_arrival\'', what: 'caregiver not arrived alerts' },
  { feature: 'chat_to_text', page: '/crm/messages', file: 'apps/unified/server/site/render.ts', needle: '\'chat_to_text\'', what: 'the website\'s Text us box; its texts arrive in Messages' },
  { feature: 'event_web_enquiries', page: '/crm/events', file: 'apps/unified/server/core/enquiry.ts', needle: '\'event_web_enquiries\'', what: 'the website\'s event enquiries arrive as events' },
  { feature: 'online_multi_service', page: '/crm/appointments', file: 'apps/unified/server/crm/salon/onlineBooking.ts', needle: '\'online_multi_service\'', what: 'several services booked online arrive as one visit' },
  { feature: 'portal_appointments', page: '/crm/appointments', file: 'packages/tenant-backend/src/portal/portal.ts', needle: '\'portal_appointments\'', what: 'clients\' appointments in their portal' },
  { feature: 'portal_booking', page: '/crm/jobs', file: 'packages/tenant-backend/src/portal/portal.ts', needle: '\'portal_booking\'', what: 'customers book from the portal; the booking arrives as a job' },
  { feature: 'store_accounts', page: '/crm/customers', file: 'apps/unified/server/crm/store/checkout/publicRoutes.ts', needle: '\'store_accounts\'', what: 'shopper accounts: customers sign in on the shop' },
  { feature: 'store_carrier_rates', page: '/crm/shipping', file: 'apps/unified/server/crm/store/checkout/carrierRates.ts', needle: '\'store_carrier_rates\'', what: 'the carrier\'s live rates at checkout' },
  { feature: 'store_fast_checkout', page: '/crm/payments', file: 'apps/unified/server/crm/store/checkout/fastCheckout.ts', needle: '\'store_fast_checkout\'', what: 'Apple Pay, Google Pay and Link at checkout' },
  { feature: 'tech_tracking', page: '/crm/jobs', file: 'apps/unified/server/crm/field/techTrack.ts', needle: '\'tech_tracking\'', what: 'the customer\'s Where\'s my tech link from a job' },
  { feature: 'drag_drop_calendar', page: '/crm/schedule', file: 'apps/unified/web/src/crm/screens.tsx', needle: "hasFeature('drag_drop_calendar')", what: 'drag a job to another day on the Schedule' },
  { feature: 'photo_capture', page: '/crm/jobs', file: 'apps/unified/web/src/crm/screens.tsx', needle: "hasFeature('photo_capture')", when: (b) => !!b.screens?.jobs?.photos, what: "the job page's Photos" },
  { feature: 'photo_capture', page: '/crm/jobs', file: 'apps/unified/web/src/crm/pages/roof/jobs/JobDetailPage.tsx', needle: "hasFeature('photo_capture')", when: (b) => b.id === 'roofing', what: "the roofing job page's Photos" },
  // The contractor's job photos are taken in the phone app and filed as documents (GET/POST /api/photos).
  { feature: 'photo_capture', page: '/crm/jobs', file: 'apps/mobile/src/components/PhotoGallery.tsx', needle: '/api/photos/bulk', when: (b) => b.id === 'contractor', what: "the phone app's job photos" },
  { feature: 'online_payments', page: '/crm/settings/integrations', file: 'packages/tenant-ui/src/settings/IntegrationsPage.tsx', needle: '/api/integrations/stripe/connect-url', what: 'connect Stripe in Settings › Integrations; customers pay invoices by card' },
  { feature: 'quickbooks', page: '/crm/settings/integrations', file: 'packages/tenant-ui/src/settings/IntegrationsPage.tsx', needle: '/api/quickbooks', what: 'connect and sync QuickBooks in Settings › Integrations' },
  { feature: 'client_portal', page: '/crm/contacts', file: 'packages/tenant-ui/src/contacts/types.ts', needle: "'client_portal'", when: (b) => b.screens?.contacts?.sections?.portal !== false, what: "the customer's portal panel on a contact" },
  { feature: 'vendor_portal', page: '/crm/bills', file: 'apps/unified/web/src/crm/pages/BillsPage.tsx', needle: 'vendor_portal', what: "bills a vendor sent through the vendor's portal" },
  // '/crm' is the admin's home in every vertical (App.tsx's index route): it opens the dashboard where the feature is on.
  { feature: 'dashboard', page: '/crm', file: 'apps/unified/web/src/screens.tsx', needle: "hasFeature('dashboard') ? '/crm/dashboard'", what: 'the home page after sign-in' },
  { feature: 'pipeline_board', page: '/crm/pipeline', file: 'apps/unified/web/src/crm/pages/roof/jobs/index.tsx', needle: 'path="pipeline"', what: "the roofer's pipeline board" },
  { feature: 'banquet_orders', page: '/crm/events', file: 'apps/unified/web/src/crm/pages/restaurant/EventDetailPage.tsx', needle: "'runsheet'", what: "an event's run of show" },
  { feature: 'event_deposits', page: '/crm/events', file: 'apps/unified/web/src/crm/pages/restaurant/EventDetailPage.tsx', needle: "'money'", what: "an event's payment schedule" },
  { feature: 'deal_desk', page: '/crm/sales-pipeline', file: 'apps/unified/web/src/crm/pages/rv/SalesPipelinePage.tsx', needle: "hasFeature('deal_desk')", what: 'structure a deal from the pipeline' },
  { feature: 'recall_lookup', page: '/crm/units', file: 'apps/unified/web/src/crm/pages/rv/InventoryPage.tsx', needle: "hasFeature('recall_lookup')", what: "a unit's open-recall check" },
  { feature: 'inventory_syndication', page: '/crm/units', file: 'apps/unified/web/src/crm/pages/rv/InventoryPage.tsx', needle: "hasFeature('inventory_syndication')", what: 'push units to the marketplaces' },
  { feature: 'trade_in', page: '/crm/ai-trade', file: 'apps/unified/web/src/crm/pages/rv/AITradeAppraisalPage.tsx', needle: '/api/ai-trade', what: 'appraise a trade' },
  { feature: 'service_status_texts', page: '/crm/service', file: 'apps/unified/server/crm/rv/repairOrders.ts', needle: 'RO_STATUS_TEXT[body.status]', what: 'the customer is texted as a repair order moves' },
  { feature: 'medical_records', page: '/crm/patients', file: 'apps/unified/web/src/crm/pages/vet/PatientDetailPage.tsx', needle: "'visits'", what: "a patient's visits (SOAP notes)" },
  { feature: 'vaccinations', page: '/crm/patients', file: 'apps/unified/web/src/crm/pages/vet/PatientDetailPage.tsx', needle: "'vaccinations'", what: "a patient's vaccinations" },
  { feature: 'lab_results', page: '/crm/patients', file: 'apps/unified/web/src/crm/pages/vet/PatientDetailPage.tsx', needle: "'labs'", what: "a patient's lab results" },
  { feature: 'rabies_certificates', page: '/crm/patients', file: 'apps/unified/web/src/crm/pages/vet/PatientDetailPage.tsx', needle: '/api/reminders/rabies/', what: 'print a rabies certificate' },
  { feature: 'prescriptions', page: '/crm/patients', file: 'apps/unified/web/src/crm/pages/vet/PatientDetailPage.tsx', needle: "'prescriptions'", what: "a patient's prescriptions" },
  // The store's and the agency's own pages carry no feature gate (each is that industry's only app); the core features
  // they were sold under live at these addresses.
  { feature: 'contacts', page: '/crm/customers', when: (b) => b.id === 'store', what: "the store's customers" },
  { feature: 'products', page: '/crm/products', when: (b) => b.id === 'store', what: "the store's catalogue" },
  { feature: 'orders', page: '/crm/orders', when: (b) => b.id === 'store', what: "the store's orders" },
  { feature: 'contacts', page: '/crm/clients', when: (b) => b.id === 'homecare', what: "the agency's clients" },
  { feature: 'scheduling', page: '/crm/scheduling', when: (b) => b.id === 'homecare', what: "the agency's schedule hub" },
  { feature: 'team', page: '/crm/caregivers', when: (b) => b.id === 'homecare', what: "the agency's caregivers" },
]

const { getAdvertisableFeaturesForTemplate } = await import(join(ROOT, 'packages/tenant-backend/src/featureRegistry.ts'))

// The anchors themselves: a renamed tab or a removed call must fail here, not leave the entry vouching for nothing.
for (const e of SURFACES) {
  if (!e.file) continue
  const path = join(ROOT, e.file)
  if (!existsSync(path)) { fail(`SURFACES: ${e.feature} names ${e.file}, which does not exist`); continue }
  if (e.needle && !code(readFileSync(path, 'utf8')).includes(e.needle)) fail(`SURFACES: ${e.feature} — ${e.file} no longer has ${e.needle} (${e.what})`)
}

const verticals = readdirSync(join(UNIFIED, 'verticals')).filter((v) => existsSync(join(UNIFIED, 'verticals', v, 'settings.ts')))
if (verticals.length < 10) fail(`only ${verticals.length} verticals under apps/unified/verticals — fix this guard's walk`)

const table: string[] = []
for (const v of verticals) {
  const r = spawnSync(process.execPath, [import.meta.path, '--menu', v], { cwd: ROOT, encoding: 'utf8', timeout: 180_000 })
  const line = (r.stdout || '').split('\n').find((l) => l.startsWith('@@MENU@@'))
  if (r.status !== 0 || !line) { fail(`${v}: its menu could not be built — ${(r.stderr || '').trim().split('\n').slice(-3).join(' | ')}`); continue }
  const b: Built = JSON.parse(line.slice('@@MENU@@'.length))
  if (b.menu.length < 10) { fail(`${v}: only ${b.menu.length} menu items were built — fix this guard`); continue }
  const pages = new Set(['/crm', ...b.menu.map((i) => i.to), ...b.settings.map((s) => s.to)])
  const offered: { id: string }[] = getAdvertisableFeaturesForTemplate(b.featureSet)
  if (!offered.length) { fail(`${v}: featureSet ${b.featureSet} is offered nothing`); continue }
  const missing: string[] = []
  for (const { id } of offered) {
    const inMenu = b.menu.some((i) => i.features.includes(id))
    const inSettings = b.settings.some((s) => s.feature === id)
    const inPage = SURFACES.some((e) => e.feature === id && pages.has(e.page) && (!e.when || e.when(b)))
    if (!inMenu && !inSettings && !inPage) missing.push(id)
  }
  for (const id of missing) fail(`${v} (${b.featureSet}) is offered "${id}" and has no screen for it: no menu item, Settings page or SURFACES entry — build it, wire the page that exists, or take ${b.featureSet} off its templates[] in packages/tenant-backend/src/featureRegistry.ts`)
  table.push(`${v.padEnd(13)} ${String(offered.length).padStart(3)} offered, ${missing.length} without a screen`)
}

console.log(table.join('\n'))
if (failed) { console.error(`\n${failed} failure(s)`); process.exit(1) }
console.log('\nOK — every feature an industry is offered has a screen in its app')
