// This vertical's sidebar + URL gates for the shared app shell (see ./shared). Items without `features`
// are core; items with `features` show when ANY listed feature is enabled. routeGates cover routes
// that exist without a sidebar entry, so a module the tenant doesn't have is not reachable by URL.
import { BarChart3, BookOpen, Bot, CalendarCheck, CheckSquare, ClipboardCheck, ClipboardList, CreditCard, DollarSign, DoorOpen, ExternalLink, FileQuestion, FileText, FolderKanban, FolderOpen, Home, Inbox, LifeBuoy, ListTodo, Mail, Megaphone, MessageSquare, Phone, Receipt, Repeat, Scissors, ShieldCheck, Star, Target, Truck, Users, UtensilsCrossed, Warehouse, Wrench } from 'lucide-react';
import type { NavItem, ShellConfig } from './shared';

const NAV: NavItem[] = [
  { to: '/crm', icon: Home, label: 'Dashboard', exact: true },
  { to: '/crm/events', icon: CalendarCheck, label: 'Events', features: ['event_bookings'] },
  { to: '/crm/spaces', icon: DoorOpen, label: 'Spaces', features: ['event_spaces'] },
  { to: '/crm/menus', icon: UtensilsCrossed, label: 'Catering Menus', features: ['catering_menus'] },
  { to: '/crm/contacts', icon: Users, label: 'Contacts' },
  { to: '/crm/invoices', icon: Receipt, label: 'Invoices', features: ['invoices'], permission: 'invoices:read' },
  { to: '/crm/documents', icon: FolderOpen, label: 'Documents', features: ['documents'] },
  { to: '/crm/team', icon: Users, label: 'Team', permission: 'team:read' },
  { to: '/crm/reviews', icon: Star, label: 'Reviews', features: ['google_reviews'] },
  // The Marketing page is email marketing (campaigns, templates, drips); Reviews has its own item above. (T15 M5)
  { to: '/crm/marketing', icon: Megaphone, label: 'Marketing', features: ['email_marketing'], permission: 'marketing:read' },
  { to: '/crm/email', icon: Mail, label: 'Email', features: ['branded_email'], minRole: 'admin' },
  { to: '/crm/google-reviews', icon: Star, label: 'Google Reviews', features: ['google_business'], minRole: 'admin' },
  { to: '/crm/messages', icon: MessageSquare, label: 'Messages', features: ['two_way_texting'], permission: 'sms:send' },
  { to: '/crm/reports', icon: BarChart3, label: 'Reports', features: ['reports'], permission: 'reports:read' },
  // The audit trail. Behind reports:read, the same permission the /api/audit route requires, so the
  // entry never offers a seat a page it would be refused. (T51)
  { to: '/crm/audit', icon: FileText, label: 'Audit Log', permission: 'reports:read' },
  { to: '/crm/leads', icon: Inbox, label: 'Lead Inbox', features: ['lead_inbox'] },
  { to: '/crm/lead-sources', icon: ExternalLink, label: 'Lead Sources', features: ['lead_inbox'] },
  { to: '/crm/support', icon: LifeBuoy, label: 'Support', features: ['support_tickets'] },
  { to: '/crm/help', icon: BookOpen, label: 'Help' },

  { to: '/crm/contact-support', icon: LifeBuoy, label: 'Contact Twomiah' },
];

export const SHELL: ShellConfig = {
  nav: NAV,
  searchPlaceholder: 'Search events, contacts, invoices...',
  routeGates: {
  '/crm/jobs': ['jobs'],
  '/crm/quotes': ['quotes'],
  '/crm/schedule': ['scheduling'],
  '/crm/marketing': ['email_marketing'],
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
