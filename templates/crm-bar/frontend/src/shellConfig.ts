// This vertical's sidebar + URL gates for the shared app shell (see ./shared). Items without `features`
// are core; items with `features` show when ANY listed feature is enabled. routeGates cover routes
// that exist without a sidebar entry, so a module the tenant doesn't have is not reachable by URL.
//
// crm-bar is crm-basic's clone made into a bar's CRM: the night (Tonight, Menu, Taps, What's on), private
// parties (crm-restaurant's events), guests, and the shared office tools. crm-basic's field-service modules
// (jobs, quotes, the job schedule, fleet, equipment, pricebook, agreements, warranties, recurring, job costing)
// are still in the code, gated and never offered to a bar — so they have no menu entry and their URLs bounce.
import { BarChart3, Beer, BookOpen, Bot, CalendarCheck, CalendarDays, Clock, CreditCard, DollarSign, Gift, Package, DoorOpen, ExternalLink, FileText, Flame, FolderOpen, Home, Inbox, LifeBuoy, Mail, Megaphone, MessageSquare, Phone, Receipt, Settings, Star, Users, Utensils, ClipboardList } from 'lucide-react'
import type { NavItem, ShellConfig } from './shared';

const NAV: NavItem[] = [
  { to: '/crm', icon: Home, label: 'Dashboard', exact: true },
  // The night — what the bar's website shows live.
  { to: '/crm/tonight', icon: Flame, label: 'Tonight', features: ['bar_tonight'], permission: 'bar:read' },
  // The register (tabs, tables, walk-ups) and, from it, the grill screen and the close-out.
  { to: '/crm/register', icon: CreditCard, label: 'Register', features: ['bar_register'], permission: 'bar:register' },
  { to: '/crm/gift-cards', icon: Gift, label: 'Gift Cards', features: ['gift_cards'], permission: 'bar:manage' },
  { to: '/crm/regulars', icon: Star, label: 'Regulars', features: ['loyalty_rewards'], permission: 'loyalty:read' },
  { to: '/crm/stock', icon: Package, label: 'Stock', features: ['bar_stock'], permission: 'bar:update' },
  { to: '/crm/menu', icon: Utensils, label: 'Menu', features: ['bar_menu'], permission: 'bar:read' },
  { to: '/crm/taps', icon: Beer, label: 'Taps', features: ['bar_menu'], permission: 'bar:read' },
  { to: '/crm/whats-on', icon: CalendarDays, label: "What's on", features: ['bar_tonight'], permission: 'bar:read' },
  // Private parties — enquiry, booking, deposit, the run of show.
  { to: '/crm/events', icon: CalendarCheck, label: 'Parties', features: ['event_bookings'] },
  { to: '/crm/spaces', icon: DoorOpen, label: 'Spaces', features: ['event_spaces'] },
  { to: '/crm/menus', icon: ClipboardList, label: 'Party Packages', features: ['catering_menus'] },
  { to: '/crm/contacts', icon: Users, label: 'Guests' },
  { to: '/crm/invoices', icon: Receipt, label: 'Invoices', permission: 'invoices:read' },
  { to: '/crm/time', icon: Clock, label: 'Time', features: ['time_tracking'] },
  { to: '/crm/expenses', icon: DollarSign, label: 'Expenses', features: ['expense_tracking'] },
  { to: '/crm/documents', icon: FolderOpen, label: 'Documents', features: ['documents'] },
  { to: '/crm/team', icon: Users, label: 'Team', permission: 'team:read' },
  // The Marketing page is email marketing (campaigns, templates, drips); Reviews has its own route gate below. (T15 M5)
  { to: '/crm/marketing', icon: Megaphone, label: 'Marketing', features: ['email_marketing'], permission: 'marketing:read' },
  { to: '/crm/call-tracking', icon: Phone, label: 'Call Tracking', features: ['call_tracking'], permission: 'calltracking:read' },
  { to: '/crm/email', icon: Mail, label: 'Email', features: ['branded_email'], minRole: 'admin' },
  { to: '/crm/google-reviews', icon: Star, label: 'Google Reviews', features: ['google_business'], minRole: 'admin' },
  { to: '/crm/ai-receptionist', icon: Bot, label: 'AI Receptionist', features: ['ai_receptionist'], permission: 'ai-receptionist:read' },
  { to: '/crm/messages', icon: MessageSquare, label: 'Messages', features: ['two_way_texting'], permission: 'sms:send' },
  { to: '/crm/reports', icon: BarChart3, label: 'Reports', features: ['reports'], permission: 'reports:read' },
  // The audit trail — owners and admins only (owner's decision, 10/09). Behind audit:read, the same permission the /api/audit route requires, so the
  // entry never offers a seat a page it would be refused. (T51)
  { to: '/crm/audit', icon: FileText, label: 'Audit Log', permission: 'audit:read' },
  { to: '/crm/leads', icon: Inbox, label: 'Lead Inbox', features: ['lead_inbox'] },
  { to: '/crm/lead-sources', icon: ExternalLink, label: 'Lead Sources', features: ['lead_inbox'] },
  { to: '/crm/support', icon: LifeBuoy, label: 'Support', features: ['support_tickets'] },
  { to: '/crm/bar-settings', icon: Settings, label: 'Bar Settings', features: ['bar_tonight'], permission: 'bar:read' },
  { to: '/crm/help', icon: BookOpen, label: 'Help' },

  { to: '/crm/contact-support', icon: LifeBuoy, label: 'Contact Twomiah' },
];

export const SHELL: ShellConfig = {
  nav: NAV,
  searchPlaceholder: 'Search guests, the menu, parties...',
  // The register's two other screens: the same permission the API asks (bar:register), so a viewer is not shown
  // a page whose every request is refused.
  routePermissions: {
    '/crm/grill': 'bar:register',
    '/crm/floor': 'bar:register',
    '/crm/count': 'bar:register',
    '/crm/closeout': 'bar:register',
  },
  routeGates: {
    '/crm/reviews': ['google_reviews'],
    // Opened from the register, so no sidebar entry of their own.
    '/crm/grill': ['bar_register'],
    '/crm/floor': ['bar_register'],
    '/crm/count': ['bar_stock'],
    '/crm/closeout': ['bar_register'],
    // Reachable by typing the URL, with no sidebar entry to gate them: modules the registry does not offer a
    // bar at all, so gating on the real feature removes them without hardcoding "never". (Field Service T28 M1)
    '/crm/jobs': ['jobs'],
    '/crm/quotes': ['quotes'],
    '/crm/schedule': ['scheduling'],
    '/crm/fleet': ['fleet'],
    '/crm/locations': ['multi_location'],
    '/crm/commissions': ['commission_tracking'],
    '/crm/inventory': ['inventory'],
    '/crm/equipment': ['equipment_tracking'],
    '/crm/bookings': ['online_booking'],
    '/crm/pricebook': ['pricebook'],
    '/crm/pricebook-trial': ['pricebook'],
    '/crm/agreements': ['service_agreements'],
    '/crm/warranties': ['warranties'],
    '/crm/recurring': ['recurring_jobs'],
    '/crm/job-costing': ['job_costing'],
    '/crm/ads': ['paid_ads'],
    '/crm/projects': ['projects'],
    '/crm/change-orders': ['change_orders'],
    '/crm/selections': ['selections'],
    '/crm/lien-waivers': ['lien_waivers'],
    '/crm/submittal-review': ['submittals'],
    '/crm/rfis-assigned': ['rfis'],
    '/crm/shared-documents': ['documents'],
    '/crm/payment-methods': ['online_payments'],
  },
  // Reachable by URL with no sidebar entry to gate them, and every one is requireAdmin (or
  // requireRole('admin','owner')) on the server: emailAliases.ts, emailDomain.ts, billing.ts,
  // integrations.ts, migration.ts, import.ts. Rank here, not a permission, because rank is what the
  // server itself asks. Settings ITSELF stays open — Profile and Security live there, and the Company
  // form is read-only for anyone without company:update. (Field Service T30 M-R1)
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
