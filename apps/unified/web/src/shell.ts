// The admin's menu and URL gates for the shared shell (packages/tenant-ui/src/shell). Items without `features` are
// core; with `features`, shown when any is on. A `permission` is the one the page's API asks for, so the menu never
// offers a page that would refuse. `routeRoles` is only for pages whose server gate is a rank (requireAdmin).
import {
  BarChart3, Briefcase, Calculator, Calendar, CalendarCheck, CalendarDays, CheckSquare, Clock, CreditCard, DollarSign, ExternalLink, FileText,
  FolderOpen, Globe, Home, Hourglass, Image, Inbox, ListTodo, Mail, MapPin, Megaphone, MessageSquare, Newspaper, Receipt, Repeat, ScrollText,
  Settings2, ShieldCheck, SlidersHorizontal, Smartphone, Star, Target, Truck, Users, Warehouse, Wrench, FolderKanban, FileQuestion,
  ClipboardList, BookOpen, ClipboardCheck, ShoppingCart, Wallet, Phone, Bot, Scissors, LifeBuoy, Radio, FileSignature, Box,
  BookMarked, LocateFixed, Paintbrush, Landmark,
} from 'lucide-react'
import type { NavItem, ShellConfig } from './shared'
import { verticalScreens } from './crm/vertical'
import { nav as basicNav } from './crm/verticals/basic'
import { nav as landscapingNav } from './crm/verticals/landscaping'
import { nav as barNav, routeGates as barRouteGates, routePermissions as barRoutePermissions } from './crm/verticals/bar'
import { nav as restaurantNav } from './crm/verticals/restaurant'
import { nav as rvNav } from './crm/verticals/rv'
import { nav as salonNav } from './crm/verticals/salon'
import { nav as vetNav } from './crm/verticals/vet'
import { nav as roofNav, routePermissions as roofRoutePermissions, isRoofing, roofingMenu } from './crm/verticals/roof'
import { nav as storeNav, routePermissions as storeRoutePermissions, isStore, storeMenu } from './crm/verticals/store'
import { nav as homecareNav, routePermissions as homecareRoutePermissions, isHomecare, SHARED_HIDDEN, SHARED_ABSENT, SETTINGS_HIDDEN, headerActions as homecareHeaderActions } from './crm/verticals/homecare'
import { ViewAsBanner } from './crm/viewAs'
import { applyNavGroups } from './navGroups'

const SHARED_NAV: NavItem[] = [
  // The CRM (templates/crm/frontend/src/shellConfig.ts): core items need the CRM's own features, so a website-only
  // business sees none of them; the rest show with their feature.
  { to: '/crm/dashboard', icon: Home, label: 'Dashboard', section: 'Business', features: ['dashboard'], exact: true },
  { to: '/crm/contacts', icon: Users, label: 'Contacts', features: ['contacts'], permission: 'contacts:read' },
  // Next to Contacts, where an enquiry becomes one. It used to close the list, after Bookings, so it read as a Bookings page.
  { to: '/crm/leads', icon: Inbox, label: 'Lead Inbox', features: ['lead_inbox'], permission: 'leads:read' },
  { to: '/crm/jobs', icon: Briefcase, label: 'Jobs', features: ['jobs'], permission: 'jobs:read' },
  { to: '/crm/tech', icon: Smartphone, label: 'Field View', features: ['tech_mobile_view'] },
  { to: '/crm/quotes', icon: FileText, label: 'Quotes', features: ['quotes'], permission: 'quotes:read' },
  { to: '/crm/invoices', icon: Receipt, label: 'Invoices', features: ['invoices'], permission: 'invoices:read' },
  // Customer financing (crm/financing.tsx): its own switch, which is not ready — on for nobody until it is tested.
  { to: '/crm/financing', icon: Landmark, label: 'Financing', features: ['consumer_financing'], permission: 'financing:read' },
  { to: '/crm/schedule', icon: Calendar, label: 'Schedule', features: ['scheduling'] },
  { to: '/crm/time', icon: Clock, label: 'Time', features: ['time_tracking'] },
  { to: '/crm/expenses', icon: DollarSign, label: 'Expenses', features: ['expense_tracking'] },
  { to: '/crm/documents', icon: FolderOpen, label: 'Documents', features: ['documents'] },
  { to: '/crm/team', icon: Users, label: 'Team', features: ['team'], permission: 'team:read' },
  { to: '/crm/locations', icon: MapPin, label: 'Locations', features: ['multi_location'], permission: 'locations:read' },
  { to: '/crm/commissions', icon: DollarSign, label: 'Commissions', features: ['commission_tracking'], permission: 'commissions:read' },
  { to: '/crm/fleet', icon: Truck, label: 'Fleet', features: ['fleet'] },
  // GPS Tracking's page: where the crew is (from the phone app) and the job-site geofences. It had no menu item, so a
  // business sold GPS Tracking found no page for it (live test 2026-10-22). GET /api/geofencing asks only a session.
  { to: '/crm/geofences', icon: LocateFixed, label: 'GPS & Geofences', features: ['gps_tracking'] },
  { to: '/crm/inventory', icon: Warehouse, label: 'Inventory', features: ['inventory'] },
  { to: '/crm/equipment', icon: Wrench, label: 'Equipment', features: ['equipment_tracking'] },
  { to: '/crm/reviews', icon: Star, label: 'Reviews', features: ['google_reviews'] },
  // The Marketing page is email marketing (campaigns, templates, drips); Reviews has its own item above.
  { to: '/crm/marketing', icon: Megaphone, label: 'Marketing', features: ['email_marketing'], permission: 'marketing:read' },
  { to: '/crm/ads', icon: Target, label: 'Ads', features: ['paid_ads'], permission: 'ads:read' },
  { to: '/crm/pricebook', icon: CreditCard, label: 'Pricebook', features: ['pricebook'] },
  { to: '/crm/agreements', icon: ShieldCheck, label: 'Agreements', features: ['service_agreements'] },
  { to: '/crm/warranties', icon: Star, label: 'Warranties', features: ['warranties'] },
  // The inbox and Google Business are requireAdmin on the server: a rank, so the menu asks the same rank.
  // The messages people sent to the business's own addresses — named as Settings named it, and in one place: Settings
  // no longer lists a second copy (store live test, 2026-10-26: "Email" beside Settings' "Email Inbox" read as two things).
  { to: '/crm/email', icon: Mail, label: 'Email Inbox', features: ['branded_email'], minRole: 'admin' },
  { to: '/crm/google-reviews', icon: Star, label: 'Google Reviews', features: ['google_business'], minRole: 'admin' },
  { to: '/crm/call-tracking', icon: Phone, label: 'Call Tracking', features: ['call_tracking'], permission: 'calltracking:read' },
  { to: '/crm/ai-receptionist', icon: Bot, label: 'AI Receptionist', features: ['ai_receptionist'], permission: 'ai-receptionist:read' },
  // Invoices on a schedule (the registry names recurring_jobs Recurring Invoices: it never made jobs).
  { to: '/crm/recurring', icon: Repeat, label: 'Recurring Invoices', features: ['recurring_jobs'], permission: 'invoices:read' },
  { to: '/crm/takeoffs', icon: Scissors, label: 'Takeoffs', features: ['takeoff_tools'], permission: 'takeoffs:read' },
  // The paid Exterior Visualizer add-on (contractor, roofing): its page was reachable by address only.
  { to: '/crm/visualizer', icon: Paintbrush, label: 'Exterior Visualizer', features: ['visualizer'] },
  // A construction business's with projects; a clinic's always (patient_records: templates/crm-vet's menu had Tasks
  // ungated). The same union as /api/tasks.
  { to: '/crm/tasks', icon: ListTodo, label: 'Tasks', features: ['projects', 'patient_records'] },
  { to: '/crm/messages', icon: MessageSquare, label: 'Messages', features: ['two_way_texting'], permission: 'sms:send' },
  { to: '/crm/reports', icon: BarChart3, label: 'Reports', features: ['reports'], permission: 'reports:read' },
  { to: '/crm/job-costing', icon: Calculator, label: 'Job Costing', features: ['job_costing'], permission: 'reports:read' },
  // GET /api/leads/sources asks leads:read (the inbox's own permission — admin and manager; a technician, a stylist and a
  // viewer held contacts:read and were offered the business's leads; live role check, 2026-10-23): the item asks the same.
  { to: '/crm/lead-sources', icon: ExternalLink, label: 'Lead Sources', features: ['lead_inbox'], permission: 'leads:read' },
  { to: '/crm/selections', icon: CheckSquare, label: 'Selections', features: ['selections'], permission: 'selections:read' },
  { to: '/crm/support', icon: LifeBuoy, label: 'Support', features: ['support_tickets'] },
  // Field service's own screens (templates/crm-fieldservice/frontend/src/shellConfig.ts). The registry offers these
  // features to field service only. Dispatch reads GET /api/jobs, so it asks jobs:read like Jobs above; the other three
  // pages' list routes ask only for a session, so they carry no permission.
  { to: '/crm/dispatch', icon: Radio, label: 'Dispatch Board', section: 'Field Service', features: ['dispatch_board'], permission: 'jobs:read' },
  { to: '/crm/maintenance', icon: FileSignature, label: 'Maintenance Contracts', section: 'Field Service', features: ['maintenance_contracts'] },
  { to: '/crm/parts', icon: Box, label: 'Parts Inventory', section: 'Field Service', features: ['parts_tracking'] },
  { to: '/crm/pricebook-rates', icon: BookMarked, label: 'Flat Rate Pricebook', section: 'Field Service', features: ['flat_rate_pricebook'] },
  { to: '/crm/projects', icon: FolderKanban, label: 'Projects', section: 'Projects', features: ['projects'] },
  { to: '/crm/rfis', icon: FileQuestion, label: 'RFIs', features: ['rfis'] },
  { to: '/crm/submittals', icon: FileText, label: 'Submittals', features: ['submittals'], permission: 'submittals:read' },
  { to: '/crm/change-orders', icon: ClipboardList, label: 'Change Orders', features: ['change_orders'], permission: 'change-orders:read' },
  { to: '/crm/punch-lists', icon: CheckSquare, label: 'Punch Lists', features: ['punch_lists'] },
  { to: '/crm/daily-logs', icon: BookOpen, label: 'Daily Logs', features: ['daily_logs'] },
  { to: '/crm/inspections', icon: ClipboardCheck, label: 'Inspections', features: ['inspections'] },
  { to: '/crm/bids', icon: Target, label: 'Bids', features: ['bid_management'], permission: 'bids:read' },
  { to: '/crm/purchase-orders', icon: ShoppingCart, label: 'Purchase Orders', features: ['purchase_orders'], permission: 'purchase-orders:read' },
  { to: '/crm/bills', icon: Wallet, label: 'Bills', features: ['vendor_bills'], permission: 'bills:read' },
  { to: '/crm/lien-waivers', icon: ShieldCheck, label: 'Lien Waivers', features: ['lien_waivers'], permission: 'lien-waivers:read' },
  { to: '/crm/draw-schedules', icon: DollarSign, label: 'Draw Schedules', features: ['draw_schedules'], permission: 'draw-schedules:read' },
  { to: '/crm/aia-forms', icon: FileText, label: 'AIA G702/G703', features: ['aia_forms'], permission: 'aia-forms:read' },
  { to: '/crm/gantt', icon: BarChart3, label: 'Gantt Chart', features: ['gantt_charts'] },
  { to: '/crm/website', icon: Globe, label: 'Website', section: 'Website', permission: 'site:read', exact: true },
  { to: '/crm/website/pages', icon: FileText, label: 'Pages', permission: 'site:read' },
  { to: '/crm/website/photos', icon: Image, label: 'Photos', permission: 'site:read' },
  { to: '/crm/website/blog', icon: Newspaper, label: 'Blog', permission: 'site:read' },
  { to: '/crm/website/portfolio', icon: Briefcase, label: 'Portfolio', permission: 'site:read' },
  { to: '/crm/website/settings', icon: Settings2, label: 'Website settings', permission: 'site:settings' },
  // The web address: /api/admin/domain asks settings:update on every door (server/modules/domain.ts).
  { to: '/crm/domain', icon: Globe, label: 'Domain', permission: 'settings:update' },
  // Bookings: the online_booking feature, behind the same permissions as /api/booking.
  { to: '/crm/bookings', icon: CalendarCheck, label: 'Bookings', section: 'Bookings', features: ['online_booking'], permission: 'bookings:read', exact: true },
  // A vertical whose online bookings land in its own book (a salon's The Book) sees them there with the desk's
  // appointments; Bookings' own calendar would show the online half alone (salon live test, 2026-10-25), so it has no
  // item of its own and its address goes to that book (App.tsx).
  ...(typeof verticalScreens().booking.calendarPath === 'string' ? [] : [{ to: '/crm/bookings/calendar', icon: CalendarDays, label: 'Calendar', features: ['online_booking'], permission: 'bookings:read' }]),
  { to: '/crm/bookings/waitlist', icon: Hourglass, label: 'Waitlist', features: ['online_booking'], permission: 'bookings:read' },
  { to: '/crm/bookings/insights', icon: BarChart3, label: 'Insights', features: ['online_booking'], permission: 'bookings:read' },
  { to: '/crm/bookings/settings', icon: SlidersHorizontal, label: 'Booking settings', features: ['online_booking'], permission: 'bookings:update' },
  // The last three have a heading of their own: with none they were read as Bookings' pages (menu review, 2026-10-30).
  // Who changed what — owners and admins (audit:read, the permission /api/audit asks for).
  { to: '/crm/audit', icon: ScrollText, label: 'Audit Log', section: 'Account', permission: 'audit:read' },
  // Ungated in the template and on the server (/api/support's knowledge base and AI chat, /api/platform-support):
  // the help center, and the line to Twomiah about the software itself, on every business's menu.
  { to: '/crm/help', icon: BookOpen, label: 'Help' },
  { to: '/crm/contact-support', icon: LifeBuoy, label: 'Contact Twomiah' },
  // Each near-copy vertical's own items (crm/verticals/<v>.tsx), gated by its features. Each starts under a heading of
  // its own, so they do not fall under Account above.
  ...basicNav,
  ...landscapingNav,
  ...barNav,
  ...restaurantNav,
  ...rvNav,
  ...salonNav,
  ...vetNav,
  ...roofNav,
  ...storeNav,
]

const NAV: NavItem[] = [
  // An agency's menu is the shared items it has, then its own under its headings (crm/verticals/homecare.tsx).
  ...(isHomecare ? SHARED_NAV.filter((item) => !SHARED_HIDDEN.includes(item.to))
    // A roofer's: in roofing's order, its own pages in place of the shared ones at the same addresses.
    : isRoofing ? roofingMenu(SHARED_NAV)
    // A store's: its own pages first, then the shared ones it has.
    : isStore ? storeMenu(SHARED_NAV)
    : SHARED_NAV),
  ...homecareNav,
]

export const SHELL: ShellConfig = {
  nav: NAV,
  // The header search: /api/search (server/crm/comms/search.ts). The shared GlobalSearch reads its Recent list in
  // either shape. No live socket.
  search: true,
  // '/' is the public website, not a portal.
  backToPortal: false,
  brand: { fallbackName: 'Admin' },
  // Not '/crm/pricebook-trial': ['pricebook'] (the base CRM's): the page offers Pricebook to a business WITHOUT it, so
  // gating it on pricebook refused everyone it was for. The field-service copy had fixed it (Field Service T28 H2).
  routeGates: {
    // Typed in where the menu leaves it out (home care): /api/geofencing is gps_tracking's on the server.
    '/crm/geofences': ['gps_tracking'],
    // The bar register's other screens (grill, floor, close-out, count, clock), opened from it.
    ...barRouteGates,
  },
  // The New Leads list the dashboard tile opens (GET /api/dashboard/new-leads asks leads:read) — no menu entry of its own.
  routePermissions: { '/crm/new-leads': 'leads:read', ...barRoutePermissions, ...homecareRoutePermissions, ...roofRoutePermissions, ...storeRoutePermissions },
  // View As, every vertical (crm/viewAs.tsx): while one is open, the strip under the header that says whose app this is
  // and offers "Return to my account". An agency also has the header's View As button (staff and client-portal preview).
  banner: ViewAsBanner,
  ...(isHomecare ? { headerActions: homecareHeaderActions } : {}),
  // Another business type's pages, typed in: "isn't part of this CRM" (home care's: crm/verticals/homecare.tsx SHARED_ABSENT).
  routeAbsent: SHARED_ABSENT,
  routeRoles: {
    // The company, billing, email addresses and the feature switches are requireAdmin on the server.
    '/crm/settings': 'admin',
    '/crm/settings/billing': 'admin',
    '/crm/settings/email': 'admin',
    '/crm/settings/features': 'admin',
    '/crm/settings/email-domain': 'admin',
    '/crm/settings/email-inbox': 'admin',
    '/crm/settings/integrations': 'admin',
    '/crm/settings/migration': 'admin',
    '/crm/settings/import': 'admin',
    '/crm/settings/export': 'admin',
    '/crm/email': 'admin',
    '/crm/google-reviews': 'admin',
  },
}

/** The settings sub-pages this app has routes for (the shared Settings page links only to these). */
export const SETTINGS_SUB_PAGES = [
  '/crm/settings/features', '/crm/settings/billing', '/crm/settings/email', '/crm/settings/email-domain',
  '/crm/settings/integrations', '/crm/settings/migration', '/crm/settings/import',
].filter((to) => !(isHomecare && SETTINGS_HIDDEN.includes(to)))

/**
 * The shell, in this vertical's words: a menu item's label renamed where the vertical says (VerticalSettings.screens.nav,
 * keyed by the page's address — 'Service Calls' for /crm/jobs in field service), a menu heading renamed the same way
 * (screens.navSections, keyed by the heading: landscaping's 'Operations' for field service's 'Field Service'), and its
 * search box prompt. A vertical can also leave a shared item out (screens.navHidden, by address: RV has no use for field
 * service's Parts Inventory page) and widen the features that show one (screens.navFeatures, by address: RV's Parts &
 * Inventory is the shared Inventory page on parts_tracking, as its server mount is), so its menu stays its own.
 */
const verticalShell = (): ShellConfig => {
  const sc = verticalScreens() as unknown as { vocabulary?: { gallery?: string }; nav?: Record<string, string>; navSections?: Record<string, string>; searchPlaceholder?: string; navHidden?: string[]; navFeatures?: Record<string, string[]>; navGroups?: Record<string, string>; navGroupOrder?: string[] }
  const names = sc.nav || {}
  const sections = sc.navSections || {}
  const hidden = new Set(Array.isArray(sc.navHidden) ? sc.navHidden : [])
  const widened = sc.navFeatures || {}
  return {
    ...SHELL,
    nav: applyNavGroups(SHELL.nav.filter((item) => !hidden.has(item.to)).map((item) => {
      const gated = widened[item.to] ? { ...item, features: widened[item.to] } : item
      // The website's page of photos is the business's Portfolio or Gallery (VerticalSettings.vocabulary.gallery).
      const own = names[item.to] || (item.to === '/crm/website/portfolio' ? sc.vocabulary?.gallery : undefined)
      const renamed = own ? { ...gated, label: own } : gated
      return item.section && sections[item.section] ? { ...renamed, section: sections[item.section] } : renamed
    }), sc.navGroups, sc.navGroupOrder),
    // Headings fold away and stay as the person left them (packages/tenant-ui shell/AppShell.tsx).
    collapsibleSections: true,
    ...(sc.searchPlaceholder ? { searchPlaceholder: sc.searchPlaceholder } : {}),
    // A page left out of the menu is not this CRM's: typed in, it says so (another vertical's page on a shared feature).
    routeAbsent: [...(SHELL.routeAbsent || []), ...hidden],
  }
}
/** The menu this page shows (scripts/check-unified-feature-has-screen.ts reads it per vertical). */
export const SHELL_HERE = verticalShell()
