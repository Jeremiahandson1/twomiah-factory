// This vertical's sidebar + URL gates for the shared app shell (see ./shared). Items without `features`
// are core; items with `features` show when ANY listed feature is enabled. routeGates cover routes
// that exist without a sidebar entry, so a module the tenant doesn't have is not reachable by URL.
import { BarChart3, BookMarked, BookOpen, Bot, Box, Briefcase, Calendar, CalendarCheck, CheckSquare, ClipboardCheck, ClipboardList, Clock, CreditCard, DollarSign, ExternalLink, FileQuestion, FileSignature, FileText, FolderKanban, FolderOpen, Home, Inbox, LifeBuoy, ListTodo, Mail, MapPin, Megaphone, MessageSquare, Phone, Radio, Receipt, Repeat, Route, Ruler, Scissors, ShieldCheck, Snowflake, Star, Target, Truck, Users, Warehouse, Wrench, Calculator } from 'lucide-react';
import type { NavItem, ShellConfig } from './shared';

const NAV: NavItem[] = [
  { to: '/crm', icon: Home, label: 'Dashboard', exact: true },
  { to: '/crm/contacts', icon: Users, label: 'Contacts' },
  // 'Jobs', matching jobsConfig.ts and reportingConfig.ts — see the note in jobsConfig.ts. (T41)
  { to: '/crm/jobs', icon: Briefcase, label: 'Jobs' },
  { to: '/crm/quotes', icon: FileText, label: 'Quotes', permission: 'quotes:read' },
  { to: '/crm/invoices', icon: Receipt, label: 'Invoices', permission: 'invoices:read' },
  { to: '/crm/schedule', icon: Calendar, label: 'Schedule', features: ['scheduling'] },
  { to: '/crm/time', icon: Clock, label: 'Time', features: ['time_tracking'] },
  { to: '/crm/expenses', icon: DollarSign, label: 'Expenses', features: ['expense_tracking'] },
  { to: '/crm/documents', icon: FolderOpen, label: 'Documents' },
  { to: '/crm/team', icon: Users, label: 'Team', permission: 'team:read' },
  { to: '/crm/fleet', icon: Truck, label: 'Fleet', features: ['fleet'] },
  { to: '/crm/locations', icon: MapPin, label: 'Locations', features: ['multi_location'] },
  { to: '/crm/commissions', icon: DollarSign, label: 'Commissions', features: ['commission_tracking'] },
  { to: '/crm/inventory', icon: Warehouse, label: 'Inventory', features: ['inventory'] },
  { to: '/crm/equipment', icon: Wrench, label: 'Equipment', features: ['equipment_tracking'] },
  { to: '/crm/bookings', icon: CalendarCheck, label: 'Online Booking', features: ['online_booking'] },
  // The Marketing page is email marketing (campaigns, templates, drips); Reviews has its own route gate below. (T15 M5)
  { to: '/crm/marketing', icon: Megaphone, label: 'Marketing', features: ['email_marketing'], permission: 'marketing:read' },
  { to: '/crm/pricebook', icon: CreditCard, label: 'Pricebook', features: ['pricebook'] },
  { to: '/crm/agreements', icon: ShieldCheck, label: 'Agreements', features: ['service_agreements'] },
  { to: '/crm/warranties', icon: Star, label: 'Warranties', features: ['warranties'] },
  { to: '/crm/call-tracking', icon: Phone, label: 'Call Tracking', features: ['call_tracking'] },
  { to: '/crm/email', icon: Mail, label: 'Email', features: ['branded_email'], minRole: 'admin' },
  { to: '/crm/google-reviews', icon: Star, label: 'Google Reviews', features: ['google_business'], minRole: 'admin' },
  { to: '/crm/ai-receptionist', icon: Bot, label: 'AI Receptionist', features: ['ai_receptionist'] },
  { to: '/crm/recurring', icon: Repeat, label: 'Recurring', features: ['recurring_jobs'], permission: 'invoices:read' },
  { to: '/crm/messages', icon: MessageSquare, label: 'Messages', features: ['two_way_texting'], permission: 'sms:send' },
  { to: '/crm/reports', icon: BarChart3, label: 'Reports', features: ['reports'], permission: 'reports:read' },
  // The audit trail — owners and admins only (owner's decision, 10/09). Behind audit:read, the same permission the /api/audit route requires, so the
  // entry never offers a seat a page it would be refused. (T51)
  { to: '/crm/audit', icon: FileText, label: 'Audit Log', permission: 'audit:read' },
  { to: '/crm/job-costing', icon: Calculator, label: 'Job Costing', features: ['job_costing'], permission: 'reports:read' },
  { to: '/crm/leads', icon: Inbox, label: 'Lead Inbox', features: ['lead_inbox'] },
  { to: '/crm/lead-sources', icon: ExternalLink, label: 'Lead Sources', features: ['lead_inbox'] },
  { to: '/crm/support', icon: LifeBuoy, label: 'Support', features: ['support_tickets'] },
  { to: '/crm/ads', icon: Megaphone, label: 'Ads', features: ['paid_ads'], permission: 'ads:read' },
  // Operations
  { to: '/crm/tech', icon: Wrench, label: 'Crew View', section: 'Operations', features: ['tech_mobile_view'] },
  { to: '/crm/dispatch', icon: Radio, label: 'Dispatch Board', section: 'Operations', features: ['dispatch_board'] },
  /**
   * THREE PAIRS OF NAV ITEMS THAT READ AS THE SAME THING. (T58)
   *
   *   Owner, on Landscaping: "near-duplicate nav items."
   *
   * They were, and all three pairs were one general item plus one Operations item whose label was a
   * near-synonym of it:
   *
   *   Agreements (service_agreements)  vs  Service Agreements (maintenance_contracts)
   *   Pricebook  (pricebook)           vs  Service Pricebook  (flat_rate_pricebook)
   *   Inventory  (inventory)           vs  Materials Inventory (parts_tracking)
   *
   * They are genuinely different modules, so the answer is not to remove one — it is to name each
   * after what it actually is. These three labels are the plain-English reading of their own feature
   * ids, so nothing is invented and the pairing stops being a coin toss. The general items above keep
   * their names, since those are the ones most of the fleet shares.
   */
  { to: '/crm/maintenance', icon: FileSignature, label: 'Maintenance Contracts', section: 'Operations', features: ['maintenance_contracts'] },
  { to: '/crm/parts', icon: Box, label: 'Parts & Materials', section: 'Operations', features: ['parts_tracking'] },
  { to: '/crm/pricebook-rates', icon: BookMarked, label: 'Flat-Rate Pricing', section: 'Operations', features: ['flat_rate_pricebook'] },
  { to: '/crm/recurring-routes', icon: Route, label: 'Route Board', section: 'Operations', features: ['recurring_routes'] },
  { to: '/crm/area-pricing', icon: Ruler, label: 'Area Pricing', section: 'Operations', features: ['area_pricing'] },
  // EVERY endpoint behind this page is an `invoices:*` one — contracts carry the rates, an event
  // stores the billable amount it computes, and there is a Bill button. T41: "The Snow page tells
  // staff 'No snow contracts yet' instead of 'no access', and still shows New Contract." A 403 read
  // as an empty list, so the page lied twice. Declaring the permission the page's own reads need
  // means the crew never lands here: AppShell hides the link and refuses the URL with its own "your
  // role cannot open this" page. (T41)
  { to: '/crm/snow-billing', icon: Snowflake, label: 'Snow Billing', section: 'Operations', features: ['snow_billing'], permission: 'invoices:read' },
  { to: '/website-cms', external: true, id: 'website-cms', icon: ExternalLink, label: 'Website CMS', section: 'Operations' },
  { to: '/crm/help', icon: BookOpen, label: 'Help' },

  { to: '/crm/contact-support', icon: LifeBuoy, label: 'Contact Twomiah' },
];

export const SHELL: ShellConfig = {
  nav: NAV,
  searchPlaceholder: 'Search contacts, jobs, invoices...',
  routeGates: {
    '/crm/reviews': ['google_reviews'],
    // The Pricebook trial page is deliberately NOT gated on `pricebook` — it exists to sell Pricebook to a
    // tenant who does not have it, and the home tile only appears when hasFeature('pricebook') is false.
    // Gating it made the offer refuse everyone it was written for. Found here by
    // scripts/check-upsell-not-self-gated.ts while fixing the same bug on field service. (T28 H2)
  },
  /**
   * Settings sub-pages whose every call is admin-only on the server (routes/emailAliases, emailDomain,
   * inboundMessages and billing are requireAdmin; migration and import are requireRole(admin, owner); the
   * shared integrations route is requireAdmin; PUT /api/company/features is requireAdmin). The shell now
   * answers "you don't have access" instead of drawing the page and printing the API's raw 403 —
   * Events T60: "the raw 403 text on the email settings pages is still there." Same list as crm-basic.
   */
  routeRoles: {
    '/crm/settings/billing': 'admin',
    '/crm/settings/email': 'admin',
    '/crm/settings/email-domain': 'admin',
    '/crm/settings/email-inbox': 'admin',
    '/crm/settings/integrations': 'admin',
    '/crm/settings/migration': 'admin',
    '/crm/settings/import': 'admin',
    '/crm/settings/features': 'admin',
    '/crm/email': 'admin',
  },
};
